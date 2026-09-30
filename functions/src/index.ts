import { initializeApp } from 'firebase-admin/app';
import { randomBytes } from 'node:crypto';
import { FieldValue, Timestamp, getFirestore, type DocumentReference, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger, setGlobalOptions } from 'firebase-functions';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { normalizeChatInput, notificationRecipients } from './logic.js';

initializeApp();
setGlobalOptions({ region: 'asia-east2', maxInstances: 20 });

const db = getFirestore();
const MAX_SUBMISSIONS = 30;
const MAX_NOTIFYING_SUBMISSIONS = 5;
const RATE_WINDOW_MS = 60_000;
const MAX_PUSH_ATTEMPTS = 3;

function cleanString(value: unknown, label: string, max: number, required = true) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    throw new HttpsError('invalid-argument', `${label} is required.`);
  }
  const clean = value.trim();
  if ((required && !clean) || clean.length > max) throw new HttpsError('invalid-argument', `${label} is invalid.`);
  return clean;
}

function cleanId(value: unknown, label: string) {
  const clean = cleanString(value, label, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) throw new HttpsError('invalid-argument', `${label} is invalid.`);
  return clean;
}

async function consumeRateLimit(
  transaction: Transaction,
  uid: string,
  bucket: string,
  maximum: number,
  windowMs: number,
) {
  const rateRef = db.doc(`users/${uid}/rateLimits/${bucket}`);
  const snapshot = await transaction.get(rateRef);
  const now = Timestamp.now();
  const startedAt = snapshot.exists && snapshot.get('windowStartedAt') instanceof Timestamp
    ? snapshot.get('windowStartedAt') as Timestamp
    : undefined;
  const sameWindow = Boolean(startedAt && now.toMillis() - startedAt.toMillis() < windowMs);
  const count = sameWindow ? Number(snapshot.get('count') || 0) : 0;
  if (count >= maximum) throw new HttpsError('resource-exhausted', 'You are making changes too quickly. Please wait and try again.');
  transaction.set(rateRef, { windowStartedAt: sameWindow ? startedAt : now, count: count + 1 });
}

function normalizePlan(value: unknown) {
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', 'Plan details are required.');
  const data = value as Record<string, unknown>;
  const dateTime = data.dateTime == null ? null : cleanString(data.dateTime, 'Date', 64);
  if (dateTime && Number.isNaN(Date.parse(dateTime))) throw new HttpsError('invalid-argument', 'Date is invalid.');
  if (dateTime && Date.parse(dateTime) <= Date.now()) throw new HttpsError('invalid-argument', 'Choose a future date for this plan.');
  const coverUri = data.coverUri == null ? null : cleanString(data.coverUri, 'Cover URL', 2048, false);
  if (coverUri && !coverUri.startsWith('https://')) throw new HttpsError('invalid-argument', 'Cover URL is invalid.');
  return {
    title: cleanString(data.title, 'Title', 80),
    description: cleanString(data.description, 'Description', 500, false),
    dateTime,
    location: cleanString(data.location, 'Location', 200, false),
    timezone: cleanString(data.timezone, 'Timezone', 100),
    coverUri,
  };
}

function planIsReadOnly(plan: DocumentSnapshot) {
  if (plan.get('status') !== 'active') return true;
  const dateTime = plan.get('dateTime');
  return typeof dateTime === 'string' && Date.parse(dateTime) <= Date.now();
}

function inviteCode() {
  return randomBytes(6).toString('base64url').toUpperCase();
}

function asHttpsError(error: unknown) {
  if (error instanceof HttpsError) return error;
  const message = error instanceof Error ? error.message : 'The message could not be sent.';
  return new HttpsError('invalid-argument', message);
}

