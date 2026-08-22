import { useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminListContentReports,
  useAdminUpdateContentReport,
  useAdminResolveContentReport,
  type ContentReport,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Flag, Loader2, Trash2, CheckCircle2, Eye, StickyNote, MessageCircleWarning } from "lucide-react";

const PAGE_SIZE = 20;

// Mirrors routes/contentReports.ts's REPORT_REASONS — display labels only,
// the admin panel is English-only by convention.
const REASON_LABELS: Record<string, string> = {
  child_safety: "Child abuse / endangerment",
  threat_or_violence: "Threat or violence",
  sexual_content: "Sexual content",
  hate_speech: "Hate speech",
  self_harm: "Self-harm or suicide",
  harassment: "Harassment or bullying",
  inappropriate: "Inappropriate",
  misinformation: "Misinformation",
  spam_or_scam: "Spam or scam",
  other: "Other",
};

const PRIORITY_STYLES: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-orange-500/90 text-white",
  medium: "bg-yellow-500/80 text-black",
  low: "bg-muted text-muted-foreground",
};

function contentDescriptor(r: ContentReport): { label: string; text: string | null; alreadyGone: boolean; authorAccountId: string | null } {
  if (r.contentType === "debate_topic") {
    return {
      label: "Debate Now topic",
      text: r.debateTopicText ?? null,
      alreadyGone: !!(r.topicRemovedByAdminAt || r.topicDeletedByAuthorAt),
      authorAccountId: r.debateTopicAuthorId ?? null,
    };
  }
  return {
    label: "Debate Now comment",
    text: r.debateTopicCommentText ?? null,
    alreadyGone: !!r.commentRemovedByAdminAt,
    authorAccountId: r.commentAuthorUserId ?? null,
  };
}

