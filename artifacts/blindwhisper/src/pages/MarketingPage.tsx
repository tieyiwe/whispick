import { useLocation, Link } from "wouter";
import { ArrowRight, Check, ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { PublicHeader } from "@/components/shared/PublicHeader";
import { MARKETING_PAGES, getMarketingPage, type MarketingPageDef } from "@/lib/marketingPages";
import { APP_VERSION } from "@/lib/appVersion";

// Public, indexable explainer pages (how it works, Whisper Box, Debate Now,
// safety, ideas, about, FAQ). Content lives in lib/marketingPages.ts, which
// scripts/prerender.mjs also reads to emit static HTML, JSON-LD, the sitemap
// and llms.txt — so this component only does layout. It must render without
// any browser APIs or data fetching: the prerenderer runs it under Node.
//
// Plain <a> (not wouter's <Link>) for any href the SPA doesn't own — /dt is
// served by the API server (crawler pages + redirect), so client-side
// navigation there would land on a route the app doesn't have.
const SPA_OWNED = (href: string) => !href.startsWith("/dt");

// Forwards any extra props (Button's asChild <Slot> merges className and
// handlers into its child) onto whichever anchor it renders.
function SmartLink({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return SPA_OWNED(href) ? (
    <Link href={href} {...rest}>
      {children}
    </Link>
  ) : (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

function formatUpdated(iso: string): string {
  // Fixed format, no Intl/locale lookups, so server and client render the
  // same string (and the prerendered HTML matches what React hydrates to).
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[(m ?? 1) - 1]} ${d}, ${y}`;
}

export function MarketingPage() {
  const [location] = useLocation();
  const page = getMarketingPage(location);
  if (!page) return null;
  return <MarketingPageView page={page} />;
}

function MarketingPageView({ page }: { page: MarketingPageDef }) {
  const { t } = useTranslation("publicPages");
  const related = page.related.map((p) => getMarketingPage(p)).filter((p): p is MarketingPageDef => !!p);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background">
      <div className="pointer-events-none absolute -top-[10%] left-1/2 h-[480px] w-[900px] max-w-[140%] -translate-x-1/2 rounded-full bg-primary/15 blur-[130px]" />
      <div className="pointer-events-none absolute top-[40%] -right-[15%] h-[380px] w-[520px] rounded-full bg-secondary/10 blur-[120px]" />

      <PublicHeader activePath={page.path} />

      <main data-marketing-path={page.path} className="relative z-10 mx-auto max-w-3xl px-4 pb-20 pt-12 sm:px-6 sm:pt-16">
        <nav aria-label={t("marketingPage.breadcrumbAria")} className="mb-6 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">{t("marketingPage.home")}</Link>
          <span className="mx-2 opacity-50">/</span>
          <span className="text-foreground/80">{page.navLabel}</span>
        </nav>

        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5" /> {page.eyebrow}
        </span>
        <h1 className="mt-5 font-serif text-4xl font-bold leading-[1.1] text-foreground sm:text-5xl">{page.h1}</h1>
        <p className="mt-6 text-lg leading-relaxed text-foreground/85">{page.intro}</p>
        <p className="mt-4 text-xs text-muted-foreground">
          {t("marketingPage.lastUpdated")} <time dateTime={page.updated}>{formatUpdated(page.updated)}</time>
        </p>

        <div className="mt-12 space-y-14">
          {page.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl">{section.heading}</h2>

              {section.paragraphs?.map((para, i) => (
                <p key={i} className="mt-4 leading-relaxed text-foreground/80">
                  {para}
                </p>
              ))}

              {section.steps && (
                <ol className="mt-6 grid gap-3 sm:grid-cols-2">
                  {section.steps.map((step, i) => (
                    <li key={step.name} className="rounded-2xl border border-border/50 bg-card/70 p-5 backdrop-blur">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                          {i + 1}
                        </span>
                        <h3 className="font-medium text-foreground">{step.name}</h3>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
                    </li>
                  ))}
                </ol>
              )}

              {section.bullets && (
                <ul className="mt-5 space-y-3">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3 leading-relaxed text-foreground/80">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-primary" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {page.faqs && page.faqs.length > 0 && (
            <section>
              <h2 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl">
                {page.sections.length ? t("marketingPage.commonQuestions") : t("marketingPage.questionsAndAnswers")}
              </h2>
              <div className="mt-5 divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/50 bg-card/60">
                {page.faqs.map((faq) => (
                  // Native <details>: works with zero JavaScript, so the
                  // answers are fully present in the prerendered HTML.
                  <details key={faq.question} className="group px-5 py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-foreground [&::-webkit-details-marker]:hidden">
                      <h3 className="text-base">{faq.question}</h3>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{faq.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}
        </div>

        <section className="relative mt-16 overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/20 via-card to-card p-8 text-center glow-card sm:p-10">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/30 blur-[70px]" />
          <h2 className="relative font-serif text-2xl font-semibold text-foreground sm:text-3xl">{page.cta.heading}</h2>
          <p className="relative mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{page.cta.body}</p>
          <Button asChild size="lg" className="relative mt-6 h-12 rounded-full px-8 text-base shadow-[0_0_28px_rgba(124,92,252,0.4)]">
            <SmartLink href={page.cta.href}>
              {page.cta.label} <ArrowRight className="ml-2 h-4 w-4 rtl:-scale-x-100" />
            </SmartLink>
          </Button>
        </section>

        {related.length > 0 && (
          <section className="mt-16">
            <h2 className="font-sans text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("marketingPage.keepReading")}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {related.map((r) => (
                <SmartLink
                  key={r.path}
                  href={r.path}
                  className="group rounded-2xl border border-border/50 bg-card/60 p-5 transition-colors hover:border-primary/40"
                >
                  <p className="font-medium text-foreground group-hover:text-primary">{r.h1}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.description}</p>
                </SmartLink>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="relative z-10 border-t border-border/40">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2.5rem)" }}>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground [&>a]:py-1.5">
            {MARKETING_PAGES.map((p) => (
              <SmartLink key={p.path} href={p.path} className="transition-colors hover:text-foreground">
                {p.navLabel}
              </SmartLink>
            ))}
            <a href="/dt" className="transition-colors hover:text-foreground">{t("landingPage.footer.liveDebates")}</a>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground [&>a]:py-1">
            <Link href="/privacy" className="hover:text-foreground">{t("landingPage.footer.privacyPolicy")}</Link>
            <Link href="/terms" className="hover:text-foreground">{t("landingPage.footer.termsOfService")}</Link>
            <Link href="/community-guidelines" className="hover:text-foreground">{t("marketingPage.communityGuidelines")}</Link>
          </div>
          <p className="mt-6 text-xs text-muted-foreground/70 tabular-nums">
            {t("marketingPage.serviceOf", { version: APP_VERSION })}
          </p>
        </div>
      </footer>
    </div>
  );
}
