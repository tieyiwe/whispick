import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LogoLockup } from "@/components/ui/logo";
import { useUser, useClerk } from "@clerk/react";
import { useGetUserProfile, useGetMyUnreadNotificationCount, getGetMyUnreadNotificationCountQueryKey } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  Send,
  ListVideo,
  Users,
  UsersRound,
  Lock,
  MessageSquareHeart,
  CreditCard,
  Settings,
  ShieldCheck,
  LogOut,
  Clapperboard,
  Sparkles,
  UserPlus,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { PullToRefresh, reloadPage } from "@/components/shared/PullToRefresh";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/send", label: "Send Whisp", icon: Send },
  { href: "/whisps", label: "My Whisps", icon: ListVideo },
  { href: "/text-whisps", label: "Text Whisps", icon: ScrollText },
  { href: "/suggestions", label: "Suggestions", icon: Sparkles },
  { href: "/circle", label: "Blind Circle", icon: Users },
  { href: "/circles", label: "My Blind Circles", icon: Lock },
  { href: "/whisper-groups", label: "Whisper Groups", icon: UsersRound },
  { href: "/media-library", label: "Media Library", icon: Clapperboard },
  { href: "/replies", label: "Replies", icon: MessageSquareHeart },
  { href: "/invite", label: "Invite a Friend", icon: UserPlus },
  { href: "/credits", label: "Credits & Plan", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

const MOBILE_TAB_ITEMS_LEFT = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/whisps", label: "Whisps", icon: ListVideo },
];

const MOBILE_TAB_ITEMS_RIGHT = [
  { href: "/circle", label: "Blind Circle", icon: Users },
  { href: "/replies", label: "Replies", icon: MessageSquareHeart },
];

