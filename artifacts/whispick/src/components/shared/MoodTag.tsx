import { Badge } from "@/components/ui/badge";
import { Eye, HeartHandshake, Heart, BrainCircuit, Sprout, Sparkles } from "lucide-react";

type MoodType = "I See You" | "Heal Together" | "I Love You" | "Think About This" | "For Your Growth" | "Just Because";

export const MOOD_CONFIG: Record<MoodType, { icon: any; color: string; bgClass: string; textClass: string; borderClass: string }> = {
  "I See You": {
    icon: Eye,
    color: "#F59E0B",
    bgClass: "bg-amber-500/10",
    textClass: "text-amber-500",
    borderClass: "border-amber-500/20",
  },
  "Heal Together": {
    icon: HeartHandshake,
    color: "#3B82F6",
    bgClass: "bg-blue-500/10",
    textClass: "text-blue-500",
    borderClass: "border-blue-500/20",
  },
  "I Love You": {
    icon: Heart,
    color: "#EC4899",
    bgClass: "bg-pink-500/10",
    textClass: "text-pink-500",
    borderClass: "border-pink-500/20",
  },
  "Think About This": {
    icon: BrainCircuit,
    color: "#10B981",
    bgClass: "bg-emerald-500/10",
    textClass: "text-emerald-500",
    borderClass: "border-emerald-500/20",
  },
  "For Your Growth": {
    icon: Sprout,
    color: "#8B5CF6",
    bgClass: "bg-purple-500/10",
    textClass: "text-purple-500",
    borderClass: "border-purple-500/20",
  },
  "Just Because": {
    icon: Sparkles,
    color: "#F5F0E8",
    bgClass: "bg-stone-200/10",
    textClass: "text-stone-200",
    borderClass: "border-stone-200/20",
  },
};

export const MOOD_TAGS = Object.keys(MOOD_CONFIG) as MoodType[];

export function MoodTag({ mood, className = "" }: { mood: string | null | undefined; className?: string }) {
  if (!mood) return null;
  
  const config = MOOD_CONFIG[mood as MoodType];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center px-3 py-1 rounded-full border text-sm font-medium ${config.bgClass} ${config.textClass} ${config.borderClass} ${className}`}>
      <Icon className="w-4 h-4 mr-2" />
      {mood}
    </div>
  );
}
