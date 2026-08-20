import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListWhisps,
  getListWhispsQueryKey,
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

type Box = "sent" | "received" | "archived";

// How long a press has to hold before it counts as "long press, open the
// options menu" instead of "tap, navigate" — and how far a finger can drift
// during that hold before it reads as a scroll gesture instead (which
// cancels the press rather than opening anything).
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export function WhispsList() {
  const { t } = useTranslation("whisp");
  const [box, setBox] = useState<Box>("sent");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // A press-and-hold on the card itself opens the same options menu the
  // "⋯" button does — tracked with refs (not state) since every pointer
  // event on every card would otherwise re-render the whole list.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handleCardPointerDown(e: React.PointerEvent, whispId: string) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    longPressFiredRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setOpenMenuId(whispId);
      navigator.vibrate?.(10);
    }, LONG_PRESS_MS);
  }

  function handleCardPointerMove(e: React.PointerEvent) {
    if (!pressStartRef.current) return;
    const dx = e.clientX - pressStartRef.current.x;
    const dy = e.clientY - pressStartRef.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) clearLongPressTimer();
  }

  // A long press that DID fire must swallow the click that follows it
  // (pointerup on touch devices dispatches a synthetic click right after) —
  // otherwise opening the menu would also navigate to the whisp underneath it.
  function handleCardClick(e: React.MouseEvent) {
    clearLongPressTimer();
    if (longPressFiredRef.current) {
      e.preventDefault();
      longPressFiredRef.current = false;
    }
  }

  // Pin/archive/delete can all move a whisp between boxes (or in/out of the
  // list entirely), so every mutation below invalidates all three box
  // queries plus the received-tab badge — simplest way to keep every tab
  // honest without hand-tracking which specific queries a given toggle
  // could affect.
  function invalidateAllBoxes() {
    (["sent", "received", "archived"] as const).forEach((b) => {
      const params = b === "sent" ? {} : { box: b };
      queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey(params) });
    });
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
  const listParams = {
    ...(box !== "sent" ? { box } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
  };
  const { data: whisps, isLoading } = useListWhisps(listParams, {
    query: { queryKey: getListWhispsQueryKey(listParams), refetchInterval: 60_000, refetchIntervalInBackground: false },
  });

  // A lightweight always-on fetch (separate from the tab's own query above,
  // but sharing its cache entry once the Received tab is actually opened —
  // same params, same query key) purely to badge the tab itself with how
  // many arrived unopened, so a Whisperer notices new ones without having to
  // switch tabs first.
  const receivedBadgeParams = { box: "received" as const };
  const { data: receivedForBadge } = useListWhisps(receivedBadgeParams, {
    query: { queryKey: getListWhispsQueryKey(receivedBadgeParams), refetchInterval: 60_000, refetchIntervalInBackground: false },
  });
  const newReceivedCount = receivedForBadge?.filter((w) => !w.openedAt).length ?? 0;

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
      (isReceivedItem && w.senderAlias?.toLowerCase().includes(q))
    );
  });

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("whispsList.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("whispsList.subtitle")}</p>
        </div>

        {/* Sent / Received / Archived — three clearly different collections,
            so this is a real tab switch rather than a filter dropdown
            value, with its own badge on Received so a new arrival is
            noticeable without having to open the tab first. */}
        <div className="inline-flex items-center gap-1 rounded-full bg-card border border-border/50 p-1">
          <button
            type="button"
            onClick={() => setBox("sent")}
            data-testid="tab-whisps-sent"
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              box === "sent" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Send className="w-3.5 h-3.5" /> {t("whispsList.tabs.sent")}
          </button>
          <button
            type="button"
            onClick={() => setBox("received")}
            data-testid="tab-whisps-received"
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors relative ${
              box === "received" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Inbox className="w-3.5 h-3.5" /> {t("whispsList.tabs.received")}
            {newReceivedCount > 0 && (
              <span
                className={`ml-0.5 inline-flex items-center justify-center rounded-full text-[10px] font-semibold min-w-[18px] h-[18px] px-1 ${
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
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              box === "archived" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Archive className="w-3.5 h-3.5" /> {t("whispsList.tabs.archived")}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={box === "sent" ? t("whispsList.searchPlaceholderSent") : t("whispsList.searchPlaceholderOther")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-card border-border/50 rounded-full"
            />
          </div>
          {box !== "archived" && (
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px] bg-card border-border/50 rounded-full">
                <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder={t("whispsList.filter.allStatuses")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("whispsList.filter.allStatuses")}</SelectItem>
                <SelectItem value="pending">{t("whispsList.filter.pending")}</SelectItem>
                <SelectItem value="scheduled">{t("whispsList.filter.scheduled")}</SelectItem>
                <SelectItem value="delivered">{t("whispsList.filter.delivered")}</SelectItem>
                <SelectItem value="opened">{t("whispsList.filter.opened")}</SelectItem>
                <SelectItem value="watched">{t("whispsList.filter.watched")}</SelectItem>
                <SelectItem value="replied">{t("whispsList.filter.replied")}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
          </div>
        ) : filteredWhisps?.length ? (
          <div className="space-y-4">
            {filteredWhisps.map((whisp) => {
              // Which role this specific whisp is showing under — for the
              // Sent/Received tabs it always matches the tab itself, but the
              // Archived tab mixes both origins into one list, so each card
              // has to work this out for itself.
              const isReceivedItem = whisp.viewerRole === "recipient";
              const isNew = box === "received" && !whisp.openedAt;
              const canDelete = whisp.viewerRole === "sender";
              return (
              <Link
                key={whisp.id}
                href={isReceivedItem ? `/w/${whisp.publicToken}` : `/whisps/${whisp.id}`}
                onClick={handleCardClick}
              >
                {/* Received cards get their own identity, not just the sent
                    card reused with different text: a left accent bar (gold
                    for a genuinely new/unopened one, a quieter primary tint
                    once it's been seen) and a Received pill, so a glance at
                    the list — not just the tab you're on — tells you which
                    kind of card this is. Pinned cards get a subtle gilded
                    ring regardless of box, since a pin means "important to
                    me" independent of sent/received/archived. */}
                <Card
                  onPointerDown={(e) => handleCardPointerDown(e, whisp.id)}
                  onPointerMove={handleCardPointerMove}
                  onPointerUp={clearLongPressTimer}
                  onPointerCancel={clearLongPressTimer}
                  className={`bg-card hover:bg-card/80 transition-colors cursor-pointer overflow-hidden group select-none ${
                    whisp.pinned ? "ring-1 ring-gilded/40" : ""
                  } ${
                    isReceivedItem
                      ? isNew
                        ? "border-gilded/50 border-l-4 border-l-gilded shadow-[0_0_16px_rgba(212,175,55,0.12)]"
                        : "border-primary/25 border-l-4 border-l-primary/40"
                      : "border-border/50"
                  }`}
                  data-testid={`card-whisp-${whisp.id}`}
                >
                  <div className="flex flex-col sm:flex-row h-full">
                    {whisp.videoThumbnail ? (
                      <div className="w-full sm:w-48 h-36 sm:h-auto shrink-0 relative">
                        <img src={whisp.videoThumbnail} alt={whisp.videoTitle || t("whispsList.videoAlt")} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <PlayCircle className="w-10 h-10 text-white opacity-80" />
                        </div>
                      </div>
                    ) : (
                      <div className="w-full sm:w-48 h-36 sm:h-auto shrink-0 bg-muted flex items-center justify-center">
                        <PlayCircle className="w-10 h-10 text-muted-foreground" />
                      </div>
                    )}
                    <div className="p-5 flex-1 flex flex-col justify-center min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <h3 className="font-semibold text-foreground text-lg truncate">{whisp.videoTitle || t("whispsList.videoLinkFallback")}</h3>
                        <div className="flex items-center gap-1 shrink-0">
                          {isNew && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-gilded/15 text-gilded text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 mr-1"
                              data-testid={`badge-new-${whisp.id}`}
                            >
                              <Sparkles className="w-2.5 h-2.5" /> {t("whispsList.newBadge")}
                            </span>
                          )}
                          {whisp.appreciationResponse === "yes" && (
                            <Heart className="w-4 h-4 text-rose-400 fill-rose-400" data-testid={`icon-appreciated-${whisp.id}`} />
                          )}
                          <StatusBadge status={whisp.status} />
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
                            className={`p-1.5 rounded-full transition-colors ${
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
                                className="p-1.5 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
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
                      <div className="flex items-center text-sm text-muted-foreground mb-4">
                        {isReceivedItem ? (
                          <span className="truncate flex items-center gap-1.5">
                            <Inbox className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                            {t("whispsList.from", { sender: whisp.senderAlias || t("whispsList.someoneAnonymous") })}
                          </span>
                        ) : (
                          <span className="truncate">
                            {t("whispsList.to", {
                              recipient:
                                whisp.recipientEmail || whisp.recipientPhone || (
                                  whisp.deliveryMethod === "circle_drop"
                                    ? t("shared.blindCircleFeed")
                                    : whisp.deliveryMethod === "circle_dm"
                                      ? t("whispsList.anonymousCircleVisitor")
                                      : t("shared.ghostBoostAudience")
                                ),
                            })}
                          </span>
                        )}
                        <span className="mx-2">•</span>
                        <span>{new Date(whisp.createdAt).toLocaleDateString()}</span>
                        <span className="mx-2">•</span>
                        <span>{t("whispsList.via", { method: deliveryLabel(whisp.deliveryMethod, whisp.whisperChannel) })}</span>
                      </div>
                      <div className="mt-auto flex items-center justify-between gap-3">
                        {whisp.moodTag ? <MoodTag mood={whisp.moodTag} className="scale-90 origin-left" /> : <span />}
                        {!isReceivedItem && whisp.videoPlatform !== "upload" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full shrink-0"
                            onClick={(e) => handleWhispAgain(e, whisp)}
                            data-testid={`button-whisp-again-${whisp.id}`}
                          >
                            <Repeat className="w-3.5 h-3.5 mr-1.5" /> {t("shared.whispToSomeoneElse")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
              );
            })}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <h3 className="text-xl font-medium text-foreground mb-2">{t("whispsList.emptyState.title")}</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-6">
              {searchQuery || statusFilter !== "all"
                ? t("whispsList.emptyState.adjustFilters")
                : box === "received"
                  ? t("whispsList.emptyState.noneReceived")
                  : box === "archived"
                    ? t("whispsList.emptyState.noneArchived")
                    : t("whispsList.emptyState.noneSent")}
            </p>
            {!searchQuery && statusFilter === "all" && box === "sent" && (
              <Link href="/send">
                <Button className="rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)]">
                  {t("whispsList.emptyState.cta")}
                </Button>
              </Link>
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
