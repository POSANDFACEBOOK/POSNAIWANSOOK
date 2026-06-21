// FOODCOST service worker — Web Push for the Area-approval notifications.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "แจ้งเตือน FOODCOST";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: d.tag || "approval",
    renotify: true,
    requireInteraction: false,
    data: { url: d.url || "/?approve=1" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/?approve=1";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cls) => {
    for (const c of cls) {
      if ("focus" in c) { try { c.navigate && c.navigate(url); } catch {} return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