// Per-report resolve dialog: resolution is fixed by which button opened it;
// the two optional messages are what make resolving more than a status flip
// — the reporter reply and the author warning.
function ResolveDialog({
  report,
  resolution,
  onClose,
  onDone,
}: {
  report: ContentReport;
  resolution: "removed" | "no_violation";
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [reply, setReply] = useState("");
  const [warn, setWarn] = useState("");
  const resolve = useAdminResolveContentReport();
  const descriptor = contentDescriptor(report);
  const canWarn = !!descriptor.authorAccountId;

  function handleResolve() {
    resolve.mutate(
      {
        id: report.id,
        data: {
          resolution,
          ...(reply.trim() ? { replyToReporter: reply.trim() } : {}),
          ...(warn.trim() ? { warnAuthor: warn.trim() } : {}),
        },
      },
      {
        onSuccess: (result: any) => {
          onDone();
          onClose();
          toast({
            title: resolution === "removed" ? "Content removed & report resolved" : "Report resolved — no violation",
            description: result.authorWarned
              ? "The reporter was notified and the author received a warning."
              : warn.trim()
                ? "The reporter was notified. The author is anonymous (no account), so no warning could be delivered."
                : "The reporter was notified of the outcome.",
          });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to resolve report", variant: "destructive" }),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {resolution === "removed" ? "Remove content & resolve" : "Resolve as no violation"}
          </DialogTitle>
          <DialogDescription>
            {descriptor.text ? `"${descriptor.text.slice(0, 160)}${descriptor.text.length > 160 ? "…" : ""}"` : `This ${descriptor.label.toLowerCase()} has no text preview.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {resolution === "removed" && !descriptor.alreadyGone && (
            <p className="text-sm text-destructive">
              This takes the {descriptor.label.toLowerCase()} down from the feed, thread, and direct link immediately.
            </p>
          )}
          {descriptor.alreadyGone && (
            <p className="text-sm text-muted-foreground">This content is already down (removed or retracted) — resolving just closes the report.</p>
          )}

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Reply to the reporter (optional)</p>
            <p className="text-xs text-muted-foreground">
              The reporter is always notified of the outcome. Write something here to replace the default message.
            </p>
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value.slice(0, 1000))}
              placeholder={
                resolution === "removed"
                  ? "Default: reviewed and removed for violating our Community Guidelines."
                  : "Default: reviewed and found it doesn't violate our Community Guidelines."
              }
              rows={3}
              className="rounded-xl resize-none"
              data-testid="textarea-reply-to-reporter"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <MessageCircleWarning className="w-4 h-4 text-orange-400" /> Warn the author (optional)
            </p>
            {canWarn ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Delivered to the author's account as a Community Guidelines warning. Leave empty to skip.
                </p>
                <Textarea
                  value={warn}
                  onChange={(e) => setWarn(e.target.value.slice(0, 1000))}
                  placeholder="e.g. Your comment was removed for harassment. Further violations may lead to suspension."
                  rows={3}
                  className="rounded-xl resize-none"
                  data-testid="textarea-warn-author"
                />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                This author is anonymous (no account) — there's nowhere to deliver a warning.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-full" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={resolution === "removed" ? "destructive" : "default"}
            className="rounded-full"
            disabled={resolve.isPending}
            onClick={handleResolve}
            data-testid="button-confirm-resolve"
          >
            {resolve.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : resolution === "removed" ? <Trash2 className="w-4 h-4 mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            {resolution === "removed" ? "Remove & resolve" : "Resolve — no violation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminReports() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("unresolved");
  const [priority, setPriority] = useState("all");
  const [reason, setReason] = useState("all");
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<{ report: ContentReport; resolution: "removed" | "no_violation" } | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  const params = {
    ...(status !== "unresolved" ? { status } : {}),
    ...(priority !== "all" ? { priority } : {}),
    ...(reason !== "all" ? { reason } : {}),
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading } = useAdminListContentReports(params);
  const updateReport = useAdminUpdateContentReport();

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/content-reports"] });
  }

  function patchReport(id: string, patch: { priority?: string; status?: string; adminNotes?: string | null }, successMsg: string) {
    updateReport.mutate(
      { id, data: patch as any },
      {
        onSuccess: () => {
          refresh();
          toast({ title: successMsg });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to update report", variant: "destructive" }),
      },
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const summary = data?.openByPriority;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <Flag className="w-7 h-7 text-destructive" /> Community Reports
          </h1>
          <p className="text-muted-foreground mt-1">
            User-filed reports against Debate Now content, ordered by triage priority — most severe first,
            oldest first within a level. Resolving a report always notifies the reporter of the outcome.
            {data ? ` ${data.total} matching this filter.` : ""}
          </p>
        </div>

        {/* Triage summary — always the full unresolved queue, unaffected by
            filters, so critical work stays visible from any view. Clicking a
            chip filters to that priority. */}
        {summary && (
          <div className="flex flex-wrap gap-2">
            {(["critical", "high", "medium", "low"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => { setPriority(priority === p ? "all" : p); setPage(1); }}
                aria-pressed={priority === p}
                data-testid={`chip-priority-${p}`}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium capitalize transition-all ${
                  priority === p ? "border-primary ring-1 ring-primary" : "border-border/50 hover:border-border"
                } ${summary[p] > 0 && (p === "critical" || p === "high") ? "bg-destructive/10" : "bg-card"}`}
              >
                <span className={`w-2 h-2 rounded-full ${p === "critical" ? "bg-destructive" : p === "high" ? "bg-orange-500" : p === "medium" ? "bg-yellow-500" : "bg-muted-foreground"}`} />
                {p}: {summary[p]}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-48 bg-card border-border/50 rounded-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unresolved">Needs attention</SelectItem>
              <SelectItem value="open">Open (untouched)</SelectItem>
              <SelectItem value="in_review">In review</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="all">All reports</SelectItem>
            </SelectContent>
          </Select>
          <Select value={reason} onValueChange={(v) => { setReason(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-56 bg-card border-border/50 rounded-full"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {Object.entries(REASON_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        ) : data?.items.length ? (
          <div className="space-y-2">
            {data.items.map((r) => {
              const descriptor = contentDescriptor(r);
              const isResolved = r.status === "resolved";
              return (
                <Card key={r.id} className={`border ${isResolved ? "bg-card/50 border-border/30 opacity-80" : r.priority === "critical" ? "bg-card border-destructive/40" : "bg-card border-border/50"}`} data-testid={`report-row-${r.id}`}>
                  <CardContent className="p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <Badge className={`capitalize shrink-0 ${PRIORITY_STYLES[r.priority] ?? ""}`}>{r.priority}</Badge>
                        <Badge variant="outline" className="shrink-0">{REASON_LABELS[r.reason] ?? r.reason}</Badge>
                        {r.status === "in_review" && (
                          <Badge variant="outline" className="border-primary text-primary shrink-0"><Eye className="w-3 h-3 mr-1" /> In review</Badge>
                        )}
                        {isResolved && (
                          <Badge variant="outline" className={`shrink-0 ${r.resolution === "removed" ? "border-destructive text-destructive" : "border-emerald-500 text-emerald-500"}`}>
                            {r.resolution === "removed" ? <><Trash2 className="w-3 h-3 mr-1" /> Removed</> : <><CheckCircle2 className="w-3 h-3 mr-1" /> No violation</>}
                          </Badge>
                        )}
                        {r.authorWarnedAt && (
                          <Badge variant="outline" className="border-orange-400 text-orange-400 shrink-0">
                            <MessageCircleWarning className="w-3 h-3 mr-1" /> Author warned
                          </Badge>
                        )}
                        {descriptor.alreadyGone && !isResolved && (
                          <Badge variant="outline" className="text-muted-foreground shrink-0">Content already down</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{new Date(r.createdAt).toLocaleString()}</span>
                    </div>

                    <p className="font-medium text-foreground text-sm">
                      {descriptor.label}: "{(descriptor.text ?? "").slice(0, 120)}{(descriptor.text?.length ?? 0) > 120 ? "…" : ""}"
                    </p>

                    {r.detail && (
                      <p className="text-sm text-muted-foreground border-l-2 border-border pl-3 whitespace-pre-wrap">{r.detail}</p>
                    )}

                    {r.adminNotes && (
                      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {r.adminNotes}
                      </p>
                    )}

                    {isResolved && r.adminReplyMessage && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Reply sent to reporter:</span> {r.adminReplyMessage}
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                      <Link href={`/admin_pro/users/${r.reporterUserId}`} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                        Reporter: {r.reporterEmail ?? r.reporterUserId}
                      </Link>

                      {!isResolved && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Re-triage: the stored priority is only a default
                              derived from the reason — the human wins. */}
                          <Select
                            value={r.priority}
                            onValueChange={(v) => patchReport(r.id, { priority: v }, `Priority set to ${v}`)}
                          >
                            <SelectTrigger className="h-8 w-28 bg-card border-border/50 rounded-full text-xs" data-testid={`select-priority-${r.id}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="critical">Critical</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="low">Low</SelectItem>
                            </SelectContent>
                          </Select>
                          {r.status === "open" && (
                            <Button size="sm" variant="outline" className="rounded-full" onClick={() => patchReport(r.id, { status: "in_review" }, "Taken into review")} disabled={updateReport.isPending}>
                              <Eye className="w-3.5 h-3.5 mr-1.5" /> Start review
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setResolving({ report: r, resolution: "no_violation" })} data-testid={`button-no-violation-${r.id}`}>
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> No violation
                          </Button>
                          <Button size="sm" variant="destructive" className="rounded-full" onClick={() => setResolving({ report: r, resolution: "removed" })} data-testid={`button-remove-${r.id}`}>
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Remove content
                          </Button>
                        </div>
                      )}
                    </div>

                    {!isResolved && (
                      <div className="flex items-center gap-2 pt-1">
                        <Textarea
                          value={notesDraft[r.id] ?? r.adminNotes ?? ""}
                          onChange={(e) => setNotesDraft((d) => ({ ...d, [r.id]: e.target.value.slice(0, 2000) }))}
                          placeholder="Internal notes (never shown to users)..."
                          rows={1}
                          className="rounded-xl resize-none text-xs min-h-8"
                          data-testid={`textarea-notes-${r.id}`}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full shrink-0"
                          disabled={updateReport.isPending || (notesDraft[r.id] ?? r.adminNotes ?? "") === (r.adminNotes ?? "")}
                          onClick={() => patchReport(r.id, { adminNotes: (notesDraft[r.id] ?? "").trim() || null }, "Notes saved")}
                        >
                          <StickyNote className="w-3.5 h-3.5 mr-1.5" /> Save
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">Nothing here — no reports match this filter.</p>
          </Card>
        )}

        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" className="rounded-full" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Prev
            </Button>
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" className="rounded-full" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>

      {resolving && (
        <ResolveDialog
          report={resolving.report}
          resolution={resolving.resolution}
          onClose={() => setResolving(null)}
          onDone={refresh}
        />
      )}
    </AdminLayout>
  );
}
