/* ==========================================================================
   SAKU HARGA — Service Worker PWA
   Menyimpan kerangka halaman (/harga) agar dapat dipasang ke layar utama Android
   dan tetap terbuka cepat meski sinyal lemah. Data harga diambil langsung dari
   API (tidak di-cache di sini) supaya angka selalu segar.
   ========================================================================== */

const CACHE_NAME = 'saku-harga-shell-v1';
const SHELL_ASSETS = [
    '/harga',
    '/harga.html',
    '/harga.css',
    '/harga.js',
    '/style.css',
    '/manifest.webmanifest',
    '/icons/app-icon.svg',
    '/icons/app-icon-192.png',
    '/icons/app-icon.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key.startsWith('saku-harga-') && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    // Jangan pernah menyimpan respons API di Service Worker agar harga selalu akurat.
    if (url.pathname.startsWith('/api/')) return;

    // Navigasi halaman: utamakan jaringan, jatuh ke shell tersimpan saat offline.
    if (request.mode === 'navigate') {
        if (url.pathname === '/harga' || url.pathname === '/harga/' || url.pathname.endsWith('/harga.html')) {
            event.respondWith(
                fetch(request)
                    .then((response) => {
                        if (response && response.ok && !response.redirected) {
                            const copy = response.clone();
                            caches.open(CACHE_NAME).then((cache) => cache.put('/harga.html', copy)).catch(() => {});
                        }
                        return response;
                    })
                    .catch(async () => {
                        const cached = await caches.match('/harga.html') || await caches.match('/harga');
                        return cached || Response.error();
                    })
            );
        }
        return;
    }

    // Aset statis kerangka: stale-while-revalidate.
    if (SHELL_ASSETS.includes(url.pathname)) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(request);
                const networkPromise = fetch(request)
                    .then((response) => {
                        if (response && response.ok) {
                            cache.put(request, response.clone()).catch(() => {});
                        }
                        return response;
                    })
                    .catch(() => null);
                return cached || await networkPromise || Response.error();
            })
        );
    }
});
