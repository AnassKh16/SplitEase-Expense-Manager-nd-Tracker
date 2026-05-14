/** Cross-tab / same-window signal so the navbar can refetch notifications after nudges. */
export const NOTIFICATIONS_REFRESH_EVENT = 'splitease-notifications-refresh';
export const NOTIFICATIONS_BC_NAME = 'splitease-notifications';

export function requestNotificationsRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_REFRESH_EVENT));
  try {
    const bc = new BroadcastChannel(NOTIFICATIONS_BC_NAME);
    bc.postMessage('refresh');
    bc.close();
  } catch {
    // BroadcastChannel unsupported — window event still works same-tab
  }
}

/** Profile / avatar changed — refetch group members and other profile-dependent UI. */
export const PROFILE_REFRESH_EVENT = 'splitease-profile-refresh';
export const PROFILE_BC_NAME = 'splitease-profile';

export function requestProfileRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PROFILE_REFRESH_EVENT));
  try {
    const bc = new BroadcastChannel(PROFILE_BC_NAME);
    bc.postMessage('refresh');
    bc.close();
  } catch {
    /* same-tab event only */
  }
}
