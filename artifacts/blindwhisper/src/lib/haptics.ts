// Thin wrapper over the Vibration API for short, native-app-style haptic
// pulses on key confirmation moments (send success, reply received, reveal
// accepted). `navigator.vibrate` only exists on Android Chrome/Firefox —
// desktop browsers and iOS Safari simply don't have it, so this degrades to
// a silent no-op everywhere it's unsupported. No feature-detection warning,
// no throw: absence is the common case, not an error.
//
// Not gated on prefers-reduced-motion — that media query is about
// vestibular/motion-sickness triggers (animation, parallax, autoplay), not
// about a single short haptic buzz, so it's intentionally left out here.

const DEFAULT_DURATION_MS = 18;

export function triggerHaptic(durationMs: number = DEFAULT_DURATION_MS): void {
  try {
    navigator.vibrate?.(durationMs);
  } catch {
    // Some browsers throw if called outside a user gesture / on a
    // background tab — swallow it, a missed haptic is never worth surfacing.
  }
}
