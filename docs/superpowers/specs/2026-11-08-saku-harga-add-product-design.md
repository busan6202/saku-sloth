# Saku Harga: Perbaikan Rute & Fitur Tambah Produk Baru (Design Doc)

**Tanggal:** 2026-11-08  
**Topik:** Perbaikan jalur aset/rute `/harga/`, update cache Service Worker, dan penambahan form Bottom Sheet Tambah Produk Baru pada Saku Harga (PWA).

---

## 1. Intent & Why
Aplikasi PWA Saku Harga dibuat khusus bagi pemilik toko agar dapat memperbarui harga dan HPP secara cepat lewat ponsel tanpa membuka modul POS kasir yang berat. Namun saat ini:
1. Mengakses `/harga/` (dengan trailing slash) menyebabkan kegagalan memuat CSS/JS karena jalur aset relatif (`harga.css`, `harga.js`).
2. Belum ada fitur pendaftaran produk baru langsung dari Saku Harga. Pemilik toko yang sedang berbelanja/kulakan di pasar terpaksa membuka POS kasir web penuh hanya untuk mendaftarkan barang baru.
3. Offline shell di Service Worker (`sw.js`) belum memasukkan `sayur-nusantara.js`, sehingga visual katalog sayur gagal muncul saat offline.

## 2. Goals & Non-Goals
### Goals
- Mengakses `/harga` maupun `/harga/` berfungsi dengan sempurna tanpa broken CSS/JS.
- Service Worker meng-cache semua dependensi shell UI (`sayur-nusantara.js` dsb.).
- Pemilik toko dapat mendaftarkan produk baru langsung dari ponsel via Bottom Sheet "Tambah Produk Baru":
  - Input nama produk, auto-detect ikon katalog Sayur Nusantara secara visual saat mengetik.
  - Pilihan kategori (Sayur Daun, Bumbu & Timbang, Sembako, Bungkusan, Umum) & satuan (PCS, KG, Ikat, Bungkus, Liter, dll).
  - Opsi barang timbangan (`is_weighable`).
  - Input harga jual & modal (HPP) dengan kalkulasi margin instan.
  - Input stok awal (opsional, default 0).
  - Validasi error yang jelas dan ramah pengguna.
- Produk baru tersimpan ke backend (`POST /api/pos/products`) dan langsung muncul di daftar produk Saku Harga secara realtime serta disiarkan via `BroadcastChannel` (`saku-pos-prices`) ke kasir POS.

### Non-Goals
- Tidak mengubah alur otentikasi kasir/pemilik (tetap terlindungi untuk akun non-kasir).
- Tidak mengubah antarmuka POS kasir secara menyeluruh, hanya memastikan broadcast event diterima.

## 3. Approaches Considered
- **Pendekatan A (Terpilih - Bottom Sheet UI Taktil):** Menambahkan tombol "+ Tambah" di header dan empty state yang membuka Bottom Sheet ramah jempol. Mempertahankan filosofi Saku Harga (Geist Mono tabular, preview margin instan, auto-detect ikon).
- **Pendekatan B (Halaman Terpisah `/harga/tambah`):** Membuka halaman baru. Ditolak karena memperlambat alur kerja mobile micro-app dan membutuhkan navigasi bolak-balik.

## 4. Detailed Specification
- **Top Bar UI:** Tambah tombol button `#btnAddProduct` di samping tombol refresh/theme/menu.
- **Empty State UI:** Tambah tombol button `#btnEmptyAdd` pada kartu state kosong.
- **Add Product Sheet (`#addProductSheet`):**
  - Header: Thumbnail preview ikon yang responsif terhadap input nama, judul "Tambah Produk Baru".
  - Field Nama Produk (wajib).
  - Field Kategori (select/chips) & Satuan (select/chips) + Toggle Timbang (Checkbox / switch).
  - Field Harga Jual & Harga Modal (HPP) dengan format angka ribuan Indonesia dan margin card.
  - Field Stok Awal.
  - Tombol Batal & Simpan Produk.
- **Backend & Network:**
  - `POST /api/pos/products` dengan payload JSON.
  - Normalisasi produk dan integrasi ke local state.
  - Penyiaran via `BroadcastChannel` dan penyimpanan cache local storage.
