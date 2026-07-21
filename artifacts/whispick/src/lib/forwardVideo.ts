// "Pass it forward" carries a video's metadata from the (unauthenticated)
// public whisp page through a sign-up/sign-in hop and into the Send Whisp
// composer. sessionStorage (not localStorage) is deliberate — this is a
// one-shot intent for the current tab, not something that should linger
// across browser sessions or leak into a shared/public computer's history.
const STORAGE_KEY = "whispick:forwardVideo";

export interface ForwardVideo {
  videoUrl: string;
  videoTitle?: string | null;
  videoThumbnail?: string | null;
  videoEmbedUrl?: string | null;
  videoPlatform?: string | null;
  videoStartSeconds?: number | null;
  videoEndSeconds?: number | null;
}

export function savePendingForward(video: ForwardVideo): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(video));
  } catch {
    // Private-browsing/storage-disabled edge case — the forward simply
    // won't pre-fill; not worth failing the flow over.
  }
}

export function hasPendingForward(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

// Read-and-clear: consumed exactly once, by whichever page picks it up
// first, so returning to a page later never re-triggers the pre-fill.
export function takePendingForward(): ForwardVideo | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(raw) as ForwardVideo;
  } catch {
    return null;
  }
}
