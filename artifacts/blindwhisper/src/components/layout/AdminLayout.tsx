import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/ui/logo";
import { PullToRefresh, reloadPage } from "@/components/shared/PullToRefresh";
import { LayoutDashboard, Users, ListVideo, BarChart3, ArrowLeft, ShieldCheck, Sparkles, Bell, ShieldAlert, Megaphone, Video, ScrollText } from "lucide-react";

const ADMIN_NAV_ITEMS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/whisps", label: "Content", icon: ListVideo },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
  { href: "/admin/suggestions", label: "Suggestions", icon: Sparkles },
  { href: "/admin/debate-agent", label: "Town Crier", icon: Megaphone },
  { href: "/admin/circle-agent", label: "Circle Scout", icon: Video },
  { href: "/admin/notifications", label: "Notifications", icon: Bell },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <header
        className="border-b border-border bg-card/50 backdrop-blur-xl sticky top-0 z-40"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          {/* Keeps its own composition rather than using LogoLockup: the
              Admin pill has to sit beside the wordmark, not below it. */}
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo className="h-9 w-auto sm:h-10 shrink-0 text-primary" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-serif text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
                Blind Whisper
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                <ShieldCheck className="w-3 h-3" /> Admin
              </span>
            </div>
          </div>
          <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 py-2" data-testid="link-exit-admin">
            <ArrowLeft className="w-3.5 h-3.5" /> Exit to app
          </Link>
        </div>
        <nav className="max-w-6xl mx-auto px-4 md:px-8 flex gap-1 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ADMIN_NAV_ITEMS.map((item) => {
            const isActive = item.exact ? location === item.href : location === item.href || location.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`admin-nav-${item.label.toLowerCase()}`}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                  isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-card"
                }`}
              >
                <Icon className="w-4 h-4" /> {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="flex-1">
        {/* Same swipe-down refresh the rest of the app has, so the gesture
            doesn't silently stop working the moment you cross into admin. */}
        <PullToRefresh onRefresh={reloadPage}>
          <div className="max-w-6xl mx-auto p-4 md:p-8">{children}</div>
        </PullToRefresh>
      </main>
    </div>
  );
}
