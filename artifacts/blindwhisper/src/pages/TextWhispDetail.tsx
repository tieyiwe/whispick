import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTextWhisp,
  useCreateTextWhispReply,
  useRequestTextWhispReveal,
  useRespondTextWhispReveal,
  useDeleteTextWhisp,
  useGetUserProfile,
  getGetTextWhispQueryKey,
  getListTextWhispsQueryKey,
} from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { TextWhispScroll } from "@/components/shared/TextWhispScroll";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Eye, Loader2, Send, MessageSquare, Trash2, UserCircle2, Check, X } from "lucide-react";

const REPLY_MAX_LENGTH = 260;

export function TextWhispDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [opened, setOpened] = useState(false);

  const { data: profile } = useGetUserProfile();
  const { data, isLoading } = useGetTextWhisp(id!, {
    query: { enabled: !!id, queryKey: getGetTextWhispQueryKey(id!) },
  });

  const createReply = useCreateTextWhispReply();
  const requestReveal = useRequestTextWhispReveal();
  const respondReveal = useRespondTextWhispReveal();
  const deleteTextWhisp = useDeleteTextWhisp();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto text-center py-16">
          <p className="text-muted-foreground">Text Whisp not found.</p>
          <Button variant="ghost" onClick={() => setLocation("/text-whisps")} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
        </div>
      </AppLayout>
    );
  }

  const { textWhisp, replies } = data;
  const isSender = profile?.id === textWhisp.senderId;
  const isRecipient = profile?.id === textWhisp.recipientUserId;
  // The recipient gets the closed-scroll "moment"; the sender (viewing their
  // own sent message) sees it already open — there's nothing to unwrap for
  // the person who wrote it.
  const startsClosed = isRecipient && !opened;

  function handleReply() {
    if (!replyText.trim()) return;
    createReply.mutate(
      { id: textWhisp.id, data: { replyText: replyText.trim() } },
      {
        onSuccess: () => {
          setReplyText("");
          queryClient.invalidateQueries({ queryKey: getGetTextWhispQueryKey(id!) });
        },
        onError: () => toast({ title: "Failed to send reply", variant: "destructive" }),
      },
    );
  }

  function handleReveal() {
    requestReveal.mutate(
      { id: textWhisp.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTextWhispQueryKey(id!) });
          toast({ title: "Reveal request sent" });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to request reveal", variant: "destructive" }),
      },
    );
  }

  function handleRespondReveal(accepted: boolean) {
    respondReveal.mutate(
      { id: textWhisp.id, data: { accepted } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTextWhispQueryKey(id!) });
          toast({ title: accepted ? "You accepted the reveal request" : "You declined the reveal request" });
        },
        onError: () => toast({ title: "Failed to respond", variant: "destructive" }),
      },
    );
  }

  function handleDelete() {
    deleteTextWhisp.mutate(
      { id: textWhisp.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTextWhispsQueryKey() });
          setLocation("/text-whisps");
          toast({ title: "Text Whisp deleted" });
        },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      },
    );
  }

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setLocation("/text-whisps")} className="text-muted-foreground -ml-2" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          {isSender && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={deleteTextWhisp.isPending}
                  className="text-muted-foreground hover:text-destructive min-w-11 min-h-11"
                  data-testid="button-delete-text-whisp"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this Text Whisp?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes it from your Text Whisps. This can't be undone from your side.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-confirm-delete-text-whisp"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* A dark "scene" gutter around the parchment card so the warm accent
            reads as an intentional focal moment, not a light-mode patch. */}
        <div className="rounded-2xl bg-gradient-to-b from-background to-card/60 border border-border/30 py-8 px-4">
          <TextWhispScroll
            mode="open"
            messageText={textWhisp.messageText}
            senderAlias={textWhisp.senderAlias}
            createdAt={textWhisp.createdAt}
            onOpened={() => setOpened(true)}
            initiallyOpen={!startsClosed}
          />
        </div>

        {(!isRecipient || opened) && (
          <>
            {/* Replies */}
            {replies.length > 0 && (
              <Card className="bg-card border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-serif flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-primary" /> Replies
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {replies.map((reply) => {
                    const fromMe = reply.senderId === profile?.id;
                    return (
                      <div
                        key={reply.id}
                        data-testid={`text-whisp-reply-${reply.id}`}
                        className={`p-3 rounded-xl text-sm ${fromMe ? "bg-muted/30 border border-border/50 ml-8" : "bg-primary/10 border border-primary/20"}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <UserCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {fromMe ? "You" : "Them"} · {new Date(reply.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-foreground">{reply.replyText}</p>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Reply box */}
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-serif">Reply</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  className="bg-input/50 border-border/50 rounded-xl resize-none min-h-[80px]"
                  placeholder="Write a reply..."
                  maxLength={REPLY_MAX_LENGTH}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  data-testid="textarea-text-whisp-reply"
                />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">{replyText.length}/{REPLY_MAX_LENGTH}</span>
                  <Button
                    onClick={handleReply}
                    disabled={!replyText.trim() || createReply.isPending}
                    className="rounded-full"
                    size="sm"
                    data-testid="button-send-text-whisp-reply"
                  >
                    {createReply.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Send className="w-3 h-3 mr-1" />}
                    Send
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Reveal flow — only offered once the recipient is a real
                account holder (recipientUserId set). A Text Whisp sent to a
                phone number that hasn't signed up yet has no one to reveal
                to (or notify) — see routes/textWhisps.ts POST /:id/reveal's
                "hasn't joined yet" gate. */}
            {isSender && !textWhisp.revealRequested && textWhisp.recipientUserId && (
              <Button
                variant="outline"
                className="w-full rounded-full border-primary/30 hover:bg-primary/10 hover:text-primary"
                onClick={handleReveal}
                disabled={requestReveal.isPending}
                data-testid="button-reveal-yourself-text-whisp"
              >
                {requestReveal.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                Reveal Yourself
              </Button>
            )}
            {isSender && !textWhisp.revealRequested && !textWhisp.recipientUserId && (
              <p className="text-xs text-muted-foreground text-center" data-testid="text-reveal-unavailable-not-joined">
                They haven't signed up yet — you'll be able to reveal yourself once they do.
              </p>
            )}
            {isSender && textWhisp.revealRequested && (
              <Card className="bg-primary/10 border-primary/20">
                <CardContent className="p-4 text-center">
                  <Eye className="w-6 h-6 text-primary mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">Reveal request sent</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {textWhisp.revealAccepted === true
                      ? "They accepted! You can now tell them who you are — send a reply above."
                      : textWhisp.revealAccepted === false
                      ? "They declined the reveal."
                      : "Waiting for them to respond..."}
                  </p>
                </CardContent>
              </Card>
            )}
            {isRecipient && textWhisp.revealRequested && textWhisp.revealAccepted == null && (
              <Card className="bg-primary/10 border-primary/20">
                <CardContent className="p-4 space-y-3 text-center">
                  <Eye className="w-6 h-6 text-primary mx-auto" />
                  <p className="text-sm font-medium text-foreground">
                    The person who sent you this wants to reveal who they are. Allow it?
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This only grants permission — they'll still have to tell you who they are.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => handleRespondReveal(false)}
                      disabled={respondReveal.isPending}
                      data-testid="button-decline-reveal-text-whisp"
                    >
                      <X className="w-3.5 h-3.5 mr-1" /> Decline
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-full"
                      onClick={() => handleRespondReveal(true)}
                      disabled={respondReveal.isPending}
                      data-testid="button-accept-reveal-text-whisp"
                    >
                      <Check className="w-3.5 h-3.5 mr-1" /> Accept
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
