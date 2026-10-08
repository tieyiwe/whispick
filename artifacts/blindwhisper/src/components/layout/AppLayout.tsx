import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { LogoLockup } from "@/components/ui/logo";
import { APP_VERSION, APP_VERSION_NAME } from "@/lib/appVersion";
import { useUser, useClerk } from "@clerk/react";
import {
  useGetUserProfile,
  useGetMyUnreadNotificationCount,
  useGetWhisperBoxUnreadCount,
  useGetReceivedWhispUnreadCount,
  getGetMyUnreadNotificationCountQueryKey,
  getGetWhisperBoxUnreadCountQueryKey,
  getGetReceivedWhispUnreadCountQueryKey,
} from "@workspace/api-client-react";
import { isSupportedLanguage } from "@/lib/languages";
import { useAppBadge } from "@/lib/useAppBadge";
import { clearAnonymousDeviceState } from "@/lib/deviceState";
import {
  LayoutDashboard,
  Send,
  ListVideo,
  Users,
  UsersRound,
  VenetianMask,
  MessageSquareHeart,
  CreditCard,
  Settings,
  ShieldCheck,
  LogOut,
  Clapperboard,
  Sparkles,
  UserPlus,
  ScrollText,
  Swords,
  Menu,
  UserCheck,
  Mailbox,
  ChevronsUpDown,
  ChevronRight,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { PullToRefresh, reloadPage } from "@/components/shared/PullToRefresh";
import { InstallAppPrompt } from "@/components/shared/InstallAppPrompt";
import { PolicyUpdateGate } from "@/components/shared/PolicyUpdateGate";
import { useMobileSendActionValue } from "@/contexts/MobileSendAction";
import { usePublicConfig } from "@/lib/usePublicConfig";
import { SUGGESTIONS_ENABLED } from "@/lib/featureFlags";

// labelKey resolves against the "common" namespace's nav.* keys (see
// src/i18n/locales/*/common.json) — the label itself is looked up at
// render time via t(), not stored here, so it re-renders in the right
// language the moment i18next's active language changes.
type NavItem = { href: string; labelKey: string; icon: typeof LayoutDashboard };
type NavSection = { key: string; titleKey: string | null; items: NavItem[] };

// Grouped by what people come here to do, most-used first: the two core
// actions, then the community spaces (Debate Now is a headline feature, so
// it leads that group instead of sitting ninth in one flat list), then the
// personal inbox, creation tools, and account housekeeping last.
const NAV_SECTIONS: NavSection[] = [
  {
    key: "main",
    titleKey: null,
    items: [
      { href: "/dashboard", labelKey: "nav.home", icon: LayoutDashboard },
      { href: "/send", labelKey: "nav.sendWhisp", icon: Send },
    ],
  },
  {
    key: "community",
    titleKey: "nav.sections.community",
    items: [
      { href: "/debate-topics", labelKey: "nav.debateTopics", icon: Swords },
      { href: "/debate-topics/following", labelKey: "nav.following", icon: UserCheck },
      { href: "/circle", labelKey: "nav.blindCircle", icon: Users },
      { href: "/circles", labelKey: "nav.myBlindCircles", icon: VenetianMask },
    ],
  },
  {
    key: "inbox",
    titleKey: "nav.sections.inbox",
    items: [
      { href: "/whisps", labelKey: "nav.myWhisps", icon: ListVideo },
      { href: "/replies", labelKey: "nav.replies", icon: MessageSquareHeart },
      { href: "/whisper-box", labelKey: "nav.whisperBox", icon: Mailbox },
      { href: "/text-whisps", labelKey: "nav.textWhisps", icon: ScrollText },
    ],
  },
  {
    key: "create",
    titleKey: "nav.sections.create",
    items: [
      { href: "/suggestions", labelKey: "nav.suggestions", icon: Sparkles },
      { href: "/whisper-groups", labelKey: "nav.whisperGroups", icon: UsersRound },
      { href: "/media-library", labelKey: "nav.mediaLibrary", icon: Clapperboard },
    ],
  },
  {
    key: "account",
    titleKey: "nav.sections.account",
    items: [
      { href: "/invite", labelKey: "nav.inviteAFriend", icon: UserPlus },
      { href: "/credits", labelKey: "nav.creditsAndPlan", icon: CreditCard },
      { href: "/settings", labelKey: "nav.settings", icon: Settings },
    ],
  },
];

// Debate Now gets a permanent tab — it's a headline feature and was only
// reachable through "More" before. Whisper Box moves into "More" instead;
// its unread badge follows it there (tile badge + a dot on the More button).
const MOBILE_TAB_ITEMS_LEFT: NavItem[] = [
  { href: "/dashboard", labelKey: "nav.home", icon: LayoutDashboard },
  { href: "/debate-topics", labelKey: "nav.debateShort", icon: Swords },
  { href: "/circle", labelKey: "nav.circleShort", icon: Users },
];

// Plus the "More" button rendered after these, so the right side also ends
// up with 3 — balanced against the 3 on the left around the center Send button.
const MOBILE_TAB_ITEMS_RIGHT: NavItem[] = [
  { href: "/whisps", labelKey: "nav.myWhispsShort", icon: ListVideo },
  { href: "/replies", labelKey: "nav.replies", icon: MessageSquareHeart },
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
      aria-current={isActive ? "page" : undefined}
      className={`relative flex flex-col items-center justify-center gap-1 min-h-12 w-full rounded-xl transition-colors duration-200 ${
        isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <div className="relative">
        <Icon className="w-[22px] h-[22px]" strokeWidth={isActive ? 2.25 : 1.75} />
        {badgeCount > 0 && (
          <span
            className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-secondary ring-2 ring-background text-[11px] font-semibold leading-none tabular-nums text-secondary-foreground flex items-center justify-center"
            data-testid={`badge-mobile-${href.replace(/\//g, "")}`}
          >
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </div>
      <span className={`text-[11px] leading-none whitespace-nowrap ${isActive ? "font-semibold" : "font-medium"}`}>{label}</span>
    </Link>
  );
}

function signOutAndForgetDevice(signOut: ReturnType<typeof useClerk>["signOut"]) {
  clearAnonymousDeviceState();
  return signOut({ redirectUrl: "/" });
}

// Top-right account dropdown — Settings + Sign Out, reachable from the same
// avatar in the mobile header and the desktop sidebar's account bar. Fixes
// two real gaps: on mobile, the avatar previously just linked straight to
// /settings with no sign-out anywhere in reach (the desktop sidebar's own
// account block at the bottom is `hidden md:flex`, invisible on mobile); on
// desktop, there was no account control in the top-right corner at all —
// only at the very bottom of the sidebar. On desktop it now IS that bottom
// block (variant="row"), so the sidebar header can give the brand its room.
function AccountMenu({
  avatarClassName = "w-8 h-8 border border-border",
  triggerClassName = "",
  variant = "avatar",
}: {
  avatarClassName?: string;
  triggerClassName?: string;
  /** "row" renders the trigger as the desktop sidebar's account bar (avatar,
   *  name and email) instead of a bare avatar — the sidebar's header is the
   *  brand's, so the account control lives at the foot of the sidebar. */
  variant?: "avatar" | "row";
}) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { t } = useTranslation();
  const isRow = variant === "row";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          isRow
            ? `group flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-card ${triggerClassName}`
            : `flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring ${triggerClassName}`
        }
        aria-label={t("account.menu")}
        data-testid="button-account-menu"
      >
        <Avatar className={avatarClassName}>
          <AvatarImage src={user?.imageUrl} />
          <AvatarFallback className="text-xs">{user?.firstName?.charAt(0) || "U"}</AvatarFallback>
        </Avatar>
        {isRow && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{user?.fullName}</span>
              <span className="block truncate text-xs text-muted-foreground">{user?.primaryEmailAddress?.emailAddress}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={isRow ? "start" : "end"}
        side={isRow ? "top" : "bottom"}
        sideOffset={8}
        className={`rounded-xl border-border/60 ${isRow ? "w-[var(--radix-dropdown-menu-trigger-width)] min-w-56" : "w-56"}`}
      >
        <DropdownMenuLabel>
          <p className="text-sm font-medium text-foreground truncate">{user?.fullName}</p>
          <p className="text-xs font-normal text-muted-foreground truncate">{user?.primaryEmailAddress?.emailAddress}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer" data-testid="link-account-menu-settings">
            <Settings className="w-4 h-4 mr-2" /> {t("account.settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => signOutAndForgetDevice(signOut)}
          className="cursor-pointer text-destructive focus:text-destructive"
          data-testid="button-account-menu-signout"
        >
          <LogOut className="w-4 h-4 mr-2" /> {t("account.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: profile } = useGetUserProfile();
  const isAdmin = profile?.role === "admin";
  const { t, i18n } = useTranslation();
  // Set when the current page (e.g. Send Text Whisp) wants the raised round
  // button below to drive ITS submit instead of the default /send link — see
  // contexts/MobileSendAction.tsx for why.
  const mobileSendAction = useMobileSendActionValue();

  // The single place the app's rendered language gets synced to the
  // account's saved preference — every authenticated page renders inside
  // AppLayout, so this covers the whole app rather than needing a copy per
  // page. Settings/the onboarding gate also call i18n.changeLanguage()
  // directly on save so a change takes effect immediately, without waiting
  // on this effect's next run.
  useEffect(() => {
    if (profile?.preferredLanguage && isSupportedLanguage(profile.preferredLanguage) && i18n.language !== profile.preferredLanguage) {
      void i18n.changeLanguage(profile.preferredLanguage);
    }
  }, [profile?.preferredLanguage, i18n]);

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
  const notificationUnreadCount = unread?.unreadCount ?? 0;

  // Same polling treatment as the Replies badge above, driving the Whisper
  // Box nav entry's own badge — see routes/whisperBox.ts's GET
  // /whisper-box/unread-count.
  const { data: whisperBoxUnread } = useGetWhisperBoxUnreadCount({
    query: {
      queryKey: getGetWhisperBoxUnreadCountQueryKey(),
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
  });
  const whisperBoxUnreadCount = whisperBoxUnread?.unreadCount ?? 0;

  // Same polling treatment again, driving the "My Whisps" nav entry's own
  // badge — count of received whisps this user hasn't opened yet (see
  // routes/whisps.ts's GET /whisps/received-unread-count). Deliberately
  // openedAt-based rather than tied to the separate notification-read
  // state, so the badge clears exactly when the recipient actually opens
  // the whisp itself.
  const { data: receivedWhispUnread } = useGetReceivedWhispUnreadCount({
    query: {
      queryKey: getGetReceivedWhispUnreadCountQueryKey(),
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
  });
  const receivedWhispUnreadCount = receivedWhispUnread?.unreadCount ?? 0;

  // Home-screen presence (Badge API): reflects total actionable unread —
  // bell notifications + Whisper Box inbox. Deliberately NOT
  // + receivedWhispUnreadCount: a whisp delivered to a matched recipient
  // already inserts its own row in notificationsTable (see lib/deliver.ts's
  // deliverInApp), so it's already counted once via notificationUnreadCount
  // — adding receivedWhispUnreadCount on top would double-count that same
  // event, inflating the OS badge. Same reasoning as skipping
  // unreadReplyCount, which is already a subset of notificationUnreadCount
  // rather than an addition — receivedWhispUnreadCount isn't a subset, but
  // it overlaps enough with it that summing both isn't safe either.
  // Piggybacks on the polled queries above instead of opening its own poll;
  // a no-op everywhere the Badge API doesn't exist. Lives here (not a page)
  // so it's active for the whole authenticated session.
  useAppBadge(notificationUnreadCount + whisperBoxUnreadCount);

  const { billingEnabled } = usePublicConfig();
  const navSections: NavSection[] = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        // Suggestions is parked for now (lib/features.ts) — hidden from the
        // sidebar and the More sheet alike, since both derive from here.
        (SUGGESTIONS_ENABLED || item.href !== "/suggestions") &&
        // Nothing to buy while the app is free (billing off) — the page
        // stays reachable by URL but leaves the nav.
        (billingEnabled || item.href !== "/credits"),
    ),
  }))
    .filter((section) => section.items.length > 0)
    .map((section) =>
    section.key === "account" && isAdmin
      ? { ...section, items: [...section.items, { href: "/admin_pro", labelKey: "nav.admin", icon: ShieldCheck }] }
      : section,
  );

  // One place that knows which nav item carries which unread count, shared by
  // the sidebar, the mobile tabs and the More sheet.
  function badgeFor(href: string): number {
    if (href === "/whisps") return receivedWhispUnreadCount;
    if (href === "/replies") return unreadReplyCount;
    if (href === "/whisper-box") return whisperBoxUnreadCount;
    return 0;
  }

  // Everything not already reachable from one of the fixed mobile tabs —
  // derived from the same sections as the sidebar so a page added there
  // later, including Admin, automatically shows up here too instead of
  // silently being mobile-unreachable again.
  const [moreOpen, setMoreOpen] = useState(false);
  // "/send" counts as fixed too: it's the raised center button, so listing
  // it again in More was a duplicate.
  const fixedMobileHrefs = new Set(["/send", ...[...MOBILE_TAB_ITEMS_LEFT, ...MOBILE_TAB_ITEMS_RIGHT].map((item) => item.href)]);
  const moreSections = navSections
    .map((section) => ({ ...section, items: section.items.filter((item) => !fixedMobileHrefs.has(item.href)) }))
    .filter((section) => section.items.length > 0);
  const moreNavItems = moreSections.flatMap((section) => section.items);
  const isOnMoreItem = moreNavItems.some((item) => item.href === location);
  const moreHasUnread = moreNavItems.some((item) => badgeFor(item.href) > 0);

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
    <div className="relative h-[100dvh] overflow-hidden bg-background flex flex-col md:flex-row">
      {/* Ambient depth for the authenticated shell — same treatment every
          public page (PublicWhisperBoxPage, PublicWhispPage, etc.) already
          uses, just not previously extended in here. Fixed relative to the
          shell (not `main`'s own scroll region), so it reads as an
          atmospheric backdrop content scrolls past rather than something
          that scrolls with it. Two blobs, not one: a single centered glow
          reads as a spotlight; two offset, differently-sized ones read as
          depth/atmosphere, matching the public pages' own pattern.
          pointer-events-none so it never intercepts a tap meant for the
          sidebar/nav/content stacked in front of it. */}
      <div className="absolute top-[-10%] left-[-10%] w-[55%] h-[40%] rounded-full blur-[120px] pointer-events-none bg-primary/8" />
      <div className="absolute bottom-[-15%] right-[-10%] w-[45%] h-[35%] rounded-full blur-[110px] pointer-events-none bg-secondary/5" />
      <aside className="relative w-full md:w-64 border-r border-border/50 bg-card/40 backdrop-blur-xl flex-col hidden md:flex md:h-full md:shrink-0">
        {/* The header belongs to the brand: the full lockup at its natural
            size, with only the notification bell beside it. The account
            control moved to the foot of the sidebar — squeezing bell AND
            avatar in here truncated the wordmark to "Blind …". */}
        <div className="flex items-center justify-between gap-2 pl-5 pr-3 pt-5 pb-4">
          <Link href="/dashboard" className="min-w-0 rounded-lg transition-opacity hover:opacity-80" aria-label="Blind Whisper">
            <LogoLockup size="sm" />
          </Link>
          <NotificationBell side="right" align="start" />
        </div>

        {/* Edge fades so a nav taller than the window reads as scrollable
            rather than simply ending at the fold. */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-16px),transparent)]">
          {navSections.map((section) => (
            <div key={section.key} className={section.titleKey ? "mt-5" : "pt-1"}>
              {section.titleKey && (
                <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                  {t(section.titleKey)}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  // Exact match for a parent route that has its own child
                  // item (/debate-topics vs /debate-topics/following), so only
                  // one of the two lights up at a time.
                  // A parent route lights up for its sub-pages (a topic at
                  // /debate-topics/<id> → "Debate Now") unless the location
                  // belongs to one of its own child nav items (/debate-topics/
                  // following → "Following" only).
                  const onChildItem = navSections.some((sec) =>
                    sec.items.some(
                      (other) =>
                        other.href !== item.href &&
                        other.href.startsWith(item.href + "/") &&
                        (location === other.href || location.startsWith(other.href + "/")),
                    ),
                  );
                  const isActive = location === item.href || (!onChildItem && location.startsWith(item.href + "/"));
                  const Icon = item.icon;
                  const badge = badgeFor(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={`relative flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-150 ${
                        isActive
                          ? "bg-primary/12 text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-card/70"
                      }`}
                    >
                      {isActive && <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />}
                      <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? "text-primary" : ""}`} />
                      <span className="flex-1 truncate">{t(item.labelKey)}</span>
                      {badge > 0 && (
                        <span
                          className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-secondary/15 text-xs font-semibold tabular-nums text-secondary flex items-center justify-center"
                          data-testid={
                            item.href === "/replies"
                              ? "badge-unread-replies"
                              : item.href === "/whisps"
                                ? "badge-unread-whisps"
                                : "badge-unread-whisper-box"
                          }
                        >
                          {badge > 9 ? "9+" : badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Account bar: one row that opens Settings / Sign out, instead of a
            name block plus a separate full-width Sign Out button. */}
        <div className="border-t border-border/50 px-3 pt-3 pb-3">
          <AccountMenu variant="row" avatarClassName="w-9 h-9 border border-border/60" />
          <p className="mt-2 text-center text-[11px] text-muted-foreground/70 tabular-nums" data-testid="text-app-version">
            v{APP_VERSION} · {APP_VERSION_NAME}
          </p>
        </div>
      </aside>

      {/* Mobile header */}
      <header
        // Not sticky — a flex child of a shell that doesn't scroll, so it
        // holds its place by construction rather than by a property that the
        // stylesheet's overflow rules were quietly defeating.
        className="md:hidden shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-xl flex items-center justify-between z-50 px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)", paddingBottom: "0.5rem" }}
      >
        {/* Was a 24px mark beside 20px text — two-thirds the height of the
            word next to it, which reads as a bullet rather than a logo. */}
        <Link href="/dashboard" className="flex items-center min-h-11 min-w-0">
          <LogoLockup />
        </Link>
        <div className="flex items-center gap-0.5 -mr-1.5">
          <NotificationBell triggerClassName="h-11 w-11" />
          <AccountMenu triggerClassName="w-11 h-11" />
        </div>
      </header>

      {/* min-h-0 is load-bearing: a flex item's default min-height is auto,
          which refuses to shrink below its content and would let the page grow
          past the shell instead of scrolling inside it. */}
      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
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
          <div className="max-w-5xl mx-auto px-4 pt-5 pb-6 md:p-8 lg:px-10 lg:py-10">
            {children}
          </div>
        </PullToRefresh>
      </main>

      {/* Only inside AppLayout, so it reaches signed-in users and never a
          stranger on a public whisp page who has no account to install for. */}
      <InstallAppPrompt />
      <PolicyUpdateGate />

      {/* Mobile bottom tab bar with a raised Send action, native-app style.
          Seven equal columns so every label sits on one line under its icon
          instead of some wrapping to two. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border/50 bg-background/90 backdrop-blur-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="relative grid grid-cols-7 items-center px-1 pt-1.5 pb-1">
          {MOBILE_TAB_ITEMS_LEFT.map((item) => (
            <MobileTabLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={t(item.labelKey)}
              isActive={location === item.href || location.startsWith(item.href + "/")}
              badgeCount={badgeFor(item.href)}
            />
          ))}

          {mobileSendAction ? (
            <button
              type="button"
              onClick={mobileSendAction.onClick}
              disabled={mobileSendAction.disabled}
              aria-label={t("nav.sendWhisp")}
              className="flex flex-col items-center justify-self-center -mt-6"
              data-testid="link-send-mobile"
            >
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 border-4 border-background ${
                  mobileSendAction.disabled
                    ? "bg-muted"
                    : "bg-primary shadow-[0_0_20px_rgba(124,92,252,0.5)] active:scale-95"
                }`}
              >
                <Send className={`w-6 h-6 ${mobileSendAction.disabled ? "text-muted-foreground" : "text-primary-foreground"}`} />
              </div>
            </button>
          ) : (
            <Link href="/send" aria-label={t("nav.sendWhisp")} className="flex flex-col items-center justify-self-center -mt-6" data-testid="link-send-mobile">
              <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-[0_0_20px_rgba(124,92,252,0.5)] active:scale-95 transition-transform duration-200 border-4 border-background">
                <Send className="w-6 h-6 text-primary-foreground" />
              </div>
            </Link>
          )}

          {MOBILE_TAB_ITEMS_RIGHT.map((item) => (
            <MobileTabLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={t(item.labelKey)}
              isActive={location === item.href || location.startsWith(item.href + "/")}
              badgeCount={badgeFor(item.href)}
            />
          ))}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            data-testid="button-mobile-more"
            aria-haspopup="dialog"
            className={`relative flex flex-col items-center justify-center gap-1 min-h-12 w-full rounded-xl transition-colors duration-200 ${
              isOnMoreItem ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="relative">
              <Menu className="w-[22px] h-[22px]" strokeWidth={isOnMoreItem ? 2.25 : 1.75} />
              {moreHasUnread && (
                <span
                  className="absolute -top-0.5 -right-1 h-2.5 w-2.5 rounded-full bg-secondary ring-2 ring-background"
                  aria-hidden
                  data-testid="badge-more-unread"
                />
              )}
            </span>
            <span className={`text-[11px] leading-none whitespace-nowrap ${isOnMoreItem ? "font-semibold" : "font-medium"}`}>{t("nav.more")}</span>
          </button>
        </div>
      </nav>

      {/* Grouped rows rather than a tile grid: sections have 1–3 items each,
          which in a 3-column grid always left orphan tiles on their own row.
          Rows also give every label room to sit on one line. */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="md:hidden max-h-[85dvh] overflow-y-auto rounded-t-3xl border-border/50 bg-background/95 backdrop-blur-xl px-4 pt-3 [&>button:first-of-type]:right-3 [&>button:first-of-type]:top-3 [&>button:first-of-type]:flex [&>button:first-of-type]:h-10 [&>button:first-of-type]:w-10 [&>button:first-of-type]:items-center [&>button:first-of-type]:justify-center [&>button:first-of-type]:rounded-full [&>button:first-of-type]:bg-card/80 [&>button:first-of-type]:opacity-100"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
        >
          <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" />
          <SheetHeader className="text-left">
            <SheetTitle className="font-serif text-xl">{t("nav.more")}</SheetTitle>
          </SheetHeader>
          <div className="space-y-5 pt-4">
            {moreSections.map((section) => (
              <div key={section.key}>
                {section.titleKey && (
                  <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                    {t(section.titleKey)}
                  </p>
                )}
                <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/50 divide-y divide-border/40">
                  {section.items.map((item) => {
                    const badge = badgeFor(item.href);
                    const isActive = location === item.href;
                    return (
                      <SheetClose asChild key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={isActive ? "page" : undefined}
                          data-testid={`link-more-${item.href.replace(/\//g, "")}`}
                          className={`flex min-h-12 items-center gap-3 px-4 py-3 text-[15px] transition-colors duration-150 active:bg-card ${
                            isActive ? "bg-primary/10 text-foreground font-medium" : "text-foreground/90 hover:bg-card"
                          }`}
                        >
                          <item.icon className={`h-5 w-5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                          <span className="flex-1">{t(item.labelKey)}</span>
                          {badge > 0 && (
                            <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-secondary/15 text-xs font-semibold tabular-nums text-secondary flex items-center justify-center">
                              {badge > 9 ? "9+" : badge}
                            </span>
                          )}
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                        </Link>
                      </SheetClose>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
