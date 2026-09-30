import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

const projectId = 'demo-tara';
const authPort = 9198;
const firestorePort = 8180;
const functionsPort = 5101;

async function anonymousUser() {
  const response = await fetch(`http://127.0.0.1:${authPort}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  return await response.json() as { localId: string; idToken: string };
}

async function callSubmitChat(token: string, data: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${functionsPort}/${projectId}/asia-east2/submitChat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await response.json() as { result?: { messageId: string }; error?: { status: string; message: string } };
  return { response, body };
}

async function callFunction(token: string, name: string, data: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${functionsPort}/${projectId}/asia-east2/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await response.json() as { result?: Record<string, unknown>; error?: { status: string; message: string } };
  return { response, body };
}

test('chat authorization, validation, idempotency, and rate limits', async () => {
  const environment = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: firestorePort },
  });
  try {
    const sender = await anonymousUser();
    const other = await anonymousUser();
    const outsider = await anonymousUser();
    await environment.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, 'plans/plan-test'), { status: 'active', organizerId: sender.localId });
      await setDoc(doc(admin, `plans/plan-test/members/${sender.localId}`), { planId: 'plan-test', userId: sender.localId, name: 'Sender', role: 'organizer' });
      await setDoc(doc(admin, `plans/plan-test/members/${other.localId}`), { planId: 'plan-test', userId: other.localId, name: 'Other', role: 'member' });
      await setDoc(doc(admin, 'plans/plan-test/messages/seed'), { senderId: other.localId, senderName: 'Other', text: 'Hi', mentionUserIds: [], request: null, operationId: 'seed', createdAt: new Date().toISOString() });
    });

    const memberDb = environment.authenticatedContext(sender.localId).firestore();
    const outsiderDb = environment.authenticatedContext(outsider.localId).firestore();
    await assertSucceeds(getDoc(doc(memberDb, 'plans/plan-test/messages/seed')));
    await assertFails(getDoc(doc(outsiderDb, 'plans/plan-test/messages/seed')));
    await assertSucceeds(getDocs(query(collectionGroup(memberDb, 'members'), where('userId', '==', sender.localId))));
    await assertFails(getDocs(collectionGroup(memberDb, 'members')));
    await assertFails(setDoc(doc(memberDb, 'plans/plan-test/messages/forged'), { senderId: sender.localId, text: 'forged' }));
    await assertSucceeds(setDoc(doc(memberDb, `users/${sender.localId}/planSettings/plan-test`), { planId: 'plan-test', notificationsMuted: true }));
    await assertFails(setDoc(doc(outsiderDb, `users/${sender.localId}/planSettings/plan-test`), { planId: 'plan-test', notificationsMuted: true }));
    await assertSucceeds(setDoc(doc(memberDb, `users/${sender.localId}/devices/device`), { token: 'ExponentPushToken[test]', platform: 'android', updatedAt: new Date().toISOString() }));
    await assertFails(getDoc(doc(memberDb, `users/${sender.localId}/devices/device`)));

    const base = { planId: 'plan-test', text: 'Hello', mentionUserIds: [], operationId: 'duplicate' };
    const first = await callSubmitChat(sender.idToken, base);
    const duplicate = await callSubmitChat(sender.idToken, base);
    assert.equal(first.response.ok, true);
    assert.equal(duplicate.response.ok, true);
    assert.equal(first.body.result?.messageId, duplicate.body.result?.messageId);

    const invalidMention = await callSubmitChat(sender.idToken, { ...base, operationId: 'invalid-mention', mentionUserIds: [outsider.localId] });
    assert.equal(invalidMention.response.ok, false);
    assert.equal(invalidMention.body.error?.status, 'FAILED_PRECONDITION');

    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `users/${sender.localId}/rateLimits/chat`), { windowStartedAt: new Date(0), count: 0, notifyingCount: 0 });
    });
    for (let index = 0; index < 30; index += 1) {
      const result = await callSubmitChat(sender.idToken, { ...base, operationId: `rate-${index}` });
      assert.equal(result.response.ok, true, `submission ${index + 1} should succeed`);
    }
    const limited = await callSubmitChat(sender.idToken, { ...base, operationId: 'rate-blocked' });
    assert.equal(limited.response.ok, false);
    assert.equal(limited.body.error?.status, 'RESOURCE_EXHAUSTED');

    await environment.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      const lockedDate = new Date(Date.now() + 12 * 60 * 60_000).toISOString();
      await setDoc(doc(admin, 'plans/plan-locked'), {
        title: 'Locked plan', description: '', location: '', timezone: 'UTC', coverUri: null,
        dateTime: lockedDate, status: 'active', organizerId: sender.localId, organizerName: 'Sender', inviteCode: 'LOCKED',
      });
      await setDoc(doc(admin, `plans/plan-locked/members/${sender.localId}`), { planId: 'plan-locked', userId: sender.localId, name: 'Sender', role: 'organizer' });
      await setDoc(doc(admin, 'invites/LOCKED'), { planId: 'plan-locked', active: true });
    });

    const dateChange = await callFunction(sender.idToken, 'updatePlanSecure', {
      planId: 'plan-locked', title: 'Locked plan', description: '', location: '', timezone: 'UTC', coverUri: null,
      dateTime: new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString(),
    });
    assert.equal(dateChange.body.error?.status, 'FAILED_PRECONDITION');
    const finished = await callFunction(sender.idToken, 'finishPlanSecure', { planId: 'plan-locked' });
    assert.equal(finished.response.ok, true);
    const mutationAfterFinish = await callFunction(sender.idToken, 'mutatePlanSecure', { action: 'setRsvp', planId: 'plan-locked', status: 'going' });
    assert.equal(mutationAfterFinish.body.error?.status, 'FAILED_PRECONDITION');

    await environment.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      const messages = await getDocs(collection(admin, 'plans/plan-test/messages'));
      assert.equal(messages.docs.filter((entry) => entry.data().operationId === 'duplicate').length, 1);
    });
  } finally {
    await environment.cleanup();
  }
});
