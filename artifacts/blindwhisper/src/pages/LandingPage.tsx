import { useEffect } from "react";
import { Link } from "wouter";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LogoLockup } from "@/components/ui/logo";
import { MoodTag } from "@/components/shared/MoodTag";
import { FAQ_ITEMS } from "@/lib/faqContent";
import { InstallAppPrompt } from "@/components/shared/InstallAppPrompt";
import { guessBrowserLanguage } from "@/lib/languages";
import { APP_VERSION, APP_VERSION_NAME } from "@/lib/appVersion";
import i18n from "@/i18n";
import { Send, Heart, Shield, Sparkles, PlayCircle, Users2, Users, Briefcase, UserRound, X, Check, ChevronDown, CheckCircle2 } from "lucide-react";
import { AnonymousMark } from "@/components/shared/AnonymousMark";

// icon/mood are presentational and stay static here; the relationship/quote
// copy for each card is looked up via `key` against
// landingPage.useCases.items.<key>.* in the publicPages namespace so it
// re-renders in the right language as i18next's active language changes.
const USE_CASES = [
  { key: "parent", icon: Users2, mood: "for-your-growth" },
  { key: "friend", icon: Users, mood: "heal-together" },
  { key: "partner", icon: Heart, mood: "i-see-you" },
  { key: "colleague", icon: Briefcase, mood: "think-about-this" },
  { key: "sibling", icon: UserRound, mood: "i-love-you" },
];

function MiniWhispPreview({ mood, className = "" }: { mood: string; className?: string }) {
  const { t } = useTranslation("publicPages");

  return (
    <div className={`rounded-2xl bg-background/60 border border-border/50 p-3 flex items-center gap-3 ${className}`}>
      <div className="w-14 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <PlayCircle className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <MoodTag mood={mood} className="scale-90 origin-left" />
        <p className="text-[11px] text-muted-foreground mt-1">{t("landingPage.useCases.previewCaption")}</p>
      </div>
    </div>
  );
}

