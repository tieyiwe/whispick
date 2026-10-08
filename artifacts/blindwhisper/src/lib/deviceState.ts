import { clearSavedCircleDmTokens } from "@/lib/circleDm";
import { clearVisitorId } from "@/lib/anonymousVisitor";
import { getExistingPushSubscription } from "@/lib/push";

// Everything this device remembers about the signed-in person's anonymous
// activity, wiped on sign-out so a shared device doesn't hand it to whoever
// uses it next: private Circle DM thread tokens, the anonymous visitor id,
// and this browser's push subscription (its notifications describe the
// previous person's whisps/replies, and a later sign-in would otherwise
// re-register it to the next account — see syncPushSubscription).
export function clearAnonymousDeviceState(): void {
  clearSavedCircleDmTokens();
  clearVisitorId();
  void getExistingPushSubscription()
    .then((subscription) => subscription?.unsubscribe())
    .catch(() => {});
}
