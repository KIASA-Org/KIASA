// KIASA's service worker. It shows alerts on this computer and opens the right
// page when one is clicked; it caches nothing. Alerts come two ways:
// - from KIASA's own pages, for a new chat message: every open KIASA desk (the
//   chat, the jobs desk, the admin and account pages) hears it and hands it
//   here, and it shows once, unless KIASA Chat is the window in front, where the
//   message is there to read;
// - from the browser's alert service, for the decision on an account request
//   ("Alert me on this computer"), even with no KIASA page open.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

// The messages already shown, so one heard by several pages shows once.
const shown = new Map();

self.addEventListener("message", event => {
  const alert = event.data;
  if (!alert || alert.type !== "alert" || typeof alert.title !== "string") return;
  event.waitUntil((async () => {
    const now = Date.now();
    for (const [id, at] of shown) if (now - at > 5 * 60_000) shown.delete(id);
    if (typeof alert.id === "string") {
      if (shown.has(alert.id)) return;
      shown.set(alert.id, now);
    }
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (!alert.test && pages.some(page => page.focused && new URL(page.url).pathname === "/chat")) return;
    const chat = typeof alert.chatId === "string" ? alert.chatId : null;
    await self.registration.showNotification(alert.title.slice(0, 120), {
      body: typeof alert.body === "string" ? alert.body.slice(0, 300) : "",
      icon: typeof alert.icon === "string" && alert.icon ? alert.icon : "/icon.png",
      badge: "/icon.png",
      // A chat's newest message takes the place of the one before, and still sounds.
      tag: chat ? `chat-${chat}` : alert.test ? "kiasa-test" : "kiasa",
      renotify: true,
      data: { url: chat ? `/chat?c=${encodeURIComponent(chat)}` : "/chat", chat },
    });
  })());
});

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
  const data = event.notification.data || {};
  const url = new URL(typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/account", self.location.origin).href;
  event.waitUntil((async () => {
    const pages = (await self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .filter(page => new URL(page.url).origin === self.location.origin);
    // A message's alert: the chat already open shows that chat, without loading again.
    const chatPage = data.chat ? pages.find(page => new URL(page.url).pathname === "/chat") : null;
    if (chatPage) {
      try {
        await chatPage.focus();
        chatPage.postMessage({ type: "open-chat", chat: data.chat });
        return;
      } catch {
        // Not to be brought forward: the steps below open the chat another way.
      }
    }
    const page = pages[0];
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
