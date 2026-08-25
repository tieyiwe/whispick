import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminListBugIssues,
  useAdminGetBugIssue,
  useAdminUpdateBugIssue,
  getAdminListBugIssuesQueryKey,
  type BugIssue,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Bug, ChevronDown, ChevronLeft, ChevronRight, CheckCircle2, RotateCcw, Loader2, Monitor, Server } from "lucide-react";

const PAGE_SIZE = 20;

function relativeTime(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}

// Fetches and renders one issue's detail — its own component (not inline in
// the list) so useAdminGetBugIssue only ever runs for the currently
// expanded row, mounted/unmounted by the parent's conditional render rather
// than toggled via the hook's `enabled` option.
function IssueDetailPanel({ id }: { id: string }) {
  const { data, isLoading } = useAdminGetBugIssue(id);

  if (isLoading || !data) {
    return <Skeleton className="h-32 rounded-xl mt-3" />;
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
      {data.issue.resolvedByAdminId && (
        <p className="text-xs text-muted-foreground">
          Resolved {data.issue.resolvedAt ? relativeTime(data.issue.resolvedAt) : ""}
        </p>
      )}
      {data.occurrences.length === 0 ? (
        <p className="text-xs text-muted-foreground">No occurrence detail stored (this issue predates BugRabbit, or every occurrence rolled off the per-issue cap).</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Recent occurrences ({data.occurrences.length}{data.issue.occurrenceCount > data.occurrences.length ? ` of ${data.issue.occurrenceCount} total` : ""})
          </p>
          {data.occurrences.map((o) => (
            <div key={o.id} className="rounded-lg bg-muted/40 p-2.5 text-xs space-y-1" data-testid={`occurrence-${o.id}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
                <span>{relativeTime(o.createdAt)}</span>
                {o.url && <span>{o.url}</span>}
                {o.userEmail && <span>{o.userEmail}</span>}
                {o.userAgent && <span className="truncate max-w-[240px]">{o.userAgent}</span>}
              </div>
              {o.stack && (
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/80 max-h-40 overflow-y-auto">{o.stack}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  return source === "backend" ? (
    <Badge variant="outline" className="shrink-0"><Server className="w-3 h-3 mr-1" /> Backend</Badge>
  ) : (
    <Badge variant="outline" className="shrink-0"><Monitor className="w-3 h-3 mr-1" /> Frontend</Badge>
  );
}

export function AdminBugRabbit() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("unresolved");
  const [sort, setSort] = useState("recency");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const params = { status, sort, page, pageSize: PAGE_SIZE };
  const { data, isLoading } = useAdminListBugIssues(params);
  const updateIssue = useAdminUpdateBugIssue();

  function refresh() {
    queryClient.invalidateQueries({ queryKey: getAdminListBugIssuesQueryKey(params) });
  }

  function setResolved(issue: BugIssue, resolved: boolean) {
    updateIssue.mutate(
      { id: issue.id, data: { resolved } },
      {
        onSuccess: () => {
          refresh();
          toast({ title: resolved ? "Marked resolved" : "Reopened" });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to update", variant: "destructive" }),
      },
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  // Same reasoning as AdminReports.tsx's own effect — resolving the last row
  // of the last page would otherwise strand `page` past the shrunken total.
  useEffect(() => {
    if (data && page > totalPages) setPage(totalPages);
  }, [data, page, totalPages]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <Bug className="w-7 h-7 text-primary" /> BugRabbit
          </h1>
          <p className="text-muted-foreground mt-1">
            Errors caught from the live app — frontend crashes and unhandled backend exceptions — grouped into one
            issue per distinct bug so repeats show up as an occurrence count instead of flooding this queue.
            {data ? ` ${data.total} matching this filter.` : ""}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-48 bg-card border-border/50 rounded-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unresolved">Unresolved</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="all">All issues</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-48 bg-card border-border/50 rounded-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recency">Most recent first</SelectItem>
              <SelectItem value="frequency">Most frequent first</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        ) : data?.items.length ? (
          <div className="space-y-2">
            {data.items.map((issue) => {
              const isExpanded = expandedId === issue.id;
              return (
                <Card
                  key={issue.id}
                  className={`border ${issue.resolved ? "bg-card/50 border-border/30 opacity-80" : "bg-card border-border/50"}`}
                  data-testid={`issue-row-${issue.id}`}
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : issue.id)}
                        className="flex items-start gap-2 text-left min-w-0 flex-1"
                        data-testid={`button-expand-${issue.id}`}
                      >
                        <ChevronDown className={`w-4 h-4 mt-0.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        <span className="font-mono text-sm text-foreground break-words">{issue.message}</span>
                      </button>
                      <Badge className="shrink-0 bg-primary/15 text-primary border-primary/30">
                        ×{issue.occurrenceCount}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap pl-6">
                      <SourceBadge source={issue.source} />
                      {issue.resolved && (
                        <Badge variant="outline" className="border-emerald-500 text-emerald-500 shrink-0">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Resolved
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">First seen {relativeTime(issue.firstSeenAt)}</span>
                      <span className="text-xs text-muted-foreground">· Last seen {relativeTime(issue.lastSeenAt)}</span>
                    </div>

                    <div className="flex justify-end pl-6">
                      {issue.resolved ? (
                        <Button size="sm" variant="outline" className="rounded-full" disabled={updateIssue.isPending} onClick={() => setResolved(issue, false)} data-testid={`button-reopen-${issue.id}`}>
                          <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reopen
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="rounded-full" disabled={updateIssue.isPending} onClick={() => setResolved(issue, true)} data-testid={`button-resolve-${issue.id}`}>
                          {updateIssue.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                          Mark resolved
                        </Button>
                      )}
                    </div>

                    {isExpanded && <div className="pl-6"><IssueDetailPanel id={issue.id} /></div>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">Nothing here — no issues match this filter.</p>
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
    </AdminLayout>
  );
}