function MobileTabLink({
  href,
  label,
  icon: Icon,
  isActive,
  badgeCount = 0,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  isActive: boolean;
  badgeCount?: number;
}) {
  return (
    <Link
      href={href}
      className={`relative flex flex-col items-center justify-center gap-0.5 min-w-11 min-h-11 px-2 py-1.5 rounded-xl transition-colors ${
        isActive ? "text-primary" : "text-muted-foreground"
      }`}
    >
      <div className="relative">
        <Icon className="w-6 h-6" />
        {badgeCount > 0 && (
          <span
            className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground flex items-center justify-center"
            data-testid={`badge-mobile-${label.toLowerCase()}`}
          >
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </div>
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </Link>
  );
}

// Top-right account dropdown — Settings + Sign Out, reachable from the same
// avatar in both the mobile header and the desktop sidebar's top bar. Fixes
// two real gaps: on mobile, the avatar previously just linked straight to
// /settings with no sign-out anywhere in reach (the desktop sidebar's own
// account block at the bottom is `hidden md:flex`, invisible on mobile); on
// desktop, there was no account control in the top-right corner at all —
// only at the very bottom of the sidebar. This doesn't replace that bottom
// block (it still works and stays), it just gives both layouts a working,
// consistently-placed account menu where people actually expect one.
function AccountMenu({
  avatarClassName = "w-8 h-8 border border-border",
  triggerClassName = "",
}: {
  avatarClassName?: string;
  triggerClassName?: string;
}) {
  const { user } = useUser();
  const { signOut } = useClerk();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring ${triggerClassName}`}
        data-testid="button-account-menu"
      >
        <Avatar className={avatarClassName}>
          <AvatarImage src={user?.imageUrl} />
          <AvatarFallback className="text-xs">{user?.firstName?.charAt(0) || "U"}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="text-sm font-medium text-foreground truncate">{user?.fullName}</p>
          <p className="text-xs font-normal text-muted-foreground truncate">{user?.primaryEmailAddress?.emailAddress}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer" data-testid="link-account-menu-settings">
            <Settings className="w-4 h-4 mr-2" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => signOut({ redirectUrl: "/" })}
          className="cursor-pointer text-destructive focus:text-destructive"
          data-testid="button-account-menu-signout"
        >
          <LogOut className="w-4 h-4 mr-2" /> Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { data: profile } = useGetUserProfile();
  const isAdmin = profile?.role === "admin";

  // Drives the Replies badge. Polled (no websockets anywhere in this app —
  // see NotificationBell's note) on the same 60s cadence as the bell, so a
  // reply that lands while the sender is using the app surfaces on its own
  // rather than only on a manual reload. Counts unread REPLY notifications
  // specifically, not every unread notification.
  const { data: unread } = useGetMyUnreadNotificationCount({
    query: {
      queryKey: getGetMyUnreadNotificationCountQueryKey(),
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
  });
  const unreadReplyCount = unread?.unreadReplyCount ?? 0;

  const navItems = isAdmin
    ? [...NAV_ITEMS, { href: "/admin", label: "Admin", icon: ShieldCheck }]
    : NAV_ITEMS;

  return (
    // The shell is exactly one viewport tall and clips; <main> inside it does
    // all the scrolling. Both the desktop sidebar and the mobile header were
    // marked `sticky top-0` and both still scrolled away with the content,
    // because index.css sets `overflow-x: hidden` on html AND body — and an
    // element with overflow-x hidden and overflow-y visible computes overflow-y
    // to auto, which makes it a scroll container and changes what `sticky`
    // resolves against. Measured: a sticky header moves -2607px during a
    // 2607px scroll under those two rules, i.e. it barely sticks at all.
    //
    // Dropping the html rule restores sticky but reinstates what it guards —
    // a single over-wide element then drags the document to a 3000px
    // scrollWidth and gives mobile a horizontal scrollbar. So both rules stay
    // and nothing here relies on sticky: owning the scroll region outright
    // pins the sidebar and the header by construction.
    //
    // 100dvh, not 100vh, so the shell tracks mobile browser chrome showing and
    // hiding instead of running under it. PullToRefresh checks its ancestors
    // for a scrolled container (not just window.scrollY), which is what keeps
    // the swipe-down gesture working now that the window never scrolls.
    <div className="h-[100dvh] overflow-hidden bg-background flex flex-col md:flex-row">
      <aside className="w-full md:w-64 border-r border-border bg-card/50 backdrop-blur-xl flex-col hidden md:flex md:h-full md:shrink-0">
        <div className="p-6 flex items-center justify-between gap-2">
          <Link href="/dashboard" className="hover:opacity-80 transition-opacity min-w-0">
            <LogoLockup />
          </Link>
          <div className="flex items-center gap-1 shrink-0">
            <NotificationBell />
            <AccountMenu />
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(item.href + "/");
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium glow-card"
                    : "text-muted-foreground hover:text-foreground hover:bg-card"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="flex-1">{item.label}</span>
                {item.href === "/replies" && unreadReplyCount > 0 && (
                  <span
                    className="min-w-[20px] h-5 px-1.5 rounded-full bg-secondary text-xs font-semibold text-secondary-foreground flex items-center justify-center"
                    data-testid="badge-unread-replies"
                  >
                    {unreadReplyCount > 9 ? "9+" : unreadReplyCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto">
          <Separator className="mb-4" />
          <div className="flex items-center gap-3 px-2 mb-4">
            <Avatar className="w-10 h-10 border border-border">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback>{user?.firstName?.charAt(0) || "U"}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{user?.fullName}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.primaryEmailAddress?.emailAddress}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={() => signOut({ redirectUrl: "/" })}
          >
            <LogOut className="w-5 h-5 mr-3" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <header
        // Not sticky — a flex child of a shell that doesn't scroll, so it
        // holds its place by construction rather than by a property that the
        // stylesheet's overflow rules were quietly defeating.
        className="md:hidden shrink-0 border-b border-border bg-card/80 backdrop-blur flex items-center justify-between z-50 px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)", paddingBottom: "0.75rem" }}
      >
        {/* Was a 24px mark beside 20px text — two-thirds the height of the
            word next to it, which reads as a bullet rather than a logo. */}
        <Link href="/dashboard" className="flex items-center min-h-11 min-w-0">
          <LogoLockup />
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <AccountMenu triggerClassName="w-11 h-11 -mr-2" />
        </div>
      </header>

      {/* min-h-0 is load-bearing: a flex item's default min-height is auto,
          which refuses to shrink below its content and would let the page grow
          past the shell instead of scrolling inside it. */}
      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-24 md:pb-0">
        {/* Restores a swipe-down refresh on mobile: index.css sets
            overscroll-behavior-y: contain (so the page doesn't rubber-band
            against the fixed header/bottom nav), which also disables the
            browser's own pull-to-refresh — and now that <main> scrolls
            internally rather than the window, the browser wouldn't offer it
            here regardless.

            A genuine reload, not a query refetch. Refetching updates the data
            but leaves the loaded bundle and service worker exactly as they
            were, so a pull down after a deploy appeared to do nothing. Note
            this discards in-progress form state — a half-composed whisp on
            /send included — which is the accepted cost of the gesture meaning
            what it does in every other app. */}
        <PullToRefresh onRefresh={reloadPage}>
          <div className="max-w-5xl mx-auto p-4 md:p-8 lg:p-10">
            {children}
          </div>
        </PullToRefresh>
      </main>

      {/* Mobile bottom tab bar with a raised Send action, native-app style */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border bg-background/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="relative flex items-center justify-around px-1 py-1.5">
          {MOBILE_TAB_ITEMS_LEFT.map((item) => (
            <MobileTabLink key={item.href} {...item} isActive={location === item.href} />
          ))}

          <Link href="/send" className="flex flex-col items-center -mt-6" data-testid="link-send-mobile">
            <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-[0_0_20px_rgba(124,92,252,0.5)] active:scale-95 transition-transform border-4 border-background">
              <Send className="w-6 h-6 text-primary-foreground" />
            </div>
          </Link>

          {MOBILE_TAB_ITEMS_RIGHT.map((item) => (
            <MobileTabLink
              key={item.href}
              {...item}
              isActive={location === item.href}
              badgeCount={item.href === "/replies" ? unreadReplyCount : 0}
            />
          ))}
        </div>
      </nav>
    </div>
  );
}
