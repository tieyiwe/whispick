import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetMyAdminAccess } from "@workspace/api-client-react";
import { Logo } from "@/components/ui/logo";
import { APP_VERSION, APP_VERSION_NAME } from "@/lib/appVersion";
import { PullToRefresh, reloadPage } from "@/components/shared/PullToRefresh";
import {
  LayoutDashboard,
  Users,
  ListVideo,
  BarChart3,
  ArrowLeft,
  ShieldCheck,
  Sparkles,
  Bell,
  ShieldAlert,
  Megaphone,
  Video,
  ScrollText,
  Flag,
  FileCheck2,
  KeyRound,
  KanbanSquare,
  Bug,
} from "lucide-react";

// Odoo-style command-center navigation: one left rail, grouped by the job
// being done (run the business → protect the community → publish content →
// reach people → system record), rather than one long flat strip. The
// grouping is what makes the panel feel like a place to RUN the whole
// operation instead of a pile of pages. Mobile keeps a horizontal scroll
// strip of the same items — a rail doesn't fit a phone.
type NavItem = { href: string; label: string; icon: typeof Users; exact?: boolean; permission?: string; ownerOnly?: boolean };

const ADMIN_NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Business",
    items: [
      { href: "/admin_pro", label: "Overview", icon: LayoutDashboard, exact: true, permission: "analytics" },
      { href: "/admin_pro/analytics", label: "Analytics", icon: BarChart3, permission: "analytics" },
      { href: "/admin_pro/projects", label: "Projects", icon: KanbanSquare, permission: "projects" },
    ],
  },
  {
    heading: "Community",
    items: [
      { href: "/admin_pro/users", label: "Users", icon: Users, permission: "users" },
      { href: "/admin_pro/moderation", label: "Moderation", icon: ShieldAlert, permission: "moderation" },
      { href: "/admin_pro/reports", label: "Reports", icon: Flag, permission: "reports" },
    ],
  },
  {
    heading: "Content",
    items: [
      { href: "/admin_pro/whisps", label: "Whisps", icon: ListVideo, permission: "whisps" },
      { href: "/admin_pro/suggestions", label: "Suggestions", icon: Sparkles, permission: "suggestions" },
      { href: "/admin_pro/debate-agent", label: "Debado", icon: Megaphone, permission: "agents" },
      { href: "/admin_pro/circle-agent", label: "Circle Scout", icon: Video, permission: "agents" },
    ],
  },
  {
    heading: "Outreach",
    items: [
      { href: "/admin_pro/notifications", label: "Messages", icon: Bell, permission: "notifications" },
      { href: "/admin_pro/policies", label: "Policies", icon: FileCheck2, permission: "policies" },
    ],
  },
  {
    heading: "System",
    items: [
      { href: "/admin_pro/audit-log", label: "Audit Log", icon: ScrollText, permission: "audit_log" },
      { href: "/admin_pro/bug-rabbit", label: "BugRabbit", icon: Bug, permission: "bugrabbit" },
      { href: "/admin_pro/access", label: "Staff & Access", icon: KeyRound, ownerOnly: true },
    ],
  },
];

