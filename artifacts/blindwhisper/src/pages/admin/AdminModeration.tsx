import { useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminListModerationFlags,
  useAdminUpdateModerationFlag,
  getAdminListModerationFlagsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, ShieldAlert, RotateCcw, Check } from "lucide-react";

const PAGE_SIZE = 20;

export function AdminModeration() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState("false");
  const [severity, setSeverity] = useState("all");
  const [page, setPage] = useState(1);

  const params = {
    ...(dismissed !== "all" ? { dismissed } : {}),
    ...(severity !== "all" ? { severity } : {}),
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading } = useAdminListModerationFlags(params, {
    query: { queryKey: getAdminListModerationFlagsQueryKey(params) },
  });
  const updateFlag = useAdminUpdateModerationFlag();

  function setFlagDismissed(id: string, value: boolean) {
    updateFlag.mutate(
      { id, data: { dismissed: value } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation/flags"] });
          toast({ title: value ? "Flag dismissed" : "Flag restored" });
        },
        onError: () => toast({ title: "Failed to update flag", variant: "destructive" }),
      },
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="w-7 h-7 text-destructive" /> Content Moderation
          </h1>
          <p className="text-muted-foreground mt-1">
            Content an automated pass flagged as possibly sexual/explicit, or — for Blind Circle comments —
            dangerous/harmful language. A signal worth a look, not a verdict.
            {data ? ` ${data.total} matching this filter.` : ""}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={dismissed} onValueChange={(v) => { setDismissed(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-48 bg-card border-border/50 rounded-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="false">Needs review</SelectItem>
              <SelectItem value="true">Dismissed (false positives)</SelectItem>
              <SelectItem value="all">All flags</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={(v) => { setSeverity(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-40 bg-card border-border/50 rounded-full"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        ) : data?.items.length ? (
          <div className="space-y-2">
            {data.items.map((f) => (
              <Card key={f.id} className={`border ${f.dismissed ? "bg-card/50 border-border/30 opacity-70" : "bg-card border-destructive/20"}`} data-testid={`flag-row-${f.id}`}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={f.dismissed ? "outline" : "destructive"} className="capitalize shrink-0">{f.severity}</Badge>
                      {f.contentType === "text_whisp" ? (
                        // No admin detail page exists for a Text Whisp — show
                        // a short excerpt instead of a dead/misleading link.
                        <span className="font-medium text-foreground truncate">
                          Text Whisp: "{(f.textWhispMessage ?? "").slice(0, 60)}{(f.textWhispMessage?.length ?? 0) > 60 ? "…" : ""}"
                        </span>
                      ) : f.contentType === "circle_comment" ? (
                        // Same reasoning as Text Whisp above — no dedicated
                        // detail page for a single comment, so show the
                        // excerpt instead of linking anywhere.
                        <span className="font-medium text-foreground truncate">
                          Circle comment: "{(f.circleCommentText ?? "").slice(0, 60)}{(f.circleCommentText?.length ?? 0) > 60 ? "…" : ""}"
                        </span>
                      ) : (
                        <Link href={`/admin/whisps/${f.whispId}`} className="font-medium text-foreground hover:text-primary transition-colors truncate">
                          {f.videoTitle || "Video"}
                        </Link>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{new Date(f.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{f.reasoning}</p>
                  <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                    {f.userId ? (
                      <Link href={`/admin/users/${f.userId}`} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                        Sender: {f.senderEmail ?? f.userId}
                      </Link>
                    ) : (
                      // A circle_comment flag from a fully anonymous, no-account
                      // visitor has no userId to link — nothing here identifies
                      // them beyond that, by design (see moderation_flags.ts).
                      <span className="text-xs text-muted-foreground">Anonymous visitor</span>
                    )}
                    <div className="flex items-center gap-1">
                      {f.dismissed ? (
                        <Button size="sm" variant="outline" className="rounded-full" onClick={() => setFlagDismissed(f.id, false)} disabled={updateFlag.isPending}>
                          <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Restore
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="rounded-full" onClick={() => setFlagDismissed(f.id, true)} disabled={updateFlag.isPending}>
                          <Check className="w-3.5 h-3.5 mr-1.5" /> Dismiss as false positive
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">Nothing here — no flags match this filter.</p>
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
