// sw.js — makes Clay Blocks work offline once it has loaded once.
// Everything the app needs is in this list. There is no CDN.
// Bump CACHE when those files change, so an update replaces the old copy.
const CACHE = 'clay-blocks-v3';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/scene.js',
  './js/voice.js',
  './js/storage.js',
  './js/exporters.js',
  './js/printcheck.js',
  './js/help.js',
  './vendor/three.module.js',
  './vendor/three-mesh-bvh.module.js',
  './vendor/three-bvh-csg.module.js',
  './vendor/BufferGeometryUtils.js',
  './vendor/OrbitControls.js',
  './vendor/STLLoader.js',
  './vendor/OBJLoader.js',
  './vendor/fflate.module.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './fonts/AtkinsonHyperlegible-Regular.ttf',
  './fonts/AtkinsonHyperlegible-Bold.ttf',
  './fonts/OFL.txt',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Our files come from the cache first, so the app still opens offline.
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  e.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