function isActivePath(location: string, item: { href: string; exact?: boolean }): boolean {
  return item.exact ? location === item.href : location === item.href || location.startsWith(item.href + "/");
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  // Collaborators only see the areas their grant covers (the backend
  // enforces regardless — this keeps the rail honest). Until the access
  // check answers, show everything rather than flashing an empty rail;
  // wrong guesses just 403 politely.
  const { data: access } = useGetMyAdminAccess();

  function canSee(item: NavItem): boolean {
    if (!access) return true;
    if (item.ownerOnly) return access.isOwner;
    if (!item.permission) return true;
    return access.isOwner || access.permissions.includes(item.permission);
  }

  const visibleGroups = ADMIN_NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter(canSee) }))
    .filter((g) => g.items.length > 0);
  const visibleItems = visibleGroups.flatMap((g) => g.items);

  // A collaborator without analytics lands on Overview by default — send
  // them to their first permitted area instead of a page of 403s.
  useEffect(() => {
    if (!access || access.isOwner) return;
    if (location === "/admin_pro" && !access.permissions.includes("analytics") && visibleItems.length > 0) {
      setLocation(visibleItems[0].href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, location]);

  // The palette class ALSO goes on <body> while any admin page is mounted:
  // Radix dialogs/selects/popovers portal to document.body, so a class on
  // this component's root alone would leave every overlay in the
  // member-facing violet — the HQ would break theme exactly when a dialog
  // opens. Cleaned up on unmount so the rest of the app never inherits it.
  useEffect(() => {
    document.body.classList.add("admin-theme");
    return () => document.body.classList.remove("admin-theme");
  }, []);

  return (
    // admin-theme scopes the HQ palette (index.css): charcoal + violet-grey
    // surfaces + matte yellow accent, without touching the member-facing app.
    // The shell is viewport-height with ONLY <main> scrolling — html/body carry
    // overflow-x:hidden (index.css), which defeats position:sticky, so a
    // sticky rail scrolled away with the page. An internally-scrolled main
    // keeps the header and rail genuinely static (PullToRefresh already
    // supports internally-scrolled containers — it walks ancestor scrollTop).
    <div className="admin-theme relative h-[100dvh] bg-background text-foreground flex flex-col overflow-hidden">
      {/* Ambient depth for the HQ shell — same two-blob treatment AppLayout
          uses for the member-facing app, so the admin surface isn't flatter
          than the app it's managing. Colors resolve against admin-theme's
          own palette (matte yellow --primary, violet-grey --secondary
          above), not the member app's, since this div is inside the
          .admin-theme scope. Flex items paint in tree order regardless of
          position (CSS Flexbox painting rules), so simply listing these
          first among the root's flex children is what keeps them behind
          the header/rail/main — no z-index juggling needed. */}
      <div className="absolute top-[-12%] left-[-8%] w-[45%] h-[35%] rounded-full blur-[110px] pointer-events-none bg-primary/5" />
      <div className="absolute bottom-[-15%] right-[-10%] w-[40%] h-[35%] rounded-full blur-[100px] pointer-events-none bg-secondary/10" />
      <header
        className="border-b border-border bg-card z-40 shrink-0"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo className="h-8 w-auto shrink-0 text-primary" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-serif text-lg sm:text-xl font-bold text-foreground tracking-tight truncate">
                Blind Whisper
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md bg-primary text-primary-foreground">
                <ShieldCheck className="w-3 h-3" /> HQ
              </span>
              <span className="hidden sm:inline text-[11px] text-muted-foreground/60 shrink-0" data-testid="text-app-version">
                v{APP_VERSION} · {APP_VERSION_NAME}
              </span>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 py-2 shrink-0"
            data-testid="link-exit-admin"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Exit to app
          </Link>
        </div>

        {/* Mobile: the same nav as a flat scroll strip under the top bar. */}
        <nav className="md:hidden px-3 flex gap-1 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleItems.map((item) => {
            const active = isActivePath(location, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`admin-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="w-4 h-4" /> {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Desktop rail — grouped, Odoo-style. */}
        <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-card/60 px-3 py-5 gap-5 overflow-y-auto">
          {visibleGroups.map((group) => (
            <div key={group.heading} className="space-y-1">
              <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {group.heading}
              </p>
              {group.items.map((item) => {
                const active = isActivePath(location, item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-testid={`admin-rail-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? "bg-primary text-primary-foreground shadow-[0_1px_8px_rgba(0,0,0,0.35)]"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" /> {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          {/* Same swipe-down refresh the rest of the app has, so the gesture
              doesn't silently stop working the moment you cross into admin. */}
          <PullToRefresh onRefresh={reloadPage}>
            <div className="max-w-6xl mx-auto p-4 md:p-8">{children}</div>
          </PullToRefresh>
        </main>
      </div>
    </div>
  );
}
