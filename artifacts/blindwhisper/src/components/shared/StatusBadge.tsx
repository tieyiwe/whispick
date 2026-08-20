import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Eye, PlayCircle, MessageSquareHeart, CalendarClock, AlertCircle } from "lucide-react";

type StatusType = "pending" | "scheduled" | "delivered" | "opened" | "watched" | "replied" | "failed";

const STATUS_CONFIG: Record<StatusType, { labelKey: string; icon: any; className: string }> = {
  pending: {
    labelKey: "statusBadge.pending",
    icon: Clock,
    className: "bg-muted text-muted-foreground border-border",
  },
  scheduled: {
    labelKey: "statusBadge.scheduled",
    icon: CalendarClock,
    className: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  },
  delivered: {
    labelKey: "statusBadge.delivered",
    icon: CheckCircle2,
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  opened: {
    labelKey: "statusBadge.opened",
    icon: Eye,
    className: "bg-primary/20 text-primary border-primary/30 glow-card",
  },
  watched: {
    labelKey: "statusBadge.watched",
    icon: PlayCircle,
    className: "bg-secondary/20 text-secondary border-secondary/30",
  },
  replied: {
    labelKey: "statusBadge.replied",
    icon: MessageSquareHeart,
    className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
  failed: {
    labelKey: "statusBadge.failed",
    icon: AlertCircle,
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("sharedB");
  const config = STATUS_CONFIG[status as StatusType] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`rounded-full px-2.5 py-0.5 font-medium ${config.className}`}>
      <Icon className="w-3 h-3 mr-1.5" />
      {t(config.labelKey)}
    </Badge>
  );
}
