/* AgriSight AI service worker (Step 8): offline app shell, audio, model. */
const VERSION = "agrisight-v2-1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const AUDIO = `${VERSION}-audio`;
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/leaf-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isAudio = (url) => url.pathname.startsWith("/api/farmer/audio/") || url.pathname.startsWith("/api/farmer/audio-scripts/");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache POSTs (diagnoses) or auth
  const url = new URL(req.url);

  if (req.mode === "navigate") {
    // network first, cached shell when offline (SPA routes)
    event.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }
  if (url.origin === self.location.origin && /^\/(assets|models)\//.test(url.pathname)) {
    // hashed/immutable build assets, model and WASM runtime: cache first
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(ASSETS).then((c) => c.put(req, res.clone()));
            return res;
          })
      )
    );
    return;
  }
  if (isAudio(url)) {
    // pre-generated clips + scripts: stale-while-revalidate
    event.respondWith(
      caches.open(AUDIO).then((cache) =>
        cache.match(req).then((hit) => {
          const net = fetch(req)
            .then((res) => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            })
            .catch(() => hit);
          return hit || net;
        })
      )
    );
  }
  // everything else (API data, personal data): network only, never cached
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_URLS") return;
  const port = event.ports[0];
  event.waitUntil(
    (async () => {
      let ok = true;
      for (const u of event.data.urls) {
        try {
          const url = new URL(u, self.location.origin);
          const cache = await caches.open(isAudio(url) ? AUDIO : ASSETS);
          const res = await fetch(url, { mode: url.origin === self.location.origin ? "same-origin" : "cors" });
          if (res.ok) await cache.put(url.href, res);
          else ok = false;
        } catch {
          ok = false;
        }
      }
      port?.postMessage({ ok });
    })()
  );
});
