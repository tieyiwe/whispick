import { Check, Clock } from "lucide-react";

// Shared by WhispDetail.tsx (Sent → Delivered → Opened → Watched → Replied)
// and TextWhispDetail.tsx (Sent → Read → Replied) — same funnel-timeline
// concept, same visual track, just a different set of steps. Extracted here
// so the two features render the identical component instead of two
// look-alike copies drifting apart over time.
export type TimelineStepData = {
  label: string;
  /** Spelled out on hover/long-press when the label had to be shortened to
   *  survive several steps across a phone screen. */
  fullLabel?: string;
  time?: string | Date | null;
  done: boolean;
  active?: boolean;
};

// The full timestamp (toLocaleString) was fine stacked vertically with a whole
// row to itself; across a horizontal track it's the widest thing on screen by
// far. Same-day steps — the common case while a whisp is live — only need the
// clock time.
export function compactTime(value: string | Date): string {
  const date = new Date(value);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// One horizontal track rather than stacked rows. Vertically a stacked layout
// runs most of a phone screen on its own, pushing the conversation — the part
// worth coming back for — below the fold.
export function TimelineTrack({ steps }: { steps: TimelineStepData[] }) {
  return (
    // Scrolls rather than crushes: a handful of steps fit a typical phone,
    // but a narrow screen or large text size shouldn't squeeze the labels
    // into unreadable slivers.
    <div className="flex overflow-x-auto pb-1">
      {steps.map((step, i) => (
        <div key={step.label} className="relative flex min-w-[54px] flex-1 flex-col items-center">
          {/* Connector back to the previous step, tinted only when this step
              is reached — so the filled portion of the track reads as
              progress at a glance, before any label is read. */}
          {i > 0 && (
            <span
              aria-hidden
              className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 ${
                step.done ? "bg-primary" : "bg-border"
              }`}
            />
          )}
          <div
            title={step.fullLabel ?? step.label}
            className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all ${
              step.done
                ? "bg-primary text-primary-foreground"
                : step.active
                ? "border-2 border-primary bg-card"
                : "border border-border bg-muted"
            }`}
          >
            {step.done ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4 text-muted-foreground" />}
          </div>
          <p
            className={`mt-1.5 px-0.5 text-center text-[10px] leading-tight ${
              step.done ? "font-medium text-foreground" : "text-muted-foreground"
            }`}
          >
            {step.label}
          </p>
          <p className="text-center text-[10px] leading-tight text-muted-foreground/70">
            {step.time ? compactTime(step.time) : step.done ? "" : "—"}
          </p>
        </div>
      ))}
    </div>
  );
}
