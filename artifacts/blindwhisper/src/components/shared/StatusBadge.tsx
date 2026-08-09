import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Eye, PlayCircle, MessageSquareHeart, CalendarClock, AlertCircle } from "lucide-react";

type StatusType = "pending" | "scheduled" | "delivered" | "opened" | "watched" | "replied" | "failed";

// dotClassName/glow map each status to the tracking-timeline dot treatment
// from the design spec: Sent (pending) is a plain tertiary dot with no
// glow; Delivered/Opened/Watched each get their status color with a soft
// glow; Replied is the one status that also gets a slow (2s), non-blocking
// opacity breathe — the only intentionally-repeating animation in the app,
// so it reads as "still resonating" rather than "alert."
const STATUS_CONFIG: Record<
  StatusType,
  { label: string; icon: any; className: string; dotClassName: string }
> = {
  pending: {
    label: "Pending",
    icon: Clock,
    className: "bg-muted text-muted-foreground border-border",
    dotClassName: "bg-tertiary-foreground",
  },
  scheduled: {
    label: "Scheduled",
    icon: CalendarClock,
    className: "bg-primary/10 text-primary border-primary/20",
    dotClassName: "bg-primary shadow-[0_0_8px_rgba(123,97,255,0.6)]",
  },
  delivered: {
    label: "Delivered",
    icon: CheckCircle2,
    className: "bg-primary/10 text-primary border-primary/20",
    dotClassName: "bg-primary shadow-[0_0_8px_rgba(123,97,255,0.6)]",
  },
  opened: {
    label: "Opened",
    icon: Eye,
    className: "bg-warning/15 text-warning border-warning/30",
    dotClassName: "bg-warning shadow-[0_0_8px_rgba(245,166,35,0.6)]",
  },
  watched: {
    label: "Watched",
    icon: PlayCircle,
    className: "bg-success/15 text-success border-success/30",
    dotClassName: "bg-success shadow-[0_0_8px_rgba(76,175,136,0.6)]",
  },
  replied: {
    label: "Replied",
    icon: MessageSquareHeart,
    className: "bg-secondary/15 text-secondary border-secondary/30",
    dotClassName: "bg-secondary shadow-[0_0_8px_rgba(255,123,123,0.6)] status-dot-pulse",
  },
  failed: {
    label: "Couldn't send",
    icon: AlertCircle,
    className: "bg-destructive/10 text-destructive border-destructive/20",
    dotClassName: "bg-destructive",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as StatusType] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`rounded-full px-2.5 py-0.5 font-medium gap-1.5 ${config.className}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dotClassName}`} aria-hidden="true" />
      <Icon className="w-3 h-3" />
      {config.label}
    </Badge>
  );
}