export const createPlanSecure = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before creating a plan.');
  const plan = normalizePlan(request.data);
  const uid = request.auth.uid;
  const planRef = db.collection('plans').doc();
  const code = inviteCode();
  const userRef = db.doc(`users/${uid}`);
  await db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    await consumeRateLimit(transaction, uid, 'createPlan', 5, 60 * 60_000);
    const organizerName = userSnapshot.get('name') || request.auth?.token.name || 'Guest';
    transaction.create(planRef, {
      ...plan,
      organizerId: uid,
      organizerName,
      status: 'active',
      inviteCode: code,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(planRef.collection('members').doc(uid), {
      planId: planRef.id,
      userId: uid,
      name: organizerName,
      role: 'organizer',
      joinedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(planRef.collection('rsvps').doc(uid), {
      planId: planRef.id,
      userId: uid,
      name: organizerName,
      status: 'going',
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(db.doc(`invites/${code}`), {
      code,
      planId: planRef.id,
      title: plan.title,
      location: plan.location,
      dateTime: plan.dateTime,
      organizerName,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { planId: planRef.id };
});

export const updatePlanSecure = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before updating a plan.');
  const data = request.data as Record<string, unknown>;
  const planId = cleanId(data?.planId, 'Plan');
  const plan = normalizePlan(data);
  const uid = request.auth.uid;
  const planRef = db.doc(`plans/${planId}`);
  let deleteCover = false;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(planRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'That plan no longer exists.');
    if (snapshot.get('organizerId') !== uid) throw new HttpsError('permission-denied', 'Only the organizer can edit this plan.');
    if (planIsReadOnly(snapshot)) throw new HttpsError('failed-precondition', 'Finished plans cannot be edited.');
    const currentDateTime = snapshot.get('dateTime');
    if (currentDateTime !== plan.dateTime && typeof currentDateTime === 'string'
      && Date.parse(currentDateTime) - Date.now() <= 24 * 60 * 60_000) {
      throw new HttpsError('failed-precondition', 'The date cannot be changed within 24 hours of the plan.');
    }
    deleteCover = plan.coverUri === null && Boolean(snapshot.get('coverUri'));
    await consumeRateLimit(transaction, uid, 'updatePlan', 20, 10 * 60_000);
    transaction.update(planRef, { ...plan, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(db.doc(`invites/${snapshot.get('inviteCode')}`), {
      title: plan.title,
      location: plan.location,
      dateTime: plan.dateTime,
      organizerName: snapshot.get('organizerName'),
    }, { merge: true });
  });
  if (deleteCover) {
    await getStorage().bucket().file(`plans/${planId}/cover`).delete({ ignoreNotFound: true });
  }
  return { ok: true };
});

export const joinPlanSecure = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in or continue as a guest before joining.');
  const data = request.data as Record<string, unknown>;
  const code = cleanString(data?.code, 'Invite code', 32).toUpperCase();
  const name = cleanString(data?.name, 'Name', 80);
  const uid = request.auth.uid;
  const inviteRef = db.doc(`invites/${code}`);
  let joinedPlanId = '';
  await db.runTransaction(async (transaction) => {
    const invite = await transaction.get(inviteRef);
    if (!invite.exists || invite.get('active') !== true) throw new HttpsError('not-found', 'This invitation is invalid or no longer active.');
    const planId = cleanId(invite.get('planId'), 'Plan');
    joinedPlanId = planId;
    const planRef = db.doc(`plans/${planId}`);
    const [plan, existing] = await Promise.all([
      transaction.get(planRef),
      transaction.get(planRef.collection('members').doc(uid)),
    ]);
    if (!plan.exists || planIsReadOnly(plan)) throw new HttpsError('failed-precondition', 'This plan is finished and no longer accepting participants.');
    if (!existing.exists) await consumeRateLimit(transaction, uid, 'joinPlan', 10, 10 * 60_000);
    transaction.set(db.doc(`users/${uid}`), { id: uid, name, isGuest: request.auth?.token.firebase?.sign_in_provider === 'anonymous' }, { merge: true });
    transaction.set(planRef.collection('members').doc(uid), {
      planId,
      userId: uid,
      name,
      role: existing.exists ? existing.get('role') : 'member',
      joinedAt: existing.exists ? existing.get('joinedAt') : FieldValue.serverTimestamp(),
      inviteCode: code,
    }, { merge: true });
  });
  return { planId: joinedPlanId };
});

export const mutatePlanSecure = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before changing a plan.');
  const data = request.data as Record<string, unknown>;
  const action = cleanString(data?.action, 'Action', 40);
  const planId = cleanId(data?.planId, 'Plan');
  const uid = request.auth.uid;
  const planRef = db.doc(`plans/${planId}`);
  await db.runTransaction(async (transaction) => {
    const [plan, member] = await Promise.all([
      transaction.get(planRef),
      transaction.get(planRef.collection('members').doc(uid)),
    ]);
    if (!plan.exists || !member.exists) throw new HttpsError('permission-denied', 'Only plan members can make this change.');
    if (planIsReadOnly(plan)) throw new HttpsError('failed-precondition', 'This plan is finished and read-only.');
    const usesExistingItem = ['claimContribution', 'claimTask', 'toggleTask'].includes(action);
    const itemId = usesExistingItem ? cleanId(data.itemId, 'Item') : '';
    const collectionName = action === 'claimContribution' ? 'contributions' : 'tasks';
    const itemRef = usesExistingItem ? planRef.collection(collectionName).doc(itemId) : undefined;
    const item = itemRef ? await transaction.get(itemRef) : undefined;
    await consumeRateLimit(transaction, uid, 'planMutation', 60, 60_000);

    if (action === 'setRsvp') {
      const status = cleanString(data.status, 'RSVP', 10);
      if (!['going', 'maybe', 'no'].includes(status)) throw new HttpsError('invalid-argument', 'RSVP is invalid.');
      transaction.set(planRef.collection('rsvps').doc(uid), {
        planId, userId: uid, name: member.get('name') || 'Guest', status, updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }
    if (action === 'addContribution') {
      transaction.create(planRef.collection('contributions').doc(), {
        planId,
        name: cleanString(data.name, 'Item', 200),
        category: cleanString(data.category, 'Category', 80),
        createdBy: uid,
        claimedBy: null,
        claimedByName: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      return;
    }
    if (action === 'addTask') {
      transaction.create(planRef.collection('tasks').doc(), {
        planId,
        title: cleanString(data.title, 'Task', 200),
        createdBy: uid,
        assignedTo: null,
        assignedToName: null,
        done: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    if (!itemRef || !item?.exists) throw new HttpsError('not-found', 'That item no longer exists.');
    if (action === 'claimContribution') {
      const claimedBy = item.get('claimedBy');
      if (claimedBy && claimedBy !== uid) throw new HttpsError('already-exists', `${item.get('claimedByName') || 'Someone'} already claimed this.`);
      transaction.update(itemRef, {
        claimedBy: claimedBy === uid ? null : uid,
        claimedByName: claimedBy === uid ? null : member.get('name') || 'Guest',
      });
      return;
    }
    if (action === 'claimTask') {
      const assignedTo = item.get('assignedTo');
      if (assignedTo && assignedTo !== uid) throw new HttpsError('already-exists', `${item.get('assignedToName') || 'Someone'} is already doing this.`);
      transaction.update(itemRef, {
        assignedTo: assignedTo === uid ? null : uid,
        assignedToName: assignedTo === uid ? null : member.get('name') || 'Guest',
      });
      return;
    }
    if (action === 'toggleTask') {
      if (item.get('assignedTo') !== uid && plan.get('organizerId') !== uid) throw new HttpsError('permission-denied', 'Only the assignee or organizer can complete this task.');
      transaction.update(itemRef, { done: !item.get('done') });
      return;
    }
    throw new HttpsError('invalid-argument', 'Action is invalid.');
  });
  return { ok: true };
});

export const managePlanMembership = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before changing plan membership.');
  const data = request.data as Record<string, unknown>;
  const planId = cleanId(data?.planId, 'Plan');
  const action = cleanString(data?.action, 'Action', 20);
  if (action !== 'leave' && action !== 'remove') throw new HttpsError('invalid-argument', 'Membership action is invalid.');
  const uid = request.auth.uid;
  const targetUserId = action === 'leave' ? uid : cleanId(data?.userId, 'Participant');
  const planRef = db.doc(`plans/${planId}`);

  await db.runTransaction(async (transaction) => {
    const [plan, actor, target] = await Promise.all([
      transaction.get(planRef),
      transaction.get(planRef.collection('members').doc(uid)),
      transaction.get(planRef.collection('members').doc(targetUserId)),
    ]);
    if (!plan.exists || !actor.exists) throw new HttpsError('permission-denied', 'You are not a member of this plan.');
    if (plan.get('organizerId') === targetUserId) throw new HttpsError('failed-precondition', 'The organizer cannot leave or be removed. Delete the plan instead.');
    if (action === 'remove' && plan.get('organizerId') !== uid) throw new HttpsError('permission-denied', 'Only the organizer can remove participants.');
    if (action === 'remove' && planIsReadOnly(plan)) throw new HttpsError('failed-precondition', 'Finished plans cannot be modified.');
    if (!target.exists) return;
    const [claimedItems, assignedTasks] = await Promise.all([
      transaction.get(planRef.collection('contributions').where('claimedBy', '==', targetUserId)),
      transaction.get(planRef.collection('tasks').where('assignedTo', '==', targetUserId)),
    ]);
    await consumeRateLimit(transaction, uid, 'membership', 10, 10 * 60_000);
    transaction.delete(target.ref);
    transaction.delete(planRef.collection('rsvps').doc(targetUserId));
    transaction.delete(db.doc(`users/${targetUserId}/planSettings/${planId}`));
    claimedItems.docs.forEach((entry) => transaction.update(entry.ref, { claimedBy: null, claimedByName: null }));
    assignedTasks.docs.forEach((entry) => transaction.update(entry.ref, { assignedTo: null, assignedToName: null, done: false }));
  });
  return { ok: true };
});

export const finishPlanSecure = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before finishing a plan.');
  const data = request.data as Record<string, unknown>;
  const planId = cleanId(data?.planId, 'Plan');
  const uid = request.auth.uid;
  const planRef = db.doc(`plans/${planId}`);
  await db.runTransaction(async (transaction) => {
    const plan = await transaction.get(planRef);
    if (!plan.exists) throw new HttpsError('not-found', 'That plan no longer exists.');
    if (plan.get('organizerId') !== uid) throw new HttpsError('permission-denied', 'Only the organizer can finish this plan.');
    if (plan.get('status') !== 'active') return;
    await consumeRateLimit(transaction, uid, 'finishPlan', 10, 60 * 60_000);
    transaction.update(planRef, {
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const code = plan.get('inviteCode');
    if (typeof code === 'string') transaction.set(db.doc(`invites/${code}`), { active: false }, { merge: true });
  });
  return { ok: true };
});

export const deletePlanSecure = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before deleting a plan.');
  const data = request.data as Record<string, unknown>;
  const planId = cleanId(data?.planId, 'Plan');
  const uid = request.auth.uid;
  const planRef = db.doc(`plans/${planId}`);
  let code = '';
  let planExists = false;
  await db.runTransaction(async (transaction) => {
    const plan = await transaction.get(planRef);
    if (!plan.exists) return;
    planExists = true;
    if (plan.get('organizerId') !== uid) throw new HttpsError('permission-denied', 'Only the organizer can delete this plan.');
    await consumeRateLimit(transaction, uid, 'deletePlan', 3, 60 * 60_000);
    code = String(plan.get('inviteCode') || '');
    transaction.update(planRef, { status: 'deleting', updatedAt: FieldValue.serverTimestamp() });
    if (code) transaction.set(db.doc(`invites/${code}`), { active: false }, { merge: true });
  });

  if (!planExists) return { ok: true };

  const members = await planRef.collection('members').get();
  await db.recursiveDelete(planRef);
  await getStorage().bucket().deleteFiles({ prefix: `plans/${planId}/` });
  const cleanup = db.batch();
  if (code) cleanup.delete(db.doc(`invites/${code}`));
  members.docs.forEach((member) => cleanup.delete(db.doc(`users/${member.id}/planSettings/${planId}`)));
  await cleanup.commit();
  return { ok: true };
});

export const submitChat = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before sending a message.');
  let input;
  try {
    input = normalizeChatInput(request.data);
  } catch (error) {
    throw asHttpsError(error);
  }

  const uid = request.auth.uid;
  const planRef = db.doc(`plans/${input.planId}`);
  const senderRef = planRef.collection('members').doc(uid);
  const needsMemberList = input.mentionUserIds.length > 0 || Boolean(input.request);
  const membersSnapshot = needsMemberList ? await planRef.collection('members').get() : undefined;
  const memberIds = membersSnapshot?.docs.map((entry) => entry.id) || [];
  if (input.mentionUserIds.some((id) => !memberIds.includes(id))) {
    throw new HttpsError('failed-precondition', 'One of the mentioned members is no longer in this plan.');
  }
  const recipients = notificationRecipients(memberIds, uid, input.mentionUserIds, Boolean(input.request));
  const messageRef = planRef.collection('messages').doc();
  const operationRef = planRef.collection('operations').doc(`${uid}_${input.operationId}`);
  const rateRef = db.doc(`users/${uid}/rateLimits/chat`);
  const requestTargetRef = input.request?.targetId
    ? planRef.collection(input.request.kind === 'task' ? 'tasks' : 'contributions').doc(input.request.targetId)
    : undefined;
  const newTargetRef = input.request && !input.request.targetId
    ? planRef.collection(input.request.kind === 'task' ? 'tasks' : 'contributions').doc()
    : undefined;

  try {
    return await db.runTransaction(async (transaction) => {
      const [planSnapshot, senderSnapshot, operationSnapshot, rateSnapshot, targetSnapshot] = await Promise.all([
        transaction.get(planRef),
        transaction.get(senderRef),
        transaction.get(operationRef),
        transaction.get(rateRef),
        requestTargetRef ? transaction.get(requestTargetRef) : Promise.resolve(undefined),
      ]);
      if (operationSnapshot.exists) {
        return { messageId: operationSnapshot.get('messageId') as string };
      }
      if (!planSnapshot.exists || !senderSnapshot.exists) throw new HttpsError('permission-denied', 'Only plan members can use this chat.');
      if (planIsReadOnly(planSnapshot)) throw new HttpsError('failed-precondition', 'This plan is finished and read-only.');
      if (requestTargetRef && !targetSnapshot?.exists) throw new HttpsError('not-found', 'That board item is no longer available.');

      const nowMs = Date.now();
      const previousStart = rateSnapshot.exists && rateSnapshot.get('windowStartedAt') instanceof Timestamp
        ? (rateSnapshot.get('windowStartedAt') as Timestamp).toMillis()
        : 0;
      const sameWindow = nowMs - previousStart < RATE_WINDOW_MS;
      const count = sameWindow ? Number(rateSnapshot.get('count') || 0) : 0;
      const notifyingCount = sameWindow ? Number(rateSnapshot.get('notifyingCount') || 0) : 0;
      const producesNotification = recipients.length > 0;
      if (count >= MAX_SUBMISSIONS || (producesNotification && notifyingCount >= MAX_NOTIFYING_SUBMISSIONS)) {
        throw new HttpsError('resource-exhausted', 'You’re sending too quickly. Wait a minute and try again.');
      }

      const targetRef = requestTargetRef || newTargetRef;
      if (newTargetRef && input.request) {
        if (input.request.kind === 'task') {
          transaction.create(newTargetRef, {
            planId: input.planId,
            title: input.request.title || input.text,
            createdBy: uid,
            assignedTo: null,
            assignedToName: null,
            done: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        } else {
          transaction.create(newTargetRef, {
            planId: input.planId,
            name: input.request.title || input.text,
            category: 'Requested in chat',
            createdBy: uid,
            claimedBy: null,
            claimedByName: null,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }

      const requestReference = input.request && targetRef
        ? { kind: input.request.kind, targetId: targetRef.id }
        : null;
      transaction.create(messageRef, {
        planId: input.planId,
        senderId: uid,
        senderName: senderSnapshot.get('name') || 'Guest',
        text: input.text,
        mentionUserIds: input.mentionUserIds,
        request: requestReference,
        operationId: input.operationId,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(planRef, {
        chatLastMessageAt: FieldValue.serverTimestamp(),
        chatLastMessageId: messageRef.id,
      });
      transaction.create(operationRef, { senderId: uid, messageId: messageRef.id, createdAt: FieldValue.serverTimestamp() });
      transaction.set(rateRef, {
        windowStartedAt: sameWindow ? rateSnapshot.get('windowStartedAt') : Timestamp.now(),
        count: count + 1,
        notifyingCount: notifyingCount + (producesNotification ? 1 : 0),
      });

      recipients.forEach((recipientId) => {
        transaction.set(db.doc(`users/${recipientId}/planSettings/${input.planId}`), {
          planId: input.planId,
          lastPingAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        const jobRef = db.doc(`pushJobs/${messageRef.id}_${recipientId}`);
        transaction.create(jobRef, {
          recipientId,
          planId: input.planId,
          messageId: messageRef.id,
          kind: input.request ? 'request' : 'mention',
          title: input.request ? 'New request in Tara' : 'You were pinged in Tara',
          body: input.request ? 'A plan member asked the group for help.' : 'A plan member mentioned you.',
          status: 'pending',
          attempts: 0,
          createdAt: FieldValue.serverTimestamp(),
          nextAttemptAt: Timestamp.now(),
        });
      });

      return { messageId: messageRef.id };
    });
  } catch (error) {
    throw asHttpsError(error);
  }
});

async function queueClaimNotification(kind: 'contribution' | 'task', planId: string, itemId: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  const ownerField = kind === 'task' ? 'assignedTo' : 'claimedBy';
  const beforeOwner = before[ownerField];
  const afterOwner = after[ownerField];
  const recipientId = after.createdBy;
  if (beforeOwner || typeof afterOwner !== 'string' || typeof recipientId !== 'string' || afterOwner === recipientId) return;
  const jobId = `claim_${kind}_${planId}_${itemId}_${afterOwner}`;
  await db.doc(`pushJobs/${jobId}`).set({
    recipientId,
    planId,
    kind: 'claim',
    title: 'Someone volunteered in Tara',
    body: kind === 'task' ? 'A plan member claimed your task request.' : 'A plan member claimed your bring request.',
    status: 'pending',
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
    nextAttemptAt: Timestamp.now(),
  }, { merge: false });
}

export const contributionClaimed = onDocumentUpdated('plans/{planId}/contributions/{itemId}', async (event) => {
  if (!event.data) return;
  await queueClaimNotification('contribution', event.params.planId, event.params.itemId, event.data.before.data(), event.data.after.data());
});

export const taskClaimed = onDocumentUpdated('plans/{planId}/tasks/{itemId}', async (event) => {
  if (!event.data) return;
  await queueClaimNotification('task', event.params.planId, event.params.itemId, event.data.before.data(), event.data.after.data());
});

interface ClaimedJob {
  ref: DocumentReference;
  data: Record<string, unknown>;
}

async function claimPushJob(jobRef: DocumentReference): Promise<ClaimedJob | null> {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) return null;
    const data = snapshot.data() as Record<string, unknown>;
    const status = data.status;
    const leaseUntil = data.leaseUntil instanceof Timestamp ? data.leaseUntil.toMillis() : 0;
    if (!['pending', 'failed'].includes(String(status)) && !(status === 'processing' && leaseUntil < Date.now())) return null;
    if (data.nextAttemptAt instanceof Timestamp && data.nextAttemptAt.toMillis() > Date.now()) return null;
    const attempts = Number(data.attempts || 0);
    if (attempts >= MAX_PUSH_ATTEMPTS) {
      transaction.update(jobRef, { status: 'abandoned', completedAt: FieldValue.serverTimestamp() });
      return null;
    }
    transaction.update(jobRef, {
      status: 'processing',
      attempts: attempts + 1,
      leaseUntil: Timestamp.fromMillis(Date.now() + 60_000),
    });
    return { ref: jobRef, data: { ...data, attempts: attempts + 1 } };
  });
}

async function processPushJob(jobRef: DocumentReference) {
  const claimed = await claimPushJob(jobRef);
  if (!claimed) return;
  const { data } = claimed;
  const recipientId = String(data.recipientId);
  const planId = String(data.planId);
  try {
    const [configSnapshot, settingSnapshot, devicesSnapshot] = await Promise.all([
      db.doc('config/push').get(),
      db.doc(`users/${recipientId}/planSettings/${planId}`).get(),
      db.collection(`users/${recipientId}/devices`).get(),
    ]);
    if (configSnapshot.exists && configSnapshot.get('deliveryEnabled') === false) {
      await jobRef.update({ status: 'disabled', completedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (settingSnapshot.exists && settingSnapshot.get('notificationsMuted') === true) {
      await jobRef.update({ status: 'muted', completedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (devicesSnapshot.empty) {
      await jobRef.update({ status: 'no-devices', completedAt: FieldValue.serverTimestamp() });
      return;
    }
    const devices = devicesSnapshot.docs.filter((entry) => typeof entry.get('token') === 'string');
    const payloads = devices.map((entry) => ({
      to: entry.get('token') as string,
      sound: 'default',
      channelId: 'tara-pings',
      title: String(data.title),
      body: String(data.body),
      data: { planId, ...(data.messageId ? { messageId: String(data.messageId) } : {}) },
    }));
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(payloads),
    });
    if (!response.ok) throw new Error(`Expo push request failed with ${response.status}`);
    const result = await response.json() as { data?: Array<{ status: string; id?: string; details?: { error?: string } }> };
    const tickets = (result.data || []).flatMap((ticket, index) => {
      if (ticket.details?.error === 'DeviceNotRegistered') void devices[index]?.ref.delete();
      return ticket.status === 'ok' && ticket.id && devices[index]
        ? [{ id: ticket.id, devicePath: devices[index].ref.path }]
        : [];
    });
    await jobRef.update({
      status: tickets.length ? 'sent' : 'complete',
      tickets,
      sentAt: FieldValue.serverTimestamp(),
      receiptCheckAt: Timestamp.fromMillis(Date.now() + 15 * 60_000),
      leaseUntil: FieldValue.delete(),
    });
  } catch (error) {
    const attempts = Number(data.attempts || 1);
    logger.error('Push delivery failed', { jobId: jobRef.id, attempts, error: error instanceof Error ? error.message : 'unknown' });
    await jobRef.update({
      status: attempts >= MAX_PUSH_ATTEMPTS ? 'abandoned' : 'failed',
      nextAttemptAt: Timestamp.fromMillis(Date.now() + Math.min(15, 2 ** attempts) * 60_000),
      leaseUntil: FieldValue.delete(),
      lastErrorAt: FieldValue.serverTimestamp(),
    });
  }
}

export const pushJobCreated = onDocumentCreated('pushJobs/{jobId}', async (event) => {
  if (event.data) await processPushJob(event.data.ref);
});

async function checkReceipts(jobRef: DocumentReference, tickets: Array<{ id: string; devicePath: string }>) {
  if (!tickets.length) return;
  const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ ids: tickets.map((ticket) => ticket.id) }),
  });
  if (!response.ok) throw new Error(`Expo receipt request failed with ${response.status}`);
  const result = await response.json() as { data?: Record<string, { status: string; details?: { error?: string } }> };
  const receipts = result.data || {};
  await Promise.all(tickets.map(async (ticket) => {
    if (receipts[ticket.id]?.details?.error === 'DeviceNotRegistered') await db.doc(ticket.devicePath).delete();
  }));
  const errors = Object.values(receipts).map((receipt) => receipt.details?.error).filter(Boolean);
  await jobRef.update({ status: 'complete', receiptErrors: errors, completedAt: FieldValue.serverTimestamp() });
}

export const maintainPushQueue = onSchedule('every 5 minutes', async () => {
  const now = Timestamp.now();
  const [retrySnapshot, receiptSnapshot] = await Promise.all([
    db.collection('pushJobs').where('status', 'in', ['pending', 'failed']).where('nextAttemptAt', '<=', now).limit(100).get(),
    db.collection('pushJobs').where('status', '==', 'sent').where('receiptCheckAt', '<=', now).limit(100).get(),
  ]);
  await Promise.all(retrySnapshot.docs.map((entry) => processPushJob(entry.ref)));
  await Promise.all(receiptSnapshot.docs.map(async (entry) => {
    try {
      await checkReceipts(entry.ref, (entry.get('tickets') || []) as Array<{ id: string; devicePath: string }>);
    } catch (error) {
      logger.error('Push receipt check failed', { jobId: entry.id, error: error instanceof Error ? error.message : 'unknown' });
    }
  }));
});

export const autoFinishPlans = onSchedule('every 60 minutes', async () => {
  const snapshot = await db.collection('plans')
    .where('status', '==', 'active')
    .where('dateTime', '<=', new Date().toISOString())
    .limit(200)
    .get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach((plan) => {
    batch.update(plan.ref, {
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const code = plan.get('inviteCode');
    if (typeof code === 'string') batch.set(db.doc(`invites/${code}`), { active: false }, { merge: true });
  });
  await batch.commit();
});
