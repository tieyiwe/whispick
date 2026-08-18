// Chrome will not offer to install a site whose service worker has no fetch
// handler, so without this `beforeinstallprompt` never fires and the install
// prompt can't exist at all.
//
// Deliberately empty: not calling respondWith lets every request go to the
// network exactly as it would without a service worker. Caching here would
// make the app serve its own stale assets after a deploy — the precise
// problem pull-to-refresh was changed to a real reload to escape.
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Blind Whisper", body: event.data.text() };
  }
  const { title = "Blind Whisper", body, url } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // PNG, not the SVG favicon: Chrome on Android doesn't reliably render
      // SVG notification icons and silently falls back to a generic bell.
      icon: "/apple-touch-icon.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (!url) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
