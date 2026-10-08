import { AppLayout } from "@/components/layout/AppLayout";
import { useTranslation } from "react-i18next";
import { useListCircleFeed } from "@workspace/api-client-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { MoodTag } from "@/components/shared/MoodTag";
import { CirclePostComposer } from "@/components/shared/CirclePostComposer";
import { savePendingForward } from "@/lib/forwardVideo";
import { PlayCircle, Users, Send, Share2 } from "lucide-react";

// Shaped like a real card (thumbnail, serif title, mood pill, footer) so the
// grid doesn't jump when the feed lands.
function CircleCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/50 bg-card overflow-hidden" aria-hidden>
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-3.5 w-full" />
        <div className="flex items-center justify-between pt-1">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function CircleFeed() {
  const { t } = useTranslation("circle");
  const { toast } = useToast();
  const { data, isLoading } = useListCircleFeed();
  const [, setLocation] = useLocation();
  const items = data?.items ?? [];

  // Passing a post onward as your own whisp. Same mechanism the public whisp
  // page's "pass it forward" uses — the video's details are carried into the
  // send composer, so what circulates is the video, never the original
  // poster's identity (which the feed never had in the first place).
  function whispThis(item: (typeof items)[number]) {
    savePendingForward({
      videoUrl: item.videoUrl,
      videoTitle: item.videoTitle,
      videoThumbnail: item.videoThumbnail,
      videoPlatform: item.videoPlatform,
    });
    setLocation("/send");
  }

  // Sharing the post itself (not re-sending it as your own whisp). Routed
  // through /api/l/:token (api-server routes/link.ts), NOT the SPA's own
  // /w/:token: a link-preview crawler gets a curiosity card ("An anonymous
  // post on Blind Circle" — never the title, thumbnail, note or poster), a
  // browser is redirected straight to /w/:token. The share text is
  // deliberately generic for the same reason: nothing about the video rides
  // along. Same navigator.share → clipboard fallback as DebateTopicCard.
  function sharePost(item: (typeof items)[number]) {
    const url = `${window.location.origin}/api/l/${item.publicToken}`;
    if (navigator.share) {
      navigator.share({ title: t("circleFeed.shareTitle"), text: t("circleFeed.shareText"), url }).catch(() => {});
      return;
    }
    navigator.clipboard
      .writeText(url)
      .then(() => toast({ title: t("circleFeed.linkCopied") }))
      .catch(() => toast({ title: t("circleFeed.copyFailed"), variant: "destructive" }));
  }

  return (
    <AppLayout>
      <div className="space-y-6 md:space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
              <Users className="w-7 h-7 text-primary shrink-0" /> {t("circleFeed.title")}
            </h1>
            <p className="text-[15px] text-muted-foreground mt-1.5 max-w-xl leading-relaxed">{t("circleFeed.description")}</p>
          </div>
          <div className="shrink-0">
            <CirclePostComposer />
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <CircleCardSkeleton key={i} />
            ))}
          </div>
        ) : items.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {items.map((item) => (
              <Card
                key={item.id}
                className="bg-card hover:border-border transition-colors duration-200 border-border/50 rounded-2xl overflow-hidden group h-full flex flex-col"
                data-testid={`circle-item-${item.id}`}
              >
                <Link href={`/w/${item.publicToken}`} className="cursor-pointer block" tabIndex={-1} aria-hidden>
                  {item.videoThumbnail ? (
                    <div className="relative aspect-video shrink-0 overflow-hidden bg-muted">
                      <img
                        src={item.videoThumbnail}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-black/20 group-hover:from-black/30 transition-colors flex items-center justify-center">
                        <PlayCircle className="w-10 h-10 text-white/90 drop-shadow" strokeWidth={1.5} />
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video shrink-0 bg-muted flex items-center justify-center">
                      <PlayCircle className="w-10 h-10 text-muted-foreground" strokeWidth={1.5} />
                    </div>
                  )}
                </Link>
                <div className="p-4 flex-1 flex flex-col gap-2.5 min-w-0">
                  <Link href={`/w/${item.publicToken}`} className="min-w-0 cursor-pointer flex flex-col items-start gap-2.5">
                    {item.videoTitle && (
                      <p className="font-serif text-lg font-semibold leading-snug text-foreground line-clamp-2 group-hover:text-primary transition-colors">
                        {item.videoTitle}
                      </p>
                    )}
                    {item.moodTag && <MoodTag mood={item.moodTag} className="py-0.5! pr-3! text-[13px]!" />}
                    {item.anonymousNote && (
                      <p className="text-sm text-muted-foreground italic leading-relaxed line-clamp-3">
                        &ldquo;{item.anonymousNote}&rdquo;
                      </p>
                    )}
                  </Link>
                  <div className="mt-auto flex items-center gap-1 pt-2 border-t border-border/40">
                    {/* Stacked rather than "alias · time" on one line, so
                        neither is ever cut off next to the two actions. */}
                    <div className="min-w-0 mr-auto leading-tight">
                      <p className="text-[13px] text-foreground/80 break-words">{item.senderAlias ?? t("circleFeed.someone")}</p>
                      <time dateTime={item.createdAt} className="block text-xs text-muted-foreground tabular-nums mt-0.5">
                        {t("circleFeed.timeAgo", { time: formatDistanceToNowStrict(new Date(item.createdAt)) })}
                      </time>
                    </div>
                    <button
                      type="button"
                      onClick={() => sharePost(item)}
                      aria-label={t("circleFeed.shareAria")}
                      data-testid={`button-share-circle-${item.id}`}
                      className="shrink-0 inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors duration-150"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    {/* Anything in the circle can be sent onward to someone who
                        needs it — which is the point of a discovery feed in an
                        app whose whole purpose is sending. */}
                    <button
                      type="button"
                      onClick={() => whispThis(item)}
                      data-testid={`button-whisp-this-${item.id}`}
                      className="shrink-0 inline-flex items-center gap-1.5 h-11 sm:h-9 rounded-full border border-primary/30 bg-primary/10 px-3.5 text-[13px] font-medium text-primary transition-colors duration-150 hover:bg-primary/20"
                    >
                      <Send className="w-3.5 h-3.5" /> {t("circleFeed.whispThis")}
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border/60 rounded-2xl py-14 px-6 text-center">
            <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-xl font-serif font-semibold text-foreground mb-2">{t("circleFeed.emptyTitle")}</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">{t("circleFeed.emptyDescription")}</p>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
