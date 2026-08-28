import { useEffect, useState, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useGetWhispStats, useListSuggestions, getListSuggestionsQueryKey, useGetUserProfile, useGetUserRecap, getGetUserRecapQueryKey, useGetWhisperBoxUnreadCount } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Send, Eye, PlayCircle, MessageSquareHeart, TrendingUp, Ghost, Sparkles, Repeat, Heart, PartyPopper, Mailbox } from "lucide-react";
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

// Lazy, even though Dashboard itself deliberately isn't (see the code-split
// comment in App.tsx): the phone verification flow pulls in libphonenumber-js
// and the Command/cmdk combobox for its country picker, which would
// otherwise inflate every visit's initial bundle just to support a
// conditional, dismissible nudge most visits don't even need to render.
const PhoneVerificationDialog = lazy(() =>
  import("@/components/shared/PhoneVerificationDialog").then((m) => ({ default: m.PhoneVerificationDialog })),
);

const FEATURED_SUGGESTIONS_PARAMS = { featured: "true" };

export function Dashboard() {
  const { t } = useTranslation("whisp");
  // Second namespace hook, same pattern SettingsPage.tsx uses for its
  // `tDemographics` alias — Whisper Box's own copy lives in its own
  // namespace rather than crowding into whisp.json.
  const { t: tWhisperBox } = useTranslation("whisperBox");
  const { data: stats, isLoading } = useGetWhispStats();
  const { data: profile } = useGetUserProfile();
  const { data: suggestionsData } = useListSuggestions(FEATURED_SUGGESTIONS_PARAMS, {
    query: { queryKey: getListSuggestionsQueryKey(FEATURED_SUGGESTIONS_PARAMS) },
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
    return (
      <AppLayout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
          </div>
          <Skeleton className="h-[400px] rounded-2xl mt-8" />
        </div>
      </AppLayout>
    );
  }

  const statCards = [
    { title: t("dashboard.stats.sentWhisps"), value: stats?.totalSent || 0, icon: Send, color: "text-primary", bg: "bg-primary/10" },
    { title: t("dashboard.stats.openRate"), value: `${Math.round(stats?.openRate || 0)}%`, icon: Eye, color: "text-blue-400", bg: "bg-blue-500/10" },
    { title: t("dashboard.stats.videosWatched"), value: stats?.totalWatched || 0, icon: PlayCircle, color: "text-secondary", bg: "bg-secondary/10" },
    { title: t("dashboard.stats.repliesReceived"), value: stats?.totalReplied || 0, icon: MessageSquareHeart, color: "text-amber-400", bg: "bg-amber-500/10" },
    // The recipient's own "was this something you needed to hear?" signal,
    // rolled up — previously visible only one whisp at a time, buried on
    // each individual detail page, with no sense of overall impact. Given
    // the gilded accent because it's the one number that measures the thing
    // the app exists to do; the others are mechanics by comparison.
    {
      title: t("dashboard.stats.whispsThatHelped"),
      value: stats?.totalAppreciated || 0,
      icon: Heart,
      color: "text-gilded",
      bg: "bg-gilded/10",
      highlight: true,
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">{t("dashboard.title")}</h1>
            <p className="text-muted-foreground mt-1">{t("dashboard.subtitle")}</p>
          </div>
          <Link href="/send">
            <Button className="rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)]">
              <Send className="w-4 h-4 mr-2" /> {t("dashboard.sendNewWhisp")}
            </Button>
          </Link>
        </div>

        <MfaNudgeBanner />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat, i) => (
            <Card
              key={i}
              className={`bg-card shadow-sm overflow-hidden relative ${
                stat.highlight ? "border-gilded/25 shadow-[0_0_20px_rgba(232,200,110,0.08)]" : "border-border/50"
              }`}
            >
              <div className={`absolute top-0 right-0 w-24 h-24 rounded-full ${stat.bg} blur-2xl -mr-10 -mt-10 pointer-events-none`} />
              <CardContent className="p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                    <h3 className={`text-3xl font-bold mt-2 ${stat.highlight ? "text-gilded" : "text-foreground"}`}>
                      {stat.value}
                    </h3>
                  </div>
                  <div className={`p-3 rounded-xl ${stat.bg}`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-serif font-semibold">{t("dashboard.recentWhisps")}</h2>
              <Link href="/whisps" className="text-sm text-primary hover:underline">{t("dashboard.viewAll")}</Link>
            </div>
            
            <div className="space-y-3">
              {stats?.recentWhisps && stats.recentWhisps.length > 0 ? (
                stats.recentWhisps.map((whisp) => (
                  <Link key={whisp.id} href={`/whisps/${whisp.id}`}>
                    <Card className="bg-card hover:bg-card/80 transition-colors border-border/50 cursor-pointer overflow-hidden group">
                      <div className="flex flex-col sm:flex-row h-full">
                        {whisp.videoThumbnail ? (
                          <div className="w-full sm:w-40 h-32 sm:h-auto shrink-0 relative">
                            <img src={whisp.videoThumbnail} alt={whisp.videoTitle || t("dashboard.videoAlt")} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                              <PlayCircle className="w-8 h-8 text-white opacity-80" />
                            </div>
                          </div>
                        ) : (
                          <div className="w-full sm:w-40 h-32 sm:h-auto shrink-0 bg-muted flex items-center justify-center">
                            <PlayCircle className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                        <div className="p-4 flex-1 flex flex-col justify-center min-w-0">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <h4 className="font-medium text-foreground truncate">{whisp.videoTitle || t("dashboard.videoLinkFallback")}</h4>
                            <StatusBadge status={whisp.status} />
                          </div>
                          <div className="flex items-center text-sm text-muted-foreground mb-3">
                            <span className="truncate">
                              {t("dashboard.sentTo", {
                                destination:
                                  whisp.recipientEmail ||
                                  whisp.recipientPhone ||
                                  (whisp.deliveryMethod === "circle_drop" ? t("shared.blindCircleFeed") : t("shared.ghostBoostAudience")),
                              })}
                            </span>
                            <span className="mx-2">•</span>
                            <span>{new Date(whisp.createdAt).toLocaleDateString()}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            {whisp.moodTag ? <MoodTag mood={whisp.moodTag} className="scale-90 origin-left self-start" /> : <span />}
                            {whisp.videoPlatform !== "upload" && (
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
                ))
              ) : (
                <Card className="bg-card/50 border-dashed border-border py-12 text-center">
                  <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Send className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground mb-2">{t("dashboard.emptyState.title")}</h3>
                  <p className="text-muted-foreground max-w-md mx-auto mb-6">
                    {t("dashboard.emptyState.description")}
                  </p>
                  <Link href="/send">
                    <Button variant="outline" className="rounded-full">{t("dashboard.emptyState.cta")}</Button>
                  </Link>
                </Card>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {/* Cold-start growth nudge — self-contained, additive block, same
                reasoning as the Whisper Box/Recap cards below: Dashboard.tsx
                is shared with other in-flight work. Renders nothing once the
                account has sent its first Whisp or dismissed this card. */}
            <FirstWhispersOnboardingCta />

            {GHOST_BOOST_ENABLED && (
              <>
                <h2 className="text-xl font-serif font-semibold">{t("dashboard.ghostBoosts.title")}</h2>
                <Card className="bg-card border-border/50 relative overflow-hidden">
                  <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[60px] pointer-events-none" />
                  <CardContent className="p-6 text-center">
                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4 glow-card">
                      <Ghost className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-3xl font-bold text-foreground mb-1">{stats?.boostCredits || 0}</h3>
                    <p className="text-muted-foreground text-sm mb-6">{t("dashboard.ghostBoosts.creditsAvailable")}</p>

                    <p className="text-xs text-muted-foreground mb-6">
                      {t("dashboard.ghostBoosts.description")}
                    </p>

                    <Link href="/credits">
                      <Button variant="outline" className="w-full rounded-full border-primary/30 hover:bg-primary/10 hover:text-primary">
                        {t("dashboard.ghostBoosts.getMoreCredits")}
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </>
            )}

            <h2 className="text-xl font-serif font-semibold pt-2">{t("dashboard.suggestions.title")}</h2>
            <Card className="bg-card border-border/50 relative overflow-hidden" data-testid="card-suggestions-nudge">
              <CardContent className="p-6 space-y-4">
                {featuredSuggestion ? (
                  <>
                    <div className="flex gap-3 items-center">
                      {featuredSuggestion.videoThumbnail ? (
                        <Thumbnail src={featuredSuggestion.videoThumbnail} alt="thumbnail" className="w-16 h-12 object-cover rounded-lg shrink-0" />
                      ) : (
                        <div className="w-16 h-12 bg-muted rounded-lg flex items-center justify-center shrink-0">
                          <Sparkles className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <p className="text-sm font-medium text-foreground line-clamp-2">{featuredSuggestion.videoTitle || t("dashboard.suggestions.videoWorthSharing")}</p>
                    </div>
                    {featuredSuggestion.aiSummary && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{featuredSuggestion.aiSummary}</p>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1 rounded-full" onClick={() => setLocation("/suggestions")}>
                        {t("dashboard.suggestions.browseLibrary")}
                      </Button>
                      <Button className="flex-1 rounded-full" onClick={handleWhisperFeatured} data-testid="button-whisper-featured-suggestion">
                        {t("dashboard.suggestions.whisperThis")}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                      <Sparkles className="w-8 h-8 text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground text-center">
                      {t("dashboard.suggestions.description")}
                    </p>
                    <Link href="/suggestions">
                      <Button variant="outline" className="w-full rounded-full">{t("dashboard.suggestions.browse")}</Button>
                    </Link>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Recap CTA — points at the shareable "Wrapped"-style stats
                card (RecapPage); a self-contained, additive block on
                purpose since Dashboard.tsx is shared with other in-flight
                work. */}
            <h2 className="text-xl font-serif font-semibold pt-2">{t("dashboard.recap.title")}</h2>
            <Card className="bg-card border-border/50 relative overflow-hidden" data-testid="card-recap-nudge">
              <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-gilded/10 rounded-full blur-[60px] pointer-events-none" />
              <CardContent className="p-6 text-center">
                <div className="w-16 h-16 rounded-full bg-gilded/15 flex items-center justify-center mx-auto mb-4">
                  <PartyPopper className="w-8 h-8 text-gilded" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">{t("dashboard.recap.heading")}</h3>
                <p className="text-sm text-muted-foreground mb-6">{t("dashboard.recap.description")}</p>
                <Link href="/recap">
                  <Button variant="outline" className="w-full rounded-full" data-testid="button-see-recap">
                    {t("dashboard.recap.cta")}
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Whisper Box CTA — self-contained, additive block for the same
                reason the Recap one above is: Dashboard.tsx is shared with
                other in-flight work. */}
            <h2 className="text-xl font-serif font-semibold pt-2">{tWhisperBox("dashboardCard.title")}</h2>
            <Card className="bg-card border-border/50 relative overflow-hidden" data-testid="card-whisper-box-nudge">
              <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[60px] pointer-events-none" />
              <CardContent className="p-6 text-center">
                <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
                  <Mailbox className="w-8 h-8 text-primary" />
                </div>
                {!whisperBoxEnabled ? (
                  <>
                    <h3 className="text-lg font-medium text-foreground mb-2">{tWhisperBox("dashboardCard.getStartedTitle")}</h3>
                    <p className="text-sm text-muted-foreground mb-6">{tWhisperBox("dashboardCard.getStartedDescription")}</p>
                    <Link href="/settings">
                      <Button variant="outline" className="w-full rounded-full" data-testid="button-get-whisper-box">
                        {tWhisperBox("dashboardCard.getStartedCta")}
                      </Button>
                    </Link>
                  </>
                ) : whisperBoxUnreadCount > 0 ? (
                  <>
                    <h3 className="text-lg font-medium text-foreground mb-2">
                      {tWhisperBox("dashboardCard.unreadTitle", { count: whisperBoxUnreadCount })}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-6">{tWhisperBox("dashboardCard.unreadDescription")}</p>
                    <Link href="/whisper-box">
                      <Button className="w-full rounded-full" data-testid="button-view-whisper-box-inbox">
                        {tWhisperBox("dashboardCard.viewInboxCta")}
                      </Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-medium text-foreground mb-2">{tWhisperBox("dashboardCard.idleTitle")}</h3>
                    <p className="text-sm text-muted-foreground mb-6">{tWhisperBox("dashboardCard.idleDescription")}</p>
                    <Link href="/whisper-box">
                      <Button variant="outline" className="w-full rounded-full" data-testid="button-view-whisper-box-inbox">
                        {tWhisperBox("dashboardCard.viewInboxCta")}
                      </Button>
                    </Link>
                  </>
                )}
              </CardContent>
            </Card>
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
