import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { getRepository } from '@/data/repository';
import type { ChatSnapshot, InvitePreview, PlanInput, RSVPStatus, SendChatInput, TaraState } from '@/types';

const initialState: TaraState = {
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

interface TaraContextValue extends TaraState {
  startupError: string | null;
  continueAsGuest(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(name: string, email: string, password: string): Promise<void>;
  signInWithGoogle(idToken?: string): Promise<void>;
  signOut(): Promise<void>;
  setGuestName(name: string): Promise<void>;
  createPlan(input: PlanInput): Promise<string>;
  updatePlan(planId: string, input: PlanInput): Promise<void>;
  getInvitePreview(code: string): Promise<InvitePreview | null>;
  joinPlan(code: string, name: string): Promise<string>;
  setRsvp(planId: string, status: RSVPStatus): Promise<void>;
  addContribution(planId: string, name: string, category: string): Promise<void>;
  claimContribution(planId: string, itemId: string): Promise<void>;
  addTask(planId: string, title: string): Promise<void>;
  claimTask(planId: string, taskId: string): Promise<void>;
  toggleTask(planId: string, taskId: string): Promise<void>;
  subscribeChat(planId: string, listener: (snapshot: ChatSnapshot) => void): () => void;
  loadOlderChat(planId: string): Promise<void>;
  ensureChatMessage(planId: string, messageId: string): Promise<void>;
  sendChatMessage(planId: string, input: SendChatInput): Promise<string>;
  markChatRead(planId: string, messageId: string, createdAt: string): Promise<void>;
  setPlanNotificationsMuted(planId: string, muted: boolean): Promise<void>;
  registerPushToken(token: string): Promise<void>;
  removePlanMember(planId: string, userId: string): Promise<void>;
  leavePlan(planId: string): Promise<void>;
  finishPlan(planId: string): Promise<void>;
  deletePlan(planId: string): Promise<void>;
  refresh(): Promise<void>;
}

const TaraContext = createContext<TaraContextValue | null>(null);

export function TaraProvider({ children }: PropsWithChildren) {
  const repository = useMemo(() => getRepository(), []);
  const [state, setState] = useState<TaraState>(initialState);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = repository.subscribe(setState);
    repository.start().catch((error: unknown) => {
      setStartupError(error instanceof Error ? error.message : 'Tara could not connect.');
      setState((current) => ({ ...current, loading: false }));
    });
    return unsubscribe;
  }, [repository]);

  const actions = useMemo<Omit<TaraContextValue, keyof TaraState | 'startupError'>>(() => ({
    continueAsGuest: () => repository.continueAsGuest(),
    signInWithEmail: (email, password) => repository.signInWithEmail(email, password),
    signUpWithEmail: (name, email, password) => repository.signUpWithEmail(name, email, password),
    signInWithGoogle: (idToken) => repository.signInWithGoogle(idToken),
    signOut: () => repository.signOut(),
    setGuestName: (name) => repository.setGuestName(name),
    createPlan: (input) => repository.createPlan(input),
    updatePlan: (planId, input) => repository.updatePlan(planId, input),
    getInvitePreview: (code) => repository.getInvitePreview(code),
    joinPlan: (code, name) => repository.joinPlan(code, name),
    setRsvp: (planId, status) => repository.setRsvp(planId, status),
    addContribution: (planId, name, category) => repository.addContribution(planId, name, category),
    claimContribution: (planId, itemId) => repository.claimContribution(planId, itemId),
    addTask: (planId, title) => repository.addTask(planId, title),
    claimTask: (planId, taskId) => repository.claimTask(planId, taskId),
    toggleTask: (planId, taskId) => repository.toggleTask(planId, taskId),
    subscribeChat: (planId, listener) => repository.subscribeChat(planId, listener),
    loadOlderChat: (planId) => repository.loadOlderChat(planId),
    ensureChatMessage: (planId, messageId) => repository.ensureChatMessage(planId, messageId),
    sendChatMessage: (planId, input) => repository.sendChatMessage(planId, input),
    markChatRead: (planId, messageId, createdAt) => repository.markChatRead(planId, messageId, createdAt),
    setPlanNotificationsMuted: (planId, muted) => repository.setPlanNotificationsMuted(planId, muted),
    registerPushToken: (token) => repository.registerPushToken(token),
    removePlanMember: (planId, userId) => repository.removePlanMember(planId, userId),
    leavePlan: (planId) => repository.leavePlan(planId),
    finishPlan: (planId) => repository.finishPlan(planId),
    deletePlan: (planId) => repository.deletePlan(planId),
    refresh: () => repository.refresh(),
  }), [repository]);

  const value = useMemo<TaraContextValue>(() => ({
    ...state,
    startupError,
    ...actions,
  }), [actions, startupError, state]);

  return <TaraContext.Provider value={value}>{children}</TaraContext.Provider>;
}

export function useTara() {
  const context = useContext(TaraContext);
  if (!context) throw new Error('useTara must be used inside TaraProvider.');
  return context;
}

export function usePlan(planId: string) {
  const tara = useTara();
  const plan = tara.plans.find((entry) => entry.id === planId);
  return {
    ...tara,
    plan,
    planMembers: tara.members.filter((entry) => entry.planId === planId),
    planRsvps: tara.rsvps.filter((entry) => entry.planId === planId),
    planContributions: tara.contributions.filter((entry) => entry.planId === planId),
    planTasks: tara.tasks.filter((entry) => entry.planId === planId),
    chatStatus: tara.chatStatuses.find((entry) => entry.planId === planId),
  };
}
