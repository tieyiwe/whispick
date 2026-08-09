import { Eye, HeartHandshake, Heart, BrainCircuit, Sprout, Sparkles } from "lucide-react";

// Keyed by the stable id stored on a whisp (whisp.moodTag), not the display
// label — labels can be reworded without breaking data already in the DB.
// Colors are the design spec's exact mood palette, each at a 15% background
// tint / full-opacity text (icon choices unchanged).
export const MOOD_CONFIG: Record<string, { label: string; icon: any; color: string; bgClass: string; textClass: string; borderClass: string }> = {
  "i-see-you": {
    label: "I See You",
    icon: Eye,
    color: "#F5A623",
    bgClass: "bg-[#F5A623]/15",
    textClass: "text-[#F5A623]",
    borderClass: "border-[#F5A623]/20",
  },
  "heal-together": {
    label: "Heal Together",
    icon: HeartHandshake,
    color: "#7BA1FF",
    bgClass: "bg-[#7BA1FF]/15",
    textClass: "text-[#7BA1FF]",
    borderClass: "border-[#7BA1FF]/20",
  },
  "i-love-you": {
    label: "I Love You",
    icon: Heart,
    color: "#FF7B7B",
    bgClass: "bg-[#FF7B7B]/15",
    textClass: "text-[#FF7B7B]",
    borderClass: "border-[#FF7B7B]/20",
  },
  "think-about-this": {
    label: "Think About This",
    icon: BrainCircuit,
    color: "#4CAF88",
    bgClass: "bg-[#4CAF88]/15",
    textClass: "text-[#4CAF88]",
    borderClass: "border-[#4CAF88]/20",
  },
  "for-your-growth": {
    label: "For Your Growth",
    icon: Sprout,
    color: "#7B61FF",
    bgClass: "bg-[#7B61FF]/15",
    textClass: "text-[#7B61FF]",
    borderClass: "border-[#7B61FF]/20",
  },
  "just-because": {
    label: "Just Because",
    icon: Sparkles,
    color: "#F0EEF8",
    bgClass: "bg-[#F0EEF8]/10",
    textClass: "text-[#F0EEF8]",
    borderClass: "border-[#F0EEF8]/15",
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
