// KIASA's service worker. It does one thing: shows the alerts a person asked
// for ("Alert me on this computer") when their browser's alert service brings
// one, even with no KIASA page open, and opens the right page when one is
// clicked. It caches nothing.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let alert = {};
  try {
    alert = event.data ? event.data.json() : {};
  } catch {
    alert = {};
  }
  const url = typeof alert.url === "string" && alert.url.startsWith("/") ? alert.url : "/account";
  event.waitUntil(self.registration.showNotification(alert.title || "KIASA", {
    body: alert.body || "",
    icon: "/icon.png",
    tag: alert.tag || "kiasa",
    renotify: true,
    data: { url },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/account", self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const page = open.find(client => new URL(client.url).origin === self.location.origin);
    if (page) {
      try {
        await page.focus();
        await page.navigate(url);
        return;
      } catch {
        // A page this worker does not control cannot be steered: open a new one.
      }
    }
    await self.clients.openWindow(url);
  })());
});
