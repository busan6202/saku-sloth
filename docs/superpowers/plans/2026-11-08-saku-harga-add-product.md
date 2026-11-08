# Saku Harga: Perbaikan Rute & Penambahan Fitur Tambah Produk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memperbaiki jalur aset dan routing `/harga/`, memperbarui cache Service Worker, dan menambahkan fitur Bottom Sheet "Tambah Produk Baru" yang lengkap dengan auto-detect ikon dan kalkulasi margin laba di Saku Harga.

**Architecture:** Frontend vanilla JavaScript (PWA) dengan desain sistem Geist Mono & Chillax. Menambahkan bottom sheet tambah produk yang terhubung ke endpoint Express `POST /api/pos/products` dan melakukan sinkronisasi lokal instan serta siaran `BroadcastChannel` ke POS kasir.

**Tech Stack:** Vanilla JavaScript (ES6+), HTML5 Semantic & PWA Web Manifest, CSS custom properties, Node.js Express & PostgreSQL backend.

**Spec:** `docs/superpowers/specs/2026-11-08-saku-harga-add-product-design.md`

## Global Constraints
- Tetap menggunakan zero-dependency frontend vanilla JS & CSS di Saku Harga.
- Font Geist Mono tabular untuk angka mata uang dan Chillax untuk judul/header.
- Gunakan jalur aset absolut (berawalan `/`) di seluruh link dan script pada `harga.html`.
- Kompatibel dengan mode luring dan cache Service Worker (`sw.js`).
- Menjaga proteksi autentikasi: akun kasir diarahkan ke `/pos`.

## Review Focus
1. Permintaan ke URL `/harga/` (dengan trailing slash) tidak boleh menyebabkan 404 pada `harga.css` atau `harga.js`.
2. Service Worker meng-cache `/sayur-nusantara.js` sehingga saat offline thumbnail produk katalog tidak rusak.
3. Form tambah produk memvalidasi nama produk tidak boleh kosong dan harga jual > 0.
4. Auto-detect ikon bereaksi saat mengetik nama (misal mengetik "kangkung" langsung memunculkan preview ikon kangkung).
5. Produk baru yang berhasil dibuat langsung muncul di daftar produk tanpa perlu refresh manual, dan POS kasir menerima notifikasi update.

---

### Task 1: Perbaikan Jalur Aset, Routing `/harga/`, dan Cache Service Worker

**Files:**
- Modify: `server.js:112-135`
- Modify: `server.js:2095-2104`
- Modify: `harga.html:14-25`
- Modify: `sw.js:9-20`

**Interfaces:**
- Consumes: Express routing & Service Worker Cache API.
- Produces: Rute `/harga` dan `/harga/` yang melayani `harga.html` dengan referensi aset absolut.

- [ ] **Step 1: Tulis script/test verifikasi untuk rute `/harga` dan `/harga/` serta header aset**
- [ ] **Step 2: Jalankan verifikasi awal untuk memastikan masalah rute / asset path terdeteksi**
- [ ] **Step 3: Perbarui `server.js` untuk menangani rute `/harga/` dan perbarui `harga.html` dengan tautan absolut (`/harga.css`, `/harga.js`, dll.), serta tambahkan `/sayur-nusantara.js` ke `SHELL_ASSETS` di `sw.js`**
- [ ] **Step 4: Jalankan verifikasi ulang dan pastikan semua aset dan rute mengembalikan status 200 OK**
- [ ] **Step 5: Commit perubahan Task 1**

---

### Task 2: Markup dan Styling Bottom Sheet "Tambah Produk Baru"

**Files:**
- Modify: `harga.html:65-145`
- Modify: `harga.html:150-215`
- Modify: `harga.css`

**Interfaces:**
- Consumes: CSS Design Tokens di `harga.css`.
- Produces: Elemen `#btnAddProduct` di top bar, `#btnEmptyAdd` di empty state, dan kontainer Bottom Sheet `#addProductSheet` dengan field input nama, kategori, satuan, is_weighable, harga jual, HPP, stok awal, serta tombol simpan/batal.

- [ ] **Step 1: Tambahkan tombol "+ Tambah" di header `harga.html` dan tombol aksi di `#emptyState`**
- [ ] **Step 2: Tambahkan markup dialog Bottom Sheet `#addProductSheet` lengkap dengan preview ikon, pilihan kategori, satuan, toggle timbang, field harga jual & HPP, kartu indikator margin, dan stok awal**
- [ ] **Step 3: Tambahkan gaya CSS di `harga.css` untuk tombol tambah header, tombol empty state, dan penyesuaian sheet form tambah produk**
- [ ] **Step 4: Verifikasi visual struktur markup dan tidak adanya class/ID yang bentrok**
- [ ] **Step 5: Commit perubahan Task 2**

---

### Task 3: Logika Tambah Produk di `harga.js`

**Files:**
- Modify: `harga.js`

**Interfaces:**
- Consumes: Helper `api()`, `normalizeProduct()`, `detectVegIcon()`, `formatNumericInput()`, `parseMoneyInput()`, `showToast()`.
- Produces: Fungsi `openAddProductSheet()`, `closeAddProductSheet()`, `updateAddMarginPreview()`, `updateAddIconPreview()`, dan `saveNewProduct()`.

- [ ] **Step 1: Cache elemen UI baru di `cacheElements()` (`btnAddProduct`, `btnEmptyAdd`, `addProductSheet`, form fields, dll.)**
- [ ] **Step 2: Implementasikan `openAddProductSheet()` dan `closeAddProductSheet()` dengan reset form ke nilai awal default**
- [ ] **Step 3: Implementasikan auto-detect ikon secara langsung saat event `input` pada nama produk, serta kalkulator margin dinamis saat input harga jual dan HPP**
- [ ] **Step 4: Implementasikan fungsi `saveNewProduct()` yang mengirim payload ke `POST /api/pos/products`, menambahkan ke `state.products`, menyimpan ke cache lokal, me-render ulang list, dan menyiarkan via `BroadcastChannel`**
- [ ] **Step 5: Kaitkan event listener untuk tombol dan form tambah produk**
- [ ] **Step 6: Commit perubahan Task 3**

---

### Task 4: Pengujian & Verifikasi Menyeluruh

**Files:**
- Test: Skrip verifikasi endpoint API & status routing.

- [ ] **Step 1: Jalankan pengujian HTTP request untuk rute `/harga` dan `/harga/`**
- [ ] **Step 2: Verifikasi pembuatan produk via endpoint `POST /api/pos/products` menggunakan payload JSON valid dan verifikasi error handling untuk payload invalid**
- [ ] **Step 3: Periksa integritas Service Worker cache manifest dan sintaks file JavaScript tanpa syntax error**
- [ ] **Step 4: Commit hasil akhir dan konfirmasi kesiapan integrasi**
