import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, ArrowDown } from "lucide-react";

// Swipe-down-to-refresh for touch devices.
//
// The app sets `overscroll-behavior-y: contain` globally (see index.css) to
// stop the page-level rubber-band gesture from fighting the fixed header and
// bottom nav — which also disables the browser's own pull-to-refresh. That's
// the right call for the app shell, but it leaves recipients on a public
// whisp page with no obvious way to refresh at all (no address bar gesture,
// no visible reload affordance). This puts the gesture back, scoped to the
// content that actually benefits from it.
//
// Deliberately touch-only: on desktop the browser reload button is right
// there, and binding this to mouse drags would hijack ordinary text
// selection.

// How far the finger travels before a refresh actually fires.
const TRIGGER_DISTANCE = 70;
// Cap on visible travel, so a long drag doesn't push content off-screen.
const MAX_PULL = 110;
// Fraction of finger movement the indicator actually follows — the standard
// pull-to-refresh feel, where the sheet lags the finger and gets "heavier"
// the further you pull.
const DRAG_RESISTANCE = 0.5;
// Ceiling on how long the indicator will wait for onRefresh before releasing
// the gesture again.
const REFRESH_TIMEOUT_MS = 10_000;

/**
 * A real browser reload, for use as `onRefresh`.
 *
 * Refetching the active queries updates the data but leaves the loaded app
 * itself untouched — the bundle, the service worker, anything cached. A pull
 * down is the gesture people use when they want the page genuinely reloaded,
 * including after a deploy, so it does exactly that.
 *
 * Never resolves in practice: navigation starts and the page is torn down.
 * PullToRefresh races onRefresh against REFRESH_TIMEOUT_MS, so the spinner
 * can't get stuck if the reload is slow or blocked.
 */
export function reloadPage(): Promise<void> {
  window.location.reload();
  return new Promise(() => {});
}

