import { lazy, Suspense, useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from '@clerk/react';
import { registerServiceWorker, syncPushSubscription } from "@/lib/push";
import { clearAnonymousDeviceState } from "@/lib/deviceState";
import { signInRedirectTarget, signInUrlFor } from "@/lib/signInRedirect";
// Imported for its module-level side effect: capturing beforeinstallprompt
// from the moment this script evaluates, not from whenever the install UI
// happens to mount. That UI lives inside AppLayout, which is pulled in by a
// lazily-loaded route chunk that only loads once auth has resolved and
// routing has landed somewhere — by which point the one-shot event may
// already have fired into a page with nothing listening. This file sits in
// App.tsx's own eager bundle specifically so the listener is live before any
// of that.
import "@/lib/installApp";
// Same reasoning as lib/installApp above — BugRabbit's window.onerror/
// unhandledrejection listeners (lib/bugRabbitCapture.ts) need to be live
// from the moment this script evaluates, not from whenever some lazily-
// loaded route happens to mount, or a crash before that point goes uncaught.
import "@/lib/bugRabbitCapture";
import { PinToTaskbarTip } from "@/components/shared/PinToTaskbarTip";
import { EnableNotificationsPrompt } from "@/components/shared/EnableNotificationsPrompt";
import { AppErrorBoundary } from "@/components/shared/AppErrorBoundary";
import { MobileSendActionProvider } from "@/contexts/MobileSendAction";
import { watchForUpdates, isUpdateAvailable } from "@/lib/appUpdate";
import { setAuthTokenGetter, setExtraHeadersGetter, createPushSubscription } from "@workspace/api-client-react";
import { getAdminMfaToken } from "@/lib/adminMfaGate";
import { initFeatureUsage } from "@/lib/featureUsage";
import { SUGGESTIONS_ENABLED } from "@/lib/featureFlags";
import { dark } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect, Link } from 'wouter';
import { Loader2, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LogoLockup } from "@/components/ui/logo";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";

import { LandingPage } from "@/pages/LandingPage";
import { Dashboard } from "@/pages/Dashboard";
import { AdminRoute } from "@/components/layout/AdminRoute";
import { ClaimPendingInvite } from "@/components/shared/ClaimPendingInvite";
import { VisitorPing } from "@/components/shared/VisitorPing";

