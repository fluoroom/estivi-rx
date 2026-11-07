// Keeps the page shell available for an offline start. Everything still goes
// to the network first, so a new build is picked up exactly as before.
const CACHE = "estivi-rx-v2";
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./js/ax25.js",
  "./js/dsp.js",
  "./js/engine.js",
  "./js/i18n.js",
  "./js/modes.js",
  "./js/schedule.js",
  "./js/sstv.js",
  "./js/store.js",
  "./js/tap-worklet.js",
  "./manifest.webmanifest",
  "./icons/icon-32.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./fonts/IBMPlexSans-Regular.ttf",
  "./fonts/IBMPlexSans-Medium.ttf",
  "./fonts/IBMPlexMono-Regular.ttf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) || Response.error()),
  );
});
