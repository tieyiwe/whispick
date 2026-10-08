import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { formatDistanceToNowStrict } from "date-fns";
import {
  useListWhisperBoxMessages,
  useMarkWhisperBoxMessageRead,
  useDeleteWhisperBoxMessage,
  useGetUserRecap,
  useGetUserProfile,
  getListWhisperBoxMessagesQueryKey,
  getGetWhisperBoxUnreadCountQueryKey,
  getGetUserRecapQueryKey,
  getGetUserProfileQueryKey,
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
import { Mailbox, Trash2, Image, Loader2, Share2, ChevronDown } from "lucide-react";
import { AnonymousMark } from "@/components/shared/AnonymousMark";
import { useLongPress } from "@/lib/useLongPress";
import { shareWhisperBoxStoryCard } from "@/lib/whisperBoxStoryCard";
import { whisperBoxShareUrl } from "@/lib/whisperBoxUrl";
import { WhisperBoxLinkDialog } from "@/components/shared/WhisperBoxLinkDialog";
import { WhisperBoxSearchBar } from "@/components/shared/WhisperBoxSearchBar";
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
  // refetchOnMount: "always" on both queries below — this inbox is a
  // second entry point (alongside Settings) into the same "share your
  // Whisper Box link" flow, and whisperBoxEnabled/whisperBoxHandlePersonalized
  // can change from elsewhere in the session with no local mutation here to
  // invalidate this page's cached copy. Without it, a stale cache can wrongly
  // route into WhisperBoxLinkDialog's name-capture step (or hide the share
  // actions) until something unrelated happens to refresh these queries.
  const { data: recap, isLoading: isLoadingRecap } = useGetUserRecap(undefined, {
    query: { refetchOnMount: "always", queryKey: getGetUserRecapQueryKey() },
  });
  const whisperBoxEnabled = recap ? recap.whisperBoxMessagesReceived !== null : undefined;
  // Only needed to decide whether a share action should detour through
  // WhisperBoxLinkDialog's name-capture step first — see that component's
  // comment for why an un-personalized (or stale-name) handle isn't worth
  // sharing. Backend-computed — see routes/user.ts's whisperBoxHandlePersonalized.
  const { data: profile } = useGetUserProfile({
    query: { refetchOnMount: "always", queryKey: getGetUserProfileQueryKey() },
  });
  const handlePersonalized = profile?.whisperBoxHandlePersonalized ?? false;

  const markRead = useMarkWhisperBoxMessageRead();
  const deleteMessage = useDeleteWhisperBoxMessage();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [storyShareLoading, setStoryShareLoading] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  // Press-and-hold jumps straight to the delete confirm — read and delete
  // are the only two things a message here can ever do, so holding a card
  // is unambiguous (no options menu needed, unlike WhispsList's pin/archive/
  // delete). Saves a tap-to-expand-then-find-the-small-trash-icon detour on
  // mobile for the one destructive action this list has.
  const longPress = useLongPress<string>((id) => setPendingDeleteId(id));

  // Same branded-image share as SettingsPage's Whisper Box card (see
  // src/lib/whisperBoxStoryCard.ts) — surfaced here too since the empty
  // state is the other natural moment to prompt "go share your link". Routed
  // through the name-capture dialog first when there's no display name yet
  // — sharing an unpersonalized (random-word) handle defeats the point.
  async function handleShareWhisperBoxStory() {
    if (!handlePersonalized) {
      setLinkDialogOpen(true);
      return;
    }
    const handle = recap?.whisperBoxHandle;
    if (!handle || storyShareLoading) return;
    setStoryShareLoading(true);
    try {
      const url = whisperBoxShareUrl(handle);
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
      } else if (result === "shared-image" || result === "shared-link") {
        toast({ title: t("settingsSection.toastStoryShared") });
      } else if (result === "unsupported") {
        toast({ title: t("settingsSection.toastStoryUnsupported"), variant: "destructive" });
      }
      // result === "cancelled": user dismissed the share sheet — no toast.
    } catch {
      toast({ title: t("settingsSection.toastStoryFailed"), variant: "destructive" });
    } finally {
      setStoryShareLoading(false);
    }
  }

  function invalidateAfterChange() {
    queryClient.invalidateQueries({ queryKey: getListWhisperBoxMessagesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetWhisperBoxUnreadCountQueryKey() });
    // Deleting a message is a hard delete (see routes/whisperBox.ts), so it
    // also moves recap's whisperBoxMessagesReceived count — invalidate it
    // too so RecapPage/Dashboard/Settings don't sit on a stale, one-too-high
    // count for up to staleTime. A harmless no-op refetch on the mark-read
    // path, which doesn't change that count.
    queryClient.invalidateQueries({ queryKey: getGetUserRecapQueryKey() });
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
        <div className="max-w-3xl space-y-5 md:space-y-6" aria-busy="true">
          <div className="space-y-2">
            <Skeleton className="h-9 w-48 rounded-lg" />
            <Skeleton className="h-4 w-72 max-w-full rounded" />
          </div>
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3 rounded-2xl border border-border/40 bg-card/40 p-4">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32 rounded" />
                  <Skeleton className="h-3 w-full rounded" />
                  <Skeleton className="h-3 w-16 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {/* Capped at a reading width: on desktop a message used to run the
          full 1000px content column as a single line. */}
      <div className="max-w-3xl space-y-5 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <Mailbox className="w-7 h-7 shrink-0 text-primary" /> {t("whisperBoxInbox.title")}
            </h1>
            <p className="text-muted-foreground mt-1.5">{t("whisperBoxInbox.subtitle")}</p>
          </div>
          {/* With messages already here, the empty state's share prompt is
              gone — so the inbox keeps a way to pass the link around. */}
          {messages.length > 0 && whisperBoxEnabled && recap?.whisperBoxHandle && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:w-auto shrink-0 rounded-full border-primary/35 px-5 hover:bg-primary/10 hover:text-foreground"
              onClick={() => setLinkDialogOpen(true)}
              data-testid="button-share-whisper-box-link"
            >
              <Share2 className="w-4 h-4 mr-2 text-primary" /> {t("whisperBoxInbox.shareLinkCta")}
            </Button>
          )}
        </div>

        {messages.length === 0 ? (
          <Card className="rounded-2xl bg-card/40 border-dashed border-border/70 px-6 py-12 sm:py-14 text-center shadow-none">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 ring-1 ring-primary/20">
              <Mailbox className="h-6 w-6 text-primary" />
            </span>
            <h3 className="text-xl font-serif font-semibold text-foreground mb-2">
              {whisperBoxEnabled ? t("whisperBoxInbox.emptyState.titleEnabled") : t("whisperBoxInbox.emptyState.titleDisabled")}
            </h3>
            <p className="text-muted-foreground max-w-sm mx-auto mb-6 leading-relaxed">
              {whisperBoxEnabled ? t("whisperBoxInbox.emptyState.descriptionEnabled") : t("whisperBoxInbox.emptyState.descriptionDisabled")}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
              {whisperBoxEnabled && recap?.whisperBoxHandle && (
                <Button
                  type="button"
                  onClick={handleShareWhisperBoxStory}
                  disabled={storyShareLoading}
                  className="h-11 w-full sm:w-auto rounded-full px-5 text-white shadow-sm"
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
              {whisperBoxEnabled ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full sm:w-auto rounded-full px-5"
                  onClick={() => setLinkDialogOpen(true)}
                  data-testid="button-manage-whisper-box"
                >
                  {t("whisperBoxInbox.emptyState.manageCta")}
                </Button>
              ) : (
                <Button asChild variant="outline" className="h-11 rounded-full px-5">
                  <Link href="/settings" data-testid="button-manage-whisper-box">
                    {t("whisperBoxInbox.emptyState.enableCta")}
                  </Link>
                </Button>
              )}
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
                  // Unread is the prominent state: full card surface, a
                  // primary edge and bold sender. Read messages recede to a
                  // quieter, translucent surface — previously this was the
                  // other way round (read sat on the brighter bg-card).
                  className={`overflow-hidden rounded-2xl shadow-none transition-colors duration-200 ${
                    isUnread
                      ? "bg-card border-primary/35 border-l-[3px] border-l-primary"
                      : "bg-card/35 border-border/40 hover:bg-card/55"
                  }`}
                  data-testid={`whisper-box-message-${message.id}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      // A long press that DID fire must swallow the click
                      // that follows it (pointerup on touch dispatches a
                      // synthetic click right after) — otherwise opening the
                      // delete confirm would also toggle the card expanded.
                      if (longPress.wasLongPress()) return;
                      handleToggleExpand(message);
                    }}
                    onPointerDown={(e) => longPress.onPointerDown(e, message.id)}
                    onPointerMove={longPress.onPointerMove}
                    onPointerUp={longPress.onPointerUp}
                    onPointerCancel={longPress.onPointerUp}
                    aria-expanded={isExpanded}
                    className="w-full text-left p-4 flex items-start gap-3 select-none focus-visible:outline-none focus-visible:bg-card/60"
                    data-testid={`button-toggle-whisper-box-message-${message.id}`}
                  >
                    <AnonymousMark
                      size="md"
                      className={`mt-0.5 h-10 w-10 ring-1 ${isUnread ? "bg-primary/20 ring-primary/35" : "bg-muted/70 text-muted-foreground ring-border/60"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={`text-sm truncate ${isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}
                          data-testid={`whisper-box-sender-${message.id}`}
                        >
                          {who}
                        </p>
                        {isUnread && (
                          <span className="shrink-0 text-[11px] uppercase tracking-wide font-semibold text-primary bg-primary/12 rounded-full px-2 py-0.5">
                            {t("whisperBoxInbox.newBadge")}
                          </span>
                        )}
                      </div>
                      <p
                        className={`mt-1 text-[15px] leading-relaxed break-words ${
                          isExpanded ? "whitespace-pre-wrap" : "line-clamp-2"
                        } ${isUnread ? "text-foreground" : "text-foreground/75"}`}
                      >
                        {message.messageText}
                      </p>
                      <time
                        dateTime={message.createdAt}
                        title={new Date(message.createdAt).toLocaleString()}
                        className="mt-1.5 block text-xs text-muted-foreground tabular-nums"
                      >
                        {t("whisperBoxInbox.timeAgo", { time: formatDistanceToNowStrict(new Date(message.createdAt)) })}
                      </time>
                    </div>
                    <ChevronDown
                      aria-hidden
                      className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-3 -mt-1 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full px-3"
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

        {/* Secondary: finding someone else's box. Below the inbox, not above
            it — this page is for reading your own messages first. */}
        <section className="space-y-2.5 rounded-2xl border border-border/40 bg-card/30 p-4 sm:p-5">
          <h2 className="text-base font-serif font-semibold text-foreground">{t("searchBar.sectionTitle")}</h2>
          <WhisperBoxSearchBar className="max-w-md" />
        </section>

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

        {recap?.whisperBoxHandle && (
          <WhisperBoxLinkDialog
            handle={recap.whisperBoxHandle}
            handlePersonalized={handlePersonalized}
            currentDisplayName={profile?.fullName ?? null}
            open={linkDialogOpen}
            onOpenChange={setLinkDialogOpen}
          />
        )}
      </div>
    </AppLayout>
  );
}
