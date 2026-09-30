export type RSVPStatus = 'going' | 'maybe' | 'no';
export type PlanStatus = 'active' | 'completed' | 'cancelled';
export type MemberRole = 'organizer' | 'member';
export type ChatRequestKind = 'contribution' | 'task';
export type AuthMethod = 'anonymous' | 'password' | 'google';

export interface TaraUser {
  id: string;
  name: string;
  avatar?: string;
  isGuest: boolean;
}

export interface Plan {
  id: string;
  title: string;
  description: string;
  dateTime: string | null;
  timezone: string;
  location: string;
  organizerId: string;
  organizerName: string;
  status: PlanStatus;
  coverUri?: string;
  inviteCode: string;
  createdAt: string;
  updatedAt: string;
  chatLastMessageAt?: string;
  chatLastMessageId?: string;
}

export interface PlanMember {
  planId: string;
  userId: string;
  name: string;
  role: MemberRole;
  joinedAt: string;
  inviteCode?: string;
}

export interface RSVP {
  planId: string;
  userId: string;
  name: string;
  status: RSVPStatus;
  updatedAt: string;
}

export interface ContributionItem {
  id: string;
  planId: string;
  name: string;
  category: string;
  createdBy: string;
  claimedBy: string | null;
  claimedByName: string | null;
  createdAt: string;
}

export interface PlanTask {
  id: string;
  planId: string;
  title: string;
  createdBy: string;
  assignedTo: string | null;
  assignedToName: string | null;
  done: boolean;
  createdAt: string;
}

export interface InvitePreview {
  code: string;
  planId: string;
  title: string;
  location: string;
  dateTime: string | null;
  organizerName: string;
  active: boolean;
}

export interface ChatRequestReference {
  kind: ChatRequestKind;
  targetId: string;
}

export interface ChatMessage {
  id: string;
  planId: string;
  senderId: string;
  senderName: string;
  text: string;
  mentionUserIds: string[];
  request: ChatRequestReference | null;
  operationId: string;
  createdAt: string;
}

export interface ChatSnapshot {
  messages: ChatMessage[];
  loading: boolean;
  hasOlder: boolean;
}

export interface PlanChatStatus {
  planId: string;
  unread: boolean;
  unreadPing: boolean;
  notificationsMuted: boolean;
  lastReadAt?: string;
  lastPingAt?: string;
}

export interface SendChatInput {
  operationId: string;
  text: string;
  mentionUserIds: string[];
  request?: {
    kind: ChatRequestKind;
    targetId?: string;
    title?: string;
  };
}

export interface TaraState {
  currentUser: TaraUser;
  isAuthenticated: boolean;
  authMethod: AuthMethod | null;
  plans: Plan[];
  members: PlanMember[];
  rsvps: RSVP[];
  contributions: ContributionItem[];
  tasks: PlanTask[];
  chatStatuses: PlanChatStatus[];
  loading: boolean;
}

export interface PlanInput {
  title: string;
  description: string;
  dateTime: string | null;
  location: string;
  coverUri?: string;
}

export interface TaraRepository {
  subscribe(listener: (state: TaraState) => void): () => void;
  start(): Promise<void>;
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
