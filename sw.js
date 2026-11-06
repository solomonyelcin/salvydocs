// Keeps the app itself available offline and speeds up repeat visits.
// Pages and scripts: network first, so a new version always wins when online; the saved copy is used offline.
// Photos, videos and Google calls are not stored here; the browser's own cache handles those.
const CACHE = "memories-shell-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "ai.js", "config.js", "manifest.webmanifest", "icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const data = /\/(library|search-index)\.json$|\/groups\.json$/.test(url.pathname);
  e.respondWith((async () => {
    try {
      const res = await fetch(req, data ? { cache: "no-cache" } : undefined);
      if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") return (await caches.match("index.html")) || Response.error();
      return Response.error();
    }
  })());
});
