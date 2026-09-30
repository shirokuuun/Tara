export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
}

export function formatPlanDate(value: string | null, compact = false) {
  if (!value) return 'Date to be decided';
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    weekday: compact ? 'short' : 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function isPastPlan(dateTime: string | null, status: string) {
  if (status === 'completed' || status === 'cancelled') return true;
  return dateTime ? new Date(dateTime).getTime() < Date.now() : false;
}

export function isPlanReadOnly(dateTime: string | null, status: string) {
  return status !== 'active' || Boolean(dateTime && new Date(dateTime).getTime() <= Date.now());
}

export function isPlanDateLocked(dateTime: string | null) {
  if (!dateTime) return false;
  const remaining = new Date(dateTime).getTime() - Date.now();
  return remaining <= 24 * 60 * 60 * 1000;
}

export function inviteUrl(code: string) {
  const base = process.env.EXPO_PUBLIC_INVITE_BASE_URL || 'https://tara.app/join';
  return `${base}?code=${encodeURIComponent(code)}`;
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
