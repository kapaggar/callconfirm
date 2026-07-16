// v4: the PWA call-tracker was retired — index.html is now a static signpost to
// the on-page inline tracker. The cache bump evicts the old precached app shell
// (and its SheetJS bundle) so returning users get the landing page.
const CACHE = "vcall-v4";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match(e.request).then(r =>
        r || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())
      )
    )
  );
});
