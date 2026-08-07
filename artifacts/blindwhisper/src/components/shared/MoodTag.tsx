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

export function MoodTag({ mood, className = "" }: { mood: string | null | undefined; className?: string }) {
  if (!mood) return null;

  const config = MOOD_CONFIG[mood];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center px-3 py-1 rounded-full border text-sm font-medium ${config.bgClass} ${config.textClass} ${config.borderClass} ${className}`}>
      <Icon className="w-4 h-4 mr-2" />
      {config.label}
    </div>
  );
}
