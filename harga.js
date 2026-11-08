/* ==========================================================================
   SAKU HARGA — PWA Ringan Khusus Pemilik Toko (Merchant Pricing Tool)
   Penerapan Prinsip Anti-Slop Frontend (tasteskill 2.5 / Leonxlnx):
   - Satu sistem konsisten, tipografi tajam dengan font Geist Mono tabular
   - Thumbnail visual nyata untuk tiap produk (121 katalog sayur / PNG hybrid)
   - Kartu harga berkarakter dengan badge margin dinamis
   - Sheet editor taktil dengan preview kalkulasi laba dan penyesuaian cepat
   - Sinkronisasi realtime praktis (10s delta + BroadcastChannel)
   ========================================================================== */
(() => {
    'use strict';

    const SESSION_KEY = 'saku-user-session-v1';
    const SESSION_TOKEN_KEY = 'saku-session-token-v1';
    const THEME_KEY = 'saku-theme';
    const CACHE_PREFIX = 'saku-harga-cache-v2:';
    const PRICE_CHANNEL_NAME = 'saku-pos-prices';
    const PRICE_BUMP_KEY = 'saku-pos-price-bump';

    const POLL_INTERVAL_MS = 10_000;
    const FULL_SYNC_EVERY = 12; // Setiap 12 siklus (~2 menit) lakukan sinkron penuh

    const API_BASE_URL = (typeof window !== 'undefined' && window.location.origin.startsWith('http') && !window.location.origin.includes('github.io'))
        ? `${window.location.origin}/api`
        : 'https://saku-sloth.vercel.app/api';

    const IS_CROSS_ORIGIN_API = (() => {
        try { return new URL(API_BASE_URL).origin !== window.location.origin; } catch { return false; }
    })();

    const rupiah = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    });
    const numberFmt = new Intl.NumberFormat('id-ID', {
        maximumFractionDigits: 0
    });

    const CATEGORY_LABELS = {
        ALL: 'Semua',
        MISSING_COST: 'Perlu HPP',
        SAYUR_DAUN: 'Sayur Daun',
        BUMBU_TIMBANG: 'Bumbu & Timbang',
        SEMBAKO: 'Sembako',
        BUNGKUSAN: 'Bungkusan',
        UMUM: 'Umum'
    };

    const QUICK_STEPS = [
        { label: '-1.000', delta: -1000 },
        { label: '-500', delta: -500 },
        { label: '+500', delta: 500 },
        { label: '+1.000', delta: 1000 },
        { label: '+2.000', delta: 2000 },
        { label: '+5.000', delta: 5000 }
    ];

    const $ = (id) => document.getElementById(id);

    const state = {
        token: '',
        user: null,
        products: [],
        category: 'ALL',
        search: '',
        editingId: null,
        lastUpdatedMs: 0,
        lastSyncAt: 0,
        pollCount: 0,
        syncing: false,
        deferredInstallPrompt: null
    };

    const els = {};
    let pollTimer = null;
    let toastTimer = null;
    let toastActionHandler = null;
    let priceChannel = null;

    try {
        if ('BroadcastChannel' in window) {
            priceChannel = new BroadcastChannel(PRICE_CHANNEL_NAME);
        }
    } catch {}

    function cacheElements() {
        [
            'hargaGate', 'gateLoginForm', 'gateEmail', 'gatePassword', 'gateError', 'gateSubmit',
            'hargaApp', 'btnAddProduct', 'btnInstall', 'btnTheme', 'btnMenu', 'menuPanel',
            'menuPos', 'menuDash', 'menuRefresh', 'menuLogout',
            'hargaSearch', 'btnClearSearch', 'categoryFilters',
            'staleNotice', 'productList', 'emptyState', 'emptyTitle', 'emptyCopy', 'btnEmptyAdd',
            'syncBar', 'syncDot', 'syncText', 'btnRefresh',
            'statTotalProducts', 'statAverageMargin', 'statMissingCost', 'cardMissingHpp',
            'editorSheet', 'editorName', 'editorMeta', 'sellUnitNote', 'editorThumb',
            'editorSell', 'quickSell', 'editorCost', 'editorMargin', 'editorMarginPct',
            'editorMarginFill', 'editorMarginCard', 'editorError', 'editorSave',
            'addProductSheet', 'addProductForm', 'addThumb', 'addSheetTitle', 'addSheetMeta',
            'addName', 'addNameHint', 'addCategory', 'addUnit', 'addIsWeighable',
            'addSell', 'addSellUnitNote', 'addCost', 'addMarginCard', 'addMarginPct',
            'addMarginFill', 'addMargin', 'addStock', 'addError', 'addSave',
            'hargaToast', 'toastText', 'toastAction'
        ].forEach((id) => { els[id] = $(id); });
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatMoney(value) {
        return rupiah.format(Math.round(Number(value) || 0));
    }

    function formatNumericInput(value) {
        const n = Math.max(0, Math.round(Number(value) || 0));
        return n === 0 ? '0' : numberFmt.format(n);
    }

    function parseMoneyInput(raw) {
        const digits = String(raw ?? '').replace(/[^\d]/g, '');
        if (!digits) return 0;
        const num = Number(digits);
        return Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0;
    }

    function formatClock(ts) {
        if (!ts) return '';
        return new Date(ts).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function categoryName(code) {
        const key = String(code || 'UMUM').toUpperCase();
        return CATEGORY_LABELS[key] || key.replace(/_/g, ' ');
    }

    // ================= IKON & THUMBNAIL NYATA =================

    const VEG_ICON_RULES = [
        [/daun bawang|bawang daun|green onion|spring onion/, 'green-onion'],
        [/lokio|kucai|chive/, 'garlic'],
        [/prei|leek/, 'leek'],
        [/bawang putih|garlic/, 'garlic'],
        [/bawang bombay|onion bombay|yellow onion/, 'yellow-onion'],
        [/bawang merah|shallot/, 'red-onion'],
        [/bawang|onion/, 'shallot'],
        [/sawi putih|petsai|petsay|napa/, 'napa-cabbage'],
        [/sawi hijau|caisim|caisin|collard/, 'collard-greens'],
        [/pakcoy|pokcoy|pocoy|bok choy|bok-choy/, 'bok-choy'],
        [/kembang kol|cauliflower/, 'cauliflower'],
        [/brokoli|broccoli/, 'broccoli'],
        [/kubis|kol\b|cabbage/, 'green-cabbage'],
        [/selada air|kangkung|water ?spinach|watercress/, 'watercress'],
        [/selada keriting|iceberg/, 'iceberg'],
        [/selada|lettuce/, 'loose-leaf-lettuce'],
        [/bayam merah|red chard|red-chard/, 'red-chard'],
        [/bayam|spinach/, 'spinach'],
        [/seledri|celery/, 'celery'],
        [/kemangi|basil/, 'basil'],
        [/tomat cherry|cherry tomato|tomat ceri/, 'cherry-tomato'],
        [/tomat|tomato/, 'tomato'],
        [/terong|terung|eggplant|aubergine/, 'eggplant'],
        [/jagung|corn/, 'corn'],
        [/paprika|capsicum|bell pepper/, 'red-bell-pepper'],
        [/cabai rawit|cabe rawit|rawit|bird'?s eye|birds eye/, 'birds-eye-chili'],
        [/cabai|cabe|chilli|chili|chile|lombok/, 'cayenne-pepper'],
        [/wortel|carrot/, 'carrot'],
        [/timun|mentimun|cucumber/, 'cucumber'],
        [/kentang|potato/, 'russet-potato'],
        [/buncis|green bean|snap bean|wax bean/, 'wax-bean'],
        [/kacang panjang|long bean|yardlong|runner bean/, 'runner-bean'],
        [/jahe|ginger/, 'ginger'],
        [/kunyit|turmeric/, 'turmeric'],
        [/kencur|lengkuas|galangal/, 'galangal'],
        [/serai|sereh|lemongrass/, 'lemongrass'],
        [/katuk|daun/, 'collard-greens']
    ];

    const PRODUCT_ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

    const PRODUCT_ICONS = {
        grain: `<path d="M12 21V8"/><path d="M12 8c0-2 1.3-3.6 3.2-4"/><path d="M12 8c0-2-1.3-3.6-3.2-4"/><path d="M12 12.5c1.6-1.2 3.6-1.1 5 .2"/><path d="M12 12.5c-1.6-1.2-3.6-1.1-5 .2"/><path d="M12 17c1.6-1.2 3.6-1.1 5 .2"/><path d="M12 17c-1.6-1.2-3.6-1.1-5 .2"/>`,
        bag: `<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>`,
        cup: `<path d="M5 8h14l-1.4 11.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8L5 8Z"/><path d="M8 5h8"/>`,
        bread: `<path d="M4 11.5C4 8.5 6.2 6 9.2 6h5.6C17.8 6 20 8.5 20 11.5c0 1.4-1 2.5-2.4 2.5H6.4C5 14 4 12.9 4 11.5Z"/><path d="M5 14v3.5C5 18.9 6.1 20 7.5 20h9c1.4 0 2.5-1.1 2.5-2.5V14"/>`,
        phone: `<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>`,
        package: `<path d="M12 3 21 7.5v9L12 21l-9-4.5v-9L12 3Z"/><path d="m3 7.5 9 4.5 9-4.5"/><path d="M12 12v9"/>`
    };

    function vegIconFile(name) {
        for (const [pattern, file] of VEG_ICON_RULES) {
            if (pattern.test(name)) return file;
        }
        return '';
    }

    function resolveIconValue(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        if (raw.toLowerCase().startsWith('sayur:')) {
            const item = window.SayurIcons?.byId(raw.slice(6));
            if (!item) return null;
            return window.SayurIcons.iconFor(item);
        }
        if (/^data:image\//i.test(raw)) return { src: raw, fallback: '' };
        if (/^(icons|assets)\/(?![^/]*\.\.)[A-Za-z0-9/_.-]+\.(png|webp|svg|jpe?g)$/i.test(raw)) {
            return { src: raw, fallback: '' };
        }
        return null;
    }

    function renderProductThumbnail(product) {
        const name = String(product.name || '').toLowerCase();
        const category = String(product.category || '').toUpperCase();

        const custom = resolveIconValue(product.icon_url);
        if (custom) {
            const fb = custom.fallback ? ` data-fb="${escapeHtml(custom.fallback)}" onerror="this.onerror=null;this.src=this.dataset.fb"` : '';
            return `<img src="${escapeHtml(custom.src)}" width="48" height="48" alt="" loading="lazy"${fb}>`;
        }

        const isProduce = category === 'SAYUR_DAUN' || category === 'BUMBU_TIMBANG';
        const vegFile = vegIconFile(name);
        if (vegFile) {
            return `<img src="icons/vegetables/${vegFile}.png" width="48" height="48" alt="" loading="lazy">`;
        }

        const sayur = window.SayurIcons?.findByName(name);
        if (sayur) {
            const icon = window.SayurIcons.iconFor(sayur);
            const fb = icon.fallback ? ` data-fb="${escapeHtml(icon.fallback)}" onerror="this.onerror=null;this.src=this.dataset.fb"` : '';
            return `<img src="${escapeHtml(icon.src)}" width="48" height="48" alt="" loading="lazy"${fb}>`;
        }

        if (isProduce) {
            const fallbackFile = category === 'BUMBU_TIMBANG' ? 'cayenne-pepper' : 'collard-greens';
            return `<img src="icons/vegetables/${fallbackFile}.png" width="48" height="48" alt="" loading="lazy">`;
        }

        let key = 'package';
        if (category === 'SEMBAKO' || /beras|gula|minyak|telur|tepung/.test(name)) key = 'grain';
        else if (category === 'BUNGKUSAN' || /bungkus|sachet|kemasan/.test(name)) key = 'bag';
        else if (/kopi|teh|minum|susu|jus|es/.test(name)) key = 'cup';
        else if (/roti|kue|snack|makan|nasi|mie/.test(name)) key = 'bread';
        else if (/pulsa|kuota|token/.test(name)) key = 'phone';
        return `<svg ${PRODUCT_ICON_ATTRS}>${PRODUCT_ICONS[key]}</svg>`;
    }

    // ================= SESI & STORAGE =================

    function persistSessionToken(token) {
        if (!IS_CROSS_ORIGIN_API) return;
        try {
            if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, token);
            else sessionStorage.removeItem(SESSION_TOKEN_KEY);
        } catch {}
    }

    function readStoredSessionToken() {
        if (!IS_CROSS_ORIGIN_API) return '';
        try { return sessionStorage.getItem(SESSION_TOKEN_KEY) || ''; } catch { return ''; }
    }

    function readSession() {
        try {
            const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
            if (!parsed || !parsed.user) return null;
            const token = parsed.token || readStoredSessionToken();
            return { token, user: parsed.user || {} };
        } catch {
            return null;
        }
    }

    function cacheKey() {
        const ownerId = state.user?.ownerId || state.user?.id || 'anon';
        return `${CACHE_PREFIX}${ownerId}`;
    }

    function loadCachedProducts() {
        try {
            const raw = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
            if (!raw || !Array.isArray(raw.products)) return false;
            state.products = raw.products;
            state.lastUpdatedMs = Number(raw.lastUpdatedMs) || 0;
            state.lastSyncAt = Number(raw.savedAt) || 0;
            return state.products.length > 0;
        } catch {
            return false;
        }
    }

    function saveCachedProducts() {
        try {
            localStorage.setItem(cacheKey(), JSON.stringify({
                products: state.products,
                lastUpdatedMs: state.lastUpdatedMs,
                savedAt: state.lastSyncAt || Date.now()
            }));
        } catch {}
    }

    function notifyPriceUpdated(product) {
        const payload = {
            type: 'price-updated',
            product,
            at: Date.now()
        };
        try { priceChannel?.postMessage(payload); } catch {}
        try { localStorage.setItem(PRICE_BUMP_KEY, JSON.stringify(payload)); } catch {}
    }

    async function api(path, options = {}) {
        const headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        if (state.token) headers.Authorization = `Bearer ${state.token}`;
        const response = await fetch(`${API_BASE_URL}${path.replace(/^\/api/, '')}`, {
            credentials: 'include',
            ...options,
            headers
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            const err = new Error(data?.error || `Permintaan gagal (${response.status}).`);
            err.status = response.status;
            throw err;
        }
        return data;
    }

    // ================= TEMA & TOAST =================

    function applyTheme() {
        const saved = localStorage.getItem(THEME_KEY);
        const isDark = saved === 'dark';
        if (isDark) {
            document.documentElement.dataset.theme = 'dark';
            if (els.btnTheme) els.btnTheme.textContent = '☀️';
        } else {
            delete document.documentElement.dataset.theme;
            if (els.btnTheme) els.btnTheme.textContent = '🌙';
        }
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) metaTheme.setAttribute('content', isDark ? '#13171F' : '#FAF7F0');
    }

    function toggleTheme() {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, next);
        applyTheme();
    }

    function showToast(message, options = {}) {
        clearTimeout(toastTimer);
        const { isError = false, actionLabel = '', onAction = null, duration = 3800 } = options;
        els.toastText.textContent = message;
        els.hargaToast.classList.toggle('is-error', Boolean(isError));
        if (actionLabel && typeof onAction === 'function') {
            toastActionHandler = onAction;
            els.toastAction.textContent = actionLabel;
            els.toastAction.hidden = false;
        } else {
            toastActionHandler = null;
            els.toastAction.hidden = true;
        }
        els.hargaToast.hidden = false;
        toastTimer = setTimeout(() => {
            els.hargaToast.hidden = true;
            toastActionHandler = null;
        }, duration);
    }

    // ================= GERBANG MASUK (NON-KASIR) =================

    function showGate(errorMessage = '') {
        stopPolling();
        els.hargaApp.hidden = true;
        els.editorSheet.hidden = true;
        els.hargaGate.hidden = false;
        if (errorMessage) {
            els.gateError.textContent = errorMessage;
            els.gateError.hidden = false;
        } else {
            els.gateError.hidden = true;
        }
    }

    async function handleGateLogin(event) {
        event.preventDefault();
        els.gateError.hidden = true;
        els.gateSubmit.disabled = true;
        try {
            const email = els.gateEmail.value.trim();
            const password = els.gatePassword.value;
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ identifier: email, email, password })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Email atau kata sandi tidak sesuai.');

            if (data.user?.role === 'cashier') {
                await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
                throw new Error('Akun kasir hanya bisa membuka Layar Kasir (/pos), bukan Saku Harga.');
            }

            const profile = {
                id: data.user.id,
                username: data.user.username,
                email: data.user.email || '',
                fullName: data.user.fullName || data.user.username,
                avatar: data.user.avatar || '🐮',
                role: data.user.role || 'user',
                ownerId: data.user.ownerId || null
            };
            localStorage.setItem(SESSION_KEY, JSON.stringify({ user: profile }));
            persistSessionToken(data.token);
            state.token = data.token || readStoredSessionToken();
            state.user = profile;
            els.gatePassword.value = '';
            await enterApp();
        } catch (err) {
            els.gateError.textContent = err.message;
            els.gateError.hidden = false;
        } finally {
            els.gateSubmit.disabled = false;
        }
    }

    async function handleLogout() {
        stopPolling();
        try {
            await api('/api/auth/logout', { method: 'POST' });
        } catch {}
        localStorage.removeItem(SESSION_KEY);
        persistSessionToken('');
        state.token = '';
        state.user = null;
        state.products = [];
        closeMenu();
        showGate();
    }

    // ================= SINKRONISASI HARGA =================

    function setSyncStatus(mode, text) {
        if (els.syncDot) els.syncDot.dataset.state = mode;
        if (els.syncText) els.syncText.textContent = text;
    }

    function mergeProducts(incoming, isFullSync) {
        if (isFullSync) {
            state.products = incoming
                .map(normalizeProduct)
                .sort((a, b) => a.name.localeCompare(b.name, 'id'));
        } else if (Array.isArray(incoming) && incoming.length > 0) {
            const byId = new Map(state.products.map((item) => [Number(item.id), item]));
            for (const row of incoming) {
                const norm = normalizeProduct(row);
                byId.set(norm.id, { ...(byId.get(norm.id) || {}), ...norm });
            }
            state.products = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'id'));
        }

        let maxMs = state.lastUpdatedMs || 0;
        for (const item of state.products) {
            if (item.updated_ms > maxMs) maxMs = item.updated_ms;
        }
        state.lastUpdatedMs = maxMs;
    }

    function normalizeProduct(row) {
        return {
            id: Number(row.id),
            name: String(row.name || ''),
            sku: String(row.sku || ''),
            unit: String(row.unit || 'PCS').toUpperCase(),
            category: String(row.category || 'UMUM').toUpperCase(),
            is_weighable: Boolean(row.is_weighable),
            is_active: row.is_active !== false,
            price_sell: Math.max(0, Math.round(Number(row.price_sell) || 0)),
            price_cost: Math.max(0, Math.round(Number(row.price_cost) || 0)),
            icon_url: row.icon_url || null,
            updated_ms: Number(row.updated_ms) || (row.updated_at ? new Date(row.updated_at).getTime() : Date.now())
        };
    }

    function updateSummaryMetrics() {
        const active = state.products.filter((p) => p.is_active);
        let totalMarginPct = 0;
        let countWithCost = 0;
        let countMissingCost = 0;

        for (const p of active) {
            if (p.price_cost > 0) {
                const margin = ((p.price_sell - p.price_cost) / p.price_cost) * 100;
                totalMarginPct += margin;
                countWithCost += 1;
            } else {
                countMissingCost += 1;
            }
        }

        if (els.statTotalProducts) els.statTotalProducts.textContent = active.length;
        if (els.statAverageMargin) {
            els.statAverageMargin.textContent = countWithCost > 0
                ? `${Math.round(totalMarginPct / countWithCost)}%`
                : '—';
        }
        if (els.statMissingCost) {
            els.statMissingCost.textContent = countMissingCost;
        }
    }

    async function syncPrices({ full = false, silent = false } = {}) {
        if (state.syncing || !state.user) return;
        state.syncing = true;
        if (!silent) setSyncStatus('busy', 'Menyinkronkan harga…');

        const useDelta = !full && state.products.length > 0 && state.lastUpdatedMs > 0;
        const query = useDelta ? `?since=${encodeURIComponent(Math.floor(state.lastUpdatedMs))}` : '';

        try {
            const data = await api(`/api/pos/products/price-sync${query}`, { method: 'GET' });
            const rows = Array.isArray(data?.products) ? data.products : [];
            const changedCount = rows.length;
            mergeProducts(rows, !useDelta);
            state.lastSyncAt = Date.now();
            saveCachedProducts();

            els.staleNotice.hidden = true;
            if (!useDelta || changedCount > 0) {
                renderCategoryFilters();
                renderProductList();
                updateSummaryMetrics();

                if (state.editingId && els.editorSheet && !els.editorSheet.hidden) {
                    const current = findProduct(state.editingId);
                    if (current && document.activeElement !== els.editorSell && document.activeElement !== els.editorCost) {
                        els.editorSell.value = formatNumericInput(current.price_sell);
                        els.editorCost.value = formatNumericInput(current.price_cost);
                        updateMarginPreview();
                    }
                }
            }
            setSyncStatus('live', `Tersinkron · ${formatClock(state.lastSyncAt)}`);
        } catch (err) {
            if (err.status === 401 || /masuk|sesi/i.test(err.message)) {
                localStorage.removeItem(SESSION_KEY);
                persistSessionToken('');
                showGate('Sesi Anda telah berakhir. Silakan masuk kembali.');
                return;
            }
            if (err.status === 403) {
                window.location.href = '/pos';
                return;
            }
            const offlineMsg = navigator.onLine
                ? `Gagal memuat dari server (${err.message}). Menampilkan data terakhir.`
                : 'Ponsel sedang luring. Menampilkan daftar harga terakhir yang tersimpan.';
            els.staleNotice.textContent = offlineMsg;
            els.staleNotice.hidden = false;
            setSyncStatus(
                'offline',
                state.lastSyncAt
                    ? `Luring · ${formatClock(state.lastSyncAt)}`
                    : 'Luring · belum tersinkron'
            );
        } finally {
            state.syncing = false;
        }
    }

    function startPolling() {
        stopPolling();
        pollTimer = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            state.pollCount += 1;
            const doFull = state.pollCount % FULL_SYNC_EVERY === 0;
            syncPrices({ full: doFull, silent: true });
        }, POLL_INTERVAL_MS);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    // ================= RENDER DAFTAR & SARING =================

    function findProduct(id) {
        return state.products.find((item) => Number(item.id) === Number(id)) || null;
    }

    function renderCategoryFilters() {
        const active = state.products.filter((p) => p.is_active);
        const categories = new Set(['ALL']);
        const missingCostCount = active.filter((p) => p.price_cost <= 0).length;

        if (missingCostCount > 0) {
            categories.add('MISSING_COST');
        }

        for (const item of active) {
            if (item.category) categories.add(item.category);
        }

        if (!categories.has(state.category)) state.category = 'ALL';

        els.categoryFilters.innerHTML = [...categories].map((cat) => {
            let count = 0;
            if (cat === 'ALL') count = active.length;
            else if (cat === 'MISSING_COST') count = missingCostCount;
            else count = active.filter((p) => p.category === cat).length;

            const pressed = state.category === cat ? 'true' : 'false';
            return `<button type="button" class="harga-chip" data-cat="${escapeHtml(cat)}" aria-pressed="${pressed}">${escapeHtml(categoryName(cat))} (${count})</button>`;
        }).join('');
    }

    function getVisibleProducts() {
        const q = state.search.trim().toLowerCase();
        return state.products.filter((item) => {
            if (!item.is_active) return false;
            if (state.category === 'MISSING_COST' && item.price_cost > 0) return false;
            if (state.category !== 'ALL' && state.category !== 'MISSING_COST' && item.category !== state.category) return false;
            if (!q) return true;
            const hay = `${item.name} ${item.sku || ''} ${categoryName(item.category)}`.toLowerCase();
            return hay.includes(q);
        });
    }

    function renderProductList() {
        const visible = getVisibleProducts();
        els.productList.innerHTML = '';

        if (visible.length === 0) {
            els.emptyState.hidden = false;
            if (state.products.length === 0) {
                els.emptyTitle.textContent = 'Belum ada produk';
                els.emptyCopy.textContent = 'Tambahkan produk pertama Anda untuk mulai mengatur harga dan modal.';
                if (els.btnEmptyAdd) els.btnEmptyAdd.textContent = '＋ Tambah Produk Baru';
            } else {
                els.emptyTitle.textContent = 'Produk tidak ditemukan';
                const searchQ = state.search.trim();
                els.emptyCopy.textContent = searchQ
                    ? `Tidak ada produk yang cocok dengan "${searchQ}".`
                    : 'Tidak ada produk untuk filter ini.';
                if (els.btnEmptyAdd) els.btnEmptyAdd.textContent = searchQ ? `＋ Tambah "${searchQ}"` : '＋ Tambah Produk Baru';
            }
            return;
        }

        els.emptyState.hidden = true;
        els.productList.innerHTML = visible.map((item) => {
            const hasCost = item.price_cost > 0;
            const isLoss = hasCost && item.price_sell < item.price_cost;
            const marginPct = hasCost
                ? Math.round(((item.price_sell - item.price_cost) / item.price_cost) * 100)
                : null;

            let marginPill = '';
            if (hasCost) {
                const lossClass = isLoss ? 'is-loss' : (marginPct === 0 ? 'is-flat' : '');
                const sign = marginPct > 0 ? '+' : '';
                marginPill = `<span class="harga-margin-badge ${lossClass}">${sign}${marginPct}%</span>`;
            }

            const costText = hasCost
                ? `Modal ${formatMoney(item.price_cost)}`
                : '<span class="harga-tag-cost is-missing">Belum ada modal</span>';

            const skuPart = item.sku ? ` · ${escapeHtml(item.sku)}` : '';

            return `
                <button type="button" class="harga-tag" role="listitem" data-product-id="${item.id}">
                    <div class="harga-tag-thumb" aria-hidden="true">
                        ${renderProductThumbnail(item)}
                    </div>
                    <div class="harga-tag-info">
                        <span class="harga-tag-name">${escapeHtml(item.name)}</span>
                        <span class="harga-tag-meta">
                            <span class="harga-tag-cat">${escapeHtml(categoryName(item.category))}</span>
                            <span class="harga-tag-unit">per ${escapeHtml(item.unit)}</span>
                            ${skuPart ? `<span>${skuPart}</span>` : ''}
                        </span>
                    </div>
                    <div class="harga-tag-prices">
                        <span class="harga-tag-sell">${formatMoney(item.price_sell)}</span>
                        <span class="harga-tag-cost ${isLoss ? 'is-loss' : ''}">
                            ${costText} ${marginPill}
                        </span>
                    </div>
                </button>
            `;
        }).join('');
    }

    // ================= PANEL UBAH HARGA (BOTTOM SHEET) =================

    function renderQuickButtons(product) {
        const chips = QUICK_STEPS.map((step) => (
            `<button type="button" data-delta="${step.delta}">${escapeHtml(step.label)}</button>`
        ));
        if (product && product.price_cost > 0) {
            chips.push('<button type="button" data-markup="15">HPP +15%</button>');
            chips.push('<button type="button" data-markup="25">HPP +25%</button>');
            chips.push('<button type="button" data-markup="35">HPP +35%</button>');
            chips.push('<button type="button" data-round="500">Bulatkan 500</button>');
        }
        els.quickSell.innerHTML = chips.join('');
    }

    function openEditor(productId) {
        const product = findProduct(productId);
        if (!product) return;
        state.editingId = product.id;

        els.editorName.textContent = product.name;
        if (els.editorThumb) {
            els.editorThumb.innerHTML = renderProductThumbnail(product);
        }

        const metaParts = [categoryName(product.category)];
        if (product.sku) metaParts.push(`SKU ${product.sku}`);
        metaParts.push(`Satuan ${product.unit}`);
        els.editorMeta.textContent = metaParts.join(' · ');
        els.sellUnitNote.textContent = `per ${product.unit}`;

        els.editorSell.value = formatNumericInput(product.price_sell);
        els.editorCost.value = formatNumericInput(product.price_cost);
        els.editorError.hidden = true;
        renderQuickButtons(product);
        updateMarginPreview();

        els.editorSheet.hidden = false;
        document.body.style.overflow = 'hidden';
        setTimeout(() => {
            els.editorSell.focus();
            els.editorSell.select();
        }, 60);
    }

    function closeEditor() {
        state.editingId = null;
        els.editorSheet.hidden = true;
        document.body.style.overflow = '';
    }

    function updateMarginPreview() {
        const product = findProduct(state.editingId);
        const unit = product?.unit || 'satuan';
        const sell = parseMoneyInput(els.editorSell.value);
        const cost = parseMoneyInput(els.editorCost.value);

        els.editorMargin.classList.remove('is-loss', 'is-flat');
        if (els.editorMarginFill) {
            els.editorMarginFill.classList.remove('is-loss', 'is-flat');
        }

        if (cost <= 0) {
            els.editorMargin.classList.add('is-flat');
            els.editorMargin.textContent = `Laba per ${unit}: isi HPP untuk melihat laba kotor`;
            if (els.editorMarginPct) els.editorMarginPct.textContent = '0%';
            if (els.editorMarginFill) els.editorMarginFill.style.width = '0%';
            return;
        }

        const diff = sell - cost;
        const pct = Math.round((diff / cost) * 100);
        const displayPct = `${pct >= 0 ? '+' : ''}${pct}%`;
        if (els.editorMarginPct) els.editorMarginPct.textContent = displayPct;

        if (diff > 0) {
            els.editorMargin.textContent = `Laba kotor per ${unit}: ${formatMoney(diff)} (${displayPct})`;
            const fillWidth = Math.min(100, Math.max(5, pct));
            if (els.editorMarginFill) els.editorMarginFill.style.width = `${fillWidth}%`;
        } else if (diff < 0) {
            els.editorMargin.classList.add('is-loss');
            if (els.editorMarginFill) {
                els.editorMarginFill.classList.add('is-loss');
                els.editorMarginFill.style.width = '100%';
            }
            els.editorMargin.textContent = `Potensi rugi per ${unit}: -${formatMoney(Math.abs(diff))} (${displayPct}) — harga jual di bawah HPP`;
        } else {
            els.editorMargin.classList.add('is-flat');
            if (els.editorMarginFill) {
                els.editorMarginFill.classList.add('is-flat');
                els.editorMarginFill.style.width = '5%';
            }
            els.editorMargin.textContent = `Impas (Rp 0) · harga jual sama dengan HPP`;
        }
    }

    function formatInputInPlace(inputEl) {
        const raw = inputEl.value;
        const numeric = parseMoneyInput(raw);
        const formatted = raw.trim() === '' ? '' : formatNumericInput(numeric);
        if (inputEl.value !== formatted) {
            inputEl.value = formatted;
        }
    }

    async function saveEditedPrice(overrideId = null, overridePayload = null, isUndo = false) {
        const targetId = overrideId ?? state.editingId;
        const product = findProduct(targetId);
        if (!product) return;

        const nextSell = overridePayload ? overridePayload.price_sell : parseMoneyInput(els.editorSell.value);
        const nextCost = overridePayload ? overridePayload.price_cost : parseMoneyInput(els.editorCost.value);

        if (nextSell <= 0) {
            els.editorError.textContent = 'Harga jual harus lebih dari Rp 0.';
            els.editorError.hidden = false;
            return;
        }

        const prevSnapshot = {
            price_sell: product.price_sell,
            price_cost: product.price_cost
        };

        if (!overridePayload && nextSell === prevSnapshot.price_sell && nextCost === prevSnapshot.price_cost) {
            closeEditor();
            return;
        }

        els.editorError.hidden = true;
        els.editorSave.disabled = true;

        product.price_sell = nextSell;
        product.price_cost = nextCost;
        product.updated_ms = Date.now();
        renderProductList();
        updateSummaryMetrics();

        try {
            const updated = await api(`/api/pos/products/${product.id}/price`, {
                method: 'PUT',
                body: JSON.stringify({
                    price_sell: nextSell,
                    price_cost: nextCost
                })
            });
            const norm = normalizeProduct(updated);
            Object.assign(product, norm);
            if (norm.updated_ms > state.lastUpdatedMs) {
                state.lastUpdatedMs = norm.updated_ms;
            }
            state.lastSyncAt = Date.now();
            saveCachedProducts();
            renderProductList();
            updateSummaryMetrics();
            setSyncStatus('live', `Tersimpan · ${formatClock(state.lastSyncAt)}`);
            notifyPriceUpdated(norm);

            if (!overridePayload) closeEditor();

            if (isUndo) {
                showToast(`Harga ${product.name} dikembalikan ke ${formatMoney(norm.price_sell)}.`);
            } else {
                showToast(`${product.name} → ${formatMoney(norm.price_sell)}`, {
                    actionLabel: 'Urungkan',
                    duration: 5500,
                    onAction: () => {
                        saveEditedPrice(product.id, prevSnapshot, true);
                    }
                });
            }
        } catch (err) {
            product.price_sell = prevSnapshot.price_sell;
            product.price_cost = prevSnapshot.price_cost;
            renderProductList();
            updateSummaryMetrics();
            if (!overridePayload && !els.editorSheet.hidden) {
                els.editorError.textContent = err.message;
                els.editorError.hidden = false;
            } else {
                showToast(err.message, { isError: true });
            }
        } finally {
            els.editorSave.disabled = false;
        }
    }

    // ================= PANEL TAMBAH PRODUK BARU =================

    function openAddProductSheet(initialName = '') {
        closeEditor();
        closeMenu();

        if (els.addProductForm) els.addProductForm.reset();
        if (els.addName) els.addName.value = initialName || '';
        if (els.addCategory) els.addCategory.value = 'UMUM';
        if (els.addUnit) els.addUnit.value = 'PCS';
        if (els.addIsWeighable) els.addIsWeighable.checked = false;
        if (els.addSell) els.addSell.value = '';
        if (els.addCost) els.addCost.value = '';
        if (els.addStock) els.addStock.value = '';
        if (els.addError) {
            els.addError.hidden = true;
            els.addError.textContent = '';
        }
        if (els.addSellUnitNote) els.addSellUnitNote.textContent = 'per PCS';

        updateAddThumb();
        updateAddMarginPreview();

        if (els.addProductSheet) {
            els.addProductSheet.hidden = false;
            document.body.style.overflow = 'hidden';
            setTimeout(() => {
                if (initialName && els.addSell) {
                    els.addSell.focus();
                } else if (els.addName) {
                    els.addName.focus();
                }
            }, 60);
        }
    }

    function closeAddProductSheet() {
        if (!els.addProductSheet) return;
        els.addProductSheet.hidden = true;
        document.body.style.overflow = '';
    }

    function updateAddThumb() {
        if (!els.addThumb) return;
        const name = (els.addName?.value || '').trim();
        const category = els.addCategory?.value || 'UMUM';

        const dummyProduct = {
            name,
            category,
            icon_url: null
        };

        els.addThumb.innerHTML = renderProductThumbnail(dummyProduct);

        if (els.addNameHint) {
            const vegFile = vegIconFile(name.toLowerCase());
            const sayur = window.SayurIcons?.findByName(name.toLowerCase());
            if (vegFile || sayur) {
                els.addNameHint.textContent = 'Ikon sayur terdeteksi ✓';
                els.addNameHint.style.color = 'var(--green)';
            } else {
                els.addNameHint.textContent = 'Ikon otomatis';
                els.addNameHint.style.color = '';
            }
        }
    }

    function updateAddMarginPreview() {
        if (!els.addMargin) return;
        const unit = els.addUnit?.value || 'PCS';
        const sell = parseMoneyInput(els.addSell?.value);
        const cost = parseMoneyInput(els.addCost?.value);

        els.addMargin.classList.remove('is-loss', 'is-flat');
        if (els.addMarginFill) {
            els.addMarginFill.classList.remove('is-loss', 'is-flat');
        }

        if (cost <= 0) {
            els.addMargin.classList.add('is-flat');
            els.addMargin.textContent = `Laba per ${unit}: isi HPP untuk melihat estimasi laba`;
            if (els.addMarginPct) els.addMarginPct.textContent = '0%';
            if (els.addMarginFill) els.addMarginFill.style.width = '0%';
            return;
        }

        const diff = sell - cost;
        const pct = Math.round((diff / cost) * 100);
        const displayPct = `${pct >= 0 ? '+' : ''}${pct}%`;
        if (els.addMarginPct) els.addMarginPct.textContent = displayPct;

        if (diff > 0) {
            els.addMargin.textContent = `Laba kotor per ${unit}: ${formatMoney(diff)} (${displayPct})`;
            const fillWidth = Math.min(100, Math.max(5, pct));
            if (els.addMarginFill) els.addMarginFill.style.width = `${fillWidth}%`;
        } else if (diff < 0) {
            els.addMargin.classList.add('is-loss');
            if (els.addMarginFill) {
                els.addMarginFill.classList.add('is-loss');
                els.addMarginFill.style.width = '100%';
            }
            els.addMargin.textContent = `Potensi rugi per ${unit}: -${formatMoney(Math.abs(diff))} (${displayPct}) — harga jual di bawah modal`;
        } else {
            els.addMargin.classList.add('is-flat');
            if (els.addMarginFill) {
                els.addMarginFill.classList.add('is-flat');
                els.addMarginFill.style.width = '5%';
            }
            els.addMargin.textContent = `Impas (Rp 0) · harga jual sama dengan modal`;
        }
    }

    async function saveNewProduct(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();

        const name = (els.addName?.value || '').trim();
        if (!name) {
            if (els.addError) {
                els.addError.textContent = 'Nama produk wajib diisi.';
                els.addError.hidden = false;
            }
            els.addName?.focus();
            return;
        }

        const sell = parseMoneyInput(els.addSell?.value);
        if (sell <= 0) {
            if (els.addError) {
                els.addError.textContent = 'Harga jual harus lebih dari Rp 0.';
                els.addError.hidden = false;
            }
            els.addSell?.focus();
            return;
        }

        const cost = parseMoneyInput(els.addCost?.value);
        const stock = parseMoneyInput(els.addStock?.value);
        const category = els.addCategory?.value || 'UMUM';
        const unit = els.addUnit?.value || 'PCS';
        const isWeighable = Boolean(els.addIsWeighable?.checked);

        // Cari tahu icon_url otomatis jika terdeteksi sayur/bumbu
        let iconUrl = null;
        const nameLower = name.toLowerCase();
        const sayurMatch = window.SayurIcons?.findByName(nameLower);
        if (sayurMatch?.id) {
            iconUrl = `sayur:${sayurMatch.id}`;
        } else {
            const vegFile = vegIconFile(nameLower);
            if (vegFile) {
                iconUrl = `icons/vegetables/${vegFile}.png`;
            }
        }

        if (els.addError) els.addError.hidden = true;
        if (els.addSave) els.addSave.disabled = true;

        try {
            const payload = {
                name,
                category,
                unit,
                is_weighable: isWeighable,
                price_sell: sell,
                price_cost: cost,
                stock,
                min_stock: 0,
                icon_url: iconUrl
            };

            const created = await api('/api/pos/products', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            const norm = normalizeProduct(created);
            // Tambahkan produk baru ke daftar lokal
            state.products.unshift(norm);
            if (norm.updated_ms > state.lastUpdatedMs) {
                state.lastUpdatedMs = norm.updated_ms;
            }
            state.lastSyncAt = Date.now();
            saveCachedProducts();

            renderCategoryFilters();
            renderProductList();
            updateSummaryMetrics();
            setSyncStatus('live', `Tersinkron · ${formatClock(state.lastSyncAt)}`);
            notifyPriceUpdated(norm);

            closeAddProductSheet();
            showToast(`Produk "${norm.name}" (${formatMoney(norm.price_sell)}) berhasil ditambahkan!`);
        } catch (err) {
            if (els.addError) {
                els.addError.textContent = err.message || 'Gagal menambahkan produk.';
                els.addError.hidden = false;
            }
        } finally {
            if (els.addSave) els.addSave.disabled = false;
        }
    }

    // ================= MENU & PWA INSTALL =================

    function toggleMenu() {
        const willOpen = els.menuPanel.hidden;
        els.menuPanel.hidden = !willOpen;
        els.btnMenu.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    }

    function closeMenu() {
        if (!els.menuPanel) return;
        els.menuPanel.hidden = true;
        els.btnMenu?.setAttribute('aria-expanded', 'false');
    }

    function setupPwaInstall() {
        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            state.deferredInstallPrompt = event;
            if (els.btnInstall) els.btnInstall.hidden = false;
        });

        window.addEventListener('appinstalled', () => {
            state.deferredInstallPrompt = null;
            if (els.btnInstall) els.btnInstall.hidden = true;
            showToast('Saku Harga terpasang di layar utama.');
        });

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
        }
    }

    async function triggerInstall() {
        if (!state.deferredInstallPrompt) {
            showToast('Gunakan menu browser ⋮ lalu pilih "Tambahkan ke layar utama".');
            return;
        }
        state.deferredInstallPrompt.prompt();
        await state.deferredInstallPrompt.userChoice.catch(() => null);
        state.deferredInstallPrompt = null;
        if (els.btnInstall) els.btnInstall.hidden = true;
    }

    // ================= EVENT LISTENERS =================

    function bindEvents() {
        els.gateLoginForm.addEventListener('submit', handleGateLogin);
        els.btnTheme.addEventListener('click', toggleTheme);
        els.btnInstall.addEventListener('click', triggerInstall);
        if (els.btnAddProduct) els.btnAddProduct.addEventListener('click', () => openAddProductSheet());
        if (els.btnEmptyAdd) els.btnEmptyAdd.addEventListener('click', () => openAddProductSheet(state.search));

        els.btnMenu.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleMenu();
        });
        document.addEventListener('click', (event) => {
            if (!els.menuPanel.hidden && !event.target.closest('.harga-menu')) {
                closeMenu();
            }
        });

        els.menuRefresh.addEventListener('click', () => {
            closeMenu();
            syncPrices({ full: true });
        });
        els.menuLogout.addEventListener('click', handleLogout);
        els.btnRefresh.addEventListener('click', () => syncPrices({ full: true }));

        els.hargaSearch.addEventListener('input', () => {
            state.search = els.hargaSearch.value;
            els.btnClearSearch.hidden = !state.search;
            renderProductList();
        });
        els.btnClearSearch.addEventListener('click', () => {
            els.hargaSearch.value = '';
            state.search = '';
            els.btnClearSearch.hidden = true;
            renderProductList();
            els.hargaSearch.focus();
        });

        els.categoryFilters.addEventListener('click', (event) => {
            const chip = event.target.closest('[data-cat]');
            if (!chip) return;
            state.category = chip.dataset.cat || 'ALL';
            renderCategoryFilters();
            renderProductList();
        });

        if (els.cardMissingHpp) {
            els.cardMissingHpp.addEventListener('click', () => {
                state.category = state.category === 'MISSING_COST' ? 'ALL' : 'MISSING_COST';
                renderCategoryFilters();
                renderProductList();
            });
        }

        els.productList.addEventListener('click', (event) => {
            const card = event.target.closest('[data-product-id]');
            if (!card) return;
            openEditor(card.dataset.productId);
        });

        document.querySelectorAll('[data-close-sheet]').forEach((el) => {
            el.addEventListener('click', closeEditor);
        });

        document.querySelectorAll('[data-close-add-sheet]').forEach((el) => {
            el.addEventListener('click', closeAddProductSheet);
        });

        if (els.addProductForm) {
            els.addProductForm.addEventListener('submit', saveNewProduct);
        }
        if (els.addName) {
            els.addName.addEventListener('input', updateAddThumb);
        }
        if (els.addCategory) {
            els.addCategory.addEventListener('change', updateAddThumb);
        }
        if (els.addUnit) {
            els.addUnit.addEventListener('change', () => {
                if (els.addSellUnitNote) els.addSellUnitNote.textContent = `per ${els.addUnit.value || 'PCS'}`;
                updateAddMarginPreview();
            });
        }
        if (els.addSell) {
            els.addSell.addEventListener('input', () => {
                formatInputInPlace(els.addSell);
                updateAddMarginPreview();
            });
        }
        if (els.addCost) {
            els.addCost.addEventListener('input', () => {
                formatInputInPlace(els.addCost);
                updateAddMarginPreview();
            });
        }
        if (els.addStock) {
            els.addStock.addEventListener('input', () => {
                formatInputInPlace(els.addStock);
            });
        }

        els.editorSell.addEventListener('input', () => {
            formatInputInPlace(els.editorSell);
            updateMarginPreview();
        });
        els.editorCost.addEventListener('input', () => {
            formatInputInPlace(els.editorCost);
            renderQuickButtons({ price_cost: parseMoneyInput(els.editorCost.value) });
            updateMarginPreview();
        });

        const submitOnEnter = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveEditedPrice();
            }
        };
        els.editorSell.addEventListener('keydown', submitOnEnter);
        els.editorCost.addEventListener('keydown', submitOnEnter);
        els.editorSave.addEventListener('click', () => saveEditedPrice());

        els.quickSell.addEventListener('click', (event) => {
            const btn = event.target.closest('button');
            if (!btn) return;
            if (btn.dataset.delta) {
                const current = parseMoneyInput(els.editorSell.value);
                const next = Math.max(0, current + Number(btn.dataset.delta));
                els.editorSell.value = formatNumericInput(next);
            } else if (btn.dataset.markup) {
                const cost = parseMoneyInput(els.editorCost.value);
                if (cost > 0) {
                    const pct = Number(btn.dataset.markup) || 0;
                    const rawTarget = cost * (1 + pct / 100);
                    const rounded = Math.ceil(rawTarget / 500) * 500;
                    els.editorSell.value = formatNumericInput(rounded);
                }
            } else if (btn.dataset.round) {
                const current = parseMoneyInput(els.editorSell.value);
                const step = Number(btn.dataset.round) || 500;
                const rounded = Math.ceil(current / step) * step;
                els.editorSell.value = formatNumericInput(rounded);
            }
            updateMarginPreview();
        });

        els.toastAction.addEventListener('click', () => {
            const fn = toastActionHandler;
            els.hargaToast.hidden = true;
            toastActionHandler = null;
            if (typeof fn === 'function') fn();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                if (els.addProductSheet && !els.addProductSheet.hidden) closeAddProductSheet();
                else if (!els.editorSheet.hidden) closeEditor();
                else if (!els.menuPanel.hidden) closeMenu();
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && state.user) {
                syncPrices({ silent: true });
            }
        });
        window.addEventListener('focus', () => {
            if (state.user) syncPrices({ silent: true });
        });
        window.addEventListener('online', () => {
            if (state.user) syncPrices({ full: true });
        });
        window.addEventListener('offline', () => {
            setSyncStatus('offline', 'Ponsel sedang luring');
        });

        if (priceChannel) {
            priceChannel.addEventListener('message', (event) => {
                if (event.data?.type === 'price-updated' && event.data.product) {
                    mergeProducts([event.data.product], false);
                    renderProductList();
                    updateSummaryMetrics();
                }
            });
        }
    }

    // ================= MASUK KE APLIKASI =================

    async function enterApp() {
        els.hargaGate.hidden = true;
        els.hargaApp.hidden = false;

        if (loadCachedProducts()) {
            renderCategoryFilters();
            renderProductList();
            updateSummaryMetrics();
            setSyncStatus('idle', `Data tersimpan · ${formatClock(state.lastSyncAt)}`);
        }

        await syncPrices({ full: true });
        startPolling();
    }

    async function init() {
        cacheElements();
        applyTheme();
        setupPwaInstall();
        bindEvents();

        const session = readSession();
        if (!session) {
            showGate();
            return;
        }

        if (session.user?.role === 'cashier') {
            window.location.replace('/pos');
            return;
        }

        state.token = session.token || '';
        state.user = session.user || {};

        try {
            const authHeader = state.token ? { Authorization: `Bearer ${state.token}` } : {};
            const meRes = await fetch(`${API_BASE_URL}/auth/me`, {
                credentials: 'include',
                headers: authHeader
            });
            if (!meRes.ok) {
                localStorage.removeItem(SESSION_KEY);
                persistSessionToken('');
                showGate('Sesi Anda sudah berakhir. Silakan masuk kembali.');
                return;
            }
            const me = await meRes.json().catch(() => null);
            if (me?.user) {
                state.user = { ...state.user, ...me.user };
                if (state.user.role === 'cashier') {
                    window.location.replace('/pos');
                    return;
                }
                localStorage.setItem(SESSION_KEY, JSON.stringify({ user: state.user }));
            }
        } catch {
            // Luring: gunakan cache lokal
        }

        await enterApp();
    }

    init();
})();
