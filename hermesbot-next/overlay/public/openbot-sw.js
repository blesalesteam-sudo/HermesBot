// OpenBot: el «trabajador» que recibe los avisos aunque OpenBot esté cerrada (server/openbot-webpush.ts).
// - Enseña cada aviso con el nombre del bot y el principio de su mensaje, como Grok Bot; los de un mismo bot se
//   sustituyen (no se amontonan), y la insignia del icono cuenta cuántos bots tienen algo nuevo.
// - Al tocarlo abre OpenBot justo en esa conversación (o la lleva allí si ya estaba abierta).
// No guarda páginas ni datos: no hace de caché.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function updateBadge() {
  try {
    const shown = await self.registration.getNotifications();
    const bots = new Set(shown.map((n) => (n.data && n.data.botId) || n.tag));
    if (bots.size > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(bots.size);
    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch {
    /* sin insignia en este navegador */
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "OpenBot", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "OpenBot";
  const options = {
    body: data.body || "",
    tag: data.tag || "openbot",
    renotify: true,
    icon: data.icon || "/openbot-logo-192.png",
    badge: "/openbot-logo-192.png",
    timestamp: data.at || Date.now(),
    data: { url: data.url || "/", botId: data.botId || null, threadId: data.threadId || null },
    requireInteraction: data.kind === "approval" || data.kind === "question" || data.kind === "secret" || data.kind === "sign-in",
  };
  event.waitUntil(self.registration.showNotification(title, options).then(updateBadge));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = new URL(data.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      open.postMessage({ type: "openbot:abrir", botId: data.botId, threadId: data.threadId });
      try { await open.focus(); } catch { /* algunos navegadores solo dejan abrir */ }
    } else {
      await self.clients.openWindow(url);
    }
    await updateBadge();
  })());
});

self.addEventListener("notificationclose", (event) => event.waitUntil(updateBadge()));

// La app abierta pide quitar los avisos de una conversación que ya se está viendo (o todos).
self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type !== "openbot:visto") return;
  event.waitUntil((async () => {
    const shown = await self.registration.getNotifications();
    for (const n of shown) {
      const d = n.data || {};
      if (msg.all || (msg.botId && d.botId === msg.botId) || (msg.threadId && d.threadId === msg.threadId)) n.close();
    }
    await updateBadge();
  })());
});
