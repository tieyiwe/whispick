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
        className="border-b border-border/50 px-4 sm:px-6 py-4 flex items-center justify-between"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
      >
        <Link href="/">
          <LogoLockup />
        </Link>
        <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> {t("legalLayout.home")}
        </Link>
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
