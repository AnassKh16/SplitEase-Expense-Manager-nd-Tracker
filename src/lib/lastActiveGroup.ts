/** Per-user: which group was last opened / refreshed on this device (localStorage). */

export const LAST_ACTIVE_GROUP_EVENT = 'splitease-last-active-group';

export function lastActiveGroupStorageKey(userId: string): string {
  return `splitease-last-active-group:${userId}`;
}

export function getLastActiveGroupId(userId: string | undefined | null): string | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(lastActiveGroupStorageKey(userId));
    if (!raw) return null;
    const p = JSON.parse(raw) as { groupId?: unknown };
    return typeof p.groupId === 'string' && p.groupId ? p.groupId : null;
  } catch {
    return null;
  }
}

export function recordLastActiveGroup(userId: string, groupId: string): void {
  if (!userId || !groupId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      lastActiveGroupStorageKey(userId),
      JSON.stringify({ groupId, at: Date.now() })
    );
    window.dispatchEvent(
      new CustomEvent(LAST_ACTIVE_GROUP_EVENT, { detail: { userId, groupId } })
    );
  } catch {
    /* quota / private mode */
  }
}
