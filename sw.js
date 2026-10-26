// Network first, cache as the offline fallback: a deploy shows on the next open, and the gym with no signal still works.
const CACHE = "standard-v8";
const SHELL = ["./", "./index.html", "./app.js", "./data.js", "./vendor/preact-htm.js", "./vendor/inter-latin-400-normal.woff2", "./vendor/inter-latin-600-normal.woff2", "./vendor/inter-latin-800-normal.woff2", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, {cache: "no-cache"})
    .then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, {ignoreSearch: true})));
});
