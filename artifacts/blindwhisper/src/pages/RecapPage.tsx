import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetUserRecap, GetUserRecapPeriod, type UserRecap } from "@workspace/api-client-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LogoLockup } from "@/components/ui/logo";
import { useToast } from "@/hooks/use-toast";
import { categoryLabel } from "@/lib/videoCategories";
import {
  PartyPopper,
  Send,
  Inbox,
  MessageSquareHeart,
  VenetianMask,
  Swords,
  Users,
  Gift,
  CalendarDays,
  Share2,
  AlertTriangle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Each tile's icon deliberately echoes the icon used for the same concept
// elsewhere in the app (AppLayout's nav icons, Dashboard's stat cards) so a
// stat reads as "the same thing" wherever it shows up, rather than
// introducing a second visual vocabulary just for this page.
function statTiles(data: UserRecap): Array<{ key: string; value: number; icon: LucideIcon }> {
  const tiles: Array<{ key: string; value: number; icon: LucideIcon }> = [
    { key: "totalSent", value: data.totalSent, icon: Send },
    { key: "totalReceived", value: data.totalReceived, icon: Inbox },
    { key: "repliesReceived", value: data.repliesReceived, icon: MessageSquareHeart },
    { key: "circlePosts", value: data.circlePosts, icon: VenetianMask },
    { key: "debateTopicsPosted", value: data.debateTopicsPosted, icon: Swords },
    { key: "followerCount", value: data.followerCount, icon: Users },
  ];
  // whisperBoxMessagesReceived is null unless the caller has Whisper Box
  // enabled — render it as an absent tile in that case, never as a "0".
  if (data.whisperBoxMessagesReceived !== null) {
    tiles.push({ key: "whisperBoxMessagesReceived", value: data.whisperBoxMessagesReceived, icon: Gift });
  }
  return tiles;
}

function StatTile({
  icon: Icon,
  label,
  value,
  statKey,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  statKey: string;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-background/40 p-4 flex flex-col items-center text-center gap-1.5">
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <p className="text-2xl font-bold text-foreground" data-testid={`recap-stat-value-${statKey}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}

export function RecapPage() {
  const { t, i18n } = useTranslation("recap");
  const { toast } = useToast();
  const [period, setPeriod] = useState<GetUserRecapPeriod>(GetUserRecapPeriod.all_time);

  const { data, isLoading, isError, refetch } = useGetUserRecap({ period });

  function handleShare() {
    if (!data) return;
    const shareText = t("share.text", { count: data.totalSent });
    // Web Share API first (mobile share sheet); falls back to copying a
    // text summary to the clipboard on desktop/unsupported browsers — same
    // two-step pattern DebateTopicCard and MyCircles use for their own
    // share/copy actions. The recap itself has no public URL to share (it's
    // the caller's own authed data), so the shareable payload is the
    // summary sentence plus a link back to the app, not a deep link.
    if (navigator.share) {
      navigator.share({ title: t("share.title"), text: shareText, url: window.location.origin }).catch(() => {});
      return;
    }
    navigator.clipboard
      .writeText(`${shareText} ${window.location.origin}`)
      .then(() => toast({ title: t("share.copied") }))
      .catch(() => toast({ title: t("share.copyFailed"), variant: "destructive" }));
  }

  const memberSince = data
    ? new Date(data.memberSince).toLocaleDateString(i18n.language, { month: "long", year: "numeric" })
    : "";

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
              <PartyPopper className="w-7 h-7 text-primary" /> {t("title")}
            </h1>
            <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
          </div>

          <Tabs value={period} onValueChange={(v) => setPeriod(v as GetUserRecapPeriod)}>
            <TabsList>
              <TabsTrigger value={GetUserRecapPeriod.all_time} data-testid="recap-tab-all-time">
                {t("period.allTime")}
              </TabsTrigger>
              <TabsTrigger value={GetUserRecapPeriod.last_30_days} data-testid="recap-tab-last-30-days">
                {t("period.last30Days")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-72 rounded-3xl" />
            <Skeleton className="h-11 w-full rounded-full" />
          </div>
        ) : isError || !data ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <p className="text-muted-foreground mb-4">{t("error.description")}</p>
            <Button variant="outline" onClick={() => refetch()} data-testid="button-recap-retry">
              {t("error.retry")}
            </Button>
          </div>
        ) : (
          <>
            {/* The shareable card itself — gilded frame (same accent
                DebateTopicCard uses) because this is meant to feel like a
                small prize worth showing off, not another settings panel. */}
            <div
              className="relative rounded-3xl border border-gilded/40 bg-card overflow-hidden p-6 sm:p-8"
              style={{ boxShadow: "0 0 32px rgba(232,200,110,0.1)" }}
              data-testid="recap-card"
            >
              <div className="absolute top-[-15%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[80px] pointer-events-none" />
              <div className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 rounded-full blur-[80px] pointer-events-none" />

              <div className="relative z-10 flex flex-col items-center text-center gap-2 mb-6">
                <LogoLockup size="sm" />
                {data.whispererHandle && (
                  // dir="ltr" pins the "@handle" run LTR even under Arabic's
                  // RTL paragraph direction — otherwise the bidi algorithm
                  // reorders the "@" to the trailing edge of the Latin-script
                  // run, same fix social apps universally apply to handles.
                  <Badge variant="secondary" className="mt-1" dir="ltr" data-testid="recap-handle">
                    @{data.whispererHandle}
                  </Badge>
                )}
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                  <CalendarDays className="w-3.5 h-3.5" /> {t("memberSince", { date: memberSince })}
                </p>
              </div>

              <div className="relative z-10 grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                {statTiles(data).map((tile) => (
                  <StatTile
                    key={tile.key}
                    statKey={tile.key}
                    icon={tile.icon}
                    label={t(`stats.${tile.key}`)}
                    value={tile.value}
                  />
                ))}
              </div>

              {data.topCategory && (
                <div
                  className="relative z-10 mt-5 rounded-2xl bg-gilded/10 border border-gilded/30 px-4 py-3 text-center"
                  data-testid="recap-top-category"
                >
                  <p className="text-sm text-gilded font-medium">
                    {t("topCategory", { category: categoryLabel(data.topCategory) })}
                  </p>
                </div>
              )}
            </div>

            <Button onClick={handleShare} className="w-full rounded-full" data-testid="button-share-recap">
              <Share2 className="w-4 h-4 mr-2" /> {t("share.button")}
            </Button>
            <p className="text-xs text-muted-foreground text-center">{t("screenshotTip")}</p>
          </>
        )}
      </div>
    </AppLayout>
  );
}
