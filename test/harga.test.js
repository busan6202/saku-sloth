const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('harga.html memuat aset dengan jalur relatif yang kompatibel untuk GitHub Pages (/saku-sloth/) maupun server', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'harga.html'), 'utf8');
    assert.match(html, /<link rel="stylesheet" href="harga\.css">/);
    assert.match(html, /<link rel="stylesheet" href="style\.css">/);
    assert.match(html, /<script src="sayur-nusantara\.js" defer><\/script>/);
    assert.match(html, /<script src="harga\.js" defer><\/script>/);
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
});

test('harga.html memiliki tombol tambah produk dan dialog bottom sheet tambah produk', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'harga.html'), 'utf8');
    assert.match(html, /id="btnAddProduct"/);
    assert.match(html, /id="btnEmptyAdd"/);
    assert.match(html, /id="addProductSheet"/);
    assert.match(html, /id="addProductForm"/);
    assert.match(html, /id="addName"/);
    assert.match(html, /id="addCategory"/);
    assert.match(html, /id="addUnit"/);
    assert.match(html, /id="addIsWeighable"/);
    assert.match(html, /id="addSell"/);
    assert.match(html, /id="addCost"/);
    assert.match(html, /id="addStock"/);
    assert.match(html, /id="addSave"/);
});

test('sw.js meng-cache sayur-nusantara.js dalam SHELL_ASSETS untuk dukungan offline', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    assert.match(sw, /'\/sayur-nusantara\.js'/);
});

test('server.js melayani /harga dan mengarahkan /harga/ untuk Saku Harga', () => {
    const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(serverCode, /app\.get\('\/harga\/',\s*\(req,\s*res\)\s*=>\s*res\.redirect\(301,\s*'\/harga'\)\)/);
    assert.match(serverCode, /app\.get\('\/harga',/);
});

test('link Kasir POS dan Saku Harga membuka di tab/window baru (target="_blank")', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const posHtml = fs.readFileSync(path.join(__dirname, '..', 'pos.html'), 'utf8');
    const hargaHtml = fs.readFileSync(path.join(__dirname, '..', 'harga.html'), 'utf8');

    assert.match(indexHtml, /<a class="nav-link" href="pos\.html" target="_blank" rel="noopener noreferrer">/);
    assert.match(indexHtml, /<a class="nav-link" href="harga\.html" target="_blank" rel="noopener noreferrer">/);
    assert.match(posHtml, /id="btnSakuHarga" href="harga\.html" target="_blank" rel="noopener noreferrer"/);
    assert.match(hargaHtml, /id="menuPos" target="_blank" rel="noopener noreferrer"/);
});

test('kasir dibatasi: harga.html memiliki elemen blocked dan server menolak akses modifikasi produk bagi kasir', () => {
    const hargaHtml = fs.readFileSync(path.join(__dirname, '..', 'harga.html'), 'utf8');
    const hargaJs = fs.readFileSync(path.join(__dirname, '..', 'harga.js'), 'utf8');
    const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    assert.match(hargaHtml, /id="hargaBlocked"/);
    assert.match(hargaHtml, /id="blockedMessage"/);
    assert.match(hargaJs, /function isCashierUser/);
    assert.match(hargaJs, /showCashierBlocked/);
    assert.match(serverCode, /app\.post\('\/api\/pos\/products'[\s\S]*?if \(isCashier\(user\)\) return res\.status\(403\)/);
    assert.match(serverCode, /app\.put\('\/api\/pos\/products\/:id'[\s\S]*?if \(isCashier\(user\)\) return res\.status\(403\)/);
    assert.match(serverCode, /app\.delete\('\/api\/pos\/products\/:id'[\s\S]*?if \(isCashier\(user\)\) return res\.status\(403\)/);
});

test('pos.html, pos.js, dan server.js menyembunyikan HPP/modal di kasir POS dan membuka semua fitur untuk owner', () => {
    const posHtml = fs.readFileSync(path.join(__dirname, '..', 'pos.html'), 'utf8');
    const posJs = fs.readFileSync(path.join(__dirname, '..', 'pos.js'), 'utf8');
    const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    // Keranjang POS tidak lagi menampilkan Total HPP atau Laba Kotor
    assert.doesNotMatch(posHtml, /id="cartCost"/);
    assert.doesNotMatch(posHtml, /id="cartProfit"/);
    assert.match(posHtml, /id="cartTotal"/);

    // pos.js mengatur hak akses Kasir vs Owner
    assert.match(posJs, /function applyRoleUi\(\)/);
    assert.match(posJs, /if \(els\.btnExportCsv\) els\.btnExportCsv\.hidden = cashier/);
    assert.match(posJs, /if \(els\.reportProfitHeader\) els\.reportProfitHeader\.hidden = cashier/);
    assert.match(posJs, /\$\{displayName\} · Kasir` : `\$\{displayName\} · Owner`/);

    // server.js menyaring HPP/modal & laba dari payload API untuk kasir
    assert.match(serverCode, /function sanitizePosProductForUser\(row, user\)/);
    assert.match(serverCode, /function sanitizePosSaleForUser\(sale, user\)/);
    assert.match(serverCode, /app\.post\('\/api\/pos\/purchases'[\s\S]*?if \(isCashier\(user\)\) return res\.status\(403\)/);
    assert.match(serverCode, /app\.get\('\/api\/pos\/export-excel'[\s\S]*?if \(isCashier\(user\)\) return res\.status\(403\)/);
});

test('harga.html memiliki fitur edit produk, hapus produk, dan pantauan penjualan kasir realtime', () => {
    const hargaHtml = fs.readFileSync(path.join(__dirname, '..', 'harga.html'), 'utf8');
    const hargaJs = fs.readFileSync(path.join(__dirname, '..', 'harga.js'), 'utf8');
    const posJs = fs.readFileSync(path.join(__dirname, '..', 'pos.js'), 'utf8');
    const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    // Elemen Penjualan Kasir Realtime di harga.html
    assert.match(hargaHtml, /id="liveSalesSection"/);
    assert.match(hargaHtml, /id="liveSalesOmzet"/);
    assert.match(hargaHtml, /id="liveSalesProfit"/);
    assert.match(hargaHtml, /id="liveSalesCount"/);
    assert.match(hargaHtml, /id="liveSalesList"/);
    assert.match(hargaHtml, /id="saleDetailSheet"/);

    // Elemen Edit & Hapus Produk di harga.html
    assert.match(hargaHtml, /id="btnEditorFullEdit"/);
    assert.match(hargaHtml, /id="btnEditorDelete"/);
    assert.match(hargaHtml, /id="addProductId"/);
    assert.match(hargaHtml, /id="addSku"/);
    assert.match(hargaHtml, /id="btnFormDelete"/);

    // Fungsi Edit, Hapus, & Penjualan Realtime di harga.js
    assert.match(hargaJs, /function openEditProductSheet\(productId\)/);
    assert.match(hargaJs, /async function deleteProduct\(productId\)/);
    assert.match(hargaJs, /async function restoreDeletedProduct\(productId\)/);
    assert.match(hargaJs, /function renderLiveSales\(\)/);
    assert.match(hargaJs, /async function openSaleDetail\(saleId\)/);
    assert.match(hargaJs, /data-edit-product=/);
    assert.match(hargaJs, /data-delete-product=/);

    // Notifikasi realtime transaksi dari pos.js & liveSales dari server.js
    assert.match(posJs, /function notifySaleUpdated\(/);
    assert.match(serverCode, /liveSales = \{/);
});
