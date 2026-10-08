// Remembers the private conversation a visitor already started with a Blind
// Circle post's poster (see routes/public.ts's POST /w/:token/circle-dm/start),
// keyed by the ORIGIN circle post's whisp id, so clicking "Message the
// poster privately" again resumes the same thread instead of minting a new
// one every time. Same anonymous, localStorage-only posture as
// lib/anonymousVisitor.ts: this mapping never leaves the device.
function storageKey(originWhispId: string): string {
  return `blindwhisper:circleDm:${originWhispId}`;
}

export function getSavedCircleDmToken(originWhispId: string): string | null {
  try {
    return localStorage.getItem(storageKey(originWhispId));
  } catch {
    return null;
  }
}

export function saveCircleDmToken(originWhispId: string, publicToken: string): void {
  try {
    localStorage.setItem(storageKey(originWhispId), publicToken);
  } catch {
    // Nothing to do — worst case, the next click on "Message the poster
    // privately" mints a second conversation instead of resuming this one.
  }
}

// Drops every saved private-conversation token on this device. Called on
// sign-out (see deviceState.ts): each token is the bearer credential for a
// private thread, so leaving them behind would let the next person on a
// shared device open the previous person's conversations.
export function clearSavedCircleDmTokens(): void {
  try {
    const prefix = storageKey("");
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Storage unavailable — then nothing was persisted to clear either.
  }
}
