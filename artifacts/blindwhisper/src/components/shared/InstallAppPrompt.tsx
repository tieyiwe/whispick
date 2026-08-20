import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Download, X, Share, Plus } from "lucide-react";
import {
  isIos,
  isMobileDevice,
  isStandalone,
  shouldStayQuiet,
  rememberInstalled,
  rememberDismissed,
  onInstallPromptAvailable,
  clearDeferredInstallPrompt,
  hasAppLayoutRenderedThisTab,
  notifyJustInstalled,
  type BeforeInstallPromptEvent,
} from "@/lib/installApp";

// How long after arriving before we ask, on iOS, where there's no captured
// event to wait for — see the two Android/Chrome delays below for the
// reasoning this mirrors.
const IOS_APPEAR_DELAY_MS = 3000;

// Two different delays for two different moments. Someone who just finished
// signing in is still mid-task — landing straight in the dashboard, likely
// about to go do the thing they came to do; asking immediately competes with
// that. A refresh is a much quieter moment (they're already settled into the
// app), so it earns a shorter wait. hasAppLayoutRenderedThisTab is what tells
// the two apart: a same-tab reload reads as "already seen", a fresh sign-in
// or a new tab reads as "not yet".
const SIGN_IN_APPEAR_DELAY_MS = 5000;
const REFRESH_APPEAR_DELAY_MS = 3000;

/**
 * Offers to install Blind Whisper to the home screen, once.
 *
 * Rendered in two places: inside AppLayout, so it appears to a signed-in
 * user going about the product, and on the public LandingPage, so a
 * signed-out visitor — someone who already has an account and is just
 * browsing signed out, or a brand-new visitor checking the product out —
 * gets the same nudge at their own front door. Deliberately NOT rendered on
 * a public whisp/invite/Text Whisp landing page: a Recipient who followed a
 * link they didn't ask for has no relationship to the app yet, and asking
 * them to install one they have no account for would be the wrong moment
 * entirely.
 *
 * "Installed" is captured from three independent signals because no single one
 * is reliable: the `appinstalled` event (missed if the tab is closed during
 * install), the prompt's own accepted outcome (Chrome only), and running in
 * standalone display mode (the ground truth, but only observable once they
 * open it from the home screen). Any of the three silences this permanently.
 */
export function InstallAppPrompt() {
  const { t } = useTranslation("sharedB");
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const ios = isIos();
  // Read once — this doesn't change over the component's lifetime, and the
  // whole point is to pick copy that matches the device, not to react to it.
  const [mobile] = useState(isMobileDevice);

  useEffect(() => {
    if (shouldStayQuiet()) return;

    // Read (and mark) once per mount, not per event delivery — the tab's
    // status as "already seen" shouldn't change based on how many times the
    // captured-event callback happens to fire below.
    const delay = hasAppLayoutRenderedThisTab() ? REFRESH_APPEAR_DELAY_MS : SIGN_IN_APPEAR_DELAY_MS;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;

    // Subscribes to the module-level capture in lib/installApp.ts rather than
    // attaching a beforeinstallprompt listener here directly. That event
    // fires once per page load, often before sign-in — before this
    // component, which only exists inside AppLayout, has ever mounted — so a
    // listener attached at this point would reliably miss it. Subscribing
    // instead delivers whatever was already captured immediately (the
    // common case, since the event has almost always already arrived by the
    // time AppLayout's chunk loads) and anything that arrives later (rare,
    // but possible if the criteria aren't met until partway through the
    // visit).
    const unsubscribe = onInstallPromptAvailable((event) => {
      deferredRef.current = event;
      if (revealTimer) clearTimeout(revealTimer);
      if (event === null) {
        setVisible(false);
        return;
      }
      revealTimer = setTimeout(() => setVisible(true), delay);
    });

    // iOS never fires beforeinstallprompt, so there is nothing to wait for —
    // show the instructions on their own timer instead. Safari only: an
    // iPhone using Chrome or Firefox cannot add to the home screen at all,
    // and telling someone to tap a Share button their browser doesn't have
    // is worse than staying quiet.
    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (ios) {
      const safari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
      if (safari) iosTimer = setTimeout(() => setVisible(true), IOS_APPEAR_DELAY_MS);
    }

    return () => {
      unsubscribe();
      if (revealTimer) clearTimeout(revealTimer);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, [ios]);

  // Catches the case the events can't: they installed it, and are now opening
  // the app from the home screen. Checked on every mount, so the very first
  // standalone launch records it and no later browser visit asks again.
  useEffect(() => {
    if (isStandalone()) {
      rememberInstalled();
      setVisible(false);
    }
  }, []);

  async function handleInstall() {
    const deferred = deferredRef.current;
    if (!deferred) return;

    setInstalling(true);
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") {
        // Recorded here as well as on `appinstalled`, since that event can be
        // missed if the page is backgrounded while the OS finishes installing.
        rememberInstalled();
        notifyJustInstalled();
        setVisible(false);
      } else {
        // Declining the OS dialog is a real answer — treat it as "not now"
        // rather than re-offering on the next screen.
        rememberDismissed();
        setVisible(false);
      }
    } finally {
      setInstalling(false);
      // A prompt can only be used once; Chrome issues a fresh event if the
      // app still qualifies. Cleared in the shared store too, or the next
      // mount (a different tab, or this one after a route change) would read
      // back an already-spent event.
      deferredRef.current = null;
      clearDeferredInstallPrompt();
    }
  }

  function handleDismiss() {
    rememberDismissed();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-3 z-[60] bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] md:bottom-4 md:left-auto md:right-4 md:w-96"
      role="dialog"
      aria-label={t("installAppPrompt.dialogAriaLabel")}
      data-testid="install-app-prompt"
    >
      <div className="rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="flex items-start gap-3">
          <Logo className="h-10 w-auto shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-serif text-base font-semibold text-foreground">
              {ios || mobile ? t("installAppPrompt.titleMobile") : t("installAppPrompt.titleDesktop")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {ios
                ? t("installAppPrompt.descriptionIos")
                : mobile
                  ? t("installAppPrompt.descriptionMobile")
                  : t("installAppPrompt.descriptionDesktop")}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t("installAppPrompt.notNow")}
            data-testid="install-app-dismiss"
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {ios ? (
          // No install API exists on iOS, so this is the whole feature there:
          // say exactly which two taps to make, using the icons they'll see.
          <ol className="mt-3 space-y-2 text-xs text-muted-foreground">
            <li className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                <Share className="h-3.5 w-3.5 text-primary" />
              </span>
              <Trans i18nKey="installAppPrompt.iosStepShare" t={t}>
                Tap <span className="font-medium text-foreground">Share</span> at the bottom of Safari
              </Trans>
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                <Plus className="h-3.5 w-3.5 text-primary" />
              </span>
              <Trans i18nKey="installAppPrompt.iosStepAddHome" t={t}>
                Choose <span className="font-medium text-foreground">Add to Home Screen</span>
              </Trans>
            </li>
          </ol>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button onClick={handleInstall} disabled={installing} className="flex-1" data-testid="install-app-confirm">
              <Download className="mr-1.5 h-4 w-4" />
              {installing ? t("installAppPrompt.installing") : t("installAppPrompt.install")}
            </Button>
            <Button variant="ghost" onClick={handleDismiss} data-testid="install-app-later">
              {t("installAppPrompt.notNow")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
