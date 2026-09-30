export type RequestKind = 'contribution' | 'task';

export interface NormalizedChatInput {
  planId: string;
  operationId: string;
  text: string;
  mentionUserIds: string[];
  request?: { kind: RequestKind; targetId?: string; title?: string };
}

function requiredString(value: unknown, label: string, max: number) {
  if (typeof value !== 'string') throw new Error(`${label} is required.`);
  const clean = value.trim();
  if (!clean || clean.length > max) throw new Error(`${label} must be between 1 and ${max} characters.`);
  return clean;
}

export function normalizeChatInput(value: unknown): NormalizedChatInput {
  if (!value || typeof value !== 'object') throw new Error('Message data is required.');
  const data = value as Record<string, unknown>;
  const rawMentions = Array.isArray(data.mentionUserIds) ? data.mentionUserIds : [];
  if (rawMentions.some((id) => typeof id !== 'string')) throw new Error('Mentions are invalid.');
  const mentionUserIds = [...new Set(rawMentions as string[])];
  if (mentionUserIds.length > 5) throw new Error('A message can ping at most five members.');
  const result: NormalizedChatInput = {
    planId: requiredString(data.planId, 'Plan', 128),
    operationId: requiredString(data.operationId, 'Operation', 128),
    text: requiredString(data.text, 'Message', 2000),
    mentionUserIds,
  };
  if (!/^[A-Za-z0-9_-]+$/.test(result.planId) || !/^[A-Za-z0-9_-]+$/.test(result.operationId)) {
    throw new Error('Plan or operation identifier is invalid.');
  }
  if (data.request !== undefined) {
    if (!data.request || typeof data.request !== 'object') throw new Error('Request data is invalid.');
    const request = data.request as Record<string, unknown>;
    if (request.kind !== 'contribution' && request.kind !== 'task') throw new Error('Request type is invalid.');
    const targetId = typeof request.targetId === 'string' && request.targetId.trim() ? request.targetId.trim() : undefined;
    const title = typeof request.title === 'string' && request.title.trim() ? request.title.trim() : undefined;
    if (!targetId && !title) throw new Error('A request needs a board item or title.');
    if (title && title.length > 200) throw new Error('Request titles can be at most 200 characters.');
    result.request = { kind: request.kind, ...(targetId ? { targetId } : {}), ...(title ? { title } : {}) };
  }
  return result;
}

export function notificationRecipients(memberIds: string[], senderId: string, mentions: string[], isRequest: boolean) {
  const targets = mentions.length ? mentions : isRequest ? memberIds : [];
  return [...new Set(targets)].filter((id) => id !== senderId && memberIds.includes(id));
}
