import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { isIos, isMobileDevice, onNotificationStepDone } from "@/lib/installApp";

/**
 * A brief, one-time nudge right after a desktop install completes: the app
 * icon exists now, but it's still buried wherever the OS put it until the
 * user pins it somewhere one click away. Phones don't need this — the
 * install flow there already puts the icon exactly where "pinned" apps
 * live, the home screen — so this only listens on desktop.
 *
 * Mounted once, globally, alongside ServiceWorkerRegistration (not inside
 * InstallAppPrompt) so it isn't tied to whichever page happened to trigger
 * the install. Listens for `onNotificationStepDone`, not `onJustInstalled`
 * directly — EnableNotificationsPrompt is the first post-install nudge, and
 * this one is meant to follow it, not compete for the same fixed
 * bottom-of-viewport slot at the same time.
 */
export function PinToTaskbarTip() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isIos() || isMobileDevice()) return;
    return onNotificationStepDone(() => setVisible(true));
  }, []);

  if (!visible) return null;

  const mac = /Macintosh|Mac OS X/.test(navigator.userAgent);
  const instructions = mac
    ? 'Right-click its Dock icon → Options → "Keep in Dock."'
    : 'Right-click its taskbar icon → "Pin to taskbar."';

  return (
    <div
      className="fixed inset-x-3 z-[60] bottom-4 md:left-auto md:right-4 md:w-96"
      role="status"
      aria-label="Pin Blind Whisper for one-click access"
      data-testid="pin-taskbar-tip"
    >
      <div className="rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-serif text-sm font-semibold text-foreground">Installed! One more step</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pin it for one-click access next time: open Blind Whisper, then {instructions}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          data-testid="pin-taskbar-dismiss"
          className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
