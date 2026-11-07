/* ==========================================================================
   SAKU HARGA — PWA ringan khusus pemilik toko untuk ubah harga produk cepat
   ========================================================================== */
(() => {
    'use strict';

    const SESSION_KEY = 'saku-user-session-v1';
    const SESSION_TOKEN_KEY = 'saku-session-token-v1';
    const THEME_KEY = 'saku-theme';
    const CACHE_PREFIX = 'saku-harga-cache-v1:';
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
            'hargaApp', 'btnInstall', 'btnTheme', 'btnMenu', 'menuPanel',
            'menuPos', 'menuDash', 'menuRefresh', 'menuLogout',
            'hargaSearch', 'btnClearSearch', 'categoryFilters',
            'staleNotice', 'productList', 'emptyState', 'emptyTitle', 'emptyCopy',
            'syncBar', 'syncDot', 'syncText', 'btnRefresh',
            'editorSheet', 'editorName', 'editorMeta', 'sellUnitNote',
            'editorSell', 'quickSell', 'editorCost', 'editorMargin', 'editorError', 'editorSave',
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
        if (metaTheme) metaTheme.setAttribute('content', isDark ? '#12161F' : '#FAF7F0');
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
                // Jangan izinkan akun kasir masuk ke Saku Harga; arahkan ke POS.
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
            updated_ms: Number(row.updated_ms) || 0
        };
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
                // Jika produk yang sedang diedit berubah dari perangkat lain, perbarui info meta.
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
                    ? `Luring · data ${formatClock(state.lastSyncAt)}`
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
        const categories = new Set(['ALL']);
        for (const item of state.products) {
            if (item.is_active && item.category) categories.add(item.category);
        }
        if (!categories.has(state.category)) state.category = 'ALL';

        els.categoryFilters.innerHTML = [...categories].map((cat) => {
            const count = cat === 'ALL'
                ? state.products.filter((p) => p.is_active).length
                : state.products.filter((p) => p.is_active && p.category === cat).length;
            const pressed = state.category === cat ? 'true' : 'false';
            return `<button type="button" class="harga-chip" data-cat="${escapeHtml(cat)}" aria-pressed="${pressed}">${escapeHtml(categoryName(cat))} (${count})</button>`;
        }).join('');
    }

    function getVisibleProducts() {
        const q = state.search.trim().toLowerCase();
        return state.products.filter((item) => {
            if (!item.is_active) return false;
            if (state.category !== 'ALL' && item.category !== state.category) return false;
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
                els.emptyCopy.textContent = 'Tambahkan produk lewat layar kasir, lalu kembali ke halaman ini untuk mengatur harganya.';
            } else {
                els.emptyTitle.textContent = 'Produk tidak ditemukan';
                els.emptyCopy.textContent = 'Coba kata kunci lain atau pilih kategori "Semua".';
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
            const costLabel = hasCost
                ? `HPP ${formatMoney(item.price_cost)}${marginPct !== null ? ` · ${marginPct >= 0 ? '+' : ''}${marginPct}%` : ''}`
                : 'HPP belum diisi';
            const skuPart = item.sku ? ` · ${escapeHtml(item.sku)}` : '';

            return `
                <button type="button" class="harga-tag" role="listitem" data-product-id="${item.id}">
                    <span>
                        <span class="harga-tag-name">${escapeHtml(item.name)}</span>
                        <span class="harga-tag-meta">${escapeHtml(categoryName(item.category))}${skuPart} · <span class="harga-tag-unit">per ${escapeHtml(item.unit)}</span></span>
                    </span>
                    <span class="harga-tag-prices">
                        <span class="harga-tag-sell">${formatMoney(item.price_sell)}</span>
                        <span class="harga-tag-cost ${isLoss ? 'is-loss' : ''}">${escapeHtml(costLabel)}</span>
                    </span>
                </button>
            `;
        }).join('');
    }

    // ================= PANEL UBAH HARGA =================

    function renderQuickButtons(product) {
        const chips = QUICK_STEPS.map((step) => (
            `<button type="button" data-delta="${step.delta}">${escapeHtml(step.label)}</button>`
        ));
        if (product && product.price_cost > 0) {
            chips.push('<button type="button" data-markup="15">HPP +15%</button>');
            chips.push('<button type="button" data-markup="25">HPP +25%</button>');
        }
        els.quickSell.innerHTML = chips.join('');
    }

    function openEditor(productId) {
        const product = findProduct(productId);
        if (!product) return;
        state.editingId = product.id;

        els.editorName.textContent = product.name;
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
        }, 40);
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
        if (cost <= 0) {
            els.editorMargin.classList.add('is-flat');
            els.editorMargin.textContent = `Laba per ${unit}: isi HPP untuk melihat margin`;
            return;
        }

        const diff = sell - cost;
        const pct = Math.round((diff / cost) * 100);
        if (diff > 0) {
            els.editorMargin.textContent = `Laba per ${unit}: ${formatMoney(diff)} (+${pct}%)`;
        } else if (diff < 0) {
            els.editorMargin.classList.add('is-loss');
            els.editorMargin.textContent = `Rugi per ${unit}: -${formatMoney(Math.abs(diff))} (${pct}%) — harga jual di bawah HPP`;
        } else {
            els.editorMargin.classList.add('is-flat');
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

    async function saveEditedPrice( overrideId = null, overridePayload = null, isUndo = false ) {
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

        // Optimistic update agar daftar langsung terasa instan
        product.price_sell = nextSell;
        product.price_cost = nextCost;
        product.updated_ms = Date.now();
        renderProductList();

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
            // Kembalikan nilai lama bila gagal
            product.price_sell = prevSnapshot.price_sell;
            product.price_cost = prevSnapshot.price_cost;
            renderProductList();
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

        els.productList.addEventListener('click', (event) => {
            const card = event.target.closest('[data-product-id]');
            if (!card) return;
            openEditor(card.dataset.productId);
        });

        document.querySelectorAll('[data-close-sheet]').forEach((el) => {
            el.addEventListener('click', closeEditor);
        });

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
                if (!els.editorSheet.hidden) closeEditor();
                else if (!els.menuPanel.hidden) closeMenu();
            }
        });

        // Segarkan seketika saat aplikasi difokuskan kembali atau sinyal pulih
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
            // Bila sedang luring, tetap izinkan masuk memakai profil & cache lokal
        }

        await enterApp();
    }

    init();
})();
