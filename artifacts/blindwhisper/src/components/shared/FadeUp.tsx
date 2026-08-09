import { ReactNode } from "react";
import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

/**
 * Reusable card-entrance wrapper — fade-up only, never side-slides, per the
 * animation spec. Wrap individual list items (a recent whisp card, a mood
 * tag grid cell) so they settle in rather than pop, without hand-rolling
 * the same initial/animate/transition triple at every call site.
 *
 * `index` staggers a list's items a little (capped) so a whole page of
 * cards doesn't animate as one flat block; omit it for a single element.
 */
export function FadeUp({
  children,
  index = 0,
  className,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();

  if (reducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: Math.min(index, 8) * 0.05 }}
    >
      {children}
    </motion.div>
  );
}
