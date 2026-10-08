function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const basePath = import.meta.env.BASE_URL;
  return navigator.serviceWorker.register(`${basePath}sw.js`, { scope: basePath });
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
  const registration = await registerServiceWorker();
  await navigator.serviceWorker.ready;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
  });
}

// Re-registers this browser's CURRENT push subscription (if any) with the
// backend through the normal Bearer-authenticated API call. Needed because a
// browser can rotate the subscription on its own (sw.js's
// pushsubscriptionchange), and the service worker can't register the new
// endpoint itself — it has no Clerk token. Idempotent: the server upserts by
// endpoint. Never creates a subscription: no subscription means push is off
// (or was turned off in Settings), and that's left alone.
export async function syncPushSubscription(
  register: (input: { endpoint: string; keys: { p256dh: string; auth: string } }) => Promise<unknown>,
): Promise<void> {
  if (!isPushSupported() || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  await register(pushSubscriptionToJson(subscription));
}

export function pushSubscriptionToJson(subscription: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint!,
    keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! },
  };
}
