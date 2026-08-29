import { useRef } from "react";

// How long a press has to hold before it counts as "long press" rather than
// "tap" — and how far a finger can drift during that hold before it reads as
// a scroll gesture instead (which cancels the press). Same values
// WhispsList.tsx's own hand-rolled version already settled on; extracted
// here so every list that wants the same "press-and-hold for quick actions"
// affordance (WhisperBoxInbox, ...) shares one implementation instead of
// re-deriving these constants and the move-tolerance math per page.
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

/**
 * Press-and-hold detection built on PointerEvents (covers touch and mouse
 * alike, unlike separate touch/mouse handler pairs). One hook instance
 * covers an entire list — `payload` (typically the row's id) is passed in
 * at each `onPointerDown` call site instead of baked in at hook-creation
 * time, since a hook can't be called once per rendered list row without
 * breaking the Rules of Hooks when the list's length changes.
 *
 * Uses refs, not state, for the in-progress press tracking — a
 * pointerdown/move on every card in a long list would otherwise re-render
 * the whole list on every finger twitch.
 *
 * Returns the handlers to spread onto whatever element should respond to
 * the gesture, plus `wasLongPress()` — call it from the element's own
 * onClick to swallow the synthetic click a touch's pointerup dispatches
 * right after a fired long press, so opening the quick-action UI doesn't
 * also trigger whatever the plain tap does (e.g. navigating into the item).
 */
export function useLongPress<T>(onLongPress: (payload: T) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  function clear() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent, payload: T) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    firedRef.current = false;
    clear();
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      navigator.vibrate?.(10);
      onLongPress(payload);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) clear();
  }

  function onPointerUp() {
    clear();
  }

  /** Call from the element's own onClick — true (and self-resetting) exactly
   *  once, right after a long press fired, so that click can be swallowed. */
  function wasLongPress(): boolean {
    clear();
    if (!firedRef.current) return false;
    firedRef.current = false;
    return true;
  }

  return { onPointerDown, onPointerMove, onPointerUp, wasLongPress };
}
