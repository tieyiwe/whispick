import { useEffect, useState, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useGetWhispStats, useListSuggestions, getListSuggestionsQueryKey, useGetUserProfile, useGetUserRecap, getGetUserRecapQueryKey, useGetWhisperBoxUnreadCount } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Send, Eye, PlayCircle, MessageSquareHeart, Ghost, Sparkles, Repeat, Heart, PartyPopper, Mailbox, ChevronRight } from "lucide-react";
import { formatTimeAgo } from "@/lib/relativeTime";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MoodTag } from "@/components/shared/MoodTag";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { Button } from "@/components/ui/button";
import { hasPendingForward, savePendingForward } from "@/lib/forwardVideo";
import { hasDismissedPhoneVerificationDialog, dismissPhoneVerificationDialog } from "@/lib/phoneVerificationDialog";
import { GHOST_BOOST_ENABLED } from "@/lib/featureFlags";
import { MfaNudgeBanner } from "@/components/shared/MfaNudgeBanner";
import { FirstWhispersOnboardingCta } from "@/components/shared/FirstWhispersOnboardingCta";
import { SUGGESTIONS_ENABLED } from "@/lib/featureFlags";

// Lazy, even though Dashboard itself deliberately isn't (see the code-split
// comment in App.tsx): the phone verification flow pulls in libphonenumber-js
// and the Command/cmdk combobox for its country picker, which would
// otherwise inflate every visit's initial bundle just to support a
// conditional, dismissible nudge most visits don't even need to render.
const PhoneVerificationDialog = lazy(() =>
  import("@/components/shared/PhoneVerificationDialog").then((m) => ({ default: m.PhoneVerificationDialog })),
);

const FEATURED_SUGGESTIONS_PARAMS = { featured: "true" };

