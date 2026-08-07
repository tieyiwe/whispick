import { ReactNode } from "react";
import { Link } from "wouter";
import { Logo } from "@/components/ui/logo";
import { ArrowLeft } from "lucide-react";

export function LegalLayout({ title, updatedDate, children }: { title: string; updatedDate: string; children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background">
      <header
        className="border-b border-border/50 px-4 sm:px-6 py-4 flex items-center justify-between"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
      >
        <Link href="/" className="flex items-center gap-2">
          <Logo className="w-7 h-7 text-primary" />
          <span className="font-serif text-xl font-bold tracking-tight text-foreground">Blind Whisper</span>
        </Link>
        <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Home
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <h1 className="text-3xl sm:text-4xl font-serif font-bold text-foreground mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {updatedDate}</p>
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
