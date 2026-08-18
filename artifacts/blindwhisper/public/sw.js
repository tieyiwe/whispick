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
      // Reuse ANY already-open Blind Whisper window, not just one sitting on
      // the exact target URL — an installed app that happens to be open on
      // /dashboard is still the window a notification about /whisps/abc
      // should land in. Matching on origin (rather than requiring an exact
      // URL match) is what makes that the common case instead of the rare
      // one, which in turn is what keeps a click from spawning a second
      // window/tab next to an app that's already running.
      const existing = clients.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      if (existing) {
        // navigate() only exists on WindowClient, and can reject (e.g. the
        // page has since been discarded) — focus() still gets attempted
        // either way, so the click always lands somewhere.
        return Promise.resolve(existing.navigate ? existing.navigate(url).catch(() => {}) : undefined).then(
          () => "focus" in existing && existing.focus()
        );
      }
      // No window open at all: openWindow() launches inside the installed
      // app rather than a browser tab whenever one is installed for this
      // origin/scope — that association is handled by the browser itself
      // (see manifest.webmanifest's scope), not something this code decides.
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
