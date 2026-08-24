import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { formatDistanceToNowStrict } from "date-fns";
import {
  useListWhisperBoxMessages,
  useMarkWhisperBoxMessageRead,
  useDeleteWhisperBoxMessage,
  useGetUserRecap,
  getListWhisperBoxMessagesQueryKey,
  getGetWhisperBoxUnreadCountQueryKey,
  type WhisperBoxMessage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Mailbox, Trash2, Clock, Image, Loader2 } from "lucide-react";
import { shareWhisperBoxStoryCard } from "@/lib/whisperBoxStoryCard";
import i18n from "@/i18n";

// The recipient's own view of their Whisper Box — see routes/whisperBox.ts's
// GET /whisper-box and docs/features-community.md. Every message here has no
// sender to attribute it to (see whisper_box_messages.ts's schema comment),
// so unlike RepliesInbox this list never links out to a conversation — read
// and delete are the only two things a message can ever do here.
export function WhisperBoxInbox() {
  const { t } = useTranslation("whisperBox");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useListWhisperBoxMessages();
  // There's no dedicated "is Whisper Box on" field on the profile — the
  // recap endpoint's whisperBoxMessagesReceived is null unless the caller
  // has whisperBoxEnabled (see UserRecap's own doc comment), which is
  // exactly the signal the empty state below needs to pick its copy.
  const { data: recap, isLoading: isLoadingRecap } = useGetUserRecap();
  const whisperBoxEnabled = recap ? recap.whisperBoxMessagesReceived !== null : undefined;

  const markRead = useMarkWhisperBoxMessageRead();
  const deleteMessage = useDeleteWhisperBoxMessage();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [storyShareLoading, setStoryShareLoading] = useState(false);

  // Same branded-image share as SettingsPage's Whisper Box card (see
  // src/lib/whisperBoxStoryCard.ts) — surfaced here too since the empty
  // state is the other natural moment to prompt "go share your link".
  async function handleShareWhisperBoxStory() {
    const handle = recap?.whispererHandle;
    if (!handle || storyShareLoading) return;
    setStoryShareLoading(true);
    try {
      const url = `${window.location.origin}/whisper-box/${handle}`;
      const result = await shareWhisperBoxStoryCard({
        handle,
        url,
        promptText: t("settingsSection.storyPromptText"),
        dir: i18n.dir(),
        shareTitle: t("settingsSection.shareTitle"),
        shareText: t("settingsSection.storyShareText"),
      });
      if (result === "downloaded") {
        toast({ title: t("settingsSection.toastStoryDownloaded") });
      } else if (result === "unsupported") {
        toast({ title: t("settingsSection.toastStoryUnsupported"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsSection.toastStoryFailed"), variant: "destructive" });
    } finally {
      setStoryShareLoading(false);
    }
  }

  function invalidateAfterChange() {
    queryClient.invalidateQueries({ queryKey: getListWhisperBoxMessagesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetWhisperBoxUnreadCountQueryKey() });
  }

  function handleToggleExpand(message: WhisperBoxMessage) {
    const opening = expandedId !== message.id;
    setExpandedId(opening ? message.id : null);
    if (opening && message.status === "unread") {
      markRead.mutate(
        { id: message.id },
        {
          onSuccess: invalidateAfterChange,
          onError: () => toast({ title: t("whisperBoxInbox.toastMarkReadError"), variant: "destructive" }),
        },
      );
    }
  }

  function handleDelete() {
    if (!pendingDeleteId) return;
    deleteMessage.mutate(
      { id: pendingDeleteId },
      {
        onSuccess: () => {
          setPendingDeleteId(null);
          if (expandedId === pendingDeleteId) setExpandedId(null);
          invalidateAfterChange();
          toast({ title: t("whisperBoxInbox.toastDeleteSuccess") });
        },
        onError: () => toast({ title: t("whisperBoxInbox.toastDeleteError"), variant: "destructive" }),
      },
    );
  }

  const messages = data?.items ?? [];

  if (isLoading || isLoadingRecap) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <Mailbox className="w-7 h-7 text-primary" /> {t("whisperBoxInbox.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("whisperBoxInbox.subtitle")}</p>
        </div>

        {messages.length === 0 ? (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center px-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Mailbox className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-serif font-medium text-foreground mb-2">
              {whisperBoxEnabled ? t("whisperBoxInbox.emptyState.titleEnabled") : t("whisperBoxInbox.emptyState.titleDisabled")}
            </h3>
            <p className="text-muted-foreground max-w-sm mx-auto mb-6">
              {whisperBoxEnabled ? t("whisperBoxInbox.emptyState.descriptionEnabled") : t("whisperBoxInbox.emptyState.descriptionDisabled")}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
              {whisperBoxEnabled && recap?.whispererHandle && (
                <Button
                  type="button"
                  onClick={handleShareWhisperBoxStory}
                  disabled={storyShareLoading}
                  className="rounded-full text-white shadow-sm"
                  style={{
                    background:
                      "linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--secondary)) 55%, hsl(var(--gilded)) 100%)",
                  }}
                  data-testid="button-share-whisper-box-story"
                >
                  {storyShareLoading ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Image className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {t("settingsSection.shareStoryButton")}
                </Button>
              )}
              <Link href="/settings">
                <Button variant="outline" className="rounded-full" data-testid="button-manage-whisper-box">
                  {whisperBoxEnabled ? t("whisperBoxInbox.emptyState.manageCta") : t("whisperBoxInbox.emptyState.enableCta")}
                </Button>
              </Link>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => {
              const isExpanded = expandedId === message.id;
              const isUnread = message.status === "unread";
              const who = message.senderAlias?.trim() || t("whisperBoxInbox.anonymous");
              return (
                <Card
                  key={message.id}
                  className={`overflow-hidden transition-colors ${isUnread ? "bg-primary/5 border-primary/30" : "bg-card border-border/50"}`}
                  data-testid={`whisper-box-message-${message.id}`}
                >
                  <button
                    type="button"
                    onClick={() => handleToggleExpand(message)}
                    className="w-full text-left p-4 flex items-start gap-3"
                    data-testid={`button-toggle-whisper-box-message-${message.id}`}
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Mailbox className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground truncate flex items-center gap-1.5" data-testid={`whisper-box-sender-${message.id}`}>
                          {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                          {who}
                        </p>
                        {isUnread && (
                          <span className="text-[10px] uppercase tracking-wide font-semibold text-primary shrink-0 bg-primary/10 rounded-full px-2 py-0.5">
                            {t("whisperBoxInbox.newBadge")}
                          </span>
                        )}
                      </div>
                      <p className={`text-sm text-foreground mt-1 ${isExpanded ? "whitespace-pre-wrap break-words" : "truncate"}`}>
                        {message.messageText}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1.5">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        {t("whisperBoxInbox.timeAgo", { time: formatDistanceToNowStrict(new Date(message.createdAt)) })}
                      </p>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full"
                        onClick={() => setPendingDeleteId(message.id)}
                        data-testid={`button-delete-whisper-box-message-${message.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {t("whisperBoxInbox.deleteButton")}
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("whisperBoxInbox.deleteDialog.title")}</AlertDialogTitle>
              <AlertDialogDescription>{t("whisperBoxInbox.deleteDialog.description")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("whisperBoxInbox.deleteDialog.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {t("whisperBoxInbox.deleteDialog.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
