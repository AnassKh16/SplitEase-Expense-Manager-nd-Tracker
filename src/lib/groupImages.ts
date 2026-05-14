const KEY_PREFIX = 'splitease-group-image:';
/** ~4.5MB — larger values are often truncated by the browser and render as broken images */
const MAX_DATA_URL_CHARS = 4_500_000;

function isPlausibleImageUrl(raw: string | null): raw is string {
  if (!raw || typeof raw !== 'string') return false;
  const t = raw.trim();
  if (t.startsWith('data:image/')) return t.length >= 100 && t.length <= MAX_DATA_URL_CHARS;
  if (t.startsWith('https://') || t.startsWith('http://')) return t.length < 8000;
  return false;
}

/** Returns a safe image URL or null (clears corrupt / oversize localStorage entries). */
export function getValidatedStoredGroupImage(groupId: string): string | null {
  if (!groupId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${groupId}`);
    if (!raw) return null;
    if (isPlausibleImageUrl(raw)) return raw;
    window.localStorage.removeItem(`${KEY_PREFIX}${groupId}`);
    return null;
  } catch {
    return null;
  }
}

export function getStoredGroupImage(groupId: string): string | null {
  return getValidatedStoredGroupImage(groupId);
}

export function setStoredGroupImage(groupId: string, imageDataUrl: string): void {
  if (!groupId || typeof window === 'undefined') return;
  if (imageDataUrl.startsWith('data:') && imageDataUrl.length > MAX_DATA_URL_CHARS) return;
  try {
    window.localStorage.setItem(`${KEY_PREFIX}${groupId}`, imageDataUrl);
  } catch {
    // storage write failures are non-critical
  }
}

export function clearStoredGroupImage(groupId: string): void {
  if (!groupId || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${KEY_PREFIX}${groupId}`);
  } catch {
    // storage delete failures are non-critical
  }
}
