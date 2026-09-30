import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInAnonymously,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type Auth,
  type Persistence,
  type User,
} from '@firebase/auth';
import * as AuthModule from '@firebase/auth';
import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';

import type {
  ChatMessage,
  ChatSnapshot,
  ContributionItem,
  InvitePreview,
  Plan,
  PlanInput,
  PlanMember,
  PlanTask,
  RSVP,
  RSVPStatus,
  SendChatInput,
  TaraRepository,
  TaraState,
  TaraUser,
} from '@/types';

const NAME_KEY = '@tara/firebase-guest-name';
const PUSH_SYNC_KEY = '@tara/push-token-synced';
const CHAT_PAGE_SIZE = 50;
const PUSH_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

type SecurePlanInput = Omit<PlanInput, 'coverUri'> & {
  coverUri: string | null;
  timezone: string;
};

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean);

function timestamp(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

function mapPlan(id: string, data: DocumentData): Plan {
  const dateTime = data.dateTime || null;
  const storedStatus = data.status || 'active';
  return {
    id,
    title: data.title,
    description: data.description || '',
    dateTime,
    timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    location: data.location || '',
    organizerId: data.organizerId,
    organizerName: data.organizerName,
    status: storedStatus === 'active' && dateTime && new Date(dateTime).getTime() <= Date.now() ? 'completed' : storedStatus,
    coverUri: data.coverUri,
    inviteCode: data.inviteCode,
    createdAt: timestamp(data.createdAt),
    updatedAt: timestamp(data.updatedAt),
    chatLastMessageAt: data.chatLastMessageAt ? timestamp(data.chatLastMessageAt) : undefined,
    chatLastMessageId: data.chatLastMessageId,
  };
}

function mapChatMessage(planId: string, id: string, data: DocumentData): ChatMessage {
  return {
    id,
    planId,
    senderId: data.senderId,
    senderName: data.senderName,
    text: data.text,
    mentionUserIds: Array.isArray(data.mentionUserIds) ? data.mentionUserIds : [],
    request: data.request?.kind && data.request?.targetId
      ? { kind: data.request.kind, targetId: data.request.targetId }
      : null,
    operationId: data.operationId,
    createdAt: timestamp(data.createdAt),
  };
}

interface ChatSession {
  listener: (snapshot: ChatSnapshot) => void;
  unsubscribe: Unsubscribe;
  live: Map<string, ChatMessage>;
  older: Map<string, ChatMessage>;
  oldestDocument?: QueryDocumentSnapshot<DocumentData>;
  hasOlder: boolean;
  loading: boolean;
}

export class FirebaseRepository implements TaraRepository {
  private auth: Auth;
  private db;
  private storage;
  private functions: Functions;
  private listeners = new Set<(state: TaraState) => void>();
  private rootUnsubscribers: Unsubscribe[] = [];
  private planUnsubscribers = new Map<string, Unsubscribe[]>();
  private authUnsubscribe?: Unsubscribe;
  private plans = new Map<string, Plan>();
  private members = new Map<string, PlanMember>();
  private rsvps = new Map<string, RSVP>();
  private contributions = new Map<string, ContributionItem>();
  private tasks = new Map<string, PlanTask>();
  private planSettings = new Map<string, { lastReadAt?: string; lastPingAt?: string; notificationsMuted: boolean }>();
  private chatSessions = new Map<string, ChatSession>();
  private state: TaraState = {
    currentUser: { id: '', name: 'You', isGuest: true },
    isAuthenticated: false,
    authMethod: null,
    plans: [],
    members: [],
    rsvps: [],
    contributions: [],
    tasks: [],
    chatStatuses: [],
    loading: true,
  };

  constructor() {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    try {
      const nativeAuth = AuthModule as typeof AuthModule & {
        getReactNativePersistence(storage: typeof AsyncStorage): Persistence;
      };
      this.auth = Platform.OS === 'web'
        ? getAuth(app)
        : initializeAuth(app, { persistence: nativeAuth.getReactNativePersistence(AsyncStorage) });
    } catch {
      this.auth = getAuth(app);
    }
    this.db = getFirestore(app);
    this.storage = getStorage(app);
    this.functions = getFunctions(app, 'asia-east2');
  }

  subscribe(listener: (state: TaraState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.state = {
      ...this.state,
      plans: [...this.plans.values()].sort((a, b) => (a.dateTime || '9999').localeCompare(b.dateTime || '9999')),
      members: [...this.members.values()],
      rsvps: [...this.rsvps.values()],
      contributions: [...this.contributions.values()],
      tasks: [...this.tasks.values()],
      chatStatuses: [...this.plans.values()].map((plan) => {
        const setting = this.planSettings.get(plan.id);
        const lastReadAt = setting?.lastReadAt;
        return {
          planId: plan.id,
          notificationsMuted: setting?.notificationsMuted || false,
          lastReadAt,
          lastPingAt: setting?.lastPingAt,
          unread: Boolean(plan.chatLastMessageAt && (!lastReadAt || plan.chatLastMessageAt > lastReadAt)),
          unreadPing: Boolean(setting?.lastPingAt && (!lastReadAt || setting.lastPingAt > lastReadAt)),
        };
      }),
      loading: false,
    };
    this.listeners.forEach((listener) => listener(this.state));
  }

  async start() {
    if (this.authUnsubscribe) return;
    await new Promise<void>((resolve, reject) => {
      let initial = true;
      this.authUnsubscribe = onAuthStateChanged(this.auth, (user) => {
        void this.handleAuthUser(user).then(() => {
          if (initial) {
            initial = false;
            resolve();
          }
        }).catch((error: unknown) => {
          if (initial) {
            initial = false;
            reject(error);
          } else {
            console.warn('Authentication state refresh failed', error);
          }
        });
      });
    });
  }

  private clearDataSubscriptions() {
    this.rootUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.rootUnsubscribers = [];
    this.planUnsubscribers.forEach((unsubscribers) => unsubscribers.forEach((unsubscribe) => unsubscribe()));
    this.planUnsubscribers.clear();
    this.chatSessions.forEach((session) => session.unsubscribe());
    this.chatSessions.clear();
    this.plans.clear();
    this.members.clear();
    this.rsvps.clear();
    this.contributions.clear();
    this.tasks.clear();
    this.planSettings.clear();
  }

  private async handleAuthUser(user: User | null) {
    this.clearDataSubscriptions();
    if (!user) {
      this.state = {
        ...this.state,
        currentUser: { id: '', name: 'You', isGuest: true },
        isAuthenticated: false,
        authMethod: null,
      };
      this.emit();
      return;
    }

    const savedName = (await AsyncStorage.getItem(NAME_KEY)) || 'You';
    const fallbackName = user.isAnonymous
      ? savedName
      : user.displayName || user.email?.split('@')[0] || 'You';
    const authMethod = user.isAnonymous
      ? 'anonymous'
      : user.providerData.some((provider) => provider.providerId === GoogleAuthProvider.PROVIDER_ID)
        ? 'google'
        : 'password';
    const uid = user.uid;
    this.state = {
      ...this.state,
      currentUser: { id: uid, name: fallbackName, avatar: user.photoURL || undefined, isGuest: user.isAnonymous },
      isAuthenticated: true,
      authMethod,
    };

    this.rootUnsubscribers.push(
      onSnapshot(doc(this.db, 'users', uid), (snapshot) => {
        if (snapshot.exists()) {
          this.state = {
            ...this.state,
            currentUser: {
              id: uid,
              name: snapshot.data().name || fallbackName,
              avatar: snapshot.data().avatar || user.photoURL || undefined,
              isGuest: user.isAnonymous,
            },
          };
          this.emit();
        }
      }),
      onSnapshot(query(collectionGroup(this.db, 'members'), where('userId', '==', uid)), (snapshot) => {
        const planIds = snapshot.docs
          .map((memberDoc) => memberDoc.ref.parent.parent?.id)
          .filter((id): id is string => Boolean(id));
        this.bindPlans([...new Set(planIds)]);
      }),
      onSnapshot(collection(this.db, 'users', uid, 'planSettings'), (snapshot) => {
        this.planSettings.clear();
        snapshot.docs.forEach((entry) => {
          const data = entry.data();
          this.planSettings.set(entry.id, {
            lastReadAt: data.lastReadAt ? timestamp(data.lastReadAt) : undefined,
            lastPingAt: data.lastPingAt ? timestamp(data.lastPingAt) : undefined,
            notificationsMuted: Boolean(data.notificationsMuted),
          });
        });
        this.emit();
      }),
    );
    this.emit();
  }

  private bindPlans(planIds: string[]) {
    const nextIds = new Set(planIds);
    for (const [planId, unsubscribers] of this.planUnsubscribers) {
      if (nextIds.has(planId)) continue;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      this.planUnsubscribers.delete(planId);
      this.plans.delete(planId);
      for (const [key, value] of this.members) if (value.planId === planId) this.members.delete(key);
      for (const [key, value] of this.rsvps) if (value.planId === planId) this.rsvps.delete(key);
      for (const [key, value] of this.contributions) if (value.planId === planId) this.contributions.delete(key);
      for (const [key, value] of this.tasks) if (value.planId === planId) this.tasks.delete(key);
      this.chatSessions.get(planId)?.unsubscribe();
      this.chatSessions.delete(planId);
    }

    for (const planId of nextIds) {
      if (this.planUnsubscribers.has(planId)) continue;
      const planRef = doc(this.db, 'plans', planId);
      const unsubscribers = [
        onSnapshot(planRef, (snapshot) => {
          if (snapshot.exists()) this.plans.set(planId, mapPlan(planId, snapshot.data()));
          else this.plans.delete(planId);
          this.emit();
        }),
        onSnapshot(collection(planRef, 'members'), (snapshot) => {
          for (const [key, member] of this.members) if (member.planId === planId) this.members.delete(key);
          snapshot.docs.forEach((entry) => {
            const data = entry.data();
            this.members.set(`${planId}:${entry.id}`, {
              planId,
              userId: entry.id,
              name: data.name,
              role: data.role,
              joinedAt: timestamp(data.joinedAt),
              inviteCode: data.inviteCode,
            });
          });
          this.emit();
        }),
        onSnapshot(collection(planRef, 'rsvps'), (snapshot) => {
          for (const [key, rsvp] of this.rsvps) if (rsvp.planId === planId) this.rsvps.delete(key);
          snapshot.docs.forEach((entry) => {
            const data = entry.data();
            this.rsvps.set(`${planId}:${entry.id}`, {
              planId,
              userId: entry.id,
              name: data.name,
              status: data.status,
              updatedAt: timestamp(data.updatedAt),
            });
          });
          this.emit();
        }),
        onSnapshot(collection(planRef, 'contributions'), (snapshot) => {
          for (const [key, item] of this.contributions) if (item.planId === planId) this.contributions.delete(key);
          snapshot.docs.forEach((entry) => {
            const data = entry.data();
            this.contributions.set(`${planId}:${entry.id}`, {
              id: entry.id,
              planId,
              name: data.name,
              category: data.category,
              createdBy: data.createdBy,
              claimedBy: data.claimedBy || null,
              claimedByName: data.claimedByName || null,
              createdAt: timestamp(data.createdAt),
            });
          });
          this.emit();
        }),
        onSnapshot(collection(planRef, 'tasks'), (snapshot) => {
          for (const [key, task] of this.tasks) if (task.planId === planId) this.tasks.delete(key);
          snapshot.docs.forEach((entry) => {
            const data = entry.data();
            this.tasks.set(`${planId}:${entry.id}`, {
              id: entry.id,
              planId,
              title: data.title,
              createdBy: data.createdBy,
              assignedTo: data.assignedTo || null,
              assignedToName: data.assignedToName || null,
              done: Boolean(data.done),
              createdAt: timestamp(data.createdAt),
            });
          });
          this.emit();
        }),
      ];
      this.planUnsubscribers.set(planId, unsubscribers);
    }
    this.emit();
  }

  private async createUserProfile(user: User, name: string) {
    const cleanName = name.trim() || user.displayName || user.email?.split('@')[0] || 'You';
    await setDoc(doc(this.db, 'users', user.uid), {
      id: user.uid,
      name: cleanName,
      avatar: user.photoURL || null,
      isGuest: user.isAnonymous,
      createdAt: new Date().toISOString(),
    });
  }

  async continueAsGuest() {
    const savedName = (await AsyncStorage.getItem(NAME_KEY)) || 'You';
    const credential = await signInAnonymously(this.auth);
    await this.createUserProfile(credential.user, savedName);
  }

  async signInWithEmail(email: string, password: string) {
    await signInWithEmailAndPassword(this.auth, email.trim().toLowerCase(), password);
  }

  async signUpWithEmail(name: string, email: string, password: string) {
    const cleanName = name.trim();
    if (!cleanName) throw new Error('Please enter your name.');
    const credential = await createUserWithEmailAndPassword(this.auth, email.trim().toLowerCase(), password);
    await updateProfile(credential.user, { displayName: cleanName });
    await this.createUserProfile(credential.user, cleanName);
  }

  async signInWithGoogle(idToken?: string) {
    if (Platform.OS !== 'web' && !idToken) throw new Error('Google did not return a secure sign-in token.');
    const credential = Platform.OS === 'web'
      ? await signInWithPopup(this.auth, new GoogleAuthProvider())
      : await signInWithCredential(this.auth, GoogleAuthProvider.credential(idToken!));
    if (getAdditionalUserInfo(credential)?.isNewUser) {
      await this.createUserProfile(credential.user, credential.user.displayName || 'You');
    }
  }

  async signOut() {
    await firebaseSignOut(this.auth);
  }

  private get user(): TaraUser {
    if (!this.auth.currentUser) throw new Error('Your session is not ready.');
    return this.state.currentUser;
  }

  async setGuestName(name: string) {
    const cleanName = name.trim();
    if (!cleanName) throw new Error('Please enter your name.');
    if (cleanName === this.state.currentUser.name) return;
    await AsyncStorage.setItem(NAME_KEY, cleanName);
    await setDoc(doc(this.db, 'users', this.user.id), { name: cleanName }, { merge: true });
    this.state = { ...this.state, currentUser: { ...this.state.currentUser, name: cleanName } };
    this.emit();
  }

  async createPlan(input: PlanInput) {
    const create = httpsCallable<SecurePlanInput, { planId: string }>(this.functions, 'createPlanSecure');
    const result = await create({ ...input, coverUri: null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const planId = result.data.planId;

    if (input.coverUri) {
      try {
        const coverUri = await this.uploadPlanCover(planId, input.coverUri);
        const update = httpsCallable<SecurePlanInput & { planId: string }, { ok: boolean }>(this.functions, 'updatePlanSecure');
        await update({ ...input, planId, coverUri, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      } catch {
        // The plan is still usable; the form can add a cover again during editing.
      }
    }
    return planId;
  }

  async updatePlan(planId: string, input: PlanInput) {
    const plan = this.plans.get(planId);
    if (!plan || plan.organizerId !== this.user.id) throw new Error('Only the organizer can edit this plan.');
    let coverUri = input.coverUri || null;
    if (input.coverUri?.startsWith('file:') || input.coverUri?.startsWith('content:')) {
      coverUri = await this.uploadPlanCover(planId, input.coverUri);
    }
    const update = httpsCallable<SecurePlanInput & { planId: string }, { ok: boolean }>(this.functions, 'updatePlanSecure');
    await update({ ...input, planId, coverUri, timezone: plan.timezone });
  }

  private async uploadPlanCover(planId: string, uri: string) {
    const response = await fetch(uri);
    const blob = await response.blob();
    const coverRef = ref(this.storage, `plans/${planId}/cover`);
    await uploadBytes(coverRef, blob, { contentType: blob.type || 'image/jpeg' });
    return getDownloadURL(coverRef);
  }

  async getInvitePreview(code: string): Promise<InvitePreview | null> {
    const normalized = code.trim().toUpperCase();
    const snapshot = await getDoc(doc(this.db, 'invites', normalized));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return {
      code: normalized,
      planId: data.planId,
      title: data.title,
      location: data.location || '',
      dateTime: data.dateTime || null,
      organizerName: data.organizerName,
      active: Boolean(data.active) && (!data.dateTime || new Date(data.dateTime).getTime() > Date.now()),
    };
  }

  async joinPlan(code: string, name: string) {
    const join = httpsCallable<{ code: string; name: string }, { planId: string }>(this.functions, 'joinPlanSecure');
    const result = await join({ code: code.trim().toUpperCase(), name: name.trim() });
    if (this.user.isGuest) await AsyncStorage.setItem(NAME_KEY, name.trim());
    return result.data.planId;
  }

  async setRsvp(planId: string, status: RSVPStatus) {
    const current = this.rsvps.get(`${planId}:${this.user.id}`);
    if (current?.status === status) return;
    const mutate = httpsCallable(this.functions, 'mutatePlanSecure');
    await mutate({ action: 'setRsvp', planId, status });
  }

  async addContribution(planId: string, name: string, category: string) {
    const mutate = httpsCallable(this.functions, 'mutatePlanSecure');
    await mutate({ action: 'addContribution', planId, name: name.trim(), category });
  }

  async claimContribution(planId: string, itemId: string) {
    const mutate = httpsCallable(this.functions, 'mutatePlanSecure');
    await mutate({ action: 'claimContribution', planId, itemId });
  }

  async addTask(planId: string, title: string) {
    const mutate = httpsCallable(this.functions, 'mutatePlanSecure');
    await mutate({ action: 'addTask', planId, title: title.trim() });
  }

  async claimTask(planId: string, taskId: string) {
    const mutate = httpsCallable(this.functions, 'mutatePlanSecure');
    await mutate({ action: 'claimTask', planId, itemId: taskId });
  }

  async toggleTask(planId: string, taskId: string) {
    const mutate = httpsCallable(this.functions, 'mutatePlanSecure');
    await mutate({ action: 'toggleTask', planId, itemId: taskId });
  }

  private emitChatSession(planId: string) {
    const session = this.chatSessions.get(planId);
    if (!session) return;
    const messages = [...session.older.values(), ...session.live.values()]
      .filter((message, index, all) => all.findIndex((candidate) => candidate.id === message.id) === index)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    session.listener({ messages, loading: session.loading, hasOlder: session.hasOlder });
  }

  subscribeChat(planId: string, listener: (snapshot: ChatSnapshot) => void) {
    this.chatSessions.get(planId)?.unsubscribe();
    const messagesQuery = query(
      collection(this.db, 'plans', planId, 'messages'),
      orderBy('createdAt', 'desc'),
      orderBy(documentId(), 'desc'),
      limit(CHAT_PAGE_SIZE),
    );
    const session: ChatSession = {
      listener,
      unsubscribe: () => undefined,
      live: new Map(),
      older: new Map(),
      hasOlder: false,
      loading: true,
    };
    this.chatSessions.set(planId, session);
    listener({ messages: [], loading: true, hasOlder: false });
    session.unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const nextLive = new Map<string, ChatMessage>();
      snapshot.docs.forEach((entry) => nextLive.set(entry.id, mapChatMessage(planId, entry.id, entry.data())));
      session.live.forEach((message, id) => {
        if (!nextLive.has(id)) session.older.set(id, message);
      });
      session.live = nextLive;
      if (!session.oldestDocument && snapshot.docs.length) {
        session.oldestDocument = snapshot.docs[snapshot.docs.length - 1];
      }
      session.hasOlder = snapshot.docs.length === CHAT_PAGE_SIZE;
      session.loading = false;
      this.emitChatSession(planId);
    }, (error) => {
      session.loading = false;
      listener({ messages: [], loading: false, hasOlder: false });
      console.warn('Chat listener failed', error.code);
    });
    return () => {
      if (this.chatSessions.get(planId) === session) this.chatSessions.delete(planId);
      session.unsubscribe();
    };
  }

  async loadOlderChat(planId: string) {
    const session = this.chatSessions.get(planId);
    if (!session?.oldestDocument || !session.hasOlder) return;
    const olderQuery = query(
      collection(this.db, 'plans', planId, 'messages'),
      orderBy('createdAt', 'desc'),
      orderBy(documentId(), 'desc'),
      startAfter(session.oldestDocument),
      limit(CHAT_PAGE_SIZE),
    );
    const snapshot = await getDocs(olderQuery);
    snapshot.docs.forEach((entry) => session.older.set(entry.id, mapChatMessage(planId, entry.id, entry.data())));
    if (snapshot.docs.length) session.oldestDocument = snapshot.docs[snapshot.docs.length - 1];
    session.hasOlder = snapshot.docs.length === CHAT_PAGE_SIZE;
    this.emitChatSession(planId);
  }

  async ensureChatMessage(planId: string, messageId: string) {
    const session = this.chatSessions.get(planId);
    if (!session || session.live.has(messageId) || session.older.has(messageId)) return;
    const snapshot = await getDoc(doc(this.db, 'plans', planId, 'messages', messageId));
    if (snapshot.exists()) {
      session.older.set(snapshot.id, mapChatMessage(planId, snapshot.id, snapshot.data()));
      this.emitChatSession(planId);
    }
  }

  async sendChatMessage(planId: string, input: SendChatInput) {
    const submit = httpsCallable<SendChatInput & { planId: string }, { messageId: string }>(this.functions, 'submitChat');
    const result = await submit({ ...input, planId });
    return result.data.messageId;
  }

  async markChatRead(planId: string, messageId: string, createdAt: string) {
    const current = this.planSettings.get(planId);
    if (current?.lastReadAt && current.lastReadAt >= createdAt) return;
    this.planSettings.set(planId, { ...current, lastReadAt: createdAt, notificationsMuted: current?.notificationsMuted || false });
    this.emit();
    try {
      await setDoc(doc(this.db, 'users', this.user.id, 'planSettings', planId), {
        planId,
        lastReadAt: createdAt,
        lastReadMessageId: messageId,
      }, { merge: true });
    } catch (error) {
      if (current) this.planSettings.set(planId, current);
      else this.planSettings.delete(planId);
      this.emit();
      throw error;
    }
  }

  async setPlanNotificationsMuted(planId: string, muted: boolean) {
    const current = this.planSettings.get(planId);
    if (current?.notificationsMuted === muted) return;
    this.planSettings.set(planId, { ...current, notificationsMuted: muted });
    this.emit();
    try {
      await setDoc(doc(this.db, 'users', this.user.id, 'planSettings', planId), {
        planId,
        notificationsMuted: muted,
      }, { merge: true });
    } catch (error) {
      if (current) this.planSettings.set(planId, current);
      else this.planSettings.delete(planId);
      this.emit();
      throw error;
    }
  }

  async registerPushToken(token: string) {
    const cached = await AsyncStorage.getItem(PUSH_SYNC_KEY);
    if (cached) {
      try {
        const value = JSON.parse(cached) as { uid?: string; token?: string; syncedAt?: number };
        if (value.uid === this.user.id && value.token === token && Date.now() - (value.syncedAt || 0) < PUSH_SYNC_INTERVAL_MS) return;
      } catch {
        await AsyncStorage.removeItem(PUSH_SYNC_KEY);
      }
    }
    const tokenId = encodeURIComponent(token);
    await setDoc(doc(this.db, 'users', this.user.id, 'devices', tokenId), {
      token,
      platform: Platform.OS,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    await AsyncStorage.setItem(PUSH_SYNC_KEY, JSON.stringify({ uid: this.user.id, token, syncedAt: Date.now() }));
  }

  async removePlanMember(planId: string, userId: string) {
    const manage = httpsCallable(this.functions, 'managePlanMembership');
    await manage({ action: 'remove', planId, userId });
  }

  async leavePlan(planId: string) {
    const manage = httpsCallable(this.functions, 'managePlanMembership');
    await manage({ action: 'leave', planId });
  }

  async finishPlan(planId: string) {
    const finish = httpsCallable(this.functions, 'finishPlanSecure');
    await finish({ planId });
  }

  async deletePlan(planId: string) {
    const remove = httpsCallable(this.functions, 'deletePlanSecure');
    await remove({ planId });
  }

  async refresh() {
    this.emit();
  }
}
