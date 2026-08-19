// Chrome will not offer to install a site whose service worker has no fetch
// handler, so without this `beforeinstallprompt` never fires and the install
// prompt can't exist at all.
//
// Deliberately empty: not calling respondWith lets every request go to the
// network exactly as it would without a service worker. Caching here would
// make the app serve its own stale assets after a deploy — the precise
// problem pull-to-refresh was changed to a real reload to escape.
self.addEventListener("fetch", () => {});

// Without these two, a new service worker installs after every deploy but
// sits in the "waiting" state until every open tab/window of the app is
// fully closed — which for an installed PWA that people rarely quit outright
// can be days. skipWaiting + clients.claim make a newly-installed worker
// take over immediately, which is what lib/appUpdate.ts's update detection
// (see App.tsx's ServiceWorkerRegistration) depends on: it learns a new
// version is live by watching for exactly this handover.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

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
