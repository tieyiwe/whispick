import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Bell, Check, Download, Share, Plus, Sparkles, ExternalLink, Copy } from "lucide-react";
import {
  useGetPushPublicKey,
  useCreatePushSubscription,
  getGetPushPublicKeyQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { LogoLockup } from "@/components/ui/logo";
import {
  isIos,
  isStandalone,
  getDeferredInstallPrompt,
  onInstallPromptAvailable,
  clearDeferredInstallPrompt,
  rememberInstalled,
  rememberDismissed,
  type BeforeInstallPromptEvent,
} from "@/lib/installApp";
import { isPushSupported, subscribeToPush, pushSubscriptionToJson } from "@/lib/push";

// Shown once, right after sign-up (Clerk's sign-up redirect points here — see
// App.tsx), as a two-in-one: install the app + turn on alerts, at the moment
// someone has just decided to join. A website can never install itself or
// grant itself notification permission: Chrome/Edge/Android only allow the
// native install dialog in response to a tap, iOS Safari has no install API
// at all (Share → Add to Home Screen), and Notification.requestPermission()
// needs a gesture too. So each step is one deliberate tap, on one screen.

type InstallMode = "prompt" | "ios" | "in-app-browser" | "installed" | "unavailable";

const SHOWN_KEY_PREFIX = "blindwhisper:welcomeShown:";

// Social apps' built-in browsers (where many people first open a Whisper Box
// or debate link) can't install a web app or reliably show push prompts.
function isInAppBrowser(): boolean {
  return /Instagram|FBAN|FBAV|FB_IAB|TikTok|BytedanceWebview|musical_ly|Snapchat|Line\/|Twitter|LinkedInApp|Pinterest/i.test(
    navigator.userAgent,
  );
}

function isIosSafari(): boolean {
  return isIos() && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
}

function initialInstallMode(): InstallMode {
  if (isStandalone()) return "installed";
  if (isInAppBrowser()) return "in-app-browser";
  if (isIosSafari()) return "ios";
  if (getDeferredInstallPrompt()) return "prompt";
  return "unavailable";
}

type NotifyState = "ask" | "on" | "blocked" | "after-install" | "unsupported";

function initialNotifyState(installMode: InstallMode): NotifyState {
  // On iPhone, web push only exists for an app added to the Home Screen and
  // opened from there — in Safari itself the API isn't available yet.
  if (isIos() && installMode !== "installed") return "after-install";
  if (!isPushSupported() || typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "on";
  if (Notification.permission === "denied") return "blocked";
  return "ask";
}

export function WelcomePage() {
  const { t } = useTranslation("welcome");
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useUser();

  const [installMode, setInstallMode] = useState<InstallMode>(initialInstallMode);
  const [installed, setInstalled] = useState(installMode === "installed");
  const [installing, setInstalling] = useState(false);
  const [notify, setNotify] = useState<NotifyState>(() => initialNotifyState(installMode));
  const [enabling, setEnabling] = useState(false);
  const [copied, setCopied] = useState(false);

  const getPushPublicKey = useGetPushPublicKey({ query: { enabled: false, queryKey: getGetPushPublicKeyQueryKey() } });
  const createPushSubscription = useCreatePushSubscription();

  // Once per account per device: revisiting /welcome later (back button, a
  // bookmarked URL) goes straight to the dashboard. The ref keeps React
  // StrictMode's double effect run (dev) from reading the flag this same
  // mount just wrote and bouncing away immediately.
  const shownCheckedRef = useRef(false);
  useEffect(() => {
    if (!isLoaded || !user || shownCheckedRef.current) return;
    shownCheckedRef.current = true;
    const key = SHOWN_KEY_PREFIX + user.id;
    try {
      if (localStorage.getItem(key)) {
        setLocation("/dashboard", { replace: true });
        return;
      }
      localStorage.setItem(key, String(Date.now()));
    } catch {
      // Storage blocked (private mode) — just show the page.
    }
  }, [isLoaded, user, setLocation]);

  // Chrome's install event can arrive a moment after the page loads.
  useEffect(() => {
    return onInstallPromptAvailable((event) => {
      setInstallMode((mode) => (mode === "unavailable" || mode === "prompt" ? (event ? "prompt" : "unavailable") : mode));
    });
  }, []);

  const nothingToDo =
    (installMode === "installed" || installMode === "unavailable") && (notify === "on" || notify === "unsupported" || notify === "blocked");
  useEffect(() => {
    if (isLoaded && nothingToDo) setLocation("/dashboard", { replace: true });
  }, [isLoaded, nothingToDo, setLocation]);

  async function handleInstall() {
    const event: BeforeInstallPromptEvent | null = getDeferredInstallPrompt();
    if (!event) return;
    setInstalling(true);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      // The captured event is single-use either way.
      clearDeferredInstallPrompt();
      if (choice.outcome === "accepted") {
        rememberInstalled();
        setInstalled(true);
      }
    } catch {
      // A failed/blocked prompt just leaves the button for another try.
    } finally {
      setInstalling(false);
    }
  }

  async function handleEnableNotifications() {
    setEnabling(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNotify(permission === "denied" ? "blocked" : "ask");
        return;
      }
      const { data } = await getPushPublicKey.refetch();
      if (!data?.publicKey) throw new Error("Missing VAPID key");
      const subscription = await subscribeToPush(data.publicKey);
      const { endpoint, keys } = pushSubscriptionToJson(subscription);
      await new Promise<void>((resolve, reject) => {
        createPushSubscription.mutate({ data: { endpoint, keys } }, { onSuccess: () => resolve(), onError: () => reject() });
      });
      setNotify("on");
    } catch {
      // Permission granted but subscribing failed (network, missing key):
      // Settings → Notifications can retry; don't block onboarding on it.
      setNotify("on");
    } finally {
      setEnabling(false);
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin + "/dashboard");
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function handleContinue() {
    // Someone who skipped installing shouldn't get the same ask again a few
    // seconds later from the in-app install banner.
    if (!installed) rememberDismissed();
    setLocation("/dashboard");
  }

  const installDone = installed || installMode === "installed";
  const notifyDone = notify === "on";

  if (!isLoaded || nothingToDo) return <div className="min-h-[100dvh] bg-background" />;

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background flex flex-col">
      <div className="pointer-events-none absolute -top-[15%] left-1/2 h-[45%] w-[90%] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-[20%] right-[-10%] h-[35%] w-[55%] rounded-full bg-secondary/10 blur-[110px]" />

      <main
        className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.5rem)", paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        <div className="flex justify-center">
          <LogoLockup />
        </div>

        {/* Heading, the two steps and the way out read as one composed unit,
            centred in the remaining height instead of the skip button being
            pinned to the bottom of a tall, mostly empty screen. */}
        <div className="flex flex-1 flex-col justify-center py-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="text-center"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" /> {t("badge")}
          </span>
          <h1 className="mt-4 font-serif text-3xl font-semibold leading-tight text-foreground">
            {user?.firstName ? t("titleNamed", { name: user.firstName }) : t("title")}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground text-pretty">{t("subtitle")}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.08, ease: "easeOut" }}
          className="mt-8 overflow-hidden rounded-2xl border border-border/50 bg-card/80 backdrop-blur divide-y divide-border/50"
        >
          {/* Step 1 — install */}
          <section
            className={`p-5 transition-colors ${installDone ? "bg-primary/10" : ""}`}
            data-testid="welcome-step-install"
          >
            <div className="flex items-start gap-3">
              <StepIcon done={installDone} index={1} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{installDone ? t("install.doneTitle") : t("install.title")}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {installDone ? t("install.doneBody") : t("install.body")}
                </p>

                {!installDone && installMode === "prompt" && (
                  <Button
                    className="mt-4 h-11 w-full rounded-full text-sm font-medium shadow-[0_0_24px_rgba(124,92,252,0.35)]"
                    onClick={handleInstall}
                    disabled={installing}
                    data-testid="button-welcome-install"
                  >
                    <Download className="mr-2 h-4 w-4" /> {t("install.button")}
                  </Button>
                )}

                {!installDone && installMode === "ios" && (
                  <ol className="mt-4 space-y-2 text-sm text-foreground/90" data-testid="welcome-ios-steps">
                    <li className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60"><Share className="h-4 w-4" /></span>
                      {t("install.iosStep1")}
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60"><Plus className="h-4 w-4" /></span>
                      {t("install.iosStep2")}
                    </li>
                  </ol>
                )}

                {!installDone && installMode === "in-app-browser" && (
                  <div className="mt-4 space-y-2" data-testid="welcome-in-app-browser">
                    <p className="flex items-start gap-2 text-sm text-foreground/90">
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("install.inAppBrowser")}
                    </p>
                    <Button variant="outline" size="sm" className="rounded-full" onClick={handleCopyLink}>
                      {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                      {copied ? t("install.copied") : t("install.copyLink")}
                    </Button>
                  </div>
                )}

                {!installDone && installMode === "unavailable" && (
                  <p className="mt-3 text-sm text-muted-foreground">{t("install.unavailable")}</p>
                )}
              </div>
            </div>
          </section>

          {/* Step 2 — notifications */}
          <section
            className={`p-5 transition-colors ${notifyDone ? "bg-primary/10" : ""}`}
            data-testid="welcome-step-notifications"
          >
            <div className="flex items-start gap-3">
              <StepIcon done={notifyDone} index={2} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{notifyDone ? t("notify.doneTitle") : t("notify.title")}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {notifyDone
                    ? t("notify.doneBody")
                    : notify === "after-install"
                      ? t("notify.afterInstall")
                      : notify === "blocked"
                        ? t("notify.blocked")
                        : notify === "unsupported"
                          ? t("notify.unsupported")
                          : t("notify.body")}
                </p>
                {notify === "ask" && (
                  <Button
                    variant={installDone || installMode !== "prompt" ? "default" : "outline"}
                    className="mt-4 h-11 w-full rounded-full text-sm font-medium"
                    onClick={handleEnableNotifications}
                    disabled={enabling}
                    data-testid="button-welcome-notifications"
                  >
                    <Bell className="mr-2 h-4 w-4" /> {t("notify.button")}
                  </Button>
                )}
              </div>
            </div>
          </section>
        </motion.div>

        <div className="mt-4">
          <Button
            variant={installDone && notifyDone ? "default" : "ghost"}
            className={`h-12 w-full rounded-full text-sm font-medium ${installDone && notifyDone ? "" : "text-muted-foreground hover:text-foreground"}`}
            onClick={handleContinue}
            data-testid="button-welcome-continue"
          >
            {installDone && notifyDone ? t("continue") : t("skip")}
          </Button>
        </div>
        </div>
      </main>
    </div>
  );
}

function StepIcon({ done, index }: { done: boolean; index: number }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
        done ? "bg-primary text-primary-foreground" : "border border-primary/40 bg-primary/10 text-primary"
      }`}
    >
      {done ? <Check className="h-4 w-4" /> : index}
    </span>
  );
}
