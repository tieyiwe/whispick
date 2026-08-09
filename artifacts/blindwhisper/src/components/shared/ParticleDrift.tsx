import { useMemo } from "react";
import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

const PARTICLE_COUNT = 8;
const STAGGER_MS = 150;

function seededParticles() {
  return Array.from({ length: PARTICLE_COUNT }).map((_, i) => {
    // Deterministic-enough "randomness" (no need for a real RNG here) so
    // each of the 8 orbs gets its own size, drift arc and start position
    // without two orbs ever reading as identical twins.
    const seed = i * 37.1;
    const size = 6 + ((seed * 13) % 5); // 6–10px
    const startX = -40 + ((seed * 7) % 80); // spread across the origin
    const arcX = -60 + ((seed * 23) % 120); // randomized horizontal drift
    const peakOpacity = 0.45 + ((seed * 3) % 45) / 100; // 0.45–0.9
    const riseHeight = 90 + ((seed * 11) % 60); // 90–150px upward drift
    return { id: i, size, startX, arcX, peakOpacity, riseHeight };
  });
}

/**
 * The send-confirmation signature moment: 8 small glowing accent-primary
 * orbs drifting upward in soft, non-linear arcs and fading out — evoking a
 * whisper actually leaving. One-shot only (never loops). Staggered starts
 * (0ms, 150ms, 300ms...) so the 8 orbs don't launch as a single burst.
 */
export function ParticleDrift({ className }: { className?: string }) {
  const particles = useMemo(seededParticles, []);
  const reducedMotion = usePrefersReducedMotion();

  if (reducedMotion) {
    // No motion — a plain, brief opacity fade stands in for the drift so
    // the moment still registers without triggering vestibular discomfort.
    return (
      <div className={`relative h-32 flex items-center justify-center pointer-events-none ${className ?? ""}`}>
        <motion.div
          className="w-3 h-3 rounded-full bg-primary"
          initial={{ opacity: 0.8 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
    );
  }

  return (
    <div className={`relative h-32 flex items-center justify-center pointer-events-none overflow-hidden ${className ?? ""}`}>
      {particles.map((p, i) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-primary"
          style={{
            width: p.size,
            height: p.size,
            left: `calc(50% + ${p.startX}px)`,
            bottom: 0,
            filter: "blur(1px)",
            boxShadow: "0 0 10px rgba(123, 97, 255, 0.6)",
          }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.6 }}
          animate={{
            x: [0, p.arcX * 0.5, p.arcX],
            y: [0, -p.riseHeight * 0.55, -p.riseHeight],
            opacity: [0, p.peakOpacity, 0],
            scale: [0.6, 1, 0.5],
          }}
          transition={{
            duration: 2,
            ease: "easeOut",
            delay: (i * STAGGER_MS) / 1000,
          }}
        />
      ))}
    </div>
  );
}