// The dashboard's compact side card: icon, serif title and one line of
// context side by side, then a single action — instead of a section heading
// above a tall centered card with a 64px icon, repeated three times.
function SideCard({
  icon: Icon,
  tint,
  title,
  description,
  badge,
  testId,
  children,
}: {
  icon: typeof Send;
  tint: "primary" | "gilded";
  title: string;
  description: string;
  badge?: number;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col rounded-2xl border-border/50 bg-card/60 p-5 shadow-none" data-testid={testId}>
      <div className="flex items-start gap-3.5">
        <span
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            tint === "gilded" ? "bg-gilded/12 text-gilded" : "bg-primary/12 text-primary"
          }`}
        >
          <Icon className="h-5 w-5" />
          {badge ? (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-secondary ring-2 ring-card text-[11px] font-semibold leading-none tabular-nums text-secondary-foreground flex items-center justify-center">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-serif font-semibold leading-snug text-foreground">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-auto space-y-3 pt-4">{children}</div>
    </Card>
  );
}

export function Dashboard() {
  const { t } = useTranslation("whisp");
  // Second namespace hook, same pattern SettingsPage.tsx uses for its
  // `tDemographics` alias — Whisper Box's own copy lives in its own
  // namespace rather than crowding into whisp.json.
  const { t: tWhisperBox } = useTranslation("whisperBox");
  const { data: stats, isLoading } = useGetWhispStats();
  const { data: profile } = useGetUserProfile();
  const { data: suggestionsData } = useListSuggestions(FEATURED_SUGGESTIONS_PARAMS, {
    // Not fetched at all while Suggestions is parked (lib/features.ts).
    query: { queryKey: getListSuggestionsQueryKey(FEATURED_SUGGESTIONS_PARAMS), enabled: SUGGESTIONS_ENABLED },
  });
  const featuredSuggestion = suggestionsData?.items[0];
  // whisperBoxMessagesReceived is null unless the caller has whisperBoxEnabled
  // — see UserRecap's own doc comment. There's no dedicated boolean field for
  // this anywhere else the frontend can read, so recap doubles as the signal.
  // refetchOnMount: "always" so this dashboard card's enabled/disabled state
  // reflects reality every time the dashboard is opened, rather than
  // whatever was cached from earlier in the session (see SettingsPage.tsx's
  // matching comment for the bug this avoids).
  const { data: recap } = useGetUserRecap(undefined, {
    query: { refetchOnMount: "always", queryKey: getGetUserRecapQueryKey() },
  });
  const whisperBoxEnabled = recap ? recap.whisperBoxMessagesReceived !== null : false;
  const { data: whisperBoxUnread } = useGetWhisperBoxUnreadCount();
  const whisperBoxUnreadCount = whisperBoxUnread?.unreadCount ?? 0;
  const [, setLocation] = useLocation();

  function relativeTime(value: string): string {
    const date = new Date(value);
    if (Date.now() - date.getTime() < 60_000) return t("shared.justNow");
    return formatTimeAgo(date);
  }

  // First-Dashboard-visit nudge to verify a phone number (see
  // PhoneVerificationDialog) — same early-account-lifecycle trigger timing
  // as the demographics gate, but dismissible: only shown while
  // phoneVerifiedAt is still null AND this browser hasn't already dismissed
  // it once for this account.
  const [showPhoneDialog, setShowPhoneDialog] = useState(false);
  useEffect(() => {
    if (!profile) return;
    if (profile.phoneVerifiedAt) return;
    if (hasDismissedPhoneVerificationDialog(profile.id)) return;
    setShowPhoneDialog(true);
  }, [profile]);

  function handleWhisperFeatured() {
    if (!featuredSuggestion) return;
    savePendingForward({
      videoUrl: featuredSuggestion.videoUrl,
      videoTitle: featuredSuggestion.videoTitle,
      videoThumbnail: featuredSuggestion.videoThumbnail,
      videoEmbedUrl: featuredSuggestion.videoEmbedUrl,
      videoPlatform: featuredSuggestion.videoPlatform,
    });
    setLocation("/send");
  }

  function handleWhispAgain(e: React.MouseEvent, whisp: {
    videoUrl: string;
    videoTitle?: string | null;
    videoThumbnail?: string | null;
    videoEmbedUrl?: string | null;
    videoPlatform?: string | null;
    videoStartSeconds?: number | null;
    videoEndSeconds?: number | null;
  }) {
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

  // A brand-new account created via "Pass it forward" from the public whisp
  // page always lands here first (Clerk's sign-up redirect is fixed at
  // /dashboard) — bounce straight to Send Whisp, which consumes (and
  // clears) the pending video itself.
  useEffect(() => {
    if (hasPendingForward()) setLocation("/send");
  }, [setLocation]);

  if (isLoading) {
    // Shaped like the page it stands in for — heading, stat tiles, recent
    // whisp rows and the side cards — so nothing jumps when data lands.
    return (
      <AppLayout>
        <div className="space-y-6 md:space-y-8" aria-busy="true">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-9 w-44 rounded-lg" />
              <Skeleton className="h-4 w-64 rounded-md" />
            </div>
            <Skeleton className="h-11 w-full sm:w-44 rounded-full" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={`flex items-center gap-2.5 rounded-2xl border border-border/40 bg-card/40 p-3.5 ${i === 4 ? "col-span-2 lg:col-span-1" : ""}`}>
                <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                <div className="space-y-1.5">
                  <Skeleton className="h-5 w-10 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            <div className="lg:col-span-2 space-y-3">
              <Skeleton className="h-6 w-40 rounded-md mb-1" />
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3 sm:gap-4 rounded-2xl border border-border/40 bg-card/40 p-3 sm:p-4">
                  <Skeleton className="w-28 sm:w-40 aspect-video rounded-[12px] shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <Skeleton className="h-4 w-4/5 rounded" />
                    <Skeleton className="h-3 w-1/2 rounded" />
                    <Skeleton className="h-6 w-24 rounded-full mt-3" />
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="rounded-2xl border border-border/40 bg-card/40 p-5 space-y-3">
                  <div className="flex gap-3">
                    <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/2 rounded" />
                      <Skeleton className="h-3 w-full rounded" />
                    </div>
                  </div>
                  <Skeleton className="h-10 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Brand-new account: nothing sent, nothing to measure. Five "0" tiles and an
  // empty "Recent" list said nothing useful, so the first screen becomes one
  // welcoming card with a single clear action instead.
  const recentWhisps = stats?.recentWhisps ?? [];
  const isNewUser = (stats?.totalSent ?? 0) === 0 && recentWhisps.length === 0;

  const statCards = [
    { key: "sent", title: t("dashboard.stats.sentWhisps"), value: stats?.totalSent || 0, icon: Send, color: "text-primary", bg: "bg-primary/12" },
    { key: "openRate", title: t("dashboard.stats.openRate"), value: `${Math.round(stats?.openRate || 0)}%`, icon: Eye, color: "text-sky-400", bg: "bg-sky-400/12" },
    { key: "watched", title: t("dashboard.stats.videosWatched"), value: stats?.totalWatched || 0, icon: PlayCircle, color: "text-secondary", bg: "bg-secondary/12" },
    { key: "replies", title: t("dashboard.stats.repliesReceived"), value: stats?.totalReplied || 0, icon: MessageSquareHeart, color: "text-amber-400", bg: "bg-amber-400/12" },
    // The recipient's own "was this something you needed to hear?" signal,
    // rolled up — previously visible only one whisp at a time, buried on
    // each individual detail page, with no sense of overall impact. Given
    // the gilded accent because it's the one number that measures the thing
    // the app exists to do; the others are mechanics by comparison. It also
    // spans the full row on mobile, so five tiles never leave an orphan.
    {
      key: "helped",
      title: t("dashboard.stats.whispsThatHelped"),
      value: stats?.totalAppreciated || 0,
      icon: Heart,
      color: "text-gilded",
      bg: "bg-gilded/12",
      highlight: true,
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-6 md:space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-foreground">{t("dashboard.title")}</h1>
            <p className="text-muted-foreground mt-1.5">
              {isNewUser ? t("dashboard.welcome.subtitle") : t("dashboard.subtitle")}
            </p>
          </div>
          {!isNewUser && (
            <Button asChild className="h-11 w-full sm:w-auto rounded-full px-6 shadow-[0_0_20px_rgba(124,92,252,0.35)]">
              <Link href="/send">
                <Send className="w-4 h-4 mr-2" /> {t("dashboard.sendNewWhisp")}
              </Link>
            </Button>
          )}
        </div>

        <MfaNudgeBanner />

        {isNewUser ? (
          <Card
            className="relative overflow-hidden rounded-2xl border-primary/25 bg-card/70 p-6 sm:p-8"
            data-testid="card-dashboard-welcome"
          >
            <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-primary/15 blur-[80px]" />
            <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 h-48 w-48 rounded-full bg-gilded/10 blur-[80px]" />
            <div className="relative space-y-6">
              <div className="space-y-4">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/25">
                  <Send className="h-6 w-6 text-primary" />
                </span>
                <div className="space-y-2">
                  <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground">{t("dashboard.welcome.title")}</h2>
                  <p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground">{t("dashboard.welcome.description")}</p>
                </div>
                <ol className="grid gap-2 sm:grid-cols-3 sm:gap-3 pt-1">
                  {(["pick", "note", "send"] as const).map((step, i) => (
                    <li key={step} className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/30 px-3 py-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold tabular-nums text-primary">
                        {i + 1}
                      </span>
                      <span className="text-sm text-foreground/90">{t(`dashboard.welcome.steps.${step}`)}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <Button asChild className="h-12 w-full sm:w-auto rounded-full px-8 text-[15px] shadow-[0_0_24px_rgba(124,92,252,0.4)]">
                <Link href="/send" data-testid="button-dashboard-first-whisp">
                  <Send className="w-4 h-4 mr-2" /> {t("dashboard.welcome.cta")}
                </Link>
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4" data-testid="dashboard-stats">
            {statCards.map((stat) => (
              <Card
                key={stat.key}
                className={`relative flex items-center gap-2.5 overflow-hidden rounded-2xl p-3.5 shadow-none ${
                  stat.highlight
                    ? "col-span-2 lg:col-span-1 border-gilded/30 bg-gilded/[0.06]"
                    : "border-border/50 bg-card/60"
                }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${stat.bg}`}>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </span>
                <div className="min-w-0">
                  <p
                    className={`text-xl lg:text-2xl font-sans font-semibold leading-tight tabular-nums tracking-tight ${
                      stat.highlight ? "text-gilded" : "text-foreground"
                    }`}
                  >
                    {stat.value}
                  </p>
                  <p className="text-xs font-medium leading-tight text-muted-foreground">{stat.title}</p>
                </div>
              </Card>
            ))}
          </div>
        )}

        <div className={`grid grid-cols-1 gap-6 lg:gap-8 ${isNewUser ? "" : "lg:grid-cols-3"}`}>
          {!isNewUser && (
            <section className="lg:col-span-2 space-y-3" aria-labelledby="dashboard-recent-heading">
              <div className="flex items-center justify-between">
                <h2 id="dashboard-recent-heading" className="text-xl font-serif font-semibold">{t("dashboard.recentWhisps")}</h2>
                <Link href="/whisps" className="-mr-2 inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-medium text-primary hover:bg-primary/10 transition-colors">
                  {t("dashboard.viewAll")} <ChevronRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="space-y-3">
                {recentWhisps.map((whisp) => (
                  <Link key={whisp.id} href={`/whisps/${whisp.id}`} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Card className="group rounded-2xl border-border/50 bg-card/60 p-3 sm:p-4 shadow-none transition-colors duration-200 hover:border-border hover:bg-card">
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3 sm:gap-x-4 sm:gap-y-2.5">
                        <div className="relative w-28 sm:w-40 sm:row-span-2 aspect-video shrink-0 self-start overflow-hidden rounded-[12px] bg-muted">
                          {whisp.videoThumbnail ? (
                            <img src={whisp.videoThumbnail} alt={whisp.videoTitle || t("dashboard.videoAlt")} className="h-full w-full object-cover" />
                          ) : null}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors duration-200 group-hover:bg-black/10">
                            <PlayCircle className="h-7 w-7 text-white/90 drop-shadow" />
                          </div>
                        </div>
                        <div className="min-w-0 self-center sm:self-start">
                          <h3 className="line-clamp-2 text-[15px] sm:text-base font-semibold leading-snug text-foreground">
                            {whisp.videoTitle || t("dashboard.videoLinkFallback")}
                          </h3>
                          <p className="mt-1 truncate text-sm text-muted-foreground">
                            {t("dashboard.sentTo", {
                              destination:
                                whisp.recipientEmail ||
                                whisp.recipientPhone ||
                                (whisp.deliveryMethod === "circle_drop" ? t("shared.blindCircleFeed") : t("shared.ghostBoostAudience")),
                            })}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                            <time dateTime={whisp.createdAt} title={new Date(whisp.createdAt).toLocaleString()}>
                              {relativeTime(whisp.createdAt)}
                            </time>
                          </p>
                        </div>
                        <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-2 flex items-center gap-2 min-w-0">
                          <StatusBadge status={whisp.status} />
                          {whisp.moodTag && (
                            <MoodTag mood={whisp.moodTag} className="min-w-0 shrink whitespace-nowrap py-0.5! pl-0.5! pr-2.5! gap-1.5! text-xs! shadow-none!" />
                          )}
                          {whisp.videoPlatform !== "upload" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ml-auto h-9 shrink-0 rounded-full px-3 text-muted-foreground hover:text-foreground"
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
                ))}
              </div>
            </section>
          )}

          {/* On a brand-new account these cards are the whole lower page, so
              they tile two-up instead of running down a narrow side column.
              self-start at every width, not just lg: in the one-column
              mobile grid a stretched column made SideCard's h-full resolve
              to the whole column's height, so each card ballooned to the
              height of all of them together (mostly empty space). */}
          <div className={isNewUser ? "grid gap-3 lg:gap-4 grid-cols-1 md:grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]" : "space-y-3 lg:space-y-4 self-start"}>
            {/* Cold-start growth nudge — self-contained, additive block, same
                reasoning as the Whisper Box/Recap cards below: Dashboard.tsx
                is shared with other in-flight work. Renders nothing once the
                account has sent its first Whisp or dismissed this card. */}
            <FirstWhispersOnboardingCta />

            {GHOST_BOOST_ENABLED && (
              <SideCard icon={Ghost} tint="primary" title={t("dashboard.ghostBoosts.title")} description={t("dashboard.ghostBoosts.description")}>
                <p className="text-sm text-muted-foreground">
                  <span className="text-2xl font-semibold tabular-nums text-foreground mr-1.5">{stats?.boostCredits || 0}</span>
                  {t("dashboard.ghostBoosts.creditsAvailable")}
                </p>
                <Button asChild variant="outline" className="h-10 w-full rounded-full">
                  <Link href="/credits">{t("dashboard.ghostBoosts.getMoreCredits")}</Link>
                </Button>
              </SideCard>
            )}

            {/* Suggestions is parked for now (lib/features.ts); the column
                is a plain stack, so dropping the card leaves no gap. */}
            {SUGGESTIONS_ENABLED && (
              <Card className="rounded-2xl border-border/50 bg-card/60 p-5 shadow-none" data-testid="card-suggestions-nudge">
                <h2 className="text-lg font-serif font-semibold leading-snug text-foreground">{t("dashboard.suggestions.title")}</h2>
                {featuredSuggestion ? (
                  <div className="mt-4 space-y-4">
                    <div className="flex gap-3 items-center">
                      {featuredSuggestion.videoThumbnail ? (
                        <Thumbnail src={featuredSuggestion.videoThumbnail} alt="thumbnail" className="w-20 aspect-video object-cover rounded-lg shrink-0" />
                      ) : (
                        <div className="w-20 aspect-video bg-muted rounded-lg flex items-center justify-center shrink-0">
                          <Sparkles className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug text-foreground line-clamp-2">{featuredSuggestion.videoTitle || t("dashboard.suggestions.videoWorthSharing")}</p>
                        {featuredSuggestion.aiSummary && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{featuredSuggestion.aiSummary}</p>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" className="h-10 rounded-full px-3 border-primary/30 hover:bg-primary/10 hover:text-foreground" onClick={handleWhisperFeatured} data-testid="button-whisper-featured-suggestion">
                        <Send className="h-4 w-4 mr-2 text-primary" /> {t("dashboard.suggestions.whisperThis")}
                      </Button>
                      <Button asChild variant="ghost" className="h-10 rounded-full px-3 text-muted-foreground hover:text-foreground">
                        <Link href="/suggestions">{t("dashboard.suggestions.browseLibrary")}</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 space-y-4">
                    <p className="text-sm text-muted-foreground">{t("dashboard.suggestions.description")}</p>
                    <Button asChild variant="outline" className="h-10 w-full rounded-full">
                      <Link href="/suggestions">{t("dashboard.suggestions.browse")}</Link>
                    </Button>
                  </div>
                )}
              </Card>
            )}

            {/* Recap CTA — points at the shareable "Wrapped"-style stats
                card (RecapPage); a self-contained, additive block on
                purpose since Dashboard.tsx is shared with other in-flight
                work. */}
            <SideCard
              icon={PartyPopper}
              tint="gilded"
              title={t("dashboard.recap.heading")}
              description={t("dashboard.recap.description")}
              testId="card-recap-nudge"
            >
              <Button asChild variant="outline" className="h-10 w-full rounded-full">
                <Link href="/recap" data-testid="button-see-recap">{t("dashboard.recap.cta")}</Link>
              </Button>
            </SideCard>

            {/* Whisper Box CTA — self-contained, additive block for the same
                reason the Recap one above is: Dashboard.tsx is shared with
                other in-flight work. */}
            <SideCard
              icon={Mailbox}
              tint="primary"
              title={
                !whisperBoxEnabled
                  ? tWhisperBox("dashboardCard.getStartedTitle")
                  : whisperBoxUnreadCount > 0
                    ? tWhisperBox("dashboardCard.unreadTitle", { count: whisperBoxUnreadCount })
                    : tWhisperBox("dashboardCard.idleTitle")
              }
              description={
                !whisperBoxEnabled
                  ? tWhisperBox("dashboardCard.getStartedDescription")
                  : whisperBoxUnreadCount > 0
                    ? tWhisperBox("dashboardCard.unreadDescription")
                    : tWhisperBox("dashboardCard.idleDescription")
              }
              badge={whisperBoxEnabled && whisperBoxUnreadCount > 0 ? whisperBoxUnreadCount : undefined}
              testId="card-whisper-box-nudge"
            >
              {!whisperBoxEnabled ? (
                <Button asChild variant="outline" className="h-10 w-full rounded-full">
                  <Link href="/settings" data-testid="button-get-whisper-box">{tWhisperBox("dashboardCard.getStartedCta")}</Link>
                </Button>
              ) : (
                <Button
                  asChild
                  variant="outline"
                  className={`h-10 w-full rounded-full ${whisperBoxUnreadCount > 0 ? "border-primary/40 bg-primary/10 hover:bg-primary/15 hover:text-foreground" : ""}`}
                >
                  <Link href="/whisper-box" data-testid="button-view-whisper-box-inbox">{tWhisperBox("dashboardCard.viewInboxCta")}</Link>
                </Button>
              )}
            </SideCard>
          </div>
        </div>
      </div>
      {profile && (
        <Suspense fallback={null}>
          <PhoneVerificationDialog
            open={showPhoneDialog}
            onDismiss={() => {
              dismissPhoneVerificationDialog(profile.id);
              setShowPhoneDialog(false);
            }}
            onVerified={() => setShowPhoneDialog(false)}
          />
        </Suspense>
      )}
    </AppLayout>
  );
}
