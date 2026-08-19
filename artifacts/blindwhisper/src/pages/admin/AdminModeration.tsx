import { useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminListModerationFlags,
  useAdminUpdateModerationFlag,
  useAdminRemoveFlaggedContent,
  getAdminListModerationFlagsQueryKey,
  type ModerationFlag,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, ShieldAlert, RotateCcw, Check, Trash2 } from "lucide-react";

const PAGE_SIZE = 20;

// The remove-content endpoint only knows how to take down these four
// content types (see admin.ts's remove-content route) — a Text Whisp is a
// private send between two people, not published anywhere public, so
// there's nothing for it to pull off a public read path.
const REMOVABLE_CONTENT_TYPES = new Set(["whisp", "circle_comment", "debate_topic", "debate_topic_comment"]);

function flagContentDescriptor(f: ModerationFlag): { label: string; text: string | null } {
  switch (f.contentType) {
    case "text_whisp":
      return { label: "Text Whisp", text: f.textWhispMessage ?? null };
    case "circle_comment":
      return { label: "Blind Circle comment", text: f.circleCommentText ?? null };
    case "debate_topic":
      return { label: "Debate Topic", text: f.debateTopicText ?? null };
    case "debate_topic_comment":
      return { label: "Debate Topic comment", text: f.debateTopicCommentText ?? null };
    default:
      return { label: "Whisp", text: f.videoTitle ?? null };
  }
}

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
  const removeContent = useAdminRemoveFlaggedContent();
  // The flag itself never gains a "removed" field (removedByAdminAt lands on
  // the underlying whisp/comment/topic row, not the flag row returned here),
  // so this queue's only record of "already taken down" is this local set.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

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

  function handleRemoveContent(id: string) {
    removeContent.mutate(
      { id },
      {
        onSuccess: () => {
          setRemovedIds((prev) => new Set(prev).add(id));
          queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation/flags"] });
          toast({ title: "Content removed", description: "It no longer appears in the feed, thread, or direct link." });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to remove content", variant: "destructive" }),
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
            Content an automated pass flagged as possibly sexual/explicit, or — for Blind Circle comments and
            Debate Topics — dangerous/harmful language. A signal worth a look, not a verdict.
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
            {data.items.map((f) => {
              const isRemoved = removedIds.has(f.id);
              const descriptor = flagContentDescriptor(f);
              const canRemove = REMOVABLE_CONTENT_TYPES.has(f.contentType);
              return (
              <Card key={f.id} className={`border ${f.dismissed || isRemoved ? "bg-card/50 border-border/30 opacity-70" : "bg-card border-destructive/20"}`} data-testid={`flag-row-${f.id}`}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={f.dismissed ? "outline" : "destructive"} className="capitalize shrink-0">{f.severity}</Badge>
                      {isRemoved && (
                        <Badge variant="outline" className="border-destructive text-destructive shrink-0">
                          <Trash2 className="w-3 h-3 mr-1" /> Content removed
                        </Badge>
                      )}
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
                      ) : f.contentType === "debate_topic" ? (
                        <span className="font-medium text-foreground truncate">
                          Debate Topic: "{(f.debateTopicText ?? "").slice(0, 60)}{(f.debateTopicText?.length ?? 0) > 60 ? "…" : ""}"
                        </span>
                      ) : f.contentType === "debate_topic_comment" ? (
                        // Same reasoning as Text Whisp above — no dedicated
                        // detail page for a single comment, so show the
                        // excerpt instead of linking anywhere.
                        <span className="font-medium text-foreground truncate">
                          Debate Topic comment: "{(f.debateTopicCommentText ?? "").slice(0, 60)}{(f.debateTopicCommentText?.length ?? 0) > 60 ? "…" : ""}"
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
                      {!isRemoved && canRemove && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="destructive" className="rounded-full" disabled={removeContent.isPending} data-testid={`button-remove-content-${f.id}`}>
                              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Remove content
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Take down this {descriptor.label.toLowerCase()}?</AlertDialogTitle>
                              <AlertDialogDescription className="space-y-2">
                                <span className="block">
                                  {descriptor.text ? `"${descriptor.text.slice(0, 200)}${descriptor.text.length > 200 ? "…" : ""}"` : `This ${descriptor.label.toLowerCase()} has no text preview.`}
                                </span>
                                <span className="block">
                                  This immediately removes it from the feed, comment thread, and direct link. It can't be restored from the admin panel.
                                </span>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRemoveContent(f.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Remove content
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
              );
            })}
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
