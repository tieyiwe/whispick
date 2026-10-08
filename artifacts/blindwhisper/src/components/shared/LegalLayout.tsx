import { ReactNode } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { LogoLockup } from "@/components/ui/logo";
import { ArrowLeft } from "lucide-react";

export function LegalLayout({ title, updatedDate, children }: { title: string; updatedDate: string; children: ReactNode }) {
  const { t } = useTranslation("sharedB");

  return (
    <div className="min-h-[100dvh] bg-background">
      <header
        className="border-b border-border/40 bg-background/70 backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {/* Same container and height as PublicHeader, so moving between the
            landing/explainer pages and these legal pages doesn't jump. */}
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:h-[72px] sm:px-6">
          <Link href="/" className="min-w-0 transition-opacity hover:opacity-80">
            <LogoLockup />
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" /> {t("legalLayout.home")}
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <h1 className="text-3xl sm:text-4xl font-serif font-bold text-foreground mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground mb-10">{t("legalLayout.lastUpdated", { date: updatedDate })}</p>
        <div className="legal-content space-y-6 text-foreground/90 leading-relaxed">{children}</div>
      </main>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-serif font-semibold text-foreground pt-2">{heading}</h2>
      <div className="space-y-3 text-sm sm:text-base">{children}</div>
    </section>
  );
}
