import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, CheckCheck, Clock, Eye, PlayCircle, MessageSquareHeart, CalendarClock, AlertCircle } from "lucide-react";

// "sent" and "read" are Text Whisps' own status values (see
// lib/db/src/schema/text_whisps.ts) — video whisps never use them (their
// equivalent stages are "delivered"/"opened"), so adding them here is
// namespace-safe and lets TextWhispsList.tsx reuse this exact badge instead
// of a one-off copy, the same "same feature, not a reimplementation" reuse
// WhispsList.tsx already gets.
type StatusType = "pending" | "scheduled" | "sent" | "read" | "delivered" | "opened" | "watched" | "replied" | "failed";

// Colour follows meaning along the funnel, not decoration: neutral while
// nothing has happened yet, cool tones as it travels (delivered → opened),
// a positive green once it's been watched, and the gilded accent for a reply —
// the best outcome a whisp can have. Red is reserved for the one state that
// needs attention ("failed"); "watched" used to be the app's coral red, which
// read as an alarm on what is good news.
const STATUS_CONFIG: Record<StatusType, { labelKey: string; icon: any; className: string }> = {
  pending: {
    labelKey: "statusBadge.pending",
    icon: Clock,
    className: "bg-muted/50 text-muted-foreground border-border/70",
  },
  scheduled: {
    labelKey: "statusBadge.scheduled",
    icon: CalendarClock,
    className: "bg-violet-400/10 text-violet-300 border-violet-400/25",
  },
  // WhatsApp-style read-receipt vocabulary — a single check for "sent, not
  // yet read" and a double check once it has been, so a Text Whisp's status
  // reads at a glance the same way the per-reply receipts in ReplyThread.tsx
  // already do.
  sent: {
    labelKey: "statusBadge.sent",
    icon: CheckCircle2,
    className: "bg-muted/50 text-muted-foreground border-border/70",
  },
  read: {
    labelKey: "statusBadge.read",
    icon: CheckCheck,
    className: "bg-primary/12 text-primary border-primary/30",
  },
  delivered: {
    labelKey: "statusBadge.delivered",
    icon: CheckCircle2,
    className: "bg-sky-400/10 text-sky-300 border-sky-400/25",
  },
  opened: {
    labelKey: "statusBadge.opened",
    icon: Eye,
    className: "bg-primary/12 text-primary border-primary/30",
  },
  watched: {
    labelKey: "statusBadge.watched",
    icon: PlayCircle,
    className: "bg-emerald-400/10 text-emerald-300 border-emerald-400/25",
  },
  replied: {
    labelKey: "statusBadge.replied",
    icon: MessageSquareHeart,
    className: "bg-gilded/12 text-gilded border-gilded/35",
  },
  failed: {
    labelKey: "statusBadge.failed",
    icon: AlertCircle,
    className: "bg-destructive/10 text-red-300 border-destructive/30",
  },
};

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const { t } = useTranslation("sharedB");
  const config = STATUS_CONFIG[status as StatusType] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={`h-6 shrink-0 gap-1 whitespace-nowrap rounded-full px-2.5 py-0 text-xs font-medium ${config.className} ${className}`}
      data-status={status}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {t(config.labelKey)}
    </Badge>
  );
}
