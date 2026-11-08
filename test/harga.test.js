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
