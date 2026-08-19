import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useGetPushPublicKey,
  useCreatePushSubscription,
  getGetPushPublicKeyQueryKey,
} from "@workspace/api-client-react";
import {
  isPushSupported,
  getExistingPushSubscription,
  subscribeToPush,
  pushSubscriptionToJson,
} from "@/lib/push";
import { onJustInstalled, announceNotificationStepDone } from "@/lib/installApp";

// A browser can never be silently opted into push — Notification.
// requestPermission() always needs a real user gesture, and a permission
// denied once can't be re-prompted automatically ever again. "Enabled by
// default" for an installed app means the closest honest equivalent:
// asking proactively, right after install, instead of leaving it buried in
// Settings for someone to find on their own. Mounted once, globally
// (alongside ServiceWorkerRegistration/PinToTaskbarTip), so it fires
// regardless of which page triggered the install.
export function EnableNotificationsPrompt() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const getPushPublicKey = useGetPushPublicKey({ query: { enabled: false, queryKey: getGetPushPublicKeyQueryKey() } });
  const createPushSubscription = useCreatePushSubscription();

  useEffect(() => {
    return onJustInstalled(() => {
      void (async () => {
        // Nothing to ask for on this browser (desktop Safari, older
        // engines), already answered (granted or denied) on a previous
        // install of this same app, or already subscribed somehow — skip
        // straight to the next post-install step in every one of those
        // cases rather than showing a prompt with nothing useful to do.
        if (!isPushSupported() || typeof Notification === "undefined" || Notification.permission !== "default") {
          announceNotificationStepDone();
          return;
        }
        const existing = await getExistingPushSubscription().catch(() => null);
        if (existing) {
          announceNotificationStepDone();
          return;
        }
        setVisible(true);
      })();
    });
  }, []);

  async function handleEnable() {
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        const { publicKey } = await getPushPublicKey.refetch().then((r) => {
          if (!r.data) throw new Error("Missing VAPID key");
          return r.data;
        });
        const subscription = await subscribeToPush(publicKey);
        const { endpoint, keys } = pushSubscriptionToJson(subscription);
        await new Promise<void>((resolve, reject) => {
          createPushSubscription.mutate(
            { data: { endpoint, keys } },
            { onSuccess: () => resolve(), onError: () => reject() },
          );
        });
      }
    } catch {
      // Same posture as ServiceWorkerRegistration's own failure handling —
      // this is a nudge, not a required step, so a failure here just means
      // trying again later from Settings rather than a surfaced error.
    } finally {
      setLoading(false);
      setVisible(false);
      announceNotificationStepDone();
    }
  }

  function handleDismiss() {
    setVisible(false);
    announceNotificationStepDone();
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-3 z-[60] bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] md:bottom-4 md:left-auto md:right-4 md:w-96"
      role="dialog"
      aria-label="Turn on notifications"
      data-testid="enable-notifications-prompt"
    >
      <div className="rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Bell className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-serif text-base font-semibold text-foreground">Turn on notifications</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Get notified the moment someone whisps you, or replies — right on your device, like any other app.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Not now"
            data-testid="enable-notifications-dismiss-icon"
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={handleEnable} disabled={loading} className="flex-1" data-testid="enable-notifications-confirm">
            {loading ? "Enabling..." : "Enable notifications"}
          </Button>
          <Button variant="ghost" onClick={handleDismiss} data-testid="enable-notifications-later">
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}