export function LandingPage() {
  const { t } = useTranslation("publicPages");

  // A visitor here has no account and no saved language preference yet —
  // AppLayout's "sync to profile.preferredLanguage" effect never runs for
  // this page, since it only mounts inside AppLayout for signed-in users.
  // So this page instead initializes the displayed language straight from
  // the browser's own setting, same guess DemographicsGateDialog uses for
  // pre-selecting the onboarding language picker.
  useEffect(() => {
    void i18n.changeLanguage(guessBrowserLanguage());
  }, []);

  const FEATURES = [
    {
      icon: Shield,
      title: t("landingPage.features.anonymous.title"),
      desc: t("landingPage.features.anonymous.desc"),
    },
    {
      icon: Heart,
      title: t("landingPage.features.resonant.title"),
      desc: t("landingPage.features.resonant.desc"),
    },
    {
      icon: Send,
      title: t("landingPage.features.delivery.title"),
      desc: t("landingPage.features.delivery.desc"),
    },
  ];

  const HOW_IT_WORKS_STEPS = [
    { src: "/screenshots/send-step1-link.png", step: "1", title: t("landingPage.howItWorks.steps.paste.title"), desc: t("landingPage.howItWorks.steps.paste.desc") },
    { src: "/screenshots/send-step2-note.png", step: "2", title: t("landingPage.howItWorks.steps.note.title"), desc: t("landingPage.howItWorks.steps.note.desc") },
    { src: "/screenshots/send-step3-sent.png", step: "3", title: t("landingPage.howItWorks.steps.sent.title"), desc: t("landingPage.howItWorks.steps.sent.desc") },
  ];

  return (
    <div className="bg-background relative">
      <header
        className="absolute top-0 w-full px-4 sm:px-6 pb-4 sm:pb-6 flex justify-between items-center z-10 gap-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
      >
        <a href="/" className="hover:opacity-80 transition-opacity">
          <LogoLockup />
        </a>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <Link href="/sign-in">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground rounded-full px-3 sm:px-4">
              {t("landingPage.header.signIn")}
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm" className="rounded-full shadow-[0_0_20px_rgba(124,92,252,0.3)] hover:shadow-[0_0_30px_rgba(124,92,252,0.5)] transition-all px-3 sm:px-4">
              {t("landingPage.header.getStarted")}
            </Button>
          </Link>
        </div>
      </header>

      <main className="relative overflow-hidden">
        {/* Hero */}
        <section className="relative flex flex-col items-center justify-center min-h-[100dvh] px-4 text-center pt-24 sm:pt-20">
          {/* Background elements — scoped to the hero section only (not the
              whole, much taller page) so the browser only ever has to paint
              these expensive blur layers for one screen's worth of scroll,
              instead of stretching/repainting them across the entire page. */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-secondary/10 rounded-full blur-[100px] pointer-events-none" />

          <div className="max-w-3xl space-y-8 relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-medium mb-4 glow-card">
              <Sparkles className="w-4 h-4" />
              <span>{t("landingPage.hero.badge")}</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-serif font-bold text-foreground leading-[1.1] tracking-tight">
              <Trans
                t={t}
                i18nKey="landingPage.hero.headline"
                components={{ em: <span className="text-primary italic" />, br: <br /> }}
              />
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {t("landingPage.hero.subtitle")}
            </p>

            <div className="pt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/sign-up">
                <Button size="lg" className="rounded-full h-14 px-8 text-lg font-medium shadow-[0_0_24px_rgba(124,92,252,0.4)] hover:shadow-[0_0_40px_rgba(124,92,252,0.6)] transition-all">
                  <Send className="w-5 h-5 mr-2" /> {t("landingPage.cta.startSendingWhisps")}
                </Button>
              </Link>
            </div>
          </div>

          {/* Hero visual — a small looping "what this actually does" cue for
              a visitor who hasn't scrolled to the screenshot-driven "See it
              in action" section yet. Three panels cross-fade on a shared,
              staggered CSS animation (.hero-flow-panel in index.css), no JS
              timer — same technique as an auto-rotating testimonial strip.
              Reuses AnonymousMark (the app's own logo mark standing in for
              "no identity") and the Whisper Box page's traveling-dot
              connector, so this tells the same "anonymous, until you choose
              otherwise" story using vocabulary already established
              elsewhere in the product. Respects prefers-reduced-motion by
              freezing on the first panel. */}
          <div className="mt-16 sm:mt-20 relative z-10 w-full max-w-sm mx-auto px-4">
            <div className="relative h-56 rounded-3xl border border-border/60 bg-card/50 backdrop-blur overflow-hidden shadow-[0_0_40px_rgba(124,92,252,0.15)]">
              <div className="hero-flow-panel absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
                <div className="flex items-center gap-3">
                  <AnonymousMark size="lg" pulse />
                  <div className="w-14 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <PlayCircle className="w-5 h-5 text-muted-foreground" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t("landingPage.hero.flow.slide1Title")}</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">{t("landingPage.hero.flow.slide1Desc")}</p>
                </div>
              </div>

              <div className="hero-flow-panel absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ animationDelay: "3.4s" }}>
                <div className="flex items-center gap-2 sm:gap-3">
                  <AnonymousMark size="lg" pulse />
                  <div className="relative w-14 h-px bg-border/60 shrink-0">
                    <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary whisper-flow-dot" />
                  </div>
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Heart className="w-6 h-6 text-primary" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t("landingPage.hero.flow.slide2Title")}</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">{t("landingPage.hero.flow.slide2Desc")}</p>
                </div>
              </div>

              <div className="hero-flow-panel absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ animationDelay: "6.8s" }}>
                <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t("landingPage.hero.flow.slide3Title")}</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">{t("landingPage.hero.flow.slide3Desc")}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto px-4 relative z-10">
            {FEATURES.map((feature, i) => (
              <div key={i} className="p-8 rounded-3xl bg-card/40 border border-border backdrop-blur hover:bg-card/60 transition-colors">
                <feature.icon className="w-10 h-10 text-primary mb-6" />
                {/* h2, not h3: these three cards sit directly under the
                    page's single h1 with no section h2 of their own, so h3
                    here would skip a heading level. */}
                <h2 className="text-xl font-serif font-semibold mb-3">{feature.title}</h2>
                <p className="text-muted-foreground">{feature.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* See it in action */}
        <section className="relative z-10 px-4 py-20 sm:py-28">
          <div className="max-w-2xl mx-auto text-center space-y-4 mb-14">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-foreground">
              {t("landingPage.howItWorks.heading")}
            </h2>
            <p className="text-muted-foreground text-lg">
              {t("landingPage.howItWorks.subheading")}
            </p>
          </div>

          <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6">
            {HOW_IT_WORKS_STEPS.map((shot) => (
              <div key={shot.step} className="flex flex-col items-center text-center">
                <div className="rounded-[2rem] border border-border/60 bg-card/40 shadow-[0_0_30px_rgba(124,92,252,0.12)] overflow-hidden w-full max-w-[220px]">
                  <img src={shot.src} alt={shot.title} className="w-full h-auto block" loading="lazy" width={390} height={844} />
                </div>
                <div className="mt-5 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-semibold flex items-center justify-center shrink-0">{shot.step}</span>
                  <h3 className="text-sm font-semibold text-foreground">{shot.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 max-w-[220px]">{shot.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* No more awkwardness */}
        <section className="relative z-10 px-4 py-24 sm:py-32">
          <div className="max-w-4xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              <span>{t("landingPage.noAwkwardness.badge")}</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-serif font-bold text-foreground leading-tight">
              <Trans
                t={t}
                i18nKey="landingPage.noAwkwardness.heading"
                components={{ em: <span className="text-primary italic" /> }}
              />
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              <Trans t={t} i18nKey="landingPage.noAwkwardness.body" components={{ em: <em /> }} />
            </p>
          </div>

          <div className="max-w-3xl mx-auto mt-16 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-6 rounded-2xl bg-card/30 border border-border/50">
              <div className="flex items-center gap-2 mb-3 text-muted-foreground">
                <X className="w-4 h-4" />
                <span className="text-sm font-medium">{t("landingPage.noAwkwardness.before.label")}</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("landingPage.noAwkwardness.before.desc")}
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-primary/10 border border-primary/30">
              <div className="flex items-center gap-2 mb-3 text-primary">
                <Check className="w-4 h-4" />
                <span className="text-sm font-medium">{t("landingPage.noAwkwardness.after.label")}</span>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed">
                {t("landingPage.noAwkwardness.after.desc")}
              </p>
            </div>
          </div>
        </section>

        {/* Use cases / illustrative scenarios */}
        <section className="relative z-10 px-4 py-24 sm:py-32 bg-card/20">
          <div className="max-w-2xl mx-auto text-center space-y-4 mb-16">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-foreground">
              {t("landingPage.useCases.heading")}
            </h2>
            <p className="text-muted-foreground text-lg">
              {t("landingPage.useCases.subheading")}
            </p>
          </div>

          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
            {USE_CASES.map((useCase, i) => (
              <div
                key={useCase.key}
                className={`p-6 sm:p-7 rounded-3xl bg-card/50 border border-border backdrop-blur space-y-4 ${
                  i === USE_CASES.length - 1 && USE_CASES.length % 2 !== 0 ? "md:col-span-2 md:max-w-xl md:mx-auto" : ""
                }`}
              >
                <div className="flex items-center gap-2 text-primary">
                  <useCase.icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{t(`landingPage.useCases.items.${useCase.key}.relationship`)}</span>
                </div>
                <p className="text-foreground/90 leading-relaxed italic">"{t(`landingPage.useCases.items.${useCase.key}.quote`)}"</p>
                <MiniWhispPreview mood={useCase.mood} />
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-10 max-w-lg mx-auto">
            {t("landingPage.useCases.disclaimer")}
          </p>
        </section>

        {/* FAQ */}
        <section className="relative z-10 px-4 py-24 sm:py-32">
          <div className="max-w-2xl mx-auto text-center space-y-4 mb-14">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-foreground">
              {t("landingPage.faq.heading")}
            </h2>
            <p className="text-muted-foreground text-lg">
              {t("landingPage.faq.subheading")}
            </p>
          </div>

          {/* Plain <details>/<summary> instead of the Radix accordion
              primitive: browsers keep a closed <details>'s content in the
              DOM at all times (just CSS-hidden), so the full answer text is
              always present for crawlers and in the prerendered HTML — no
              JS, no lazy-render-on-click, and no risk of a Presence/forceMount
              edge case silently dropping collapsed answers from the markup.

              FAQ_ITEMS itself comes from src/lib/faqContent.ts, a separate
              file mirrored into prerendered structured data — it's outside
              this namespace's extraction and stays English-only for now. */}
          <div className="max-w-2xl mx-auto divide-y divide-border">
            {FAQ_ITEMS.map((item, i) => (
              <details key={i} className="group py-4">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none text-left text-base font-serif font-semibold text-foreground hover:text-primary transition-colors [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-muted-foreground leading-relaxed">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="relative z-10 px-4 py-24 sm:py-32 text-center">
          <div className="max-w-2xl mx-auto space-y-6">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-foreground">
              {t("landingPage.closingCta.heading")}
            </h2>
            <p className="text-muted-foreground text-lg">
              {t("landingPage.closingCta.body")}
            </p>
            <div className="pt-4">
              <Link href="/sign-up">
                <Button size="lg" className="rounded-full h-14 px-8 text-lg font-medium shadow-[0_0_24px_rgba(124,92,252,0.4)] hover:shadow-[0_0_40px_rgba(124,92,252,0.6)] transition-all">
                  <Send className="w-5 h-5 mr-2" /> {t("landingPage.cta.startSendingWhisps")}
                </Button>
              </Link>
            </div>
            <p className="text-sm text-muted-foreground pt-2">
              {t("landingPage.closingCta.notReadyPrefix")}{" "}
              <Link href="/subscribe" className="text-primary hover:underline font-medium">
                {t("landingPage.closingCta.notReadyLink")}
              </Link>
            </p>
          </div>
        </section>
      </main>

      <footer className="relative z-10 pb-8 flex flex-col items-center gap-2 text-xs text-muted-foreground">
        <div className="flex justify-center gap-4">
          <Link href="/privacy" className="hover:text-primary transition-colors">{t("landingPage.footer.privacyPolicy")}</Link>
          <span className="text-border">•</span>
          <Link href="/terms" className="hover:text-primary transition-colors">{t("landingPage.footer.termsOfService")}</Link>
          <span className="text-border">•</span>
          <Link href="/sms-terms" className="hover:text-primary transition-colors">{t("landingPage.footer.smsTerms")}</Link>
        </div>
        <p className="text-[11px] text-muted-foreground/60" data-testid="text-app-version">v{APP_VERSION} · {APP_VERSION_NAME}</p>
      </footer>

      {/* This is a signed-out visitor's only chance to see an install nudge
          outside of AppLayout (see InstallAppPrompt's own docs) — someone who
          already has the app, or a returning user browsing signed out, lands
          here rather than mid-task inside the product. */}
      <InstallAppPrompt />
    </div>
  );
}
