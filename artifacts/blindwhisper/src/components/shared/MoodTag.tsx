import { Eye, HeartHandshake, Heart, BrainCircuit, Sprout, Sparkles } from "lucide-react";

// Keyed by the stable id stored on a whisp (whisp.moodTag), not the display
// label — labels can be reworded without breaking data already in the DB.
export const MOOD_CONFIG: Record<string, { label: string; icon: any; color: string; bgClass: string; textClass: string; borderClass: string }> = {
  "i-see-you": {
    label: "I See You",
    icon: Eye,
    color: "#F59E0B",
    bgClass: "bg-amber-500/10",
    textClass: "text-amber-500",
    borderClass: "border-amber-500/20",
  },
  "heal-together": {
    label: "Heal Together",
    icon: HeartHandshake,
    color: "#3B82F6",
    bgClass: "bg-blue-500/10",
    textClass: "text-blue-500",
    borderClass: "border-blue-500/20",
  },
  "i-love-you": {
    label: "I Love You",
    icon: Heart,
    color: "#EC4899",
    bgClass: "bg-pink-500/10",
    textClass: "text-pink-500",
    borderClass: "border-pink-500/20",
  },
  "think-about-this": {
    label: "Think About This",
    icon: BrainCircuit,
    color: "#10B981",
    bgClass: "bg-emerald-500/10",
    textClass: "text-emerald-500",
    borderClass: "border-emerald-500/20",
  },
  "for-your-growth": {
    label: "For Your Growth",
    icon: Sprout,
    color: "#8B5CF6",
    bgClass: "bg-purple-500/10",
    textClass: "text-purple-500",
    borderClass: "border-purple-500/20",
  },
  "just-because": {
    label: "Just Because",
    icon: Sparkles,
    color: "#D4B896",
    bgClass: "bg-stone-200/10",
    textClass: "text-stone-200",
    borderClass: "border-stone-200/20",
  },
};

export const MOOD_TAGS = Object.keys(MOOD_CONFIG);

// The mood is the one piece of emotional framing a recipient sees before
// they press play, so it's built from the mood's OWN colour rather than a
// generic chip: a soft gradient in that hue, a matching rim, and a low glow
// that lifts it off the Midnight background. Driven by inline styles because
// each mood's colour is a value in MOOD_CONFIG — Tailwind can't generate
// classes for colours it doesn't see at build time.
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function MoodTag({ mood, className = "" }: { mood: string | null | undefined; className?: string }) {
  if (!mood) return null;

  const config = MOOD_CONFIG[mood];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div
      className={`inline-flex items-center gap-2 pl-1.5 pr-3.5 py-1.5 rounded-full border text-sm font-medium ${className}`}
      style={{
        color: config.color,
        // Angled so the chip has a little depth instead of reading as a flat
        // swatch — brighter at the icon end, fading across the label.
        backgroundImage: `linear-gradient(135deg, ${withAlpha(config.color, 0.22)}, ${withAlpha(config.color, 0.07)})`,
        borderColor: withAlpha(config.color, 0.35),
        boxShadow: `0 2px 14px ${withAlpha(config.color, 0.18)}`,
      }}
    >
      {/* The icon gets its own disc so it reads as a badge rather than a
          glyph sitting next to text. */}
      <span
        className="flex items-center justify-center w-6 h-6 rounded-full shrink-0"
        style={{ backgroundColor: withAlpha(config.color, 0.2) }}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <span className="tracking-wide">{config.label}</span>
    </div>
  );
}
