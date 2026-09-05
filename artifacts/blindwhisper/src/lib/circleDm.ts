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
