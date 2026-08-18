import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Download, X, Share, Plus } from "lucide-react";
import {
  isIos,
  isStandalone,
  shouldStayQuiet,
  rememberInstalled,
  rememberDismissed,
  type BeforeInstallPromptEvent,
} from "@/lib/installApp";

// How long after arriving before we ask. Immediately would interrupt whatever
// brought them here; a few seconds lands after the page has settled.
const APPEAR_DELAY_MS = 3500;

/**
 * Offers to install Blind Whisper to the home screen, once.
 *
 * Rendered inside AppLayout, so it only ever appears to a signed-in user —
 * asking a stranger on a public whisp page to install an app they have no
 * account for would be the wrong moment entirely.
 *
 * "Installed" is captured from three independent signals because no single one
 * is reliable: the `appinstalled` event (missed if the tab is closed during
 * install), the prompt's own accepted outcome (Chrome only), and running in
 * standalone display mode (the ground truth, but only observable once they
 * open it from the home screen). Any of the three silences this permanently.
 */
export function InstallAppPrompt() {
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const ios = isIos();

  useEffect(() => {
    if (shouldStayQuiet()) return;

    // Chrome fires this when the app meets the install criteria. Capturing it
    // (and preventing the default mini-infobar) is what lets us offer the
    // install inside our own UI at a moment that makes sense, rather than
    // whenever the browser decides.
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      setVisible(true);
    }

    // Fires on a successful install, including one done through the browser's
    // own menu rather than our button.
    function onInstalled() {
      rememberInstalled();
      setVisible(false);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // iOS never fires beforeinstallprompt, so there is nothing to wait for —
    // show the instructions on a timer instead. Safari only: an iPhone using
    // Chrome or Firefox cannot add to the home screen at all, and telling
    // someone to tap a Share button their browser doesn't have is worse than
    // staying quiet.
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (ios) {
      const safari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
      if (safari) timer = setTimeout(() => setVisible(true), APPEAR_DELAY_MS);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) clearTimeout(timer);
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
      // app still qualifies.
      deferredRef.current = null;
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
      aria-label="Install Blind Whisper"
      data-testid="install-app-prompt"
    >
      <div className="rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="flex items-start gap-3">
          <Logo className="h-10 w-auto shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-serif text-base font-semibold text-foreground">Add Blind Whisper to your phone</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {ios
                ? "Opens full screen, with no browser bars — like an app."
                : "Opens full screen from your home screen, like an app."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Not now"
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
              Tap <span className="font-medium text-foreground">Share</span> at the bottom of Safari
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                <Plus className="h-3.5 w-3.5 text-primary" />
              </span>
              Choose <span className="font-medium text-foreground">Add to Home Screen</span>
            </li>
          </ol>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button onClick={handleInstall} disabled={installing} className="flex-1" data-testid="install-app-confirm">
              <Download className="mr-1.5 h-4 w-4" />
              {installing ? "Installing..." : "Install"}
            </Button>
            <Button variant="ghost" onClick={handleDismiss} data-testid="install-app-later">
              Not now
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
