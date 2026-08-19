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

const APP_SEEN_THIS_TAB_KEY = "blindwhisper:appSeenThisTab";

/**
 * Whether AppLayout has already rendered once in this browser tab's session.
 *
 * sessionStorage is exactly the primitive this needs: it survives a same-tab
 * reload (so hitting refresh reads as "already seen"), but starts empty in a
 * brand new tab (so completing sign-in, or opening the app fresh, reads as
 * "not yet seen") — which is precisely the "just signed in" vs. "this is a
 * refresh" distinction the install prompt's timing depends on.
 *
 * Marks itself as a side effect: the first call in a tab's life reports
 * false, every call after (including across reloads) reports true.
 */
export function hasAppLayoutRenderedThisTab(): boolean {
  try {
    const seen = sessionStorage.getItem(APP_SEEN_THIS_TAB_KEY) === "1";
    sessionStorage.setItem(APP_SEEN_THIS_TAB_KEY, "1");
    return seen;
  } catch {
    // Storage unavailable (private mode, a locked-down profile) — treat as a
    // fresh sign-in, since that's the longer of the two delays and the safer
    // default when we can't tell.
    return false;
  }
}

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
 * Phone/tablet vs. desktop — used only to pick which install copy to show
 * ("to your phone" vs. "to this computer"), never to decide whether to show
 * a prompt at all. Chromium exposes this directly via NavigatorUAData; other
 * engines (and older Chromium) fall back to a user-agent sniff, the same
 * technique isIos() above already relies on.
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") return uaData.mobile;
  return /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
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

// `beforeinstallprompt` fires once per page load, often within the first
// second — well before a user has had the chance to sign in. The install UI
// only exists inside AppLayout, which doesn't render until AFTER sign-in, so
// a listener attached there is reliably too late: by the time it mounts, the
// one-shot event already fired into a page with nobody listening, and the
// browser does not re-fire it later in that same page's lifetime. Chrome's
// own developer docs call this out explicitly as the standard mistake.
//
// The fix is a module-level capture that starts the moment this file is
// first imported — which happens from App.tsx's top level, before any
// auth-gated component exists — so the event is caught regardless of what's
// mounted when it happens to arrive. Components read the already-captured
// value on mount instead of racing to attach their own listener in time.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
type Listener = (event: BeforeInstallPromptEvent | null) => void;
const listeners = new Set<Listener>();

// A separate channel from `listeners` above, deliberately: that one carries
// the *prompt* event and goes quiet the moment it's consumed (dismissed,
// cleared on unmount, etc.) — "just installed" needs to reach a listener
// exactly once, regardless of what happened to the prompt event on the way.
type InstalledListener = () => void;
const installedListeners = new Set<InstalledListener>();

function announceJustInstalled(): void {
  for (const listener of installedListeners) listener();
}

/**
 * Fires once, the moment an install actually completes — whether triggered
 * through our own Install button or the browser's own address-bar/menu
 * install affordance. Meant for a follow-up nudge (e.g. "now pin it to your
 * taskbar") that only makes sense right after a real install, not on every
 * mount.
 */
export function onJustInstalled(listener: InstalledListener): () => void {
  installedListeners.add(listener);
  return () => installedListeners.delete(listener);
}

/**
 * Called directly from the Install button's own accepted-outcome branch, in
 * addition to the `appinstalled` handler below — belt-and-suspenders for the
 * same reason `rememberInstalled` is called from both places: `appinstalled`
 * can be missed if the tab is backgrounded while the OS finishes installing.
 * Safe to call twice; listeners just re-fire.
 */
export function notifyJustInstalled(): void {
  announceJustInstalled();
}

// A third channel, for sequencing the two post-install nudges
// (EnableNotificationsPrompt, then PinToTaskbarTip on desktop) one after
// another instead of both popping into the same fixed bottom-of-viewport
// slot at once. The notifications prompt listens for `onJustInstalled`
// directly (it's the FIRST thing to show); the pin-to-taskbar tip listens
// for this instead, fired once the notifications step is fully resolved
// (enabled, denied, or not applicable on this browser) — never before.
type StepDoneListener = () => void;
const notificationStepDoneListeners = new Set<StepDoneListener>();

export function onNotificationStepDone(listener: StepDoneListener): () => void {
  notificationStepDoneListeners.add(listener);
  return () => notificationStepDoneListeners.delete(listener);
}

export function announceNotificationStepDone(): void {
  for (const listener of notificationStepDoneListeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    for (const listener of listeners) listener(deferredPrompt);
  });

  // Captured at module scope for the same reason as beforeinstallprompt
  // above: this can fire (an install completed through the browser's own
  // menu, not our button) whether or not the prompt UI happens to be
  // mounted right now.
  window.addEventListener("appinstalled", () => {
    rememberInstalled();
    deferredPrompt = null;
    for (const listener of listeners) listener(null);
    announceJustInstalled();
  });
}

/** Whatever beforeinstallprompt event has been captured so far, if any. */
export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

/** Consumes the captured event — a prompt can only be shown once. */
export function clearDeferredInstallPrompt(): void {
  deferredPrompt = null;
}

/**
 * Notifies `listener` immediately with whatever's already captured (which
 * covers the common case: the event arrived before this component mounted),
 * and again if one arrives later while still subscribed. Returns the
 * unsubscribe function.
 */
export function onInstallPromptAvailable(listener: Listener): () => void {
  listener(deferredPrompt);
  listeners.add(listener);
  return () => listeners.delete(listener);
}
