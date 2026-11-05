/* ==========================================================================
   SAKU KASIR — logika modul POS (memakai API & sesi akun Saku Harian)
   ========================================================================== */
(() => {
    'use strict';

    const SESSION_KEY = 'saku-user-session-v1';
    const THEME_KEY = 'saku-theme';
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
            'posGate', 'posShell', 'gateLoginLink', 'posUserAvatar', 'posUserName',
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
            'pBarcode', 'pSell', 'pCost', 'pStock', 'pMinStock', 'productError',
            'btnResetProduct', 'btnSaveProduct', 'productList',
            'reportsModal', 'reportFrom', 'reportTo', 'btnLoadReport', 'btnExportCsv',
            'reportSummary', 'reportTableBody',
            'settingsModal', 'sQrisPayload', 'sSheetsUrl', 'qrisHelp', 'sheetsHelp',
            'settingsError', 'btnSaveSettings',
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

    async function api(path, options = {}) {
        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        if (state.token) headers.Authorization = `Bearer ${state.token}`;
        const response = await fetch(path, { ...options, headers });
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
        for (const id of [...state.cart.keys()]) {
            if (!state.products.some((product) => Number(product.id) === id)) {
                state.cart.delete(id);
            }
        }
        renderCatalog();
        renderCart();
        renderProductList();
    }

    function productEmoji(product) {
        const name = String(product.name || '').toLowerCase();
        if (/kopi|teh|minum|susu|jus|es/.test(name)) return '🥤';
        if (/roti|kue|snack|makan|nasi|mie/.test(name)) return '🍞';
        if (/sabun|tisu|bersih/.test(name)) return '🧼';
        if (/pulsa|kuota|token/.test(name)) return '📱';
        return '📦';
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
                    <span class="pos-product-icon" aria-hidden="true">${productEmoji(product)}</span>
                    <span class="pos-product-name">${escapeHtml(product.name)}</span>
                    <span class="pos-product-meta">${escapeHtml(product.sku || product.barcode || 'Tanpa SKU')}</span>
                    <span class="pos-product-price">${formatMoney(product.price_sell)}</span>
                    <span class="pos-stock-pill ${stockClass(product)}">${stock <= 0 ? 'Stok habis' : `Stok ${stock}`}</span>
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
                    <strong>${escapeHtml(product.name)}</strong><br>
                    <span class="pos-product-meta">${escapeHtml(product.sku || '-')} · ${escapeHtml(product.barcode || 'tanpa barcode')}${product.is_active ? '' : ' · nonaktif'}</span>
                </td>
                <td class="numeric">${formatMoney(product.price_sell)}</td>
                <td class="numeric">${formatMoney(product.price_cost)}</td>
                <td class="numeric">${Number(product.stock) || 0}</td>
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

    function cartTotals() {
        let qty = 0;
        let total = 0;
        let cost = 0;
        for (const [productId, amount] of state.cart.entries()) {
            const product = findProduct(productId);
            if (!product) continue;
            qty += amount;
            total += Number(product.price_sell) * amount;
            cost += Number(product.price_cost) * amount;
        }
        return { qty, total, cost, profit: total - cost };
    }

    function addToCart(productId) {
        const product = findProduct(productId);
        if (!product || !product.is_active) return;
        const current = state.cart.get(Number(product.id)) || 0;
        const stock = Number(product.stock) || 0;
        if (current + 1 > stock) {
            showToast(`Stok ${product.name} hanya ${stock}.`, true);
            return;
        }
        state.cart.set(Number(product.id), current + 1);
        renderCart();
    }

    function changeQty(productId, delta) {
        const id = Number(productId);
        const product = findProduct(id);
        if (!product) return;
        const next = (state.cart.get(id) || 0) + delta;
        if (next <= 0) {
            state.cart.delete(id);
        } else if (next > Number(product.stock || 0)) {
            showToast(`Stok ${product.name} hanya ${product.stock}.`, true);
            return;
        } else {
            state.cart.set(id, next);
        }
        renderCart();
    }

    function clearCart() {
        state.cart.clear();
        renderCart();
    }

    function renderCart() {
        const totals = cartTotals();
        els.cartQty.textContent = String(totals.qty);
        els.cartCost.textContent = formatMoney(totals.cost);
        els.cartProfit.textContent = formatMoney(totals.profit);
        els.cartTotal.textContent = formatMoney(totals.total);
        els.cartEmpty.hidden = state.cart.size > 0;
        els.btnCheckout.disabled = state.cart.size === 0;
        els.checkoutCount.textContent = state.cart.size > 0 ? `(${totals.qty})` : '';

        els.cartItems.innerHTML = [...state.cart.entries()].map(([productId, qty]) => {
            const product = findProduct(productId);
            if (!product) return '';
            const subtotal = Number(product.price_sell) * qty;
            return `
                <div class="pos-cart-item">
                    <div>
                        <div class="pos-cart-item-name">${escapeHtml(product.name)}</div>
                        <div class="pos-cart-item-price">${formatMoney(product.price_sell)} × ${qty}</div>
                    </div>
                    <div class="pos-cart-item-total">${formatMoney(subtotal)}</div>
                    <div class="pos-qty-control">
                        <button type="button" data-cart-action="dec" data-id="${productId}" aria-label="Kurangi ${escapeHtml(product.name)}">−</button>
                        <span>${qty}</span>
                        <button type="button" data-cart-action="inc" data-id="${productId}" aria-label="Tambah ${escapeHtml(product.name)}">+</button>
                    </div>
                </div>
            `;
        }).join('');
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
                items: [...state.cart.entries()].map(([productId, qty]) => ({ productId, qty })),
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
                items: [...state.cart.entries()].map(([productId, qty]) => ({ productId, qty })),
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
                    <span>${Number(item.qty)} × ${formatMoney(item.unit_price ?? item.unitPrice)}</span>
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
            lines.push(`${item.product_name || item.productName} ${item.qty} × ${formatMoney(item.unit_price ?? item.unitPrice)} = ${formatMoney(item.subtotal)}`);
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
                    <td><strong>${escapeHtml(sale.invoice_no)}</strong></td>
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
            const response = await fetch(`/api/pos/export-excel${query ? `?${query}` : ''}`, {
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

    function resetProductForm() {
        els.productForm.reset();
        els.productId.value = '';
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
            stock: Math.max(0, Math.round(Number(els.pStock.value) || 0)),
            min_stock: Math.max(0, Math.round(Number(els.pMinStock.value) || 0))
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
            changeQty(button.dataset.id, button.dataset.cartAction === 'inc' ? 1 : -1);
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
        const session = readSession();
        if (!session) {
            showGate('Silakan masuk ke akun Saku Harian terlebih dahulu. Sesi kasir memakai akun yang sama dengan dashboard keuangan.');
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

        try {
            await Promise.all([loadProducts(), loadSettings()]);
            els.reportFrom.value = firstDayOfMonthValue();
            els.reportTo.value = todayInputValue();
        } catch (err) {
            if (/masuk|sesi|401/i.test(err.message)) {
                showGate('Sesi Anda tidak valid atau sudah berakhir. Silakan masuk kembali dari dashboard.');
            } else {
                showToast(err.message, true);
            }
        }
    }

    init();
})();
