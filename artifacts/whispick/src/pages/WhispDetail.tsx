import { useParams, useLocation } from "wouter";
import {
  useGetWhisp,
  useCreateWhispReply,
  useRequestReveal,
  useDeleteWhisp,
  getGetWhispQueryKey,
  getListWhispsQueryKey,
  getGetWhispStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MoodTag } from "@/components/shared/MoodTag";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  ArrowLeft,
  PlayCircle,
  Send,
  Eye,
  Check,
  Clock,
  MessageSquare,
  Loader2,
  Trash2,
  UserCircle2,
} from "lucide-react";
import { DELIVERY_METHOD_LABELS } from "@/lib/deliveryMethod";

function TimelineStep({
  label,
  time,
  done,
  active,
}: {
  label: string;
  time?: string | Date | null;
  done: boolean;
  active?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
          done
            ? "bg-primary text-primary-foreground"
            : active
            ? "bg-muted border-2 border-primary"
            : "bg-muted border border-border"
        }`}
      >
        {done ? <Check className="w-4 h-4" /> : <Clock className="w-4 h-4 text-muted-foreground" />}
      </div>
      <div>
        <p className={`text-sm font-medium ${done ? "text-foreground" : "text-muted-foreground"}`}>{label}</p>
        {time && <p className="text-xs text-muted-foreground mt-0.5">{new Date(time).toLocaleString()}</p>}
        {!time && !done && <p className="text-xs text-muted-foreground mt-0.5">Waiting...</p>}
      </div>
    </div>
  );
}

export function WhispDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");

  const { data, isLoading } = useGetWhisp(id!, {
    query: { enabled: !!id, queryKey: getGetWhispQueryKey(id!) },
  });

  const createReply = useCreateWhispReply();
  const requestReveal = useRequestReveal();
  const deleteWhisp = useDeleteWhisp();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto text-center py-16">
          <p className="text-muted-foreground">Whisp not found.</p>
          <Button variant="ghost" onClick={() => setLocation("/whisps")} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to whisps
          </Button>
        </div>
      </AppLayout>
    );
  }

  const { whisp, trackingEvents, replies } = data;

  function handleSendFollowUp() {
    if (!replyText.trim()) return;
    createReply.mutate(
      { id: whisp.id, data: { replyText: replyText.trim(), fromRecipient: false } },
      {
        onSuccess: () => {
          setReplyText("");
          queryClient.invalidateQueries({ queryKey: getGetWhispQueryKey(id!) });
          toast({ title: "Follow-up sent" });
        },
        onError: () => toast({ title: "Failed to send", variant: "destructive" }),
      }
    );
  }

  function handleReveal() {
    requestReveal.mutate(
      { id: whisp.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWhispQueryKey(id!) });
          toast({ title: "Reveal request sent" });
        },
        onError: () => toast({ title: "Failed to request reveal", variant: "destructive" }),
      }
    );
  }

  function handleDelete() {
    if (!confirm("Delete this whisp permanently?")) return;
    deleteWhisp.mutate(
      { id: whisp.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetWhispStatsQueryKey() });
          setLocation("/whisps");
          toast({ title: "Whisp deleted" });
        },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      }
    );
  }

  const eventTypes = trackingEvents.map((e) => e.eventType);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setLocation("/whisps")} className="text-muted-foreground -ml-2" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            disabled={deleteWhisp.isPending}
            className="text-muted-foreground hover:text-destructive"
            data-testid="button-delete-whisp"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        {/* Video preview */}
        <Card className="bg-card border-border/50 overflow-hidden">
          {whisp.videoThumbnail ? (
            <div className="relative h-48 overflow-hidden">
              <img src={whisp.videoThumbnail} alt="Video" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <a href={whisp.videoUrl} target="_blank" rel="noopener noreferrer">
                  <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white/30 transition-colors">
                    <PlayCircle className="w-8 h-8 text-white" />
                  </div>
                </a>
              </div>
            </div>
          ) : null}
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="font-serif font-semibold text-lg text-foreground">{whisp.videoTitle || "Video"}</h2>
                <p className="text-sm text-muted-foreground">
                  Sent to {whisp.recipientEmail || whisp.recipientPhone || (whisp.deliveryMethod === "circle_drop" ? "Circle feed" : "Ghost Boost audience")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Via {DELIVERY_METHOD_LABELS[whisp.deliveryMethod] ?? whisp.deliveryMethod} · {new Date(whisp.createdAt).toLocaleDateString()}
                </p>
              </div>
              <StatusBadge status={whisp.status} />
            </div>
            {whisp.moodTag && <MoodTag mood={whisp.moodTag} className="mb-2" />}
            {whisp.anonymousNote && (
              <p className="text-sm text-muted-foreground italic border-l-2 border-primary/40 pl-3">
                "{whisp.anonymousNote}"
              </p>
            )}
          </CardContent>
        </Card>

        {/* Delivery timeline */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-serif">Delivery Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <TimelineStep label="Sent" time={whisp.createdAt} done={true} />
            <TimelineStep label="Delivered" time={whisp.deliveredAt} done={!!whisp.deliveredAt} />
            <TimelineStep
              label="Opened"
              time={whisp.openedAt}
              done={!!whisp.openedAt}
              active={!!whisp.deliveredAt && !whisp.openedAt}
            />
            <TimelineStep
              label="Clicked video"
              time={trackingEvents.find((e) => e.eventType === "clicked")?.createdAt}
              done={eventTypes.includes("clicked")}
              active={!!whisp.openedAt && !eventTypes.includes("clicked")}
            />
            <TimelineStep
              label="Watched"
              time={whisp.watchedAt}
              done={!!whisp.watchedAt}
              active={eventTypes.includes("clicked") && !whisp.watchedAt}
            />
            <TimelineStep
              label="Replied"
              time={replies.find((r) => r.fromRecipient)?.createdAt}
              done={replies.some((r) => r.fromRecipient)}
              active={!!whisp.openedAt && !replies.some((r) => r.fromRecipient)}
            />
          </CardContent>
        </Card>

        {/* Replies */}
        {replies.length > 0 && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                Anonymous Replies
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {replies.map((reply) => (
                <div
                  key={reply.id}
                  data-testid={`reply-${reply.id}`}
                  className={`p-3 rounded-xl text-sm ${
                    reply.fromRecipient
                      ? "bg-primary/10 border border-primary/20"
                      : "bg-muted/30 border border-border/50 ml-8"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <UserCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {reply.fromRecipient ? "Recipient" : "You"} · {new Date(reply.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-foreground">{reply.replyText}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Send follow-up */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-serif">Send a follow-up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              className="bg-input/50 border-border/50 rounded-xl resize-none min-h-[80px]"
              placeholder="Send another anonymous message..."
              maxLength={300}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              data-testid="textarea-follow-up"
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">{replyText.length}/300</span>
              <Button
                onClick={handleSendFollowUp}
                disabled={!replyText.trim() || createReply.isPending}
                className="rounded-full"
                size="sm"
                data-testid="button-send-follow-up"
              >
                {createReply.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Send className="w-3 h-3 mr-1" />}
                Send
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Reveal flow */}
        {!whisp.revealRequested && (
          <Button
            variant="outline"
            className="w-full rounded-full border-primary/30 hover:bg-primary/10 hover:text-primary"
            onClick={handleReveal}
            disabled={requestReveal.isPending}
            data-testid="button-reveal-yourself"
          >
            {requestReveal.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
            Reveal Yourself
          </Button>
        )}
        {whisp.revealRequested && (
          <Card className="bg-primary/10 border-primary/20">
            <CardContent className="p-4 text-center">
              <Eye className="w-6 h-6 text-primary mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">Reveal request sent</p>
              <p className="text-xs text-muted-foreground mt-1">
                {whisp.revealAccepted === true
                  ? "They accepted! You can now reveal your identity."
                  : whisp.revealAccepted === false
                  ? "They declined the reveal."
                  : "Waiting for the recipient to respond..."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
