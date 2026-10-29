// Network first, cache as the offline fallback: a deploy shows on the next open, and the gym with no signal still works.
const CACHE = "standard-v9";
const SHELL = ["./", "./index.html", "./app.js", "./data.js", "./vendor/preact-htm.js", "./vendor/inter-latin-400-normal.woff2", "./vendor/inter-latin-600-normal.woff2", "./vendor/inter-latin-800-normal.woff2", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
// Only our own old caches: another app on the same origin (Daily Standard) keeps its cache.
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("standard-v") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  const cached = () => caches.match(e.request, {ignoreSearch: true});
  // A Wi-Fi login page or a server error must never replace a good cached file: pages must be HTML, files must not be.
  const good = (r) => r.ok && !r.redirected && (r.headers.get("content-type") || "").includes("text/html") === (e.request.mode === "navigate");
  const net = fetch(e.request, {cache: "no-cache"}).then((r) => { if (good(r)) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; });
  e.waitUntil(net.catch(() => {}));
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const use = (r) => { if (r && !done) { done = true; resolve(r); } };
    // Weak gym signal: after 3 s show the cached copy; the network answer still refreshes the cache for next time.
    setTimeout(() => cached().then(use), 3000);
    net.then((r) => good(r) ? use(r) : cached().then((c) => use(c || r)))
      .catch(() => cached().then((c) => use(c || Response.error())));
  }));
});
