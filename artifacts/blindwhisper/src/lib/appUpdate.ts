// Detecting and applying a new deploy without an intrusive "new version
// available, refresh?" prompt and without leaving anyone stuck on a stale
// bundle that 404s the moment it tries to load a page it doesn't have yet.
//
// The mechanism: sw.js now calls skipWaiting()+clients.claim() the instant a
// new worker installs, instead of the default behavior (a new worker sits
// "waiting" until every open tab/window closes — which, for an installed PWA
// people rarely quit outright, can be days). That makes `controllerchange`
// fire the moment a fresh deploy takes over an already-open page — and
// specifically only then: a brand-new page load with no prior controller
// never fires it, since there's nothing to change FROM. That's what makes it
// a reliable "an update just landed under you" signal rather than something
// that also fires on first install.

let updateAvailable = false;
type Listener = () => void;
const listeners = new Set<Listener>();

function markUpdateAvailable(): void {
  if (updateAvailable) return;
  updateAvailable = true;
  for (const listener of listeners) listener();
}

export function isUpdateAvailable(): boolean {
  return updateAvailable;
}

/** Notified once, the moment an update is first detected. */
export function onUpdateAvailable(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Wires up update detection for `registration`. Call once, right after
 * registering the service worker.
 */
export function watchForUpdates(registration: ServiceWorkerRegistration): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", markUpdateAvailable);

  // The browser checks for a changed sw.js on ordinary navigation, but an
  // installed PWA or a long-lived tab can go a long time without one of
  // those — a slow background poll plus a check on regaining focus both give
  // an update a chance to be noticed promptly instead of eventually.
  function checkNow(): void {
    void registration.update().catch(() => {});
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkNow();
  });
  setInterval(checkNow, UPDATE_CHECK_INTERVAL_MS);

  // The "seamless" part: never reload out from under someone actively using
  // the app — that would be worse than the stale version it's fixing.
  //
  // This used to call reload() the instant the page was (or became) hidden,
  // on the theory that a backgrounded tab is safe to quietly refresh behind
  // the user's back. That's exactly backwards on a phone: a hidden/
  // backgrounded PWA is frequently suspended or frozen by the OS, so a
  // reload issued while hidden can be silently dropped or interrupted
  // mid-navigation — and the next time the app is reopened, it resumes into
  // that half-reloaded state: a blank white screen that only a manual
  // force-close-and-reopen clears. That's this exact "sometimes goes blank"
  // bug.
  //
  // The fix: only ever reload once the page is actively being resumed to
  // VISIBLE — that's the one moment the browser is guaranteed to actually
  // be running the page, not suspending it, so the reload lands instead of
  // racing a frozen background state. If the app is already hidden right
  // now, that just means waiting for the very next time it's reopened; if
  // it's currently visible (actively in use), wait for it to be backgrounded
  // first so the reload doesn't interrupt anything, then wait for the
  // following reopen.
  onUpdateAvailable(() => {
    let hasBeenHidden = document.visibilityState === "hidden";
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hasBeenHidden = true;
        return;
      }
      if (!hasBeenHidden) return;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.location.reload();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
  });

  wireClickReload();
}

// Catches the other half of "seamless": App.tsx's own location-change effect
// (isUpdateAvailable() check on every wouter navigation) only fires when a
// click actually changes the route — a same-page action (submitting a reply
// inline, toggling a setting, dismissing a dialog) never does, so an update
// could sit pending indefinitely on a page the user keeps using without ever
// navigating away. This is the general form: once an update is known to be
// pending, the next click on an actual control (a button or a link, not a
// stray tap on the page background) reloads shortly after.
//
// Deliberately DEFERRED, not immediate — the click's own handler (its own
// fetch, its own toast, its own local state update) needs a moment to
// actually finish before the page is torn down under it, same reasoning as
// the visibility-based path above not reloading while the page might be
// suspended: reloading mid-request would abort that request client-side and
// read as the action having silently failed, which is a worse glitch than
// the stale-bundle problem this is fixing. 600ms comfortably covers this
// app's own request latencies without making the update feel delayed.
function wireClickReload(): void {
  let reloadScheduled = false;
  document.addEventListener(
    "click",
    (event) => {
      if (!updateAvailable || reloadScheduled) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("button, a[href]")) return;
      reloadScheduled = true;
      setTimeout(() => window.location.reload(), 600);
    },
    // Capture phase: still sees the click even when a handler further down
    // the tree (a Radix dialog/dropdown trigger) calls stopPropagation —
    // a bubble-phase listener would otherwise never run for those.
    { capture: true },
  );
}
