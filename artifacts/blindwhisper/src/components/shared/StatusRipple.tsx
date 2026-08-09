import { AnimatePresence, motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

/**
 * A single, non-repeating ring that expands out from a status dot when a
 * tracked whisp's status changes in front of the viewer (e.g. a live
 * dashboard where "opened" flips to "watched" while the page is open).
 * Deliberately ONE clean pulse, not a loop — a repeating ring reads as an
 * alert, which is the wrong tone for "someone watched your whisp."
 *
 * NOTE (see final report): as of this pass, nothing in the app re-renders
 * a whisp's status while the viewer is looking at it — WhispDetail /
 * WhispsList / Dashboard all fetch once on mount with no polling or
 * realtime subscription (this is an intentional pattern elsewhere in the
 * app; see the "no realtime" comment in NotificationBell.tsx). So there is
 * currently no real "status just changed" moment to wire this to. It's
 * built here, ready to drop onto a status dot, for whenever a live-updating
 * view (e.g. a polling WhispDetail) exists.
 *
 * Usage: mount with `active` flipped to `true` for one render when the
 * status you're tracking changes, then back to `false` — e.g. from a
 * `useEffect` comparing the previous vs. current status.
 */
export function StatusRipple({
  active,
  color = "var(--tw-ripple-color, hsl(var(--primary)))",
}: {
  active: boolean;
  color?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();

  if (reducedMotion) return null;

  return (
    <AnimatePresence>
      {active && (
        <motion.span
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ border: `1.5px solid ${color}` }}
          initial={{ scale: 1, opacity: 0.4 }}
          animate={{ scale: 2.2, opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
      )}
    </AnimatePresence>
  );
}
