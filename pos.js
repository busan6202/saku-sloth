/* ==========================================================================
   SAKU KASIR — logika modul POS (memakai API & sesi akun Saku Harian)
   ========================================================================== */
(() => {
    'use strict';

    const SESSION_KEY = 'saku-user-session-v1';
    const THEME_KEY = 'saku-theme';
    // GitHub Pages tidak menjalankan backend Express, jadi panggilan API diarahkan ke server Vercel.
    const API_BASE_URL = (typeof window !== 'undefined' && window.location.origin.startsWith('http') && !window.location.origin.includes('github.io'))
        ? `${window.location.origin}/api`
        : 'https://saku-sloth.vercel.app/api';
    const rupiah = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    });

    const $ = (id) => document.getElementById(id);

    const state = {
        token: '',
        user: null,
        products: [],
        cart: new Map(),
        settings: {},
        payMethod: 'CASH',
        pendingSale: null,
        lastSale: null,
        reportRows: []
    };

    const els = {};

    function cacheElements() {
        [
            'posGate', 'posShell', 'gateLoginLink', 'gateLoginForm', 'gateEmail', 'gatePassword',
            'gateError', 'gateSubmit', 'posUserAvatar', 'posUserName',
            'posSearch', 'btnClearSearch', 'productGrid', 'productCount', 'emptyCatalog',
            'cartItems', 'cartEmpty', 'cartQty', 'cartCost', 'cartProfit', 'cartTotal',
            'btnClearCart', 'btnCheckout', 'checkoutCount',
            'btnManageProducts', 'btnReports', 'btnSettings', 'btnTheme',
            'checkoutModal', 'checkoutTotal', 'payMethodCash', 'payMethodQris',
            'cashPane', 'qrisPane', 'cashInput', 'quickCash', 'changeText',
            'qrisCanvas', 'qrisFallback', 'qrisHint', 'customerName', 'customerPhone',
            'checkoutError', 'btnConfirmPayment',
            'receiptModal', 'receiptContent', 'btnPrintReceipt', 'btnSendWa', 'waPhone',
            'productsModal', 'productForm', 'productId', 'productFormTitle', 'pName', 'pSku',
            'pIconFile', 'pIconPreview', 'btnClearIcon',
            'pBarcode', 'pSell', 'pCost', 'pStock', 'pMinStock', 'pCategory', 'pUnit', 'pWeighable',
            'productError', 'btnResetProduct', 'btnSaveProduct', 'productList',
            'weighModal', 'weighTitle', 'weighProductName', 'weighProductPrice', 'weighModeQty',
            'weighModeRupiah', 'weighPaneQty', 'weighPaneRupiah', 'weighQtyInput', 'weighRupiahInput',
            'weighEstimate', 'weighError', 'btnAddWeigh',
            'btnPurchase', 'purchaseModal', 'purchaseWallet', 'purchaseNote', 'purchaseList',
            'purchaseTotal', 'purchaseError', 'btnSavePurchase',
            'btnSpoilage', 'spoilageModal', 'spoilProduct', 'spoilQty', 'spoilReason',
            'spoilEstimate', 'spoilError', 'btnSaveSpoilage',
            'reportsModal', 'reportFrom', 'reportTo', 'btnLoadReport', 'btnExportCsv',
            'reportSummary', 'reportTableBody',
            'settingsModal', 'sQrisPayload', 'sSheetsUrl', 'qrisHelp', 'sheetsHelp',
            'settingsError', 'btnSaveSettings',
            'posBrandLink', 'cashierSection', 'cashierCount', 'cashierForm', 'cName', 'cEmail',
            'cPassword', 'btnAddCashier', 'cashierError', 'cashierList',
            'posToast'
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
        return rupiah.format(Number(value) || 0);
    }

    function formatDateTime(value) {
        const date = value ? new Date(value) : new Date();
        return date.toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }

    function todayInputValue() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${now.getFullYear()}-${month}-${day}`;
    }

    function firstDayOfMonthValue() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        return `${now.getFullYear()}-${month}-01`;
    }

    let toastTimer = null;
    function showToast(message, isError = false) {
        clearTimeout(toastTimer);
        els.posToast.textContent = message;
        els.posToast.classList.toggle('is-error', Boolean(isError));
        els.posToast.hidden = false;
        toastTimer = setTimeout(() => { els.posToast.hidden = true; }, 3200);
    }

    function openModal(id) {
        const modal = $(id);
        if (!modal) return;
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeModal(id) {
        const modal = $(id);
        if (!modal) return;
        modal.hidden = true;
        const anyOpen = [...document.querySelectorAll('.pos-modal')].some((m) => !m.hidden);
        if (!anyOpen) document.body.style.overflow = '';
    }

    function readSession() {
        try {
            const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
            if (!parsed || !parsed.token) return null;
            return { token: parsed.token, user: parsed.user || {} };
        } catch {
            return null;
        }
    }

    function showGate(message) {
        els.posShell.hidden = true;
        els.posGate.hidden = false;
        if (message) {
            const copy = els.posGate.querySelector('p');
            if (copy) copy.textContent = message;
        }
    }

    // Login langsung dari layar kasir (dipakai akun kasir maupun pemilik toko).
    async function handleGateLogin(event) {
        event.preventDefault();
        els.gateError.hidden = true;
        els.gateSubmit.disabled = true;
        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    identifier: els.gateEmail.value.trim(),
                    email: els.gateEmail.value.trim(),
                    password: els.gatePassword.value
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Email atau kata sandi tidak sesuai.');

            const user = {
                id: data.user.id,
                username: data.user.username,
                email: data.user.email || '',
                fullName: data.user.fullName || data.user.username,
                avatar: data.user.avatar || '🐮',
                role: data.user.role || 'user',
                ownerId: data.user.ownerId || null,
                token: data.token
            };
            localStorage.setItem(SESSION_KEY, JSON.stringify({ user, token: data.token }));
            window.location.reload();
        } catch (err) {
            els.gateError.textContent = err.message;
            els.gateError.hidden = false;
        } finally {
            els.gateSubmit.disabled = false;
        }
    }

    async function api(path, options = {}) {
        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        if (state.token) headers.Authorization = `Bearer ${state.token}`;
        const response = await fetch(`${API_BASE_URL}${path.replace(/^\/api/, '')}`, { ...options, headers });
        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }
        if (!response.ok) {
            const message = data?.error || `Permintaan gagal (${response.status}).`;
            throw new Error(message);
        }
        return data;
    }

    function applyTheme() {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === 'dark') {
            document.documentElement.dataset.theme = 'dark';
            els.btnTheme.textContent = '☀️';
        } else {
            delete document.documentElement.dataset.theme;
            els.btnTheme.textContent = '🌙';
        }
    }

    function toggleTheme() {
        const isDark = document.documentElement.dataset.theme === 'dark';
        if (isDark) {
            delete document.documentElement.dataset.theme;
            localStorage.setItem(THEME_KEY, 'light');
        } else {
            document.documentElement.dataset.theme = 'dark';
            localStorage.setItem(THEME_KEY, 'dark');
        }
        applyTheme();
    }

    // ================= PRODUK =================

    async function loadProducts() {
        state.products = await api('/api/pos/products?include_inactive=1');
        for (const [key, line] of [...state.cart.entries()]) {
            if (!state.products.some((product) => Number(product.id) === Number(line.productId))) {
                state.cart.delete(key);
            }
        }
        renderCatalog();
        renderCart();
        renderProductList();
    }

    // Ikon PNG dari open-crop-icons (https://github.com/openfarmcc/open-crop-icons, lisensi CC0).
    // Urutan penting: pola yang lebih spesifik harus berada di atas.
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

    // Ikon lini bergaya theSVG UI untuk produk non-sayur: grid 24x24, memakai currentColor.
    const PRODUCT_ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

    const PRODUCT_ICONS = {
        grain: `
            <path d="M12 21V8" />
            <path d="M12 8c0-2 1.3-3.6 3.2-4" />
            <path d="M12 8c0-2-1.3-3.6-3.2-4" />
            <path d="M12 12.5c1.6-1.2 3.6-1.1 5 .2" />
            <path d="M12 12.5c-1.6-1.2-3.6-1.1-5 .2" />
            <path d="M12 17c1.6-1.2 3.6-1.1 5 .2" />
            <path d="M12 17c-1.6-1.2-3.6-1.1-5 .2" />
        `,
        bag: `
            <path d="M6 8h12l-1 12H7L6 8Z" />
            <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
        `,
        cup: `
            <path d="M5 8h14l-1.4 11.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8L5 8Z" />
            <path d="M8 5h8" />
        `,
        bread: `
            <path d="M4 11.5C4 8.5 6.2 6 9.2 6h5.6C17.8 6 20 8.5 20 11.5c0 1.4-1 2.5-2.4 2.5H6.4C5 14 4 12.9 4 11.5Z" />
            <path d="M5 14v3.5C5 18.9 6.1 20 7.5 20h9c1.4 0 2.5-1.1 2.5-2.5V14" />
        `,
        phone: `
            <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
            <path d="M11 18.5h2" />
        `,
        package: `
            <path d="M12 3 21 7.5v9L12 21l-9-4.5v-9L12 3Z" />
            <path d="m3 7.5 9 4.5 9-4.5" />
            <path d="M12 12v9" />
        `
    };

    function vegIconFile(name) {
        for (const [pattern, file] of VEG_ICON_RULES) {
            if (pattern.test(name)) return file;
        }
        return '';
    }

    function productIcon(product) {
        const name = String(product.name || '').toLowerCase();
        const category = String(product.category || '').toUpperCase();

        // Ikon kustom per produk (hasil unggah PNG di form produk) selalu diutamakan.
        const customIcon = String(product.icon_url || '').trim();
        if (customIcon) {
            return `<img class="pos-product-icon-img" src="${escapeHtml(customIcon)}" width="64" height="64" alt="" loading="lazy" decoding="async">`;
        }

        const isProduce = category === 'SAYUR_DAUN' || category === 'BUMBU_TIMBANG';
        const fallback = category === 'BUMBU_TIMBANG' ? 'cayenne-pepper' : 'collard-greens';
        const vegFile = vegIconFile(name) || (isProduce ? fallback : '');
        if (vegFile) {
            return `<img class="pos-product-icon-img" src="icons/vegetables/${vegFile}.png" width="64" height="64" alt="" loading="lazy" decoding="async">`;
        }

        let key = 'package';
        if (category === 'SEMBAKO' || /beras|gula|minyak|telur|tepung/.test(name)) key = 'grain';
        else if (category === 'BUNGKUSAN' || /bungkus|sachet|kemasan/.test(name)) key = 'bag';
        else if (/kopi|teh|minum|susu|jus|es/.test(name)) key = 'cup';
        else if (/roti|kue|snack|makan|nasi|mie/.test(name)) key = 'bread';
        else if (/pulsa|kuota|token/.test(name)) key = 'phone';
        return `<svg class="pos-product-icon-svg" ${PRODUCT_ICON_ATTRS}>${PRODUCT_ICONS[key]}</svg>`;
    }

    function stockLabel(product) {
        const stock = Number(product.stock) || 0;
        return `${formatQty(stock)} ${product.unit || 'PCS'}`;
    }

    function stockClass(product) {
        const stock = Number(product.stock) || 0;
        const min = Number(product.min_stock) || 0;
        if (stock <= 0) return 'is-empty';
        if (stock <= min) return 'is-low';
        return '';
    }

    function renderCatalog() {
        const keyword = els.posSearch.value.trim().toLowerCase();
        const activeProducts = state.products.filter((product) => product.is_active);
        const visible = keyword
            ? activeProducts.filter((product) => {
                const haystack = `${product.name} ${product.sku || ''} ${product.barcode || ''}`.toLowerCase();
                return haystack.includes(keyword);
            })
            : activeProducts;

        els.productCount.textContent = `${visible.length} produk`;
        els.emptyCatalog.hidden = visible.length > 0;
        els.productGrid.innerHTML = visible.map((product) => {
            const stock = Number(product.stock) || 0;
            return `
                <button type="button" class="pos-product-card" data-product-id="${product.id}" ${stock <= 0 ? 'disabled' : ''}>
                    <span class="pos-product-icon" aria-hidden="true">${productIcon(product)}</span>
                    <span class="pos-product-name">${escapeHtml(product.name)}</span>
                    <span class="pos-product-meta">${escapeHtml(product.category || 'UMUM')} · ${escapeHtml(product.sku || product.barcode || 'Tanpa SKU')}</span>
                    <span class="pos-product-price">${formatMoney(product.price_sell)}<small> / ${escapeHtml(product.unit || 'PCS')}</small></span>
                    <span class="pos-stock-pill ${stockClass(product)}">${stock <= 0 ? 'Stok habis' : `Stok ${escapeHtml(stockLabel(product))}`}${product.is_weighable ? ' ⚖️' : ''}</span>
                </button>
            `;
        }).join('');
    }

    function renderProductList() {
        if (!els.productList) return;
        if (state.products.length === 0) {
            els.productList.innerHTML = '<tr><td colspan="5">Belum ada produk.</td></tr>';
            return;
        }
        els.productList.innerHTML = state.products.map((product) => `
            <tr>
                <td>
                    <div class="pos-table-product">
                        <span class="pos-table-icon" aria-hidden="true">${productIcon(product)}</span>
                        <span>
                            <strong>${escapeHtml(product.name)}</strong><br>
                            <span class="pos-product-meta">${escapeHtml(product.sku || '-')} · ${escapeHtml(product.barcode || 'tanpa barcode')}${product.is_active ? '' : ' · nonaktif'}</span>
                        </span>
                    </div>
                </td>
                <td class="numeric">${formatMoney(product.price_sell)}<br><span class="pos-product-meta">per ${escapeHtml(product.unit || 'PCS')}</span></td>
                <td class="numeric">${formatMoney(product.price_cost)}</td>
                <td class="numeric">${escapeHtml(stockLabel(product))}</td>
                <td>
                    <div class="pos-row-actions">
                        <button type="button" class="pos-mini-button" data-edit-product="${product.id}">Edit</button>
                        <button type="button" class="pos-mini-button" data-delete-product="${product.id}">Hapus</button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // ================= KERANJANG =================

    function findProduct(productId) {
        return state.products.find((product) => Number(product.id) === Number(productId));
    }

    function formatQty(qty) {
        const num = Number(qty) || 0;
        return String(Number(num.toFixed(3)));
    }

    function cartStep(product) {
        return product?.is_weighable ? 0.1 : 1;
    }

    function cartTotals() {
        let qty = 0;
        let total = 0;
        let cost = 0;
        for (const line of state.cart.values()) {
            const product = findProduct(line.productId);
            if (!product) continue;
            const subtotal = line.subtotal != null ? line.subtotal : Number(product.price_sell) * line.qty;
            const unitCost = Number(product.price_cost) || 0;
            qty += line.qty;
            total += subtotal;
            cost += unitCost * line.qty;
        }
        return { qty, total, cost, profit: total - cost };
    }

    function cartStockUsed(productId, ignoreKey = null) {
        let used = 0;
        for (const [key, line] of state.cart.entries()) {
            if (key === ignoreKey) continue;
            if (Number(line.productId) === Number(productId)) used += line.qty;
        }
        return used;
    }

    // Tambah baris keranjang. `subtotal` diisi untuk mode nominal rupiah (produk timbangan).
    function pushCartLine(product, qty, subtotal = null) {
        const stock = Number(product.stock) || 0;
        const used = cartStockUsed(product.id);
        if (qty <= 0) return;
        if (used + qty > stock + 1e-9) {
            showToast(`Stok ${product.name} hanya ${formatQty(stock)} ${product.unit || ''}.`, true);
            return;
        }
        const key = subtotal != null ? `c-${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` : `p-${product.id}`;
        const existing = state.cart.get(key);
        if (existing && subtotal == null) {
            existing.qty = Number((existing.qty + qty).toFixed(3));
        } else {
            state.cart.set(key, { productId: Number(product.id), qty: Number(qty.toFixed(3)), subtotal });
        }
        renderCart();
    }

    function addToCart(productId) {
        const product = findProduct(productId);
        if (!product || !product.is_active) return;
        if (product.is_weighable) {
            openWeighModal(product);
            return;
        }
        pushCartLine(product, 1);
    }

    function changeQty(cartKey, direction) {
        const line = state.cart.get(cartKey);
        if (!line) return;
        const product = findProduct(line.productId);
        if (!product) return;
        if (direction > 0 && line.subtotal != null) {
            // Baris nominal manual: naikkan nominal sebesar harga satuan setara berat minimum.
            showToast('Baris nominal manual tidak bisa ditambah. Hapus lalu tambahkan lagi.', true);
            return;
        }
        const next = Number((line.qty + cartStep(product) * direction).toFixed(3));
        if (next <= 0) {
            state.cart.delete(cartKey);
        } else if (cartStockUsed(product.id, cartKey) + next > Number(product.stock || 0) + 1e-9) {
            showToast(`Stok ${product.name} hanya ${formatQty(product.stock)} ${product.unit || ''}.`, true);
            return;
        } else {
            line.qty = next;
        }
        renderCart();
    }

    function clearCart() {
        state.cart.clear();
        renderCart();
    }

    function cartPayloadItems() {
        return [...state.cart.values()].map((line) => (
            line.subtotal != null
                ? { productId: line.productId, qty: line.qty, subtotal: line.subtotal }
                : { productId: line.productId, qty: line.qty }
        ));
    }

    function renderCart() {
        const totals = cartTotals();
        els.cartQty.textContent = formatQty(totals.qty);
        els.cartCost.textContent = formatMoney(totals.cost);
        els.cartProfit.textContent = formatMoney(totals.profit);
        els.cartTotal.textContent = formatMoney(totals.total);
        els.cartEmpty.hidden = state.cart.size > 0;
        els.btnCheckout.disabled = state.cart.size === 0;
        els.checkoutCount.textContent = state.cart.size > 0 ? `(${formatQty(totals.qty)})` : '';

        els.cartItems.innerHTML = [...state.cart.entries()].map(([key, line]) => {
            const product = findProduct(line.productId);
            if (!product) return '';
            const unit = product.unit || 'PCS';
            const subtotal = line.subtotal != null ? line.subtotal : Number(product.price_sell) * line.qty;
            const priceLabel = line.subtotal != null
                ? `Nominal manual · ± ${formatQty(line.qty)} ${unit}`
                : `${formatMoney(product.price_sell)} / ${unit}`;
            return `
                <div class="pos-cart-item">
                    <div>
                        <div class="pos-cart-item-name">${escapeHtml(product.name)}</div>
                        <div class="pos-cart-item-price">${priceLabel}</div>
                    </div>
                    <div class="pos-cart-item-total">${formatMoney(subtotal)}</div>
                    ${line.subtotal != null
                        ? `<div class="pos-qty-control"><button type="button" data-cart-action="dec" data-cart-key="${key}" aria-label="Hapus ${escapeHtml(product.name)}">✕</button></div>`
                        : `<div class="pos-qty-control">
                        <button type="button" data-cart-action="dec" data-cart-key="${key}" aria-label="Kurangi ${escapeHtml(product.name)}">−</button>
                        <span>${formatQty(line.qty)} ${escapeHtml(unit)}</span>
                        <button type="button" data-cart-action="inc" data-cart-key="${key}" aria-label="Tambah ${escapeHtml(product.name)}">+</button>
                    </div>`}
                </div>
            `;
        }).join('');
    }

    // ================= TIMBANGAN & NOMINAL MANUAL =================

    const weighState = { product: null, mode: 'qty' };

    function openWeighModal(product) {
        weighState.product = product;
        weighState.mode = 'qty';
        els.weighTitle.textContent = `Timbang ${product.name}`;
        els.weighProductName.textContent = product.name;
        els.weighProductPrice.textContent = `${formatMoney(product.price_sell)} / ${product.unit || 'KG'}`;
        els.weighQtyInput.value = '';
        els.weighRupiahInput.value = '';
        els.weighEstimate.textContent = '';
        els.weighError.hidden = true;
        setWeighMode('qty');
        openModal('weighModal');
        setTimeout(() => els.weighQtyInput.focus(), 50);
    }

    function setWeighMode(mode) {
        weighState.mode = mode === 'rupiah' ? 'rupiah' : 'qty';
        const isQty = weighState.mode === 'qty';
        els.weighModeQty.classList.toggle('is-active', isQty);
        els.weighModeRupiah.classList.toggle('is-active', !isQty);
        els.weighModeQty.setAttribute('aria-selected', String(isQty));
        els.weighModeRupiah.setAttribute('aria-selected', String(!isQty));
        els.weighPaneQty.hidden = !isQty;
        els.weighPaneRupiah.hidden = isQty;
        updateWeighEstimate();
    }

    function updateWeighEstimate() {
        const product = weighState.product;
        if (!product) return;
        const price = Number(product.price_sell) || 0;
        const nominal = Number(els.weighRupiahInput.value) || 0;
        if (weighState.mode === 'rupiah' && nominal > 0 && price > 0) {
            const estimated = Math.round((nominal / price) * 1000) / 1000;
            els.weighEstimate.textContent = `Setara ± ${formatQty(estimated)} ${product.unit || 'KG'}`;
        } else {
            els.weighEstimate.textContent = '';
        }
    }

    function confirmWeigh() {
        const product = weighState.product;
        if (!product) return;
        const price = Number(product.price_sell) || 0;
        els.weighError.hidden = true;

        if (weighState.mode === 'rupiah') {
            const nominal = Math.round(Number(els.weighRupiahInput.value) || 0);
            if (nominal <= 0) {
                els.weighError.textContent = 'Isi nominal rupiah terlebih dahulu.';
                els.weighError.hidden = false;
                return;
            }
            if (price <= 0) {
                els.weighError.textContent = 'Harga produk belum diatur.';
                els.weighError.hidden = false;
                return;
            }
            const qty = Math.round((nominal / price) * 1000) / 1000;
            pushCartLine(product, qty, nominal);
        } else {
            const qty = Number(els.weighQtyInput.value);
            if (!Number.isFinite(qty) || qty <= 0) {
                els.weighError.textContent = 'Isi berat/jumlah terlebih dahulu.';
                els.weighError.hidden = false;
                return;
            }
            pushCartLine(product, qty);
        }
        closeModal('weighModal');
    }

    // ================= KULAKAN (STOK MASUK) =================

    function openPurchaseModal() {
        els.purchaseError.hidden = true;
        els.purchaseNote.value = '';
        els.purchaseWallet.value = state.settings.cash_wallet || 'Tunai';
        const active = state.products.filter((product) => product.is_active);
        els.purchaseList.innerHTML = active.length === 0
            ? '<p class="pos-help">Belum ada produk aktif.</p>'
            : active.map((product) => `
                <div class="pos-purchase-row" data-purchase-row="${product.id}">
                    <div class="pos-purchase-name">
                        <strong>${escapeHtml(product.name)}</strong>
                        <span class="pos-product-meta">${escapeHtml(product.category || 'UMUM')} · stok ${formatQty(product.stock)} ${escapeHtml(product.unit || 'PCS')} · HPP ${formatMoney(product.price_cost)}</span>
                    </div>
                    <input type="number" min="0" step="0.001" placeholder="Qty" data-purchase-qty="${product.id}">
                    <input type="number" min="0" step="100" placeholder="HPP/satuan" data-purchase-cost="${product.id}" value="${Number(product.price_cost) || ''}">
                    <input type="number" min="0" step="100" placeholder="Harga jual" data-purchase-sell="${product.id}" value="${Number(product.price_sell) || ''}">
                </div>
            `).join('');
        updatePurchaseTotal();
        openModal('purchaseModal');
    }

    function collectPurchaseItems() {
        return [...els.purchaseList.querySelectorAll('[data-purchase-row]')].map((row) => {
            const id = row.dataset.purchaseRow;
            return {
                productId: Number(id),
                qty: Number(els.purchaseList.querySelector(`[data-purchase-qty="${id}"]`)?.value) || 0,
                costPerUnit: Number(els.purchaseList.querySelector(`[data-purchase-cost="${id}"]`)?.value) || 0,
                sellPrice: els.purchaseList.querySelector(`[data-purchase-sell="${id}"]`)?.value || ''
            };
        }).filter((item) => item.qty > 0);
    }

    function updatePurchaseTotal() {
        const total = collectPurchaseItems().reduce((sum, item) => sum + item.qty * item.costPerUnit, 0);
        els.purchaseTotal.textContent = formatMoney(total);
    }

    async function savePurchase() {
        els.purchaseError.hidden = true;
        const items = collectPurchaseItems();
        if (items.length === 0) {
            els.purchaseError.textContent = 'Isi minimal satu produk yang masuk.';
            els.purchaseError.hidden = false;
            return;
        }
        els.btnSavePurchase.disabled = true;
        try {
            await api('/api/pos/purchases', {
                method: 'POST',
                body: JSON.stringify({
                    wallet: els.purchaseWallet.value.trim(),
                    note: els.purchaseNote.value.trim(),
                    items
                })
            });
            closeModal('purchaseModal');
            showToast('Kulakan tersimpan. Stok & HPP diperbarui.');
            await loadProducts();
        } catch (err) {
            els.purchaseError.textContent = err.message;
            els.purchaseError.hidden = false;
        } finally {
            els.btnSavePurchase.disabled = false;
        }
    }

    // ================= SUSUT / BARANG RUSAK =================

    function openSpoilageModal() {
        els.spoilError.hidden = true;
        els.spoilQty.value = '';
        els.spoilEstimate.textContent = '';
        const active = state.products.filter((product) => product.is_active && Number(product.stock) > 0);
        els.spoilProduct.innerHTML = active.length === 0
            ? '<option value="">Tidak ada produk berstok</option>'
            : active.map((product) => `<option value="${product.id}">${escapeHtml(product.name)} — ${formatQty(product.stock)} ${escapeHtml(product.unit || 'PCS')}</option>`).join('');
        updateSpoilEstimate();
        openModal('spoilageModal');
    }

    function updateSpoilEstimate() {
        const product = findProduct(els.spoilProduct.value);
        const qty = Number(els.spoilQty.value) || 0;
        if (!product || qty <= 0) {
            els.spoilEstimate.textContent = '';
            return;
        }
        const loss = (Number(product.price_cost) || 0) * qty;
        els.spoilEstimate.textContent = `Estimasi kerugian modal: ${formatMoney(loss)}`;
    }

    async function saveSpoilage() {
        els.spoilError.hidden = true;
        const productId = Number(els.spoilProduct.value);
        const qty = Number(els.spoilQty.value);
        if (!Number.isFinite(productId) || !Number.isFinite(qty) || qty <= 0) {
            els.spoilError.textContent = 'Pilih produk dan isi jumlah susut.';
            els.spoilError.hidden = false;
            return;
        }
        els.btnSaveSpoilage.disabled = true;
        try {
            await api('/api/pos/spoilage', {
                method: 'POST',
                body: JSON.stringify({ productId, qty, reason: els.spoilReason.value })
            });
            closeModal('spoilageModal');
            showToast('Susut tercatat dan stok dikurangi.');
            await loadProducts();
        } catch (err) {
            els.spoilError.textContent = err.message;
            els.spoilError.hidden = false;
        } finally {
            els.btnSaveSpoilage.disabled = false;
        }
    }

    // ================= PEMBAYARAN =================

    function setPayMethod(method) {
        state.payMethod = method === 'QRIS' ? 'QRIS' : 'CASH';
        const isCash = state.payMethod === 'CASH';
        els.payMethodCash.classList.toggle('is-active', isCash);
        els.payMethodQris.classList.toggle('is-active', !isCash);
        els.payMethodCash.setAttribute('aria-selected', String(isCash));
        els.payMethodQris.setAttribute('aria-selected', String(!isCash));
        els.cashPane.hidden = !isCash;
        els.qrisPane.hidden = isCash;
        els.btnConfirmPayment.textContent = isCash ? 'Selesaikan' : 'Buat Tagihan QRIS';
        if (!isCash) renderQris();
        updateChange();
    }

    function openCheckout() {
        if (state.cart.size === 0) return;
        state.pendingSale = null;
        els.checkoutError.hidden = true;
        els.customerName.value = '';
        els.customerPhone.value = '';
        els.cashInput.value = '';
        els.checkoutTotal.textContent = formatMoney(cartTotals().total);
        buildQuickCash();
        setPayMethod('CASH');
        openModal('checkoutModal');
    }

    function buildQuickCash() {
        const total = cartTotals().total;
        const suggestions = new Set([total]);
        [1000, 5000, 10000, 20000, 50000, 100000].forEach((step) => {
            suggestions.add(Math.ceil(total / step) * step);
        });
        const unique = [...suggestions].filter((value) => value >= total).sort((a, b) => a - b).slice(0, 6);
        els.quickCash.innerHTML = unique.map((value) => `
            <button type="button" data-cash="${value}">${formatMoney(value)}</button>
        `).join('');
    }

    function updateChange() {
        const total = cartTotals().total;
        const paid = Number(els.cashInput.value) || 0;
        const change = paid - total;
        els.changeText.textContent = formatMoney(Math.max(0, change));
        els.changeText.parentElement.classList.toggle('is-short', state.payMethod === 'CASH' && change < 0);
    }

    async function renderQris() {
        const payload = String(state.settings.qris_payload || '').trim();
        const sale = state.pendingSale;
        const total = sale ? Number(sale.total_amount) : cartTotals().total;
        els.qrisFallback.textContent = payload
            ? payload
            : 'Payload QRIS belum diatur di menu ⚙️ Pengaturan. Pembayaran tetap bisa dikonfirmasi manual.';
        els.qrisHint.innerHTML = sale
            ? `Invoice <strong>${escapeHtml(sale.invoice_no)}</strong> menunggu pembayaran ${formatMoney(total)}.<br>Tekan <strong>Konfirmasi Lunas</strong> setelah dana masuk.`
            : 'Minta pelanggan memindai kode QRIS, lalu tekan <strong>Buat Tagihan QRIS</strong> untuk mencatat transaksi pending.';

        if (!payload || typeof window.QRCode === 'undefined') {
            els.qrisCanvas.hidden = true;
            return;
        }
        els.qrisCanvas.hidden = false;
        try {
            await window.QRCode.toCanvas(els.qrisCanvas, payload, { width: 200, margin: 1 });
        } catch {
            els.qrisCanvas.hidden = true;
        }
    }

    async function submitCashPayment() {
        const totals = cartTotals();
        const paid = Number(els.cashInput.value) || 0;
        if (paid < totals.total) {
            els.checkoutError.textContent = 'Uang diterima masih kurang dari total belanja.';
            els.checkoutError.hidden = false;
            return;
        }
        const result = await api('/api/pos/checkout', {
            method: 'POST',
            body: JSON.stringify({
                items: cartPayloadItems(),
                paymentMethod: 'CASH',
                paidAmount: paid,
                customerName: els.customerName.value.trim(),
                customerPhone: els.customerPhone.value.trim()
            })
        });
        await finishPayment(result.sale, result.items);
    }

    async function createQrisPending() {
        const result = await api('/api/pos/checkout', {
            method: 'POST',
            body: JSON.stringify({
                items: cartPayloadItems(),
                paymentMethod: 'QRIS',
                customerName: els.customerName.value.trim(),
                customerPhone: els.customerPhone.value.trim()
            })
        });
        state.pendingSale = result.sale;
        clearCart();
        setPayMethod('QRIS');
        els.btnConfirmPayment.textContent = '✅ Konfirmasi Lunas';
        els.checkoutError.hidden = true;
        await renderQris();
        await loadProducts();
        showToast(`Tagihan ${result.sale.invoice_no} dibuat. Menunggu pembayaran.`);
    }

    async function confirmQrisPaid() {
        const sale = state.pendingSale;
        const result = await api(`/api/pos/sales/${sale.id}/pay`, { method: 'POST' });
        await finishPayment(result.sale, result.items);
    }

    async function finishPayment(sale, items) {
        state.lastSale = { sale, items };
        state.pendingSale = null;
        els.customerName.value = '';
        els.customerPhone.value = '';
        els.waPhone.value = sale.customer_phone || '';
        closeModal('checkoutModal');
        renderReceipt(sale, items);
        openModal('receiptModal');
        clearCart();
        await loadProducts();
    }

    async function handleConfirmPayment() {
        els.checkoutError.hidden = true;
        els.btnConfirmPayment.disabled = true;
        try {
            if (state.pendingSale) {
                await confirmQrisPaid();
            } else if (state.payMethod === 'CASH') {
                await submitCashPayment();
            } else {
                await createQrisPending();
            }
        } catch (err) {
            els.checkoutError.textContent = err.message;
            els.checkoutError.hidden = false;
        } finally {
            els.btnConfirmPayment.disabled = false;
        }
    }

    // ================= STRUK =================

    function renderReceipt(sale, items) {
        const rows = (items || []).map((item) => `
            <div class="pos-receipt-item">
                <p>${escapeHtml(item.product_name || item.productName)}</p>
                <div class="pos-receipt-row">
                    <span>${formatQty(item.qty)} ${escapeHtml(item.unit || 'PCS')} × ${formatMoney(item.unit_price ?? item.unitPrice)}</span>
                    <span>${formatMoney(item.subtotal)}</span>
                </div>
            </div>
        `).join('');

        const isCash = sale.payment_method === 'CASH';
        els.receiptContent.innerHTML = `
            <div class="pos-receipt-brand">
                <strong>SAKU KASIR</strong>
                <p>Nota Penjualan</p>
            </div>
            <div class="pos-receipt-row"><span>Invoice</span><strong>${escapeHtml(sale.invoice_no)}</strong></div>
            <div class="pos-receipt-row"><span>Waktu</span><span>${formatDateTime(sale.paid_at || sale.created_at)}</span></div>
            <div class="pos-receipt-row"><span>Kasir</span><span>${escapeHtml(state.user?.fullName || state.user?.full_name || state.user?.username || 'Kasir')}</span></div>
            ${sale.customer_name ? `<div class="pos-receipt-row"><span>Pelanggan</span><span>${escapeHtml(sale.customer_name)}</span></div>` : ''}
            <div class="pos-receipt-divider"></div>
            ${rows}
            <div class="pos-receipt-divider"></div>
            <div class="pos-receipt-row"><span>Metode</span><span>${isCash ? 'TUNAI' : 'QRIS'}</span></div>
            <div class="pos-receipt-row"><span>Saku Tujuan</span><span>${escapeHtml(sale.wallet)}</span></div>
            <div class="pos-receipt-row"><span>Total HPP</span><span>${formatMoney(sale.total_cost)}</span></div>
            <div class="pos-receipt-row"><span>Laba Kotor</span><span>${formatMoney(sale.gross_profit)}</span></div>
            <div class="pos-receipt-divider"></div>
            <div class="pos-receipt-row is-total"><span>TOTAL</span><span>${formatMoney(sale.total_amount)}</span></div>
            ${isCash ? `
                <div class="pos-receipt-row"><span>Diterima</span><span>${formatMoney(sale.paid_amount)}</span></div>
                <div class="pos-receipt-row"><span>Kembalian</span><span>${formatMoney(sale.change_amount)}</span></div>
            ` : ''}
            <div class="pos-receipt-divider"></div>
            <p style="text-align:center;margin:0">Terima kasih sudah berbelanja 🙏</p>
        `;
    }

    function receiptText(sale, items) {
        const lines = [
            '*SAKU KASIR*',
            `Invoice: ${sale.invoice_no}`,
            `Waktu: ${formatDateTime(sale.paid_at || sale.created_at)}`,
            ''
        ];
        (items || []).forEach((item) => {
            lines.push(`${item.product_name || item.productName} ${formatQty(item.qty)} ${item.unit || 'PCS'} × ${formatMoney(item.unit_price ?? item.unitPrice)} = ${formatMoney(item.subtotal)}`);
        });
        lines.push('', `Total: ${formatMoney(sale.total_amount)}`, `Metode: ${sale.payment_method}`, `Saku: ${sale.wallet}`);
        if (sale.payment_method === 'CASH') {
            lines.push(`Diterima: ${formatMoney(sale.paid_amount)}`, `Kembalian: ${formatMoney(sale.change_amount)}`);
        }
        lines.push('', 'Terima kasih sudah berbelanja 🙏');
        return lines.join('\n');
    }

    function sendReceiptToWhatsApp() {
        if (!state.lastSale) return;
        const rawPhone = els.waPhone.value.trim() || state.lastSale.sale.customer_phone || '';
        const digits = rawPhone.replace(/\D/g, '');
        if (!digits) {
            showToast('Isi nomor WhatsApp terlebih dahulu.', true);
            return;
        }
        const normalized = digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
        const text = encodeURIComponent(receiptText(state.lastSale.sale, state.lastSale.items));
        window.open(`https://wa.me/${normalized}?text=${text}`, '_blank', 'noopener');
    }

    // ================= LAPORAN =================

    async function openReports() {
        if (!els.reportFrom.value) els.reportFrom.value = firstDayOfMonthValue();
        if (!els.reportTo.value) els.reportTo.value = todayInputValue();
        openModal('reportsModal');
        await loadReport();
    }

    function reportQuery() {
        const params = new URLSearchParams();
        if (els.reportFrom.value) params.set('from', els.reportFrom.value);
        if (els.reportTo.value) params.set('to', els.reportTo.value);
        return params.toString();
    }

    async function loadReport() {
        els.reportSummary.innerHTML = '<div class="pos-summary-card"><span>Memuat</span><strong>…</strong></div>';
        els.reportTableBody.innerHTML = '';
        try {
            const query = reportQuery();
            const [summary, sales] = await Promise.all([
                api(`/api/pos/summary${query ? `?${query}` : ''}`),
                api(`/api/pos/sales?limit=300${query ? `&${query}` : ''}`)
            ]);
            state.reportRows = sales;
            renderReportSummary(summary);
            renderReportRows(sales);
        } catch (err) {
            els.reportSummary.innerHTML = '';
            els.reportTableBody.innerHTML = `<tr><td colspan="7">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    function renderReportSummary(summary) {
        const cards = [
            ['Transaksi Lunas', String(summary.transactions)],
            ['Omzet', formatMoney(summary.omzet)],
            ['HPP', formatMoney(summary.hpp)],
            ['Laba Kotor', formatMoney(summary.laba)],
            ['Susut / Layu', formatMoney(summary.spoilageLoss)],
            ['Laba Bersih', formatMoney(summary.netProfit ?? summary.laba)],
            ['Belanja Kulakan', formatMoney(summary.purchaseTotal)],
            ['Tunai', formatMoney(summary.cashTotal)],
            ['QRIS', formatMoney(summary.qrisTotal)],
            ['Pending', String(summary.pending)]
        ];
        els.reportSummary.innerHTML = cards.map(([label, value]) => `
            <div class="pos-summary-card"><span>${label}</span><strong>${value}</strong></div>
        `).join('');
    }

    function renderReportRows(sales) {
        if (sales.length === 0) {
            els.reportTableBody.innerHTML = '<tr><td colspan="7">Belum ada transaksi pada rentang tanggal ini.</td></tr>';
            return;
        }
        els.reportTableBody.innerHTML = sales.map((sale) => {
            const statusClass = sale.status === 'PAID' ? 'pos-status-paid'
                : sale.status === 'PENDING' ? 'pos-status-pending' : 'pos-status-cancelled';
            const payAction = sale.status === 'PENDING'
                ? `<button type="button" class="pos-mini-button" data-pay-sale="${sale.id}">Lunas</button>`
                : '';
            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(sale.invoice_no)}</strong>
                        ${sale.cashier_name ? `<br><span class="pos-product-meta">Kasir: ${escapeHtml(sale.cashier_name)}</span>` : ''}
                    </td>
                    <td>${formatDateTime(sale.created_at)}</td>
                    <td>${escapeHtml(sale.payment_method)}</td>
                    <td class="numeric">${formatMoney(sale.total_amount)}</td>
                    <td class="numeric">${formatMoney(sale.gross_profit)}</td>
                    <td><span class="pos-status ${statusClass}">${escapeHtml(sale.status)}</span></td>
                    <td>
                        <div class="pos-row-actions">
                            ${payAction}
                            <button type="button" class="pos-mini-button" data-detail-sale="${sale.id}">Lihat</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    async function openSaleDetail(saleId) {
        try {
            const detail = await api(`/api/pos/sales/${saleId}`);
            state.lastSale = { sale: detail.sale, items: detail.items };
            els.waPhone.value = detail.sale.customer_phone || '';
            renderReceipt(detail.sale, detail.items);
            openModal('receiptModal');
        } catch (err) {
            showToast(err.message, true);
        }
    }

    async function markSalePaid(saleId) {
        try {
            await api(`/api/pos/sales/${saleId}/pay`, { method: 'POST' });
            showToast('Transaksi ditandai lunas dan masuk ke saku keuangan.');
            await Promise.all([loadReport(), loadProducts()]);
        } catch (err) {
            showToast(err.message, true);
        }
    }

    async function exportReportCsv() {
        try {
            const query = reportQuery();
            const response = await fetch(`${API_BASE_URL}/pos/export-excel${query ? `?${query}` : ''}`, {
                headers: { Authorization: `Bearer ${state.token}` }
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Gagal mengunduh laporan.');
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `laporan-pos-${els.reportFrom.value || 'awal'}-${els.reportTo.value || 'akhir'}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            showToast('Laporan POS berhasil diunduh.');
        } catch (err) {
            showToast(err.message, true);
        }
    }

    // ================= MODE KASIR =================

    function isCashier() {
        return state.user?.role === 'cashier';
    }

    // Kasir tidak boleh keluar dari modul POS: sembunyikan tautan dashboard & pengaturan.
    function applyRoleUi() {
        const cashier = isCashier();
        if (els.posBrandLink) {
            els.posBrandLink.href = cashier ? 'pos.html' : 'index.html';
            els.posBrandLink.title = cashier ? 'Saku Kasir' : 'Kembali ke dashboard keuangan';
        }
        if (els.btnSettings) els.btnSettings.hidden = cashier;
        if (els.cashierSection) els.cashierSection.hidden = cashier;
        if (cashier) {
            els.posUserName.textContent = `${state.user.fullName || state.user.full_name || state.user.username || 'Kasir'} · Kasir`;
        }
    }

    async function loadCashiers() {
        if (!els.cashierList || isCashier()) return;
        try {
            const rows = await api('/api/pos/cashiers');
            els.cashierCount.textContent = `${rows.length} akun`;
            els.cashierList.innerHTML = rows.length === 0
                ? '<p class="pos-help">Belum ada akun kasir. Tambahkan lewat formulir di atas.</p>'
                : rows.map((row) => `
                    <div class="pos-cashier-row">
                        <div>
                            <strong>${escapeHtml(row.full_name || row.username)}</strong>
                            <span class="pos-product-meta">${escapeHtml(row.email || row.username)}</span>
                        </div>
                        <div class="pos-row-actions">
                            <button type="button" class="pos-mini-button" data-reset-cashier="${row.id}">Reset Sandi</button>
                            <button type="button" class="pos-mini-button" data-delete-cashier="${row.id}">Hapus</button>
                        </div>
                    </div>
                `).join('');
        } catch (err) {
            els.cashierList.innerHTML = `<p class="pos-help">${escapeHtml(err.message)}</p>`;
        }
    }

    async function addCashier(event) {
        event.preventDefault();
        els.cashierError.hidden = true;
        els.btnAddCashier.disabled = true;
        try {
            await api('/api/pos/cashiers', {
                method: 'POST',
                body: JSON.stringify({
                    fullName: els.cName.value.trim(),
                    email: els.cEmail.value.trim(),
                    password: els.cPassword.value
                })
            });
            els.cashierForm.reset();
            showToast('Akun kasir dibuat. Kasir bisa masuk lewat halaman POS.');
            await loadCashiers();
        } catch (err) {
            els.cashierError.textContent = err.message;
            els.cashierError.hidden = false;
        } finally {
            els.btnAddCashier.disabled = false;
        }
    }

    async function resetCashierPassword(cashierId) {
        const password = window.prompt('Kata sandi baru untuk kasir ini (minimal 6 karakter):');
        if (!password) return;
        try {
            await api(`/api/pos/cashiers/${cashierId}`, {
                method: 'PUT',
                body: JSON.stringify({ password })
            });
            showToast('Kata sandi kasir diperbarui.');
        } catch (err) {
            showToast(err.message, true);
        }
    }

    async function removeCashier(cashierId) {
        if (!window.confirm('Hapus akun kasir ini? Kasir tidak akan bisa masuk lagi.')) return;
        try {
            await api(`/api/pos/cashiers/${cashierId}`, { method: 'DELETE' });
            showToast('Akun kasir dihapus.');
            await loadCashiers();
        } catch (err) {
            showToast(err.message, true);
        }
    }

    // ================= PENGATURAN =================

    async function loadSettings() {
        state.settings = await api('/api/pos/settings');
        if (els.sSheetsUrl && document.activeElement !== els.sSheetsUrl) {
            els.sSheetsUrl.value = state.settings.sheets_webhook_url || '';
        }
        if (els.sQrisPayload && document.activeElement !== els.sQrisPayload) {
            els.sQrisPayload.value = state.settings.qris_payload || '';
        }
        if (els.qrisHelp) {
            els.qrisHelp.textContent = 'Payload dipakai untuk menampilkan kode QR di layar kasir. Kosongkan bila memakai QRIS statis dari aplikasi merchant.';
        }
        if (els.sheetsHelp) {
            els.sheetsHelp.textContent = state.settings.env_sheets_webhook
                ? 'URL dari environment server sudah aktif. Isi kolom di atas hanya jika ingin menimpa dengan webhook lain.'
                : 'Tempel URL hasil deploy Google Apps Script (doPost) di sini agar setiap transaksi lunas otomatis tercatat ke spreadsheet.';
        }
    }

    async function openSettings() {
        els.settingsError.hidden = true;
        try {
            await loadSettings();
            openModal('settingsModal');
            if (!isCashier()) loadCashiers();
        } catch (err) {
            showToast(err.message, true);
        }
    }

    async function saveSettings() {
        els.settingsError.hidden = true;
        els.btnSaveSettings.disabled = true;
        try {
            const saved = await api('/api/pos/settings', {
                method: 'PUT',
                body: JSON.stringify({
                    qris_payload: els.sQrisPayload.value.trim(),
                    sheets_webhook_url: els.sSheetsUrl.value.trim()
                })
            });
            state.settings = { ...state.settings, ...saved };
            closeModal('settingsModal');
            showToast('Pengaturan POS disimpan.');
        } catch (err) {
            els.settingsError.textContent = err.message;
            els.settingsError.hidden = false;
        } finally {
            els.btnSaveSettings.disabled = false;
        }
    }

    // ================= FORM PRODUK =================

    // Draf ikon kustom untuk form produk (data URL PNG hasil resize di browser).
    let productIconDraft = '';

    const ICON_MAX_SIZE = 128;          // px, sisi terpanjang
    const ICON_MAX_SOURCE_BYTES = 5 * 1024 * 1024; // batas file mentah yang diterima

    function renderProductIconPreview() {
        const box = els.pIconPreview;
        if (!box) return;
        if (productIconDraft) {
            box.innerHTML = `<img class="pos-product-icon-img" src="${escapeHtml(productIconDraft)}" width="64" height="64" alt="">`;
            box.classList.add('is-custom');
            return;
        }
        box.classList.remove('is-custom');
        const preview = productIcon({
            name: els.pName?.value || '',
            category: els.pCategory?.value || '',
            icon_url: ''
        });
        box.innerHTML = preview;
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
            reader.readAsDataURL(file);
        });
    }

    // Perkecil gambar ke maksimal ICON_MAX_SIZE agar payload API & database tetap ringan.
    function resizeImageDataUrl(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, ICON_MAX_SIZE / Math.max(img.width, img.height));
                const width = Math.max(1, Math.round(img.width * scale));
                const height = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Canvas tidak didukung browser ini.'));
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error('File bukan gambar yang valid.'));
            img.src = dataUrl;
        });
    }

    async function handleIconFileChange(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
            showToast('Gunakan gambar PNG, JPG, atau WebP.', true);
            event.target.value = '';
            return;
        }
        if (file.size > ICON_MAX_SOURCE_BYTES) {
            showToast('Ukuran file terlalu besar. Maksimal 5 MB.', true);
            event.target.value = '';
            return;
        }
        try {
            const raw = await readFileAsDataUrl(file);
            productIconDraft = await resizeImageDataUrl(raw);
            renderProductIconPreview();
            showToast('Ikon siap disimpan. Klik Simpan/Update Produk.');
        } catch (err) {
            showToast(err.message, true);
        } finally {
            event.target.value = '';
        }
    }

    function clearProductIconDraft() {
        productIconDraft = '';
        renderProductIconPreview();
    }

    function resetProductForm() {
        els.productForm.reset();
        els.productId.value = '';
        els.pCategory.value = 'SAYUR_DAUN';
        els.pUnit.value = 'KG';
        els.pWeighable.checked = true;
        productIconDraft = '';
        renderProductIconPreview();
        els.productFormTitle.textContent = 'Tambah Produk';
        els.btnSaveProduct.textContent = 'Simpan Produk';
        els.productError.hidden = true;
    }

    function fillProductForm(product) {
        els.productId.value = product.id;
        els.productFormTitle.textContent = 'Edit Produk';
        els.btnSaveProduct.textContent = 'Update Produk';
        els.pName.value = product.name || '';
        els.pSku.value = product.sku || '';
        els.pBarcode.value = product.barcode || '';
        els.pSell.value = Number(product.price_sell) || 0;
        els.pCost.value = Number(product.price_cost) || 0;
        els.pStock.value = Number(product.stock) || 0;
        els.pMinStock.value = Number(product.min_stock) || 0;
        els.pCategory.value = product.category || 'UMUM';
        els.pUnit.value = product.unit || 'PCS';
        els.pWeighable.checked = Boolean(product.is_weighable);
        productIconDraft = String(product.icon_url || '');
        renderProductIconPreview();
        els.productError.hidden = true;
        els.productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function saveProduct(event) {
        event.preventDefault();
        els.productError.hidden = true;
        els.btnSaveProduct.disabled = true;
        const productId = els.productId.value;
        const payload = {
            name: els.pName.value.trim(),
            sku: els.pSku.value.trim(),
            barcode: els.pBarcode.value.trim(),
            price_sell: Number(els.pSell.value) || 0,
            price_cost: Number(els.pCost.value) || 0,
            stock: Math.max(0, Number(els.pStock.value) || 0),
            min_stock: Math.max(0, Number(els.pMinStock.value) || 0),
            category: els.pCategory.value || 'UMUM',
            unit: els.pUnit.value || 'PCS',
            is_weighable: els.pWeighable.checked,
            icon_url: productIconDraft || null
        };
        try {
            if (productId) {
                await api(`/api/pos/products/${productId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showToast('Produk diperbarui.');
            } else {
                await api('/api/pos/products', { method: 'POST', body: JSON.stringify(payload) });
                showToast('Produk baru ditambahkan.');
            }
            resetProductForm();
            await loadProducts();
        } catch (err) {
            els.productError.textContent = err.message;
            els.productError.hidden = false;
        } finally {
            els.btnSaveProduct.disabled = false;
        }
    }

    async function removeProduct(productId) {
        const product = findProduct(productId);
        if (!product) return;
        if (!window.confirm(`Nonaktifkan produk "${product.name}"? Riwayat penjualan tetap tersimpan.`)) return;
        try {
            await api(`/api/pos/products/${productId}`, { method: 'DELETE' });
            showToast('Produk dinonaktifkan.');
            await loadProducts();
        } catch (err) {
            showToast(err.message, true);
        }
    }

    // ================= EVENT BINDING =================

    async function handleSearchEnter() {
        const code = els.posSearch.value.trim();
        if (!code) return;
        const lower = code.toLowerCase();
        const local = state.products.find((product) => product.is_active && (
            String(product.barcode || '').toLowerCase() === lower ||
            String(product.sku || '').toLowerCase() === lower
        ));
        if (local) {
            addToCart(local.id);
            els.posSearch.value = '';
            renderCatalog();
            return;
        }
        try {
            const product = await api(`/api/pos/products/lookup?code=${encodeURIComponent(code)}`);
            addToCart(product.id);
            els.posSearch.value = '';
            renderCatalog();
        } catch (err) {
            showToast(err.message, true);
        }
    }

    function bindEvents() {
        els.posSearch.addEventListener('input', renderCatalog);
        els.posSearch.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                handleSearchEnter();
            }
        });
        els.btnClearSearch.addEventListener('click', () => {
            els.posSearch.value = '';
            renderCatalog();
            els.posSearch.focus();
        });

        els.productGrid.addEventListener('click', (event) => {
            const card = event.target.closest('[data-product-id]');
            if (card) addToCart(card.dataset.productId);
        });

        els.cartItems.addEventListener('click', (event) => {
            const button = event.target.closest('[data-cart-action]');
            if (!button) return;
            changeQty(button.dataset.cartKey, button.dataset.cartAction === 'inc' ? 1 : -1);
        });
        els.btnClearCart.addEventListener('click', clearCart);
        els.btnCheckout.addEventListener('click', openCheckout);

        els.payMethodCash.addEventListener('click', () => { if (!state.pendingSale) setPayMethod('CASH'); });
        els.payMethodQris.addEventListener('click', () => setPayMethod('QRIS'));
        els.cashInput.addEventListener('input', updateChange);
        els.quickCash.addEventListener('click', (event) => {
            const button = event.target.closest('[data-cash]');
            if (!button) return;
            els.cashInput.value = button.dataset.cash;
            updateChange();
        });
        els.btnConfirmPayment.addEventListener('click', handleConfirmPayment);

        els.btnPrintReceipt.addEventListener('click', () => window.print());
        els.btnSendWa.addEventListener('click', sendReceiptToWhatsApp);

        els.btnManageProducts.addEventListener('click', () => {
            resetProductForm();
            loadProducts().catch((err) => showToast(err.message, true));
            openModal('productsModal');
        });

        els.pIconFile?.addEventListener('change', handleIconFileChange);
        els.btnClearIcon?.addEventListener('click', clearProductIconDraft);
        els.pName?.addEventListener('input', renderProductIconPreview);
        els.pCategory?.addEventListener('change', renderProductIconPreview);

        // Timangan / nominal manual
        els.weighModeQty.addEventListener('click', () => setWeighMode('qty'));
        els.weighModeRupiah.addEventListener('click', () => setWeighMode('rupiah'));
        els.weighQtyInput.addEventListener('input', updateWeighEstimate);
        els.weighRupiahInput.addEventListener('input', updateWeighEstimate);
        els.weighQtyInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); confirmWeigh(); }
        });
        els.weighRupiahInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); confirmWeigh(); }
        });
        els.weighModal.addEventListener('click', (event) => {
            const weightButton = event.target.closest('[data-weigh]');
            if (weightButton) {
                els.weighQtyInput.value = weightButton.dataset.weigh;
                updateWeighEstimate();
                return;
            }
            const rupiahButton = event.target.closest('[data-rupiah]');
            if (rupiahButton) {
                setWeighMode('rupiah');
                els.weighRupiahInput.value = rupiahButton.dataset.rupiah;
                updateWeighEstimate();
            }
        });
        els.btnAddWeigh.addEventListener('click', confirmWeigh);

        // Kulakan & susut
        els.btnPurchase.addEventListener('click', openPurchaseModal);
        els.purchaseList.addEventListener('input', updatePurchaseTotal);
        els.btnSavePurchase.addEventListener('click', savePurchase);
        els.btnSpoilage.addEventListener('click', openSpoilageModal);
        els.spoilProduct.addEventListener('change', updateSpoilEstimate);
        els.spoilQty.addEventListener('input', updateSpoilEstimate);
        els.btnSaveSpoilage.addEventListener('click', saveSpoilage);
        els.btnResetProduct.addEventListener('click', resetProductForm);
        els.productForm.addEventListener('submit', saveProduct);
        els.productList.addEventListener('click', (event) => {
            const editButton = event.target.closest('[data-edit-product]');
            if (editButton) {
                const product = findProduct(editButton.dataset.editProduct);
                if (product) fillProductForm(product);
                return;
            }
            const deleteButton = event.target.closest('[data-delete-product]');
            if (deleteButton) removeProduct(deleteButton.dataset.deleteProduct);
        });

        els.btnReports.addEventListener('click', openReports);
        els.btnLoadReport.addEventListener('click', loadReport);
        els.btnExportCsv.addEventListener('click', exportReportCsv);
        els.reportTableBody.addEventListener('click', (event) => {
            const detailButton = event.target.closest('[data-detail-sale]');
            if (detailButton) {
                openSaleDetail(detailButton.dataset.detailSale);
                return;
            }
            const payButton = event.target.closest('[data-pay-sale]');
            if (payButton) markSalePaid(payButton.dataset.paySale);
        });

        els.btnSettings.addEventListener('click', openSettings);
        els.btnSaveSettings.addEventListener('click', saveSettings);
        els.btnTheme.addEventListener('click', toggleTheme);

        if (els.cashierForm) els.cashierForm.addEventListener('submit', addCashier);
        if (els.cashierList) {
            els.cashierList.addEventListener('click', (event) => {
                const resetButton = event.target.closest('[data-reset-cashier]');
                if (resetButton) {
                    resetCashierPassword(resetButton.dataset.resetCashier);
                    return;
                }
                const deleteButton = event.target.closest('[data-delete-cashier]');
                if (deleteButton) removeCashier(deleteButton.dataset.deleteCashier);
            });
        }

        document.querySelectorAll('[data-close-modal]').forEach((button) => {
            button.addEventListener('click', () => closeModal(button.dataset.closeModal));
        });
        document.querySelectorAll('.pos-modal').forEach((modal) => {
            modal.addEventListener('click', (event) => {
                if (event.target === modal) closeModal(modal.id);
            });
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                const open = [...document.querySelectorAll('.pos-modal')].reverse().find((modal) => !modal.hidden);
                if (open) closeModal(open.id);
            }
        });
    }

    // ================= INIT =================

    async function init() {
        cacheElements();
        if (els.gateLoginForm) els.gateLoginForm.addEventListener('submit', handleGateLogin);
        const session = readSession();
        if (!session) {
            showGate('Masuk dengan akun kasir atau akun pemilik toko untuk mulai berjualan.');
            return;
        }

        state.token = session.token;
        state.user = session.user || {};
        const displayName = state.user.fullName || state.user.full_name || state.user.username || 'Kasir';
        els.posUserName.textContent = displayName;
        els.posUserAvatar.textContent = state.user.avatar || '🐮';
        els.posGate.hidden = true;
        els.posShell.hidden = false;

        bindEvents();
        applyTheme();
        applyRoleUi();

        try {
            await Promise.all([loadProducts(), loadSettings()]);
            // Server adalah sumber kebenaran untuk peran akun (kasir vs pemilik).
            if (state.settings?.is_cashier && state.user.role !== 'cashier') {
                state.user.role = 'cashier';
                applyRoleUi();
            }
            els.reportFrom.value = firstDayOfMonthValue();
            els.reportTo.value = todayInputValue();
        } catch (err) {
            if (/masuk|sesi|401/i.test(err.message)) {
                showGate('Sesi Anda tidak valid atau sudah berakhir. Silakan masuk kembali.');
            } else {
                showToast(err.message, true);
            }
        }
    }

    init();
})();
