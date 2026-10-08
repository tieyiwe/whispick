import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LogoLockup } from "@/components/ui/logo";

// One public header for every signed-out marketing surface (landing,
// /how-it-works and the other explainer pages) so the logo, the key links,
// "Sign In" and "Get Started" look and read the same wherever a visitor
// lands from search.
//
// Must stay renderable without browser APIs — scripts/prerender.mjs renders
// LandingPage and MarketingPage under Node at build time. It also must NOT
// import lib/marketingPages: LandingPage is in the eager main bundle, and
// App.tsx deliberately keeps the explainer copy out of it, so the nav labels
// come from i18n instead.

const NAV_LINKS = [
  { href: "/how-it-works", key: "publicHeader.nav.howItWorks" },
  { href: "/anonymous-message-link", key: "publicHeader.nav.whisperBox" },
  { href: "/anonymous-debates", key: "publicHeader.nav.debateNow" },
  { href: "/safety", key: "publicHeader.nav.safety" },
] as const;

export function PublicHeader({
  overlay = false,
  activePath,
}: {
  /** Transparent and absolutely positioned over a hero (landing page),
   *  instead of the bordered, blurred bar the explainer pages use. */
  overlay?: boolean;
  /** Highlights the matching nav link. */
  activePath?: string;
}) {
  const { t } = useTranslation("publicPages");

  return (
    <header
      className={
        overlay
          ? "absolute inset-x-0 top-0 z-20"
          : "relative z-20 border-b border-border/40 bg-background/70 backdrop-blur"
      }
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 max-[399px]:gap-2 max-[399px]:px-3 sm:h-[72px] sm:px-6">
        <Link
          href="/"
          className="min-w-0 shrink transition-opacity hover:opacity-80"
          aria-label={t("publicHeader.homeAria")}
        >
          {/* The compact lockup on phones leaves room for both auth buttons
              without truncating the wordmark. */}
          <span className="sm:hidden"><LogoLockup size="sm" /></span>
          <span className="hidden sm:block"><LogoLockup /></span>
        </Link>

        <nav aria-label={t("publicHeader.navAria")} className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => {
            const active = activePath === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-2 text-sm transition-colors hover:text-foreground ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {t(link.key)}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Button
            asChild
            variant="ghost"
            className="h-11 rounded-full px-2.5 text-sm text-muted-foreground hover:text-foreground max-[399px]:px-2 sm:h-10 sm:px-4"
          >
            <Link href="/sign-in">{t("landingPage.header.signIn")}</Link>
          </Button>
          {/* Tighter padding below 400px (360px Android phones): at the normal
              spacing the two buttons squeezed the wordmark to "Blind Whi…". */}
          <Button asChild className="h-11 rounded-full px-4 text-sm max-[399px]:px-3 sm:h-10 sm:px-5">
            <Link href="/sign-up">{t("landingPage.header.getStarted")}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
