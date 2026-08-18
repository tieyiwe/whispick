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

  useEffect(() => {
    const node = containerRef.current;
    if (!node || disabled) return;

    function handleTouchStart(e: TouchEvent) {
      // Only start a pull from a genuine top-of-page rest state. Starting one
      // mid-scroll would hijack ordinary upward scrolling.
      if (window.scrollY > 0 || refreshing) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0].clientY;
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

    function handleTouchMove(e: TouchEvent) {
      if (startYRef.current === null || refreshing) return;
      if (startedInScrolledChild(e.target)) {
        startYRef.current = null;
        setPullDistance(0);
        return;
      }
      const delta = e.touches[0].clientY - startYRef.current;

      // Upward movement means they're scrolling the page, not pulling —
      // release the gesture entirely rather than tracking a negative pull.
      if (delta <= 0) {
        startYRef.current = null;
        setPullDistance(0);
        return;
      }

      // Only take over the gesture once it's unambiguously a downward pull
      // (a few pixels of slop), so a slightly-imperfect vertical scroll isn't
      // stolen. preventDefault stops the page scrolling underneath the
      // indicator — it needs a non-passive listener, hence the explicit
      // { passive: false } below.
      if (delta > 5 && e.cancelable) e.preventDefault();
      setPullDistance(Math.min(delta * DRAG_RESISTANCE, MAX_PULL));
    }

    async function handleTouchEnd() {
      if (startYRef.current === null) return;
      startYRef.current = null;

      if (pullDistance < TRIGGER_DISTANCE) {
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
          onRefresh(),
          new Promise((resolve) => setTimeout(resolve, REFRESH_TIMEOUT_MS)),
        ]);
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    }

    node.addEventListener("touchstart", handleTouchStart, { passive: true });
    node.addEventListener("touchmove", handleTouchMove, { passive: false });
    node.addEventListener("touchend", handleTouchEnd);
    node.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      node.removeEventListener("touchstart", handleTouchStart);
      node.removeEventListener("touchmove", handleTouchMove);
      node.removeEventListener("touchend", handleTouchEnd);
      node.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [onRefresh, pullDistance, refreshing, disabled]);

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