export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
}: {
  onRefresh: () => Promise<unknown>;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mirror state into refs so the effect below can read current values
  // without needing them in its dependency array — see the comment on that
  // dependency array for why that matters here.
  const pullDistanceRef = useRef(pullDistance);
  const refreshingRef = useRef(refreshing);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    pullDistanceRef.current = pullDistance;
    refreshingRef.current = refreshing;
    onRefreshRef.current = onRefresh;
  }, [pullDistance, refreshing, onRefresh]);

  useEffect(() => {
    const maybeNode = containerRef.current;
    if (!maybeNode || disabled) return;
    // A plain re-binding, not a cast: TypeScript's closure-narrowing doesn't
    // reliably carry `maybeNode`'s non-null type into the several mutually-
    // referencing function declarations below, so `node` exists purely to
    // give them all a type it can track — its runtime value never changes.
    const node: HTMLDivElement = maybeNode;

    // "At the top" is not the same question as `window.scrollY === 0`.
    // AppLayout scrolls <main> internally at every width so the sidebar and
    // the mobile header stay put, which leaves the window permanently at 0 —
    // judging by window.scrollY alone, the gesture would fire at any scroll
    // depth and hijack ordinary upward scrolling. The public pages still
    // scroll the window, so both cases have to be handled: check the window,
    // then walk the ancestors for whichever element is really scrolling.
    function isAtTop(): boolean {
      if (window.scrollY > 0) return false;
      let el = node?.parentElement ?? null;
      while (el) {
        if (el.scrollTop > 0) return false;
        el = el.parentElement;
      }
      return true;
    }

    // True when the touch began inside something that scrolls itself and
    // isn't already at its own top — a long draft in the reply composer's
    // textarea, for instance. preventDefault-ing those drags would stop
    // people scrolling their own content, so the gesture yields to them.
    function startedInScrolledChild(target: EventTarget | null): boolean {
      let el = target instanceof Element ? target : null;
      while (el && el !== node) {
        if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) return true;
        el = el.parentElement;
      }
      return false;
    }

    // A non-passive touchmove listener anywhere in a touch's target chain
    // forces the browser to run it — and wait for the result — on every
    // single frame of that touch before committing to scroll, whether or not
    // it ever calls preventDefault. Keeping one attached for the component's
    // entire lifetime made ordinary scrolling janky everywhere except right
    // at the screen edge, where the OS's own swipe-back gesture intercepts
    // the touch before it ever reaches the DOM. The fix: attach handleTouchMove
    // only for the span of a touch that might actually be a pull (started at
    // the very top of the page) and detach it the instant that stops being
    // true, so a scroll starting anywhere else — which is most scrolling —
    // never has a non-passive listener in its path at all.
    function endPull() {
      node.removeEventListener("touchmove", handleTouchMove);
      startYRef.current = null;
      setPullDistance(0);
    }

    function handleTouchStart(e: TouchEvent) {
      // Only start a pull from a genuine top-of-page rest state. Starting one
      // mid-scroll would hijack ordinary upward scrolling.
      if (!isAtTop() || refreshingRef.current) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0].clientY;
      node.addEventListener("touchmove", handleTouchMove, { passive: false });
    }

    function handleTouchMove(e: TouchEvent) {
      if (startYRef.current === null || refreshingRef.current) return;
      if (startedInScrolledChild(e.target)) {
        endPull();
        return;
      }
      const delta = e.touches[0].clientY - startYRef.current;

      // Upward movement means they're scrolling the page, not pulling —
      // release the gesture entirely rather than tracking a negative pull.
      if (delta <= 0) {
        endPull();
        return;
      }

      // Only take over the gesture once it's unambiguously a downward pull
      // (a few pixels of slop), so a slightly-imperfect vertical scroll isn't
      // stolen. preventDefault stops the page scrolling underneath the
      // indicator — it needs the non-passive listener attached above.
      if (delta > 5 && e.cancelable) e.preventDefault();
      setPullDistance(Math.min(delta * DRAG_RESISTANCE, MAX_PULL));
    }

    async function handleTouchEnd() {
      if (startYRef.current === null) return;
      node.removeEventListener("touchmove", handleTouchMove);
      startYRef.current = null;

      if (pullDistanceRef.current < TRIGGER_DISTANCE) {
        setPullDistance(0);
        return;
      }

      // Hold the indicator at the trigger point while the refresh runs, so it
      // reads as "working" rather than snapping back as if nothing happened.
      setRefreshing(true);
      setPullDistance(TRIGGER_DISTANCE);
      try {
        // Raced against a timeout: if onRefresh never settles (a request that
        // hangs rather than fails), the indicator would otherwise stay stuck
        // on "Refreshing..." and — because `refreshing` gates touchstart —
        // disable pull-to-refresh for the rest of the page's life.
        await Promise.race([
          onRefreshRef.current(),
          new Promise((resolve) => setTimeout(resolve, REFRESH_TIMEOUT_MS)),
        ]);
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    }

    node.addEventListener("touchstart", handleTouchStart, { passive: true });
    node.addEventListener("touchend", handleTouchEnd);
    node.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      node.removeEventListener("touchstart", handleTouchStart);
      node.removeEventListener("touchmove", handleTouchMove);
      node.removeEventListener("touchend", handleTouchEnd);
      node.removeEventListener("touchcancel", handleTouchEnd);
    };
    // Mount-once: pullDistance/refreshing/onRefresh are deliberately left out
    // and read via the refs synced above instead, so this effect doesn't
    // tear down and recreate the DOM listeners on every pull-distance update
    // (which happens on every touchmove frame of an active pull).
  }, [disabled]);

  const ready = pullDistance >= TRIGGER_DISTANCE;

  return (
    <div ref={containerRef}>
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{
          height: pullDistance,
          // Only animate the snap-back/settle, never the drag itself — a
          // transition during the drag makes the indicator lag the finger.
          transition: startYRef.current === null ? "height 0.25s cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        }}
        aria-hidden={pullDistance === 0}
      >
        <div
          className={`flex items-center gap-2 text-xs ${ready || refreshing ? "text-primary" : "text-muted-foreground"}`}
          style={{ opacity: Math.min(pullDistance / TRIGGER_DISTANCE, 1) }}
          data-testid="pull-to-refresh-indicator"
        >
          {refreshing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Refreshing...
            </>
          ) : (
            <>
              <ArrowDown
                className="w-4 h-4 transition-transform duration-200"
                style={{ transform: ready ? "rotate(180deg)" : "none" }}
              />
              {ready ? "Release to refresh" : "Pull to refresh"}
            </>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
