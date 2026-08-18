import { lazy, Suspense, useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from '@clerk/react';
import { registerServiceWorker } from "@/lib/push";
// Imported for its module-level side effect: capturing beforeinstallprompt
// from the moment this script evaluates, not from whenever the install UI
// happens to mount. That UI lives inside AppLayout, which is pulled in by a
// lazily-loaded route chunk that only loads once auth has resolved and
// routing has landed somewhere — by which point the one-shot event may
// already have fired into a page with nothing listening. This file sits in
// App.tsx's own eager bundle specifically so the listener is live before any
// of that.
import "@/lib/installApp";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { dark } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { Loader2 } from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";

import { LandingPage } from "@/pages/LandingPage";
import { Dashboard } from "@/pages/Dashboard";
import { AdminRoute } from "@/components/layout/AdminRoute";
import { ClaimPendingInvite } from "@/components/shared/ClaimPendingInvite";

// Everything below is off the critical first-load path (landing, sign-in/up,
// and dashboard are the only pages most visits ever touch) — code-split so a
// visitor never downloads/parses the admin panel (and the recharts library
// it pulls in via AdminAnalytics) or any other page they didn't ask for.
// Named exports need the `.then(m => ({ default: m.X }))` unwrap since
// React.lazy only accepts a module with a default export.
const PrivacyPolicy = lazy(() => import("@/pages/PrivacyPolicy").then((m) => ({ default: m.PrivacyPolicy })));
const TermsOfService = lazy(() => import("@/pages/TermsOfService").then((m) => ({ default: m.TermsOfService })));
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
const CreditsPage = lazy(() => import("@/pages/CreditsPage").then((m) => ({ default: m.CreditsPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const PublicWhispPage = lazy(() => import("@/pages/PublicWhispPage").then((m) => ({ default: m.PublicWhispPage })));
const InvitePage = lazy(() => import("@/pages/InvitePage").then((m) => ({ default: m.InvitePage })));
const PublicInvitePage = lazy(() => import("@/pages/PublicInvitePage").then((m) => ({ default: m.PublicInvitePage })));
const PublicTextWhisp = lazy(() => import("@/pages/PublicTextWhisp").then((m) => ({ default: m.PublicTextWhisp })));
const TextWhispsList = lazy(() => import("@/pages/TextWhispsList").then((m) => ({ default: m.TextWhispsList })));
const SendTextWhisp = lazy(() => import("@/pages/SendTextWhisp").then((m) => ({ default: m.SendTextWhisp })));
const TextWhispDetail = lazy(() => import("@/pages/TextWhispDetail").then((m) => ({ default: m.TextWhispDetail })));
const SubscribePage = lazy(() => import("@/pages/SubscribePage").then((m) => ({ default: m.SubscribePage })));
const VerifySubscriptionPage = lazy(() => import("@/pages/VerifySubscriptionPage").then((m) => ({ default: m.VerifySubscriptionPage })));
const UnsubscribeFromMatchingPage = lazy(() => import("@/pages/UnsubscribeFromMatchingPage").then((m) => ({ default: m.UnsubscribeFromMatchingPage })));

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
const AdminNotifications = lazy(() => import("@/pages/admin/AdminNotifications").then((m) => ({ default: m.AdminNotifications })));

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
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
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
    cardBox: "bg-[#2D2A45] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-[0_0_24px_rgba(124,92,252,0.15)]",
    card: "!shadow-none !border-0 !bg-transparent",
    footer: "!shadow-none !border-0 !bg-transparent",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 relative overflow-hidden">
      <div className="absolute top-[10%] left-[20%] w-[40%] h-[40%] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[10%] right-[20%] w-[30%] h-[30%] bg-secondary/8 rounded-full blur-[100px] pointer-events-none" />
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={`${basePath}/dashboard`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 relative overflow-hidden">
      <div className="absolute top-[10%] left-[20%] w-[40%] h-[40%] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[10%] right-[20%] w-[30%] h-[30%] bg-secondary/8 rounded-full blur-[100px] pointer-events-none" />
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={`${basePath}/dashboard`} />
    </div>
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
    return () => setAuthTokenGetter(null);
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
    void registerServiceWorker().catch(() => {});
  }, []);

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

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in"><Component /></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      {...(clerkProxyUrl ? { proxyUrl: clerkProxyUrl } : {})}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkAuthTokenBridge />
        <ServiceWorkerRegistration />
        <ClerkQueryClientCacheInvalidator />
        <ClaimPendingInvite />
        <Suspense fallback={<RouteLoadingFallback />}>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />

            <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
            <Route path="/send" component={() => <ProtectedRoute component={SendWhisp} />} />
            <Route path="/suggestions" component={() => <ProtectedRoute component={SuggestionsLibrary} />} />
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
            <Route path="/credits" component={() => <ProtectedRoute component={CreditsPage} />} />
            <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
            <Route path="/invite" component={() => <ProtectedRoute component={InvitePage} />} />
            <Route path="/send-text" component={() => <ProtectedRoute component={SendTextWhisp} />} />
            <Route path="/text-whisps/:id" component={() => <ProtectedRoute component={TextWhispDetail} />} />
            <Route path="/text-whisps" component={() => <ProtectedRoute component={TextWhispsList} />} />

            <Route path="/admin/users/:id" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminUserDetail} />} />} />
            <Route path="/admin/users" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminUsers} />} />} />
            <Route path="/admin/whisps/:id" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminWhispDetail} />} />} />
            <Route path="/admin/whisps" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminWhisps} />} />} />
            <Route path="/admin/analytics" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminAnalytics} />} />} />
            <Route path="/admin/suggestions" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminSuggestions} />} />} />
            <Route path="/admin/moderation" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminModeration} />} />} />
            <Route path="/admin/notifications" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminNotifications} />} />} />
            <Route path="/admin" component={() => <ProtectedRoute component={() => <AdminRoute component={AdminDashboard} />} />} />

            <Route path="/w/:token" component={PublicWhispPage} />
            <Route path="/invite/:token" component={PublicInvitePage} />
            <Route path="/tw/:token" component={PublicTextWhisp} />
            <Route path="/privacy" component={PrivacyPolicy} />
            <Route path="/privacy-policy" component={PrivacyPolicy} />
            <Route path="/terms" component={TermsOfService} />
            <Route path="/terms-and-conditions" component={TermsOfService} />
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
        <Toaster />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}
