import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useAdminGetWhisp, useAdminDeleteWhisp, getAdminGetWhispQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MoodTag } from "@/components/shared/MoodTag";
import { deliveryLabel } from "@/lib/deliveryMethod";
import { categoryLabel } from "@/lib/videoCategories";
import { ArrowLeft, PlayCircle, Trash2, ChevronDown, ChevronUp } from "lucide-react";

export function AdminWhispDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showTranscript, setShowTranscript] = useState(false);

  const { data, isLoading } = useAdminGetWhisp(id!, { query: { enabled: !!id, queryKey: getAdminGetWhispQueryKey(id!) } });
  const deleteWhisp = useAdminDeleteWhisp();

  function handleDelete() {
    deleteWhisp.mutate(
      { id: id! },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/admin/whisps"] });
          setLocation("/admin_pro/whisps");
          toast({ title: "Whisp removed" });
        },
        onError: () => toast({ title: "Failed to remove whisp", variant: "destructive" }),
      }
    );
  }

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </AdminLayout>
    );
  }

  if (!data) {
    return (
      <AdminLayout>
        <div className="max-w-2xl mx-auto text-center py-16">
          <p className="text-muted-foreground">Whisp not found.</p>
        </div>
      </AdminLayout>
    );
  }

  const { whisp, senderEmail, senderFullName, trackingEvents, replies, categories, deliveryAttempts, moderationFlags } = data;

  return (
    <AdminLayout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setLocation("/admin_pro/whisps")} className="text-muted-foreground -ml-2">
            <ArrowLeft className="w-4 h-4 mr-1" /> Content
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" data-testid="button-delete-whisp-detail">
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this whisp?</AlertDialogTitle>
                <AlertDialogDescription>Permanently deletes this whisp, its tracking history, and any replies. This can't be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Card className="bg-card border-border/50 overflow-hidden">
          {whisp.videoThumbnail && (
            <div className="relative h-48 overflow-hidden">
              <img src={whisp.videoThumbnail} alt="Video" className="w-full h-full object-cover" />
              <a href={whisp.videoUrl} target="_blank" rel="noopener noreferrer" className="absolute inset-0 bg-black/50 flex items-center justify-center hover:bg-black/40 transition-colors">
                <PlayCircle className="w-10 h-10 text-white" />
              </a>
            </div>
          )}
          <CardContent className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-serif font-semibold text-lg text-foreground">{whisp.videoTitle || "Video"}</h2>
                <p className="text-sm text-muted-foreground">
                  From {senderFullName || senderEmail || "Unknown"} {senderEmail && senderFullName ? `(${senderEmail})` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Via {deliveryLabel(whisp.deliveryMethod, whisp.whisperChannel)} · {new Date(whisp.createdAt).toLocaleString()}
                </p>
              </div>
              <StatusBadge status={whisp.status} />
            </div>
            {whisp.moodTag && <MoodTag mood={whisp.moodTag} />}
            {whisp.anonymousNote && (
              <p className="text-sm text-muted-foreground italic border-l-2 border-primary/40 pl-3">"{whisp.anonymousNote}"</p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1 border-t border-border/30">
              {(whisp.recipientEmail || whisp.recipientPhone) && (
                <div>
                  <p className="text-muted-foreground">Recipient</p>
                  <p className="text-foreground font-medium truncate">{whisp.recipientEmail || whisp.recipientPhone}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">Delivered</p>
                <p className="text-foreground font-medium">{whisp.deliveredAt ? new Date(whisp.deliveredAt).toLocaleString() : "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Opened</p>
                <p className="text-foreground font-medium">{whisp.openedAt ? new Date(whisp.openedAt).toLocaleString() : "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Watched</p>
                <p className="text-foreground font-medium">{whisp.watchedAt ? new Date(whisp.watchedAt).toLocaleString() : "—"}</p>
              </div>
              {whisp.revealRequested && (
                <div>
                  <p className="text-muted-foreground">Reveal</p>
                  <p className="text-foreground font-medium">
                    {whisp.revealAccepted === null ? "Requested" : whisp.revealAccepted ? "Accepted" : "Declined"}
                  </p>
                </div>
              )}
              {whisp.appreciationResponse && (
                <div>
                  <p className="text-muted-foreground">Appreciated</p>
                  <p className="text-foreground font-medium capitalize">{whisp.appreciationResponse}</p>
                </div>
              )}
            </div>
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {categories.map((c) => (
                  <Badge key={c.id} variant="outline" data-testid={`category-badge-${c.category}`}>
                    #{c.rank} {categoryLabel(c.category)} <span className="text-muted-foreground ml-1">({c.score})</span>
                  </Badge>
                ))}
              </div>
            )}
            {whisp.videoTranscript && (
              <div>
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                  data-testid="button-toggle-transcript"
                >
                  {showTranscript ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {showTranscript ? "Hide" : "Show"} fetched transcript
                </button>
                {showTranscript && (
                  <p className="text-xs text-muted-foreground mt-2 bg-muted/30 rounded-lg p-3 max-h-40 overflow-y-auto">{whisp.videoTranscript}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {moderationFlags.length > 0 && (
          <Card className="bg-destructive/5 border-destructive/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif text-destructive">Content Flags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {moderationFlags.map((f) => (
                <div key={f.id} className="p-3 rounded-xl text-sm bg-card border border-destructive/20">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="destructive" className="capitalize">{f.severity}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(f.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-foreground">{f.reasoning}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {f.dismissed ? "Dismissed as a false positive" : "Awaiting review"} · <Link href="/admin_pro/moderation" className="hover:text-primary transition-colors">Review queue</Link>
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-serif">Delivery Attempts</CardTitle>
            <p className="text-xs text-muted-foreground">Every SMS/email/WhatsApp send Blind Whisper made for this whisp, accepted or failed.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {deliveryAttempts.length ? deliveryAttempts.map((a) => (
              <div key={a.id} className="p-3 rounded-xl text-sm bg-muted/20 border border-border/30">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge variant={a.success ? "outline" : "destructive"} className="capitalize">{a.success ? "Accepted" : "Failed"}</Badge>
                    <span className="text-xs text-muted-foreground capitalize">{a.channel} · {a.purpose.replace(/_/g, " ")}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">To {a.toAddress}</p>
                {a.errorMessage && <p className="text-xs text-destructive mt-1">{a.errorMessage}</p>}
                {a.providerMessageId && <p className="text-xs text-muted-foreground mt-1 font-mono">{a.providerMessageId}</p>}
              </div>
            )) : <p className="text-sm text-muted-foreground py-4 text-center">No send attempts logged for this whisp.</p>}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-serif">Tracking Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {trackingEvents.length ? trackingEvents.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0">
                <span className="text-foreground capitalize">{e.eventType.replace(/_/g, " ")}</span>
                <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
            )) : <p className="text-sm text-muted-foreground py-4 text-center">No tracking events yet.</p>}
          </CardContent>
        </Card>

        {replies.length > 0 && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif">Replies</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {replies.map((r) => (
                <div key={r.id} className={`p-3 rounded-xl text-sm ${r.fromRecipient ? "bg-primary/10 border border-primary/20" : "bg-muted/30 border border-border/50"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">{r.fromRecipient ? "Recipient" : "Sender"}</span>
                    <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  {r.replyText && <p className="text-foreground">{r.replyText}</p>}
                  {r.videoUrl && <p className="text-xs text-muted-foreground mt-1">Video reply: {r.videoTitle || r.videoUrl}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
