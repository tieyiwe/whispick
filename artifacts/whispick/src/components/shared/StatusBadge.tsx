import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Eye, PlayCircle, MessageSquareHeart, CalendarClock } from "lucide-react";

type StatusType = "pending" | "scheduled" | "delivered" | "opened" | "watched" | "replied";

const STATUS_CONFIG: Record<StatusType, { label: string; icon: any; className: string }> = {
  pending: {
    label: "Pending",
    icon: Clock,
    className: "bg-muted text-muted-foreground border-border",
  },
  scheduled: {
    label: "Scheduled",
    icon: CalendarClock,
    className: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  },
  delivered: {
    label: "Delivered",
    icon: CheckCircle2,
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  opened: {
    label: "Opened",
    icon: Eye,
    className: "bg-primary/20 text-primary border-primary/30 glow-card",
  },
  watched: {
    label: "Watched",
    icon: PlayCircle,
    className: "bg-secondary/20 text-secondary border-secondary/30",
  },
  replied: {
    label: "Replied",
    icon: MessageSquareHeart,
    className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as StatusType] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`rounded-full px-2.5 py-0.5 font-medium ${config.className}`}>
      <Icon className="w-3 h-3 mr-1.5" />
      {config.label}
    </Badge>
  );
}
