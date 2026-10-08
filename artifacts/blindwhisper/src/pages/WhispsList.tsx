import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatTimeAgo } from "@/lib/relativeTime";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListWhisps,
  getListWhispsQueryKey,
  getGetReceivedWhispUnreadCountQueryKey,
  usePinWhisp,
  useArchiveWhisp,
  useDeleteWhisp,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Link, useLocation } from "wouter";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MoodTag } from "@/components/shared/MoodTag";
import {
  PlayCircle,
  Search,
  Filter,
  Repeat,
  Heart,
  Send,
  Inbox,
  Sparkles,
  Pin,
  MoreVertical,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { deliveryLabel } from "@/lib/deliveryMethod";
import { savePendingForward, type ForwardVideo } from "@/lib/forwardVideo";
import { useLongPress } from "@/lib/useLongPress";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { senderThumbnailSrc } from "@/components/shared/SenderVideo";

type Box = "sent" | "received" | "archived";

// A received whisp is never 'pending' (Ghost Boost never lands in Received)
// or 'scheduled' (hidden from the recipient until it goes out), so the
// Received tab doesn't offer either — they could only ever list nothing.
const SENT_ONLY_STATUSES = ["pending", "scheduled"];

export function WhispsList() {
  const { t } = useTranslation("whisp");
  const [box, setBox] = useState<Box>("sent");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  function relativeTime(value: string): string {
    const date = new Date(value);
    if (Date.now() - date.getTime() < 60_000) return t("shared.justNow");
    return formatTimeAgo(date);
  }
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // A press-and-hold on the card itself opens the same options menu the
  // "⋯" button does.
  const longPress = useLongPress<string>((whispId) => setOpenMenuId(whispId));

  // A long press that DID fire must swallow the click that follows it
  // (pointerup on touch devices dispatches a synthetic click right after) —
  // otherwise opening the menu would also navigate to the whisp underneath it.
  function handleCardClick(e: React.MouseEvent) {
    if (longPress.wasLongPress()) e.preventDefault();
  }

  // Pin/archive/delete can all move a whisp between boxes (or in/out of the
  // list entirely), so every mutation below invalidates every box query
  // (the bare prefix key matches each box/status combination) plus the
  // AppLayout nav badge's own count — archiving an unread received whisp
  // takes it out of that count, and the nav badge used to keep showing it
  // until its next 60s poll. Simplest way to keep every tab and badge honest
  // without hand-tracking which specific queries a given toggle could affect.
  function invalidateAllBoxes() {
    queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetReceivedWhispUnreadCountQueryKey() });
  }

  const pinWhisp = usePinWhisp();
  const archiveWhisp = useArchiveWhisp();
  const deleteWhisp = useDeleteWhisp();

  function handleTogglePin(e: React.MouseEvent, id: string, currentlyPinned: boolean) {
    e.preventDefault();
    e.stopPropagation();
    pinWhisp.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateAllBoxes();
          toast({ title: currentlyPinned ? t("whispsList.toast.unpinned") : t("whispsList.toast.pinnedToTop") });
        },
        onError: () => toast({ title: t("shared.couldntUpdateThat"), variant: "destructive" }),
      },
    );
  }

  function handleToggleArchive(id: string, currentlyArchived: boolean) {
    setOpenMenuId(null);
    archiveWhisp.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateAllBoxes();
          toast({ title: currentlyArchived ? t("shared.movedBackToList") : t("whispsList.toast.archived") });
        },
        onError: () => toast({ title: t("shared.couldntUpdateThat"), variant: "destructive" }),
      },
    );
  }

  function handleConfirmDelete() {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    setDeleteTargetId(null);
    deleteWhisp.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateAllBoxes();
          toast({ title: t("shared.whispDeleted") });
        },
        onError: () => toast({ title: t("whispsList.toast.couldntDelete"), variant: "destructive" }),
      },
    );
  }

  // Polled, not just fetched once — same 60s cadence and background-pause
  // behavior as NotificationBell.tsx, so a whisp someone else sends while
  // this Whisperer is sitting on the page (any tab) shows up on its own,
  // the same way the notification bell already does, instead of needing a
  // manual refresh to notice it.
  // The Archived tab hides the status dropdown (the server ignores status
  // there), so a filter picked on another tab must not carry over into it —
  // it used to, which made an empty Archived tab say "Try adjusting your
  // filters" with no filter anywhere on screen to adjust. Same for a
  // sent-only status (see the dropdown below) carried into Received.
  const effectiveStatusFilter =
    box === "archived" || (box === "received" && SENT_ONLY_STATUSES.includes(statusFilter)) ? "all" : statusFilter;
  const listParams = {
    ...(box !== "sent" ? { box } : {}),
    ...(effectiveStatusFilter !== "all" ? { status: effectiveStatusFilter } : {}),
  };
  const { data: whisps, isLoading } = useListWhisps(listParams, {
    query: { queryKey: getListWhispsQueryKey(listParams), refetchInterval: 60_000, refetchIntervalInBackground: false },
  });

  // A lightweight always-on fetch (separate from the tab's own query above,
  // but sharing its cache entry once the Received tab is actually opened —
  // same params, same query key) purely to badge the tab itself with how
  // many arrived unopened, so a Whisperer notices new ones without having to
  // switch tabs first. Counts the server's own `unread` flag rather than
  // `!openedAt`: that's the exact rule /received-unread-count (the nav
  // badge) uses, so the two badges can't disagree — `!openedAt` alone also
  // counted an expired whisp, which can never be opened and so never cleared.
  const receivedBadgeParams = { box: "received" as const };
  const { data: receivedForBadge } = useListWhisps(receivedBadgeParams, {
    query: { queryKey: getListWhispsQueryKey(receivedBadgeParams), refetchInterval: 60_000, refetchIntervalInBackground: false },
  });
  const newReceivedCount = receivedForBadge?.filter((w) => w.unread).length ?? 0;

  function handleWhispAgain(e: React.MouseEvent, whisp: ForwardVideo & { videoPlatform?: string | null }) {
    e.preventDefault();
    e.stopPropagation();
    if (whisp.videoPlatform === "upload") return;
    savePendingForward({
      videoUrl: whisp.videoUrl,
      videoTitle: whisp.videoTitle,
      videoThumbnail: whisp.videoThumbnail,
      videoEmbedUrl: whisp.videoEmbedUrl,
      videoPlatform: whisp.videoPlatform,
      videoStartSeconds: whisp.videoStartSeconds,
      videoEndSeconds: whisp.videoEndSeconds,
    });
    setLocation("/send");
  }

  const filteredWhisps = whisps?.filter((w) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const isReceivedItem = w.viewerRole === "recipient";
    return (
      w.videoTitle?.toLowerCase().includes(q) ||
      (!isReceivedItem && w.recipientEmail?.toLowerCase().includes(q)) ||
      (!isReceivedItem && w.recipientPhone?.toLowerCase().includes(q)) ||
      (isReceivedItem && w.senderAlias?.toLowerCase().includes(q)) ||
      (isReceivedItem && w.senderHandle?.toLowerCase().includes(q))
    );
  });

  return (
    <AppLayout>
      <div className="space-y-5 md:space-y-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-foreground">{t("whispsList.title")}</h1>
          <p className="text-muted-foreground mt-1.5">{t("whispsList.subtitle")}</p>
        </div>

        {/* Sent / Received / Archived — three clearly different collections,
            so this is a real tab switch rather than a filter dropdown
            value, with its own badge on Received so a new arrival is
            noticeable without having to open the tab first. */}
        <div className="flex w-full sm:inline-flex sm:w-auto items-center gap-1 rounded-full bg-card/60 border border-border/50 p-1" role="tablist">
          <button
            type="button"
            onClick={() => setBox("sent")}
            data-testid="tab-whisps-sent"
            role="tab"
            aria-selected={box === "sent"}
            className={`flex flex-1 sm:flex-none min-w-0 items-center justify-center gap-1 sm:gap-1.5 rounded-full min-h-10 px-2 sm:px-4 py-2 text-[13px] sm:text-sm font-medium transition-colors duration-200 ${
              box === "sent" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Send className="hidden min-[400px]:block w-3.5 h-3.5 shrink-0" /> <span className="truncate">{t("whispsList.tabs.sent")}</span>
          </button>
          <button
            type="button"
            onClick={() => setBox("received")}
            data-testid="tab-whisps-received"
            role="tab"
            aria-selected={box === "received"}
            className={`flex flex-1 sm:flex-none min-w-0 items-center justify-center gap-1 sm:gap-1.5 rounded-full min-h-10 px-2 sm:px-4 py-2 text-[13px] sm:text-sm font-medium transition-colors duration-200 relative ${
              box === "received" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Inbox className="hidden min-[400px]:block w-3.5 h-3.5 shrink-0" /> <span className="truncate">{t("whispsList.tabs.received")}</span>
            {newReceivedCount > 0 && (
              <span
                className={`ml-0.5 inline-flex items-center justify-center rounded-full text-[11px] font-semibold tabular-nums min-w-[18px] h-[18px] px-1 ${
                  box === "received" ? "bg-primary-foreground/25 text-primary-foreground" : "bg-primary text-primary-foreground"
                }`}
                data-testid="badge-new-received-count"
              >
                {newReceivedCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setBox("archived")}
            data-testid="tab-whisps-archived"
            role="tab"
            aria-selected={box === "archived"}
            className={`flex flex-1 sm:flex-none min-w-0 items-center justify-center gap-1 sm:gap-1.5 rounded-full min-h-10 px-2 sm:px-4 py-2 text-[13px] sm:text-sm font-medium transition-colors duration-200 ${
              box === "archived" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Archive className="hidden min-[400px]:block w-3.5 h-3.5 shrink-0" /> <span className="truncate">{t("whispsList.tabs.archived")}</span>
          </button>
        </div>

        <div className="flex gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={box === "sent" ? t("whispsList.searchPlaceholderSent") : t("whispsList.searchPlaceholderOther")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 pl-10 bg-card/60 border-border/50 rounded-full text-sm"
            />
          </div>
          {box !== "archived" && (
            <Select value={effectiveStatusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-11 w-[7.75rem] sm:w-[180px] shrink-0 gap-1 bg-card/60 border-border/50 rounded-full" aria-label={t("whispsList.filter.allStatuses")}>
                <Filter className="hidden sm:block w-4 h-4 mr-1 shrink-0 text-muted-foreground" />
                <SelectValue placeholder={t("whispsList.filter.allStatuses")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("whispsList.filter.allStatuses")}</SelectItem>
                {box === "sent" && <SelectItem value="pending">{t("whispsList.filter.pending")}</SelectItem>}
                {box === "sent" && <SelectItem value="scheduled">{t("whispsList.filter.scheduled")}</SelectItem>}
                <SelectItem value="delivered">{t("whispsList.filter.delivered")}</SelectItem>
                <SelectItem value="opened">{t("whispsList.filter.opened")}</SelectItem>
                <SelectItem value="watched">{t("whispsList.filter.watched")}</SelectItem>
                <SelectItem value="replied">{t("whispsList.filter.replied")}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 sm:gap-4 rounded-2xl border border-border/40 bg-card/40 p-3 sm:p-4">
                <Skeleton className="w-28 sm:w-44 aspect-video rounded-[12px] shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <Skeleton className="h-4 w-4/5 rounded" />
                  <Skeleton className="h-3 w-1/2 rounded" />
                  <Skeleton className="h-3 w-2/5 rounded" />
                  <div className="flex gap-2 pt-2">
                    <Skeleton className="h-6 w-20 rounded-full" />
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredWhisps?.length ? (
          <div className="space-y-3">
            {filteredWhisps.map((whisp) => {
              // Which role this specific whisp is showing under — for the
              // Sent/Received tabs it always matches the tab itself, but the
              // Archived tab mixes both origins into one list, so each card
              // has to work this out for itself.
              const isReceivedItem = whisp.viewerRole === "recipient";
              const isNew = box === "received" && !!whisp.unread;
              const canDelete = whisp.viewerRole === "sender";
              const isOwnUpload = !isReceivedItem && whisp.videoPlatform === "upload";
              const ownUploadThumbnail = isOwnUpload ? senderThumbnailSrc(whisp) : null;
              return (
              <Link
                key={whisp.id}
                href={isReceivedItem ? `/w/${whisp.publicToken}` : `/whisps/${whisp.id}`}
                onClick={handleCardClick}
                className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* Received cards get their own identity, not just the sent
                    card reused with different text: a left accent bar (gold
                    for a genuinely new/unopened one, a quieter primary tint
                    once it's been seen). Pinned cards get a subtle gilded
                    ring regardless of box, since a pin means "important to
                    me" independent of sent/received/archived.

                    Thumbnail beside the text at every width (not stacked
                    above it on phones): a full-width video still per card
                    meant one whisp per screen, and squeezed the title into a
                    one-line ellipsis beside four action icons. */}
                <Card
                  onPointerDown={(e) => longPress.onPointerDown(e, whisp.id)}
                  onPointerMove={longPress.onPointerMove}
                  onPointerUp={longPress.onPointerUp}
                  onPointerCancel={longPress.onPointerUp}
                  className={`group select-none cursor-pointer rounded-2xl p-3 sm:p-4 shadow-none transition-colors duration-200 hover:bg-card ${
                    whisp.pinned ? "ring-1 ring-gilded/40" : ""
                  } ${
                    isReceivedItem
                      ? isNew
                        ? "bg-gilded/[0.05] border-gilded/40 border-l-4 border-l-gilded"
                        : "bg-card/60 border-primary/25 border-l-4 border-l-primary/40"
                      : "bg-card/60 border-border/50 hover:border-border"
                  }`}
                  data-testid={`card-whisp-${whisp.id}`}
                >
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3 sm:gap-x-4 sm:gap-y-2.5">
                    <div className="relative w-28 sm:w-44 sm:row-span-2 aspect-video self-start overflow-hidden rounded-[12px] bg-muted">
                      {/* A sender's own upload goes through the owner-scoped
                          thumbnail route (see SenderVideo.tsx) — the stored
                          public one stops answering when the recipient's
                          link expires, which blanked Sent/Archived cards. */}
                      {isOwnUpload ? (
                        ownUploadThumbnail && (
                          <Thumbnail src={ownUploadThumbnail} alt={whisp.videoTitle || t("whispsList.videoAlt")} className="h-full w-full object-cover" />
                        )
                      ) : whisp.videoThumbnail ? (
                        <img src={whisp.videoThumbnail} alt={whisp.videoTitle || t("whispsList.videoAlt")} className="h-full w-full object-cover" />
                      ) : null}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors duration-200 group-hover:bg-black/10">
                        <PlayCircle className="h-7 w-7 sm:h-8 sm:w-8 text-white/90 drop-shadow" />
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-start gap-1">
                        <h3 className="min-w-0 flex-1 line-clamp-2 text-[15px] sm:text-base font-semibold leading-snug text-foreground">
                          {whisp.videoTitle || t("whispsList.videoLinkFallback")}
                        </h3>
                        <div className="-mr-1.5 -mt-1 flex shrink-0 items-center">
                          {/* One-tap pin toggle, separate from the options
                              menu below — the single action common enough
                              to deserve its own button instead of a menu
                              trip every time. */}
                          <button
                            type="button"
                            onClick={(e) => handleTogglePin(e, whisp.id, whisp.pinned)}
                            aria-label={whisp.pinned ? t("whispsList.unpin") : t("whispsList.pinToTop")}
                            aria-pressed={whisp.pinned}
                            data-testid={`button-pin-${whisp.id}`}
                            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                              whisp.pinned ? "text-gilded hover:bg-gilded/10" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                          >
                            <Pin className={`w-4 h-4 ${whisp.pinned ? "fill-gilded" : ""}`} />
                          </button>
                          <DropdownMenu
                            open={openMenuId === whisp.id}
                            onOpenChange={(o) => setOpenMenuId(o ? whisp.id : null)}
                          >
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                aria-label={t("whispsList.moreOptions")}
                                data-testid={`button-menu-${whisp.id}`}
                                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-xl" onCloseAutoFocus={(e) => e.preventDefault()}>
                              <DropdownMenuItem
                                onClick={(e) => handleTogglePin(e as unknown as React.MouseEvent, whisp.id, whisp.pinned)}
                                data-testid={`menu-pin-${whisp.id}`}
                              >
                                <Pin className="w-4 h-4 mr-2" /> {whisp.pinned ? t("whispsList.unpin") : t("whispsList.pinToTop")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleToggleArchive(whisp.id, whisp.archived)}
                                data-testid={`menu-archive-${whisp.id}`}
                              >
                                {whisp.archived ? (
                                  <>
                                    <ArchiveRestore className="w-4 h-4 mr-2" /> {t("whispsList.moveBackToList")}
                                  </>
                                ) : (
                                  <>
                                    <Archive className="w-4 h-4 mr-2" /> {t("whispsList.archive")}
                                  </>
                                )}
                              </DropdownMenuItem>
                              {canDelete && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setDeleteTargetId(whisp.id);
                                  }}
                                  className="text-destructive focus:text-destructive"
                                  data-testid={`menu-delete-${whisp.id}`}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" /> {t("shared.delete")}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {isReceivedItem ? (
                          <>
                            <Inbox className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px text-primary/70" />
                            {t("whispsList.from", { sender: whisp.senderHandle || t("whispsList.someoneAnonymous") })}
                            {whisp.senderAlias && whisp.senderAlias !== whisp.senderHandle && (
                              <span className="text-muted-foreground/70"> ({whisp.senderAlias})</span>
                            )}
                          </>
                        ) : (
                          t("whispsList.to", {
                            recipient:
                              whisp.recipientEmail || whisp.recipientPhone || (
                                whisp.deliveryMethod === "circle_drop"
                                  ? t("shared.blindCircleFeed")
                                  : whisp.deliveryMethod === "circle_dm"
                                    ? t("whispsList.anonymousCircleVisitor")
                                    : t("shared.ghostBoostAudience")
                              ),
                          })
                        )}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        <time dateTime={whisp.createdAt} title={new Date(whisp.createdAt).toLocaleString()} className="tabular-nums">
                          {relativeTime(whisp.createdAt)}
                        </time>
                        <span className="mx-1.5 text-muted-foreground/50" aria-hidden>·</span>
                        {t("whispsList.via", { method: deliveryLabel(whisp.deliveryMethod, whisp.whisperChannel) })}
                      </p>
                    </div>

                    <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-2 flex min-w-0 items-center gap-2">
                      {isNew && (
                        <span
                          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-gilded/15 text-gilded text-[11px] font-semibold uppercase tracking-wide px-2"
                          data-testid={`badge-new-${whisp.id}`}
                        >
                          <Sparkles className="w-3 h-3" /> {t("whispsList.newBadge")}
                        </span>
                      )}
                      <StatusBadge status={whisp.status} />
                      {whisp.appreciationResponse === "yes" && (
                        <Heart className="w-4 h-4 shrink-0 text-rose-400 fill-rose-400" data-testid={`icon-appreciated-${whisp.id}`} />
                      )}
                      {whisp.moodTag && (
                        <MoodTag mood={whisp.moodTag} className="min-w-0 shrink whitespace-nowrap py-0.5! pl-0.5! pr-2.5! gap-1.5! text-xs! shadow-none!" />
                      )}
                      {!isReceivedItem && whisp.videoPlatform !== "upload" && !whisp.contentRemoved && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-9 shrink-0 rounded-full px-2.5 sm:px-3 text-muted-foreground hover:text-foreground"
                          onClick={(e) => handleWhispAgain(e, whisp)}
                          aria-label={t("shared.whispToSomeoneElse")}
                          title={t("shared.whispToSomeoneElse")}
                          data-testid={`button-whisp-again-${whisp.id}`}
                        >
                          <Repeat className="h-4 w-4 sm:mr-1.5" />
                          <span className="hidden sm:inline">{t("shared.whispAgain")}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
              );
            })}
          </div>
        ) : (
          <Card className="rounded-2xl bg-card/40 border-dashed border-border/70 px-6 py-12 sm:py-16 text-center shadow-none">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 ring-1 ring-primary/20">
              {box === "received" ? <Inbox className="h-6 w-6 text-primary" /> : box === "archived" ? <Archive className="h-6 w-6 text-primary" /> : <Send className="h-6 w-6 text-primary" />}
            </span>
            <h3 className="text-xl font-serif font-semibold text-foreground mb-2">{t("whispsList.emptyState.title")}</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-6 leading-relaxed">
              {searchQuery || effectiveStatusFilter !== "all"
                ? t("whispsList.emptyState.adjustFilters")
                : box === "received"
                  ? t("whispsList.emptyState.noneReceived")
                  : box === "archived"
                    ? t("whispsList.emptyState.noneArchived")
                    : t("whispsList.emptyState.noneSent")}
            </p>
            {!searchQuery && effectiveStatusFilter === "all" && box === "sent" && (
              <Button asChild className="h-11 rounded-full px-6 shadow-[0_0_20px_rgba(124,92,252,0.35)]">
                <Link href="/send">
                  <Send className="w-4 h-4 mr-2" /> {t("whispsList.emptyState.cta")}
                </Link>
              </Button>
            )}
          </Card>
        )}
      </div>

      <AlertDialog open={deleteTargetId !== null} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("whispsList.deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("whispsList.deleteDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("shared.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("shared.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
