import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/ui/logo";
import { useUser, useClerk } from "@clerk/react";
import { useGetUserProfile } from "@workspace/api-client-react";
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

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/send", label: "Send Whisp", icon: Send },
  { href: "/whisps", label: "My Whisps", icon: ListVideo },
  { href: "/text-whisps", label: "Text Whisps", icon: ScrollText },
  { href: "/suggestions", label: "Suggestions", icon: Sparkles },
  { href: "/circle", label: "Circle", icon: Users },
  { href: "/circles", label: "My Circles", icon: Lock },
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
  { href: "/circle", label: "Circle", icon: Users },
  { href: "/replies", label: "Replies", icon: MessageSquareHeart },
];

function MobileTabLink({ href, label, icon: Icon, isActive }: { href: string; label: string; icon: typeof LayoutDashboard; isActive: boolean }) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center justify-center gap-0.5 min-w-11 min-h-11 px-2 py-1.5 rounded-xl transition-colors ${
        isActive ? "text-primary" : "text-muted-foreground"
      }`}
    >
      <Icon className="w-6 h-6" />
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

  const navItems = isAdmin
    ? [...NAV_ITEMS, { href: "/admin", label: "Admin", icon: ShieldCheck }]
    : NAV_ITEMS;

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col md:flex-row">
      <aside className="w-full md:w-64 border-r border-border bg-card/50 backdrop-blur-xl flex flex-col hidden md:flex h-screen sticky top-0">
        <div className="p-6 flex items-center justify-between gap-2">
          <Link href="/dashboard" className="flex items-center gap-3 text-primary hover:opacity-80 transition-opacity min-w-0">
            <Logo className="w-8 h-8 text-primary shrink-0" />
            <span className="font-serif text-2xl font-bold tracking-tight text-foreground truncate">Blind Whisper</span>
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
                {item.label}
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
        className="md:hidden border-b border-border bg-card/80 backdrop-blur flex items-center justify-between sticky top-0 z-50 px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)", paddingBottom: "0.75rem" }}
      >
        <Link href="/dashboard" className="flex items-center gap-2 min-h-11">
          <Logo className="w-6 h-6 text-primary" />
          <span className="font-serif text-xl font-bold">Blind Whisper</span>
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <AccountMenu triggerClassName="w-11 h-11 -mr-2" />
        </div>
      </header>

      <main className="flex-1 overflow-x-hidden md:min-h-screen pb-24 md:pb-0">
        <div className="max-w-5xl mx-auto p-4 md:p-8 lg:p-10">
          {children}
        </div>
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
            <MobileTabLink key={item.href} {...item} isActive={location === item.href} />
          ))}
        </div>
      </nav>
    </div>
  );
}