// Everything below is off the critical first-load path (landing, sign-in/up,
// and dashboard are the only pages most visits ever touch) — code-split so a
// visitor never downloads/parses the admin panel (and the recharts library
// it pulls in via AdminAnalytics) or any other page they didn't ask for.
// Named exports need the `.then(m => ({ default: m.X }))` unwrap since
// React.lazy only accepts a module with a default export.
const PrivacyPolicy = lazy(() => import("@/pages/PrivacyPolicy").then((m) => ({ default: m.PrivacyPolicy })));
const TermsOfService = lazy(() => import("@/pages/TermsOfService").then((m) => ({ default: m.TermsOfService })));
const SmsTerms = lazy(() => import("@/pages/SmsTerms").then((m) => ({ default: m.SmsTerms })));
const CommunityGuidelines = lazy(() => import("@/pages/CommunityGuidelines").then((m) => ({ default: m.CommunityGuidelines })));
const WhispsList = lazy(() => import("@/pages/WhispsList").then((m) => ({ default: m.WhispsList })));
const CircleFeed = lazy(() => import("@/pages/CircleFeed").then((m) => ({ default: m.CircleFeed })));
const MyCircles = lazy(() => import("@/pages/MyCircles").then((m) => ({ default: m.MyCircles })));
const CircleDetail = lazy(() => import("@/pages/CircleDetail").then((m) => ({ default: m.CircleDetail })));
const SendWhisp = lazy(() => import("@/pages/SendWhisp").then((m) => ({ default: m.SendWhisp })));
const SuggestionsLibrary = lazy(() => import("@/pages/SuggestionsLibrary").then((m) => ({ default: m.SuggestionsLibrary })));
const WhisperGroups = lazy(() => import("@/pages/WhisperGroups").then((m) => ({ default: m.WhisperGroups })));
const MediaLibrary = lazy(() => import("@/pages/MediaLibrary").then((m) => ({ default: m.MediaLibrary })));
const WhisperGroupDetail = lazy(() => import("@/pages/WhisperGroupDetail").then((m) => ({ default: m.WhisperGroupDetail })));
const GroupSendDetail = lazy(() => import("@/pages/GroupSendDetail").then((m) => ({ default: m.GroupSendDetail })));
const WhispDetail = lazy(() => import("@/pages/WhispDetail").then((m) => ({ default: m.WhispDetail })));
const RepliesInbox = lazy(() => import("@/pages/RepliesInbox").then((m) => ({ default: m.RepliesInbox })));
const WhisperBoxInbox = lazy(() => import("@/pages/WhisperBoxInbox").then((m) => ({ default: m.WhisperBoxInbox })));
const PublicWhisperBoxPage = lazy(() => import("@/pages/PublicWhisperBoxPage").then((m) => ({ default: m.PublicWhisperBoxPage })));
const CreditsPage = lazy(() => import("@/pages/CreditsPage").then((m) => ({ default: m.CreditsPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const AccountSecurity = lazy(() => import("@/pages/AccountSecurity").then((m) => ({ default: m.AccountSecurity })));
const PublicWhispPage = lazy(() => import("@/pages/PublicWhispPage").then((m) => ({ default: m.PublicWhispPage })));
const InvitePage = lazy(() => import("@/pages/InvitePage").then((m) => ({ default: m.InvitePage })));
const PublicInvitePage = lazy(() => import("@/pages/PublicInvitePage").then((m) => ({ default: m.PublicInvitePage })));
const PublicTextWhisp = lazy(() => import("@/pages/PublicTextWhisp").then((m) => ({ default: m.PublicTextWhisp })));
const TextWhispsList = lazy(() => import("@/pages/TextWhispsList").then((m) => ({ default: m.TextWhispsList })));
const SendTextWhisp = lazy(() => import("@/pages/SendTextWhisp").then((m) => ({ default: m.SendTextWhisp })));
const TextWhispDetail = lazy(() => import("@/pages/TextWhispDetail").then((m) => ({ default: m.TextWhispDetail })));
const DebateTopics = lazy(() => import("@/pages/DebateTopics").then((m) => ({ default: m.DebateTopics })));
const WelcomePage = lazy(() => import("@/pages/WelcomePage").then((m) => ({ default: m.WelcomePage })));
const MarketingPage = lazy(() => import("@/pages/MarketingPage").then((m) => ({ default: m.MarketingPage })));
// Public explainer pages — must match the `path`s in lib/marketingPages.ts
// (listed here rather than imported so the main bundle doesn't carry their
// copy; scripts/prerender.mjs fails the build if a page has no route here).
export const MARKETING_ROUTE_PATHS = ["/how-it-works", "/anonymous-message-link", "/anonymous-debates", "/ideas", "/safety", "/about", "/faq"];
const DebateTopicDetail = lazy(() => import("@/pages/DebateTopicDetail").then((m) => ({ default: m.DebateTopicDetail })));
const CreateDebateTopic = lazy(() => import("@/pages/CreateDebateTopic").then((m) => ({ default: m.CreateDebateTopic })));
const DebateFollowing = lazy(() => import("@/pages/DebateFollowing").then((m) => ({ default: m.DebateFollowing })));
const SubscribePage = lazy(() => import("@/pages/SubscribePage").then((m) => ({ default: m.SubscribePage })));
const VerifySubscriptionPage = lazy(() => import("@/pages/VerifySubscriptionPage").then((m) => ({ default: m.VerifySubscriptionPage })));
const UnsubscribeFromMatchingPage = lazy(() => import("@/pages/UnsubscribeFromMatchingPage").then((m) => ({ default: m.UnsubscribeFromMatchingPage })));
const RecapPage = lazy(() => import("@/pages/RecapPage").then((m) => ({ default: m.RecapPage })));
const FirstWhispersOnboarding = lazy(() => import("@/pages/FirstWhispersOnboarding").then((m) => ({ default: m.FirstWhispersOnboarding })));

// Admin panel — highest-value split. Most users never load any of this, and
// AdminAnalytics alone pulls in the recharts charting library.
const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const AdminUsers = lazy(() => import("@/pages/admin/AdminUsers").then((m) => ({ default: m.AdminUsers })));
const AdminUserDetail = lazy(() => import("@/pages/admin/AdminUserDetail").then((m) => ({ default: m.AdminUserDetail })));
const AdminWhisps = lazy(() => import("@/pages/admin/AdminWhisps").then((m) => ({ default: m.AdminWhisps })));
const AdminWhispDetail = lazy(() => import("@/pages/admin/AdminWhispDetail").then((m) => ({ default: m.AdminWhispDetail })));
const AdminAnalytics = lazy(() => import("@/pages/admin/AdminAnalytics").then((m) => ({ default: m.AdminAnalytics })));
const AdminSuggestions = lazy(() => import("@/pages/admin/AdminSuggestions").then((m) => ({ default: m.AdminSuggestions })));
const AdminModeration = lazy(() => import("@/pages/admin/AdminModeration").then((m) => ({ default: m.AdminModeration })));
const AdminReports = lazy(() => import("@/pages/admin/AdminReports").then((m) => ({ default: m.AdminReports })));
const AdminPolicies = lazy(() => import("@/pages/admin/AdminPolicies").then((m) => ({ default: m.AdminPolicies })));
const AdminAccess = lazy(() => import("@/pages/admin/AdminAccess").then((m) => ({ default: m.AdminAccess })));
const AdminProjects = lazy(() => import("@/pages/admin/AdminProjects").then((m) => ({ default: m.AdminProjects })));
const AdminNotifications = lazy(() => import("@/pages/admin/AdminNotifications").then((m) => ({ default: m.AdminNotifications })));
const AdminDebateAgent = lazy(() => import("@/pages/admin/AdminDebateAgent").then((m) => ({ default: m.AdminDebateAgent })));
const AdminCircleAgent = lazy(() => import("@/pages/admin/AdminCircleAgent").then((m) => ({ default: m.AdminCircleAgent })));
const AdminAuditLog = lazy(() => import("@/pages/admin/AdminAuditLog").then((m) => ({ default: m.AdminAuditLog })));
const AdminBugRabbit = lazy(() => import("@/pages/admin/AdminBugRabbit").then((m) => ({ default: m.AdminBugRabbit })));

// Route-level Suspense fallback — same full-page centered spinner AdminRoute
// already uses while it waits on the user profile fetch, so a lazy chunk
// loading doesn't introduce a new, inconsistent loading affordance.
function RouteLoadingFallback() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background">
      <Loader2 className="w-6 h-6 text-primary animate-spin" />
    </div>
  );
}

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
// The Clerk proxy (/api/__clerk) is PRODUCTION-ONLY: the backend's
// clerkProxyMiddleware is a no-op passthrough outside production (Clerk
// proxying doesn't work for dev instances). So pointing Clerk at proxyUrl
// during `vite dev` makes it fetch clerk.browser.js from a path nothing
// serves → "failed to load Clerk JS" and a blank app. Gate on
// import.meta.env.PROD so dev loads Clerk directly from its
// publishable-key FAPI, and only the production build routes through the
// proxy (which is where custom-domain cookie handling actually needs it).
const useClerkProxy = !!clerkProxyUrl && import.meta.env.PROD;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

const clerkAppearance = {
  theme: dark,
  cssLayerName: "clerk",
  options: {
    // The brand lockup sits above the card in AuthShell, so Clerk's own
    // in-card logo would just repeat it.
    logoPlacement: "none" as const,
    logoLinkUrl: basePath || "/",
    // One-tap Google is the fastest way in — full-width, labelled, and first.
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "#7C5CFC",
    colorBackground: "#2D2A45",
    colorInputBackground: "#1e1b35",
    colorNeutral: "#9c95c0",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "16px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#2D2A45] rounded-2xl w-[420px] max-w-full overflow-hidden border border-white/[0.06] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)]",
    card: "!shadow-none !border-0 !bg-transparent",
    footer: "!shadow-none !border-0 !bg-transparent",
    headerTitle: "!font-serif !text-2xl !font-semibold",
    headerSubtitle: "!text-sm",
    socialButtonsBlockButton: "!h-11 !rounded-full !border-0 !bg-white hover:!bg-white/90 !shadow-none",
    socialButtonsBlockButtonText: "!text-[#14121F] !text-sm !font-semibold",
    dividerLine: "!bg-white/10",
    dividerText: "!text-xs",
    formFieldInput: "!h-11 !rounded-xl",
    formButtonPrimary: "!h-11 !rounded-full !text-sm !font-semibold !normal-case !shadow-none",
    footerActionLink: "!font-medium",
  },
};

// Shared frame for the sign-in / sign-up pages: a quiet way back home, the
// brand lockup over the auth card, and one line of reassurance — so the card
// doesn't float alone on an empty screen.
function AuthShell({ reassurance, children }: { reassurance: string; children: React.ReactNode }) {
  const { t } = useTranslation("publicPages");
  return (
    <div
      className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-background"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="absolute top-[5%] left-[15%] w-[45%] h-[40%] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[10%] right-[15%] w-[30%] h-[30%] bg-secondary/8 rounded-full blur-[100px] pointer-events-none" />

      <header className="relative z-10 mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:h-[72px] sm:px-6">
        <Link
          href="/"
          className="-ml-3 inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("auth.backHome")}
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pb-12 pt-2">
        <Link href="/" aria-label={t("publicHeader.homeAria")} className="transition-opacity hover:opacity-80">
          <LogoLockup />
        </Link>
        <p className="mt-3 mb-6 text-sm text-muted-foreground">{reassurance}</p>
        {children}
      </main>
    </div>
  );
}

function SignInPage() {
  const { t } = useTranslation("publicPages");
  const [location] = useLocation();
  // A deep link the visitor was bounced here from (see ProtectedRoute and
  // lib/signInRedirect.ts) wins over the usual /dashboard landing.
  const target = signInRedirectTarget(window.location.search, location !== "/sign-in");
  return (
    <AuthShell reassurance={t("auth.signInReassurance")}>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={`${basePath}${target}`} />
    </AuthShell>
  );
}

function SignUpPage() {
  const { t } = useTranslation("publicPages");
  return (
    <AuthShell reassurance={t("auth.signUpReassurance")}>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={`${basePath}/welcome`} />
    </AuthShell>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
        // A signed-in person just left (signed out, session expired, account
        // deleted, switched accounts) — their anonymous device state goes
        // with them. Covers every sign-out path, not just AppLayout's buttons.
        if (prevUserIdRef.current) clearAnonymousDeviceState();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

// Cookie-based auth (the customFetch default — see its own doc comment)
// depends on the browser's __session/__client_uat cookies staying in sync
// under a suffix @clerk/backend derives from the publishable key. On this
// deployment's exact custom-domain + Frontend-API-proxy combination, the
// browser's Clerk client ends up refreshing a DIFFERENT cookie suffix family
// than the one @clerk/backend computes for the same (confirmed byte-
// identical) key — every request looked signed-out no matter how many times
// a user signed in, sitewide, regardless of caching/cookie state. Explicitly
// sending the session token as a Bearer header sidesteps that whole
// cookie-suffix mechanism: @clerk/backend's header-auth path verifies the
// token directly and never touches __client_uat at all.
function ClerkAuthTokenBridge() {
  const { getToken } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    // The admin panel's second-factor unlock token rides on every request
    // as X-Admin-Mfa (harmless on non-admin routes, required by /admin/*).
    setExtraHeadersGetter(() => {
      const token = getAdminMfaToken();
      return token ? { "X-Admin-Mfa": token } : null;
    });
    // Feature-usage capture starts once the token getter is in place so
    // signed-in activity is attributed (guests still count, unattributed).
    initFeatureUsage();
    return () => {
      setAuthTokenGetter(null);
      setExtraHeadersGetter(null);
    };
  }, [getToken]);

  return null;
}

// Registers the service worker on load, for everyone.
//
// It used to be registered only as a side effect of turning on push
// notifications (lib/push.ts subscribeToPush), which meant anyone who never
// granted notification permission had no service worker at all — and Chrome
// will not fire `beforeinstallprompt` without one, so the install prompt
// could never appear for most people. Registration is cheap, idempotent, and
// the worker itself does nothing but handle pushes and pass fetches straight
// through (public/sw.js).
function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Failure here is never worth surfacing: it means no push and no install
    // offer, not a broken app.
    void registerServiceWorker()
      .then((registration) => watchForUpdates(registration))
      .catch(() => {});
  }, []);

  return null;
}

