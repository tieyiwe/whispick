// Installing Blind Whisper to a phone's home screen, where it opens without
// browser chrome and behaves like a native app.
//
// The two platforms could not be less alike here, and the difference drives
// the whole design:
//
//   Android/Chrome fires `beforeinstallprompt`, which we capture and replay
//   later. That is a real, one-tap OS install dialog.
//
//   iOS Safari has no such event and no install API of any kind. The only way
//   onto an iPhone home screen is the user tapping Share → Add to Home Screen
//   themselves. Nothing we write can perform it, so on iOS the honest product
//   is a clear set of instructions, not a button that pretends.

const DISMISSED_KEY = "blindwhisper:installPromptDismissedAt";
const INSTALLED_KEY = "blindwhisper:installed";

// A dismissal is "not now", not "never" — but re-asking every session is how
// an install prompt becomes the thing people learn to swat away. Two weeks is
// long enough that the second ask lands on someone who has since decided the
// app is worth keeping.
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export type InstallPlatform = "android" | "ios" | "unsupported";

/** True when the app is already running from the home screen. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS predates the display-mode media query and only exposes this.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac, so the touch check is what separates
  // an iPad from a desktop Safari that can't install anything this way.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * Whether we should stay quiet: already installed, previously installed on
 * this device, or snoozed recently.
 *
 * localStorage is read defensively — private browsing and locked-down
 * profiles throw on access, and an install nudge is never worth a crash.
 */
export function shouldStayQuiet(): boolean {
  if (isStandalone()) return true;
  try {
    if (localStorage.getItem(INSTALLED_KEY)) return true;
    const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) ?? 0);
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < SNOOZE_MS;
  } catch {
    return false;
  }
}

export function rememberInstalled(): void {
  try {
    localStorage.setItem(INSTALLED_KEY, String(Date.now()));
  } catch {
    // Nothing to do — worst case they see the prompt once more, and the
    // standalone check above will silence it as soon as they open the app
    // from the home screen.
  }
}

export function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // Same reasoning as above.
  }
}

/** The `beforeinstallprompt` event, which TypeScript's DOM lib doesn't type. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