// Keeps the backend's copy of this browser's push subscription current. The
// browser can rotate the subscription on its own, and sw.js can't register
// the new one (no Clerk token there), so the signed-in app does it: once per
// load per user, plus whenever sw.js reports a rotation while a window is
// open. Idempotent server-side (upsert by endpoint).
function PushSubscriptionSync() {
  const { isSignedIn, userId } = useAuth();
  const syncedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || !userId) return;
    const sync = () => {
      void syncPushSubscription((input) => createPushSubscription(input)).catch(() => {});
    };
    if (syncedForRef.current !== userId) {
      syncedForRef.current = userId;
      sync();
    }
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "push-subscription-changed") sync();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [isSignedIn, userId]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/dashboard" /></Show>
      <Show when="signed-out"><LandingPage /></Show>
    </>
  );
}

// Signed out: the bare home (/dashboard) still goes to the landing page,
// but any other page — the whisp, text thread or inbox a notification email
// linked to — goes to sign-in carrying that path, so signing in finishes on
// it instead of on the dashboard (lib/signInRedirect.ts).
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const [location] = useLocation();
  const signedOutTarget = location === "/dashboard" ? "/" : signInUrlFor(location + window.location.search);
  return (
    <>
      <Show when="signed-in"><Component /></Show>
      <Show when="signed-out"><Redirect to={signedOutTarget} /></Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [location, setLocation] = useLocation();
  const skipNextUpdateCheck = useRef(true);

  // Belt-and-suspenders for watchForUpdates' own background-tab reload: that
  // covers the common case (a phone gets backgrounded within seconds), but a
  // desktop tab left open and actively used for hours might never go hidden.
  // The next real navigation is the other moment a stale bundle would 404
  // anyway, so treat it the same way — reload for real instead of letting
  // wouter hand off to a chunk that no longer exists on the server.
  useEffect(() => {
    if (skipNextUpdateCheck.current) {
      skipNextUpdateCheck.current = false;
      return;
    }
    if (isUpdateAvailable()) window.location.reload();
  }, [location]);

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      {...(useClerkProxy ? { proxyUrl: clerkProxyUrl } : {})}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      // A brand-new account always lands on /welcome (install the app + turn
      // on alerts, once), wherever sign-up started — including someone who
      // taps Google on the sign-in page without an account yet.
      signUpForceRedirectUrl={`${basePath}/welcome`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkAuthTokenBridge />
        <ServiceWorkerRegistration />
        <PushSubscriptionSync />
        <EnableNotificationsPrompt />
        <PinToTaskbarTip />
        <ClerkQueryClientCacheInvalidator />
        <ClaimPendingInvite />
        <VisitorPing />
        <AppErrorBoundary>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />

            <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
            <Route path="/welcome" component={() => <ProtectedRoute component={WelcomePage} />} />
            <Route path="/send" component={() => <ProtectedRoute component={SendWhisp} />} />
            <Route path="/onboarding/first-whispers" component={() => <ProtectedRoute component={FirstWhispersOnboarding} />} />
            {/* Hidden until there are enough users to curate for (lib/features.ts). */}
            <Route
              path="/suggestions"
              component={() => (SUGGESTIONS_ENABLED ? <ProtectedRoute component={SuggestionsLibrary} /> : <Redirect to="/dashboard" />)}
            />
            <Route path="/whisps/:id" component={() => <ProtectedRoute component={WhispDetail} />} />
            <Route path="/whisps" component={() => <ProtectedRoute component={WhispsList} />} />
            <Route path="/circle" component={() => <ProtectedRoute component={CircleFeed} />} />
            <Route path="/circles/:id" component={() => <ProtectedRoute component={CircleDetail} />} />
            <Route path="/circles" component={() => <ProtectedRoute component={MyCircles} />} />
            <Route path="/whisper-groups/sends/:groupSendId" component={() => <ProtectedRoute component={GroupSendDetail} />} />
            <Route path="/whisper-groups/:id" component={() => <ProtectedRoute component={WhisperGroupDetail} />} />
            <Route path="/whisper-groups" component={() => <ProtectedRoute component={WhisperGroups} />} />
            <Route path="/media-library" component={() => <ProtectedRoute component={MediaLibrary} />} />
            <Route path="/replies" component={() => <ProtectedRoute component={RepliesInbox} />} />
            <Route path="/whisper-box" component={() => <ProtectedRoute component={WhisperBoxInbox} />} />
            <Route path="/credits" component={() => <ProtectedRoute component={CreditsPage} />} />
            <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
            <Route path="/recap" component={() => <ProtectedRoute component={RecapPage} />} />
            <Route path="/account/security/*?" component={() => <ProtectedRoute component={AccountSecurity} />} />
            <Route path="/invite" component={() => <ProtectedRoute component={InvitePage} />} />
            <Route path="/debate-topics/new" component={() => <ProtectedRoute component={CreateDebateTopic} />} />
            <Route path="/debate-topics/following" component={() => <ProtectedRoute component={DebateFollowing} />} />
            <Route path="/send-text" component={() => <ProtectedRoute component={SendTextWhisp} />} />
            <Route path="/text-whisps/:id" component={() => <ProtectedRoute component={TextWhispDetail} />} />
            <Route path="/text-whisps" component={() => <ProtectedRoute component={TextWhispsList} />} />

            <Route path="/admin_pro/users/:id" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminUserDetail} />} />} />
            <Route path="/admin_pro/users" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminUsers} />} />} />
            <Route path="/admin_pro/whisps/:id" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminWhispDetail} />} />} />
            <Route path="/admin_pro/whisps" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminWhisps} />} />} />
            <Route path="/admin_pro/analytics" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminAnalytics} />} />} />
            <Route path="/admin_pro/suggestions" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminSuggestions} />} />} />
            <Route path="/admin_pro/moderation" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminModeration} />} />} />
            <Route path="/admin_pro/reports" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminReports} />} />} />
            <Route path="/admin_pro/policies" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminPolicies} />} />} />
            <Route path="/admin_pro/access" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminAccess} />} />} />
            <Route path="/admin_pro/projects" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminProjects} />} />} />
            <Route path="/admin_pro/notifications" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminNotifications} />} />} />
            <Route path="/admin_pro/debate-agent" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminDebateAgent} />} />} />
            <Route path="/admin_pro/circle-agent" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminCircleAgent} />} />} />
            <Route path="/admin_pro/audit-log" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminAuditLog} />} />} />
            <Route path="/admin_pro/bug-rabbit" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminBugRabbit} />} />} />
            <Route path="/admin_pro" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminDashboard} />} />} />

            <Route path="/debate-topics/:id" component={DebateTopicDetail} />
            <Route path="/debate-topics" component={DebateTopics} />
            <Route path="/w/:token" component={PublicWhispPage} />
            <Route path="/whisper-box/:handle" component={PublicWhisperBoxPage} />
            <Route path="/invite/:token" component={PublicInvitePage} />
            <Route path="/tw/:token" component={PublicTextWhisp} />
            {MARKETING_ROUTE_PATHS.map((path) => (
              <Route key={path} path={path} component={MarketingPage} />
            ))}
            <Route path="/privacy" component={PrivacyPolicy} />
            <Route path="/privacy-policy" component={PrivacyPolicy} />
            <Route path="/terms" component={TermsOfService} />
            <Route path="/terms-and-conditions" component={TermsOfService} />
            <Route path="/sms-terms" component={SmsTerms} />
            <Route path="/community-guidelines" component={CommunityGuidelines} />
            <Route path="/subscribe" component={SubscribePage} />
            <Route path="/verify-subscription" component={VerifySubscriptionPage} />
            <Route path="/unsubscribe" component={UnsubscribeFromMatchingPage} />

            <Route>
              <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
                <div className="text-center">
                  <h1 className="text-4xl font-serif font-bold text-foreground mb-4">404</h1>
                  <p className="text-muted-foreground">Page not found</p>
                </div>
              </div>
            </Route>
          </Switch>
        </Suspense>
        </AppErrorBoundary>
        <Toaster />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <MobileSendActionProvider>
        <ClerkProviderWithRoutes />
      </MobileSendActionProvider>
    </WouterRouter>
  );
}
