# 🐮 Saku Harian — Smart Daily Financial Planner

Aplikasi perencana keuangan harian dengan tampilan **Hallmark Hum** (artisanal paper + maskot sapi lucu),
login multi-user **berbasis email**, dan bot Telegram untuk mencatat transaksi langsung dari chat.

- Web App: kalender bulanan, catatan pemasukan/pengeluaran, kantong dana (e-wallet & bank), piutang/utang,
  pengingat tagihan, analisis kas, saran hemat, dan ekspor CSV/Google Sheets.
- Telegram Bot: catat transaksi cepat lewat tombol, cek saldo, edit, dan reset.
- Data setiap akun **terpisah dan privat** — dikunci berdasarkan `user_id` di sisi server.

---

## 📚 Daftar Isi

1. [Fitur](#-fitur)
2. [Teknologi](#-teknologi)
3. [Struktur Proyek](#-struktur-proyek)
4. [Prasyarat](#-prasyarat)
5. [Menjalankan di Komputer Lokal](#-menjalankan-di-komputer-lokal)
6. [Konfigurasi Environment (.env)](#-konfigurasi-environment-env)
7. [Database & Skema Otomatis](#-database--skema-otomatis)
8. [Cara Kerja Login (Email)](#-cara-kerja-login-email)
9. [Setup Bot Telegram](#-setup-bot-telegram)
10. [Deploy ke Vercel](#-deploy-ke-vercel)
11. [Ringkasan API](#-ringkasan-api)
12. [Push ke GitHub (Langkah Lengkap)](#-push-ke-github-langkah-lengkap)
13. [Troubleshooting](#-troubleshooting)
14. [Lisensi](#-lisensi)

---

## ✨ Fitur

| Kategori | Detail |
| --- | --- |
| Autentikasi | Registrasi & login via **email + kata sandi**, sesi token 30 hari, logout, ingat perangkat |
| Multi-user | Setiap akun hanya melihat transaksi & utang miliknya sendiri |
| Transaksi | Pemasukan/pengeluaran, kategori, kantong dana, tanggal manual, edit & hapus |
| Kantong Dana | GoPay, DANA, OVO, ShopeePay, LinkAja, QRIS, bank (BCA/Mandiri/BRI/BNI/BSI/dll), Tunai |
| Piutang & Utang | Status pending/partial/paid, nominal dibayar, tenggat, ringkasan net |
| Kalender | Timeline harian & kalender bulanan |
| Tagihan | Pengingat tagihan bulanan + badge notifikasi |
| Analisis | Ringkasan kas, distribusi kategori, saran hemat |
| Ekspor | CSV Google Sheets & CSV Excel (hanya data milik pengguna yang login) |
| Tema | Light/Dark mode, typography Chillax + Geist Mono |
| Telegram Bot | Menu tombol, catat cepat, cek saldo, edit, reset |

---

## 🧱 Teknologi

- **Frontend**: HTML5, CSS3 (design tokens), JavaScript vanilla (ES2020)
- **Backend**: Node.js 18+, Express 4, `pg` (PostgreSQL)
- **Database**: Neon PostgreSQL (SSL)
- **Auth**: kustom — hash `PBKDF2-SHA512` + salt, tabel `user_sessions`
- **Bot**: Telegram Bot API (webhook + inline keyboard)
- **Opsional AI**: Google Gemini API untuk analisis teks
- **Deploy**: Vercel (`@vercel/node` + static)

> Catatan: proyek ini **tidak memakai Firebase**. Autentikasi sepenuhnya di backend Express sendiri.

---

## 📁 Struktur Proyek

```
saku-sloth/
├── index.html        # Markup UI (auth screen + app shell)
├── style.css         # Design system Hallmark Hum + tema terang/gelap
├── script.js         # Logika klien: auth, transaksi, utang, kalender, ekspor
├── pos.html          # Halaman kasir POS (full-screen, terpisah dari dashboard)
├── pos.css           # Gaya modul POS
├── pos.js            # Logika kasir: katalog, keranjang, bayar, struk, laporan
├── server.js         # API Express: auth, transaksi, utang, POS, webhook Telegram
├── vercel.json       # Konfigurasi build & routing Vercel
├── package.json      # Dependensi & script start
├── icons/            # Ikon SVG
└── .env              # (lokal, TIDAK di-commit) kredensial rahasia
```

---

## ✅ Prasyarat

- **Node.js** versi **18 atau lebih baru** → cek dengan `node -v`
- **npm** (ikut terpasang bersama Node.js)
- **Git** → cek dengan `git --version`
- Akun **Neon** (PostgreSQL gratis) — https://neon.tech
- (Opsional) Akun **Vercel** untuk deploy
- (Opsional) **Bot Telegram** dari @BotFather

---

## 💻 Menjalankan di Komputer Lokal

### 1. Clone repository

```bash
git clone https://github.com/busan6202/saku-sloth.git
cd saku-sloth
```

### 2. Install dependensi

```bash
npm install
```

### 3. Buat file `.env`

Buat file `.env` di root proyek (lihat [bagian berikut](#-konfigurasi-environment-env)), minimal isi `DATABASE_URL`.

### 4. Jalankan server

```bash
npm start
```

Buka **http://localhost:3000** di browser.

> Untuk mengganti port:
> Windows PowerShell → `$env:PORT=8080; npm start`
> macOS/Linux → `PORT=8080 npm start`

---

## 🔐 Konfigurasi Environment (.env)

Buat file `.env` di root proyek:

```env
# WAJIB — Connection string Neon PostgreSQL
# Format: postgresql://user:password@host/dbname?sslmode=require
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require

# OPSIONAL — Bot Telegram
TELEGRAM_BOT_TOKEN=123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# OPSIONAL — URL publik untuk webhook Telegram
WEBHOOK_URL=https://domain-anda.vercel.app/api/telegram-webhook

# WAJIB bila webhook publik aktif — secret_token yang divalidasi di setiap request Telegram
TELEGRAM_WEBHOOK_SECRET=string-acak-panjang

# OPSIONAL — Batasi chat Telegram yang boleh memakai bot (pisahkan dengan koma)
TELEGRAM_ALLOWED_CHAT_IDS=

# OPSIONAL — Daftar origin frontend yang diizinkan mengakses API (pisahkan dengan koma)
CORS_ORIGINS=https://domain-anda.vercel.app,http://localhost:3000

# OPSIONAL — Jumlah iterasi PBKDF2 (default 210000). Naikkan bila server kuat.
PASSWORD_ITERATIONS=210000

# OPSIONAL — Analisis AI
GEMINI_API_KEY=your-gemini-api-key

# OPSIONAL — Modul POS Kasir
POS_CASH_WALLET=Tunai
POS_QRIS_WALLET=QRIS
POS_PAYMENT_WEBHOOK_SECRET=rahasia-webhook-qris
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/XXXX/exec
```

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Connection string PostgreSQL/Neon. Untuk kompatibilitas lama, `MONGO_URI` juga dibaca. |
| `TELEGRAM_BOT_TOKEN` | ❌ | Tanpa ini fitur bot tidak aktif. |
| `WEBHOOK_URL` | ❌ | Wajib bila ingin bot berjalan di server publik (Vercel). |
| `TELEGRAM_WEBHOOK_SECRET` | ⚠️ | **Wajib di produksi.** Dikirim Telegram di header `x-telegram-bot-api-secret-token`; webhook menolak request tanpa secret yang cocok (401). |
| `TELEGRAM_ALLOWED_CHAT_IDS` | ❌ | Whitelist `chat_id` Telegram yang boleh memakai bot. Kosong = semua chat diizinkan. |
| `CORS_ORIGINS` | ❌ | Whitelist origin frontend. Kosong = hanya origin yang sama dengan server. |
| `PASSWORD_ITERATIONS` | ❌ | Iterasi PBKDF2-SHA512 (default `210000`). |
| `GEMINI_API_KEY` | ❌ | Untuk fitur analisis AI. |
| `PORT` | ❌ | Port lokal (default 3000). |
| `POS_CASH_WALLET` | ❌ | Nama saku untuk pembayaran tunai (default `Tunai`). |
| `POS_QRIS_WALLET` | ❌ | Nama saku untuk pembayaran QRIS (default `QRIS`). |
| `POS_PAYMENT_WEBHOOK_SECRET` | ❌ | Secret header `x-pos-secret` untuk callback pembayaran QRIS. |
| `GOOGLE_SHEETS_WEBHOOK_URL` | ❌ | URL Apps Script `doPost` default untuk sinkronisasi POS. |

> ⚠️ **Jangan pernah commit file `.env`.** File ini sudah masuk `.gitignore`.

> 🌐 **Frontend dan API beda domain** (mis. frontend di `github.io`, API di `vercel.app`)?
> Tambahkan origin frontend ke `CORS_ORIGINS`, contoh:
> `CORS_ORIGINS=https://nama-user.github.io,http://localhost:3000`.
> Tanpa itu, request yang membawa cookie sesi akan ditolak `403` oleh proteksi CSRF.

### Cara mendapatkan `DATABASE_URL` (Neon)

1. Daftar/masuk ke https://console.neon.tech
2. **Create project** → pilih region terdekat (mis. Singapore)
3. Buka **Dashboard → Connection string**
4. Salin string `postgresql://...` dan tempel ke `.env`

---

## 🗄️ Database & Skema Otomatis

Tidak perlu menjalankan migrasi manual. Saat server pertama kali menerima request,
`ensureDatabaseReady()` akan membuat tabel berikut bila belum ada:

| Tabel | Fungsi |
| --- | --- |
| `users` | Akun: `username`, `email`, `password_hash`, `full_name`, `avatar`, `role`, `owner_id` (akun kasir menempel ke pemilik) |
| `pos_products` | Produk POS: SKU/barcode, **kategori**, **satuan**, **`is_weighable`**, harga jual, HPP, **stok desimal `NUMERIC(10,3)`** |
| `pos_sales` | Header penjualan: invoice, metode, total, HPP, laba, status |
| `pos_sale_items` | Rincian item per invoice (harga jual & modal saat transaksi, **qty desimal + satuan**) |
| `pos_spoilage_logs` | Catatan sayur layu/busuk: qty hilang, nilai kerugian, alasan |
| `pos_purchases` | Header belanja kulakan (stok masuk) beserta saku pembayaran |
| `pos_purchase_items` | Rincian item kulakan + HPP baru per satuan |
| `pos_settings` | Payload QRIS & URL webhook Google Sheets per pengguna |

Migrasi ringan (`ADD COLUMN IF NOT EXISTS`, unique index email, backfill `user_id` data lama) juga berjalan otomatis.

---

## 🛒 Modul POS Kasir (`/pos`)

Halaman kasir terpisah dari dashboard keuangan, tetapi memakai **database, sesi login, dan API yang sama**.

- `/dashboard` → perencana keuangan harian (saldo kantong, utang, laporan).
- `/pos` → layar kasir penuh: katalog, keranjang, pembayaran, struk, dan laporan POS.

### Toko sayur & bumbu dapur

Modul ini disiapkan untuk pedagang sayur/bumbu:

- **Stok & qty desimal** — `NUMERIC(10,3)`, jadi 0,25 kg cabai atau 1,5 ons bawang tercatat presisi.
- **Produk timbangan (`is_weighable`)** — saat diklik di katalog, kasir memilih berat cepat (`1 Ons`, `¼ Kg`, `½ Kg`, `1 Kg`) atau langsung mengetik **nominal rupiah** (mis. “cabai Rp 5.000”) dan sistem menghitung berat ekuivalennya.
- **Satuan per produk** — KG, ONS, GRAM, IKAT, BUNGKUS, PCS. Satuan ikut tercetak di struk, laporan, dan Google Sheets.
- **Kategori** — `SAYUR_DAUN`, `BUMBU_TIMBANG`, `SEMBAKO`, `BUNGKUSAN`, `UMUM`.
- **Kulakan pagi** — tombol 📥 **Kulakan** mencatat stok masuk sekaligus memperbarui HPP (dan harga jual bila diisi), lalu mencatat total belanja sebagai pengeluaran saku agar saldo kas ikut turun.
- **Susut / layu** — tombol 🥀 **Susut** mengurangi stok dan mencatat kerugian modal di `pos_spoilage_logs`. Nilainya **tidak** masuk tabel `transactions` (agar saldo kas tidak dobel), tetapi muncul di laporan sebagai `spoilageLoss`, dan **laba bersih = laba kotor − susut**.

### Akun kasir (akses terbatas)

Pemilik toko bisa membuat **akun kasir** yang menempel ke akun utamanya:

- Kasir **login dengan email & kata sandi sendiri**, tetapi seluruh data POS (produk, transaksi, laporan, pengaturan QRIS/Sheets) tetap milik akun pemilik.
- Kasir **hanya bisa membuka halaman POS**. Semua endpoint dashboard keuangan (`/api/transactions`, `/api/debts`, `/api/summary`, dll.) menolak akun kasir dengan `403`, dan dashboard otomatis mengalihkan mereka ke `pos.html`.
- Kasir **tidak bisa** mengubah pengaturan POS (payload QRIS & webhook Sheets) maupun mengelola akun kasir lain.
- Setiap transaksi menyimpan `cashier_id` & `cashier_name`, sehingga laporan menampilkan siapa yang melayani.
- Kelola akun kasir di POS → ⚙️ **Pengaturan** → bagian **Akun Kasir** (tambah, reset sandi, hapus).

### Alur transaksi

1. Kasir memilih produk / scan barcode. Stok dicek sebelum masuk keranjang.
2. Produk timbangan membuka dialog berat/nominal; produk biasa langsung bertambah 1 satuan.
3. Keranjang menghitung total jual, total HPP, dan laba kotor dari data produk.
4. **Tunai** → kasir mengisi uang diterima, sistem menghitung kembalian, transaksi langsung `PAID`.
5. **QRIS** → transaksi dibuat `PENDING`; kasir menekan **Konfirmasi Lunas**, atau payment gateway memanggil webhook.
6. Saat `PAID`, satu fungsi backend otomatis:
   - mengurangi stok produk,
   - mencatat pemasukan ke tabel `transactions` pada saku `Tunai` atau `QRIS`,
   - menyimpan total HPP & laba kotor di `pos_sales` untuk laporan laba/rugi,
   - mengirim rincian item ke Google Sheets (bila webhook diatur).
7. Struk bisa dicetak atau dikirim ke WhatsApp pelanggan.
8. Tombol **Download Excel/CSV** di laporan menarik rincian item (termasuk satuan & qty desimal) per rentang tanggal.

### Callback pembayaran QRIS

```bash
curl -X POST https://domain-anda.vercel.app/api/pos/webhook/payment \
  -H "Content-Type: application/json" \
  -H "x-pos-secret: rahasia-webhook-qris" \
  -d '{"invoiceNo":"POS-20261105-ABC123","status":"PAID"}'
```

Status yang didukung: `PAID`, `FAILED`, `CANCELLED`, `EXPIRED`.

### Google Apps Script (`doPost`)

Buat spreadsheet → **Extensions → Apps Script** → tempel kode berikut → **Deploy → New deployment → Web app** (akses: anyone) → salin URL `/exec` ke pengaturan POS (⚙️) atau `GOOGLE_SHEETS_WEBHOOK_URL`.

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('POS') ||
                SpreadsheetApp.getActiveSpreadsheet().insertSheet('POS');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'ID Transaksi', 'Nama Produk', 'SKU', 'Satuan', 'Qty',
                     'Harga Satuan', 'Harga Modal', 'Subtotal', 'Metode Bayar',
                     'Saku Tujuan', 'Laba Bersih']);
  }
  const payload = JSON.parse(e.postData.contents);
  (payload.rows || []).forEach(function (row) {
    sheet.appendRow([
      row.Timestamp, row['ID Transaksi'], row['Nama Produk'], row.SKU, row.Satuan, row.Qty,
      row['Harga Satuan'], row['Harga Modal'], row.Subtotal,
      row['Metode Bayar'], row['Saku Tujuan'], row['Laba Bersih']
    ]);
  });
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```
| `debts` | Piutang/utang + `user_id` |
| `telegram_edit_sessions` | State sementara wizard/edit bot |

Migrasi ringan (`ADD COLUMN IF NOT EXISTS`, unique index email, backfill `user_id` data lama) juga berjalan otomatis.

**Akun awal:** tidak ada akun bawaan. Daftarkan akun pertama lewat halaman **Daftar**.

> Ingin akun admin? Daftar seperti biasa, lalu ubah `role` user tersebut menjadi `admin`
> langsung di database:
>
> ```sql
> UPDATE users SET role = 'admin' WHERE LOWER(email) = 'email-anda@contoh.com';
> ```
>
> Jangan pernah menaruh kredensial default di kode atau dokumentasi publik.

---

## 🔑 Cara Kerja Login (Email)

1. **Daftar** → isi nama, email, kata sandi (min. 6 karakter), pilih maskot.
   - Email divalidasi formatnya dan harus unik (case-insensitive).
   - Username internal dibuat otomatis dari email (mis. `andriadi@gmail.com` → `andriadi`, ditambah angka bila bentrok).
2. Backend menyimpan hash `PBKDF2-SHA512` (210.000 iterasi, format `pbkdf2$<iterasi>$<salt>$<hash>`). Hash lama 1.000 iterasi otomatis di-*upgrade* saat login berhasil.
3. Backend membuat token sesi acak 32 byte dan menyimpannya di `user_sessions` (berlaku 30 hari, atau 12 jam bila "ingat saya" tidak dicentang).
4. Token dikirim ke browser sebagai **cookie `HttpOnly`** (opsional `SameSite=None; Secure` untuk frontend lintas domain). **Token tidak disimpan di `localStorage`**, sehingga XSS tidak bisa mencuri sesi.
5. Klien mengirim `credentials: 'include'`; server juga masih menerima `Authorization: Bearer <token>` sebagai fallback.
6. Setiap request data (transaksi/utang/ekspor) difilter dengan `user_id` dari sesi aktif.
7. Login lama dengan **username** tetap didukung untuk akun yang sudah ada.

**Kenapa data tidak tercampur antar pengguna:**

- Tidak ada lagi header `X-User-Id` yang bisa dipalsukan.
- Semua query memakai `buildUserScope()` → `user_id = $1` (admin: ditambah data global `user_id IS NULL`).
- Cache `localStorage` dibersihkan otomatis saat logout atau ganti akun.

---

## 🤖 Setup Bot Telegram

1. Chat **@BotFather** → `/newbot` → simpan **token**.
2. Isi `TELEGRAM_BOT_TOKEN` di `.env`.
3. Isi `TELEGRAM_WEBHOOK_SECRET` dengan string acak panjang. Nilai ini didaftarkan sebagai
   `secret_token` webhook dan **wajib** ada di produksi (tanpa itu webhook membalas `503`).
4. Untuk server publik, isi `WEBHOOK_URL`, misal `https://saku-sloth.vercel.app/api/telegram-webhook`.
5. Jalankan server. Webhook + menu perintah tersinkron otomatis saat start, atau paksa lewat
   (endpoint ini **khusus admin yang sedang login**):

```bash
curl -X POST https://domain-anda.vercel.app/api/setup-telegram-menu \
  -H "Cookie: saku_session=<token-sesi-anda>"
```

6. Buka bot di Telegram, kirim `/menu` untuk melihat tombol interaktif.

**Isolasi data bot:** setiap `chat_id` Telegram dipetakan ke satu akun (`users.telegram_chat_id`)
yang dibuat otomatis. Bot hanya membaca/menulis transaksi milik akun tersebut — pengguna satu chat
tidak bisa melihat data chat lain. Bila ingin membatasi siapa saja yang boleh memakai bot, isi
`TELEGRAM_ALLOWED_CHAT_IDS` dengan daftar `chat_id` yang diizinkan.

---

## ☁️ Deploy ke Vercel

### Opsi A — Dashboard

1. Push repo ke GitHub (lihat [bagian Push ke GitHub](#-push-ke-github-langkah-lengkap)).
2. Buka https://vercel.com → **Add New → Project**.
3. Import repository `saku-sloth`.
4. Framework preset: **Other** (biarkan default; `vercel.json` sudah mengatur build & route).
5. Tambahkan **Environment Variables**: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_WEBHOOK_SECRET`, `WEBHOOK_URL` → `https://<nama-project>.vercel.app/api/telegram-webhook`,
   `CORS_ORIGINS`, dan `GEMINI_API_KEY` (opsional).
6. Klik **Deploy**.
7. Setelah dapat domain dan akun admin sudah dibuat, panggil `POST /api/setup-telegram-menu`
   sekali (dengan cookie sesi admin) agar webhook terpasang.

### Opsi B — Vercel CLI

```bash
npm i -g vercel
vercel login
vercel            # deploy preview
vercel --prod     # deploy production
```

> `vercel.json` sudah memetakan `/api/*` ke `server.js` serta file statis (`index.html`, `style.css`, `script.js`, `icons/`).

---

## 🔌 Ringkasan API

Semua endpoint data memerlukan sesi aktif, dikirim sebagai **cookie `saku_session`**
(otomatis setelah login) atau header `Authorization: Bearer <token>` sebagai fallback.

### Auth

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| POST | `/api/auth/register` | `{ fullName, email, password, avatar }` |
| POST | `/api/auth/login` | `{ email, password }` (atau `username`) |
| GET | `/api/auth/me` | Validasi sesi, ambil profil |
| POST | `/api/auth/logout` | Hapus token sesi |

### Transaksi

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/api/transactions` | Daftar transaksi milik user |
| POST | `/api/transactions` | Tambah transaksi |
| PUT | `/api/transactions/:id` | Edit transaksi |
| DELETE | `/api/transactions/:id` | Hapus transaksi |
| POST | `/api/transactions/reset` | Reset saldo (`mode: all \| wallet \| zero`) |
| DELETE | `/api/transactions` | Hapus semua transaksi user |
| GET | `/api/export-excel` | Unduh CSV |
| GET | `/api/export-googlesheet` | Unduh CSV (UTF-8 BOM) |

### Piutang & Utang

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/api/debts` | Daftar utang/piutang |
| GET | `/api/debts/summary` | Ringkasan total & outstanding |
| POST | `/api/debts` | Tambah catatan |
| PUT | `/api/debts/:id` | Update/pembayaran |
| DELETE | `/api/debts/:id` | Hapus catatan |

### POS Kasir

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/api/pos/products` | Katalog produk (`?q=` pencarian, `?include_inactive=1`) |
| GET | `/api/pos/products/lookup` | Cari produk via `?code=` (barcode/SKU) |
| POST | `/api/pos/products` | Tambah produk |
| PUT | `/api/pos/products/:id` | Update produk/harga/stok |
| DELETE | `/api/pos/products/:id` | Nonaktifkan produk |
| GET | `/api/pos/settings` | Payload QRIS & URL webhook Sheets (kasir hanya baca) |
| PUT | `/api/pos/settings` | Simpan pengaturan POS (khusus pemilik toko) |
| GET | `/api/pos/cashiers` | Daftar akun kasir milik pemilik toko |
| POST | `/api/pos/cashiers` | Buat akun kasir `{ fullName, email, password }` |
| PUT | `/api/pos/cashiers/:id` | Ubah nama / reset kata sandi kasir |
| DELETE | `/api/pos/cashiers/:id` | Hapus akun kasir |
| POST | `/api/pos/checkout` | Checkout (`CASH` langsung lunas, `QRIS` pending). Item mendukung `qty` desimal dan `subtotal` (nominal manual untuk produk timbangan) |
| GET | `/api/pos/spoilage` | Riwayat barang susut (`?from=&to=`) |
| POST | `/api/pos/spoilage` | Catat susut `{ productId, qty, reason }` — stok berkurang, tidak menyentuh saldo kas |
| POST | `/api/pos/purchases` | Kulakan `{ wallet, note, items:[{ productId, qty, costPerUnit, sellPrice? }] }` — stok masuk, HPP & harga jual diperbarui, belanja dicatat sebagai pengeluaran |
| POST | `/api/pos/sales/:id/pay` | Konfirmasi pelunasan QRIS |
| POST | `/api/pos/sales/:id/cancel` | Batalkan transaksi pending |
| GET | `/api/pos/sales` | Riwayat transaksi (`?from=&to=&status=`) |
| GET | `/api/pos/sales/:id` | Detail transaksi + item |
| POST | `/api/pos/sales/:id/sync-sheet` | Kirim ulang ke Google Sheets |
| GET | `/api/pos/summary` | Omzet, HPP, laba kotor, `spoilageLoss`, `netProfit`, `purchaseTotal`, tunai/QRIS, pending |
| GET | `/api/pos/export-excel` | Unduh rincian item (CSV) |
| POST | `/api/pos/webhook/payment` | Callback pembayaran QRIS (secret header) |

### Lain-lain

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| POST | `/api/setup-telegram-menu` | Sinkron menu & webhook bot (khusus admin) |
| POST | `/api/telegram-webhook` | Endpoint webhook Telegram (wajib secret token) |

---

## 🧪 Menjalankan Tes

```bash
npm test
```

Tes memakai `node --test` bawaan Node.js dan mencakup:

- Format & verifikasi hash kata sandi (PBKDF2 210.000 iterasi), termasuk kompatibilitas hash lama.
- Penolakan hash `sha256` tanpa salt.
- Pembuatan & validasi cookie sesi (`HttpOnly`, `SameSite`, `Secure`).
- Ekstraksi token dari cookie/header.
- Rate limiter (blokir setelah batas percobaan).
- Scope `user_id` untuk pengguna biasa vs admin.

---

## 🚀 Push ke GitHub (Langkah Lengkap)

### 1. Pastikan Git terpasang & identitas diset

```bash
git --version
git config --global user.name "Nama Anda"
git config --global user.email "email@anda.com"
```

### 2. Cek `.gitignore`

Pastikan file berikut **tidak** ikut ter-commit:

```gitignore
node_modules
.env
.DS_Store
```

### 3. Inisialisasi repo (lewati jika sudah ada `.git`)

```bash
git init
git branch -M main
```

### 4. Tambahkan remote (lewati jika sudah ada)

```bash
git remote add origin https://github.com/busan6202/saku-sloth.git
git remote -v      # verifikasi
```

Jika remote sudah ada tapi URL-nya salah:

```bash
git remote set-url origin https://github.com/busan6202/saku-sloth.git
```

### 5. Simpan perubahan

```bash
git status
git add .
git commit -m "docs: tambah README lengkap & perbaikan login email multi-user"
```

### 6. Push ke GitHub

```bash
# pertama kali (sekaligus set upstream)
git push -u origin main

# berikutnya cukup
git push
```

### 7. Jika ditolak karena autentikasi

HTTPS tidak menerima password biasa. Gunakan **Personal Access Token**:

1. GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. **Generate new token** → centang scope `repo` → generate → salin token
3. Saat diminta password, tempel token tersebut
4. Agar tersimpan:

```bash
git config --global credential.helper manager      # Windows
git config --global credential.helper osxkeychain  # macOS
```

Alternatif: pakai SSH.

```bash
ssh-keygen -t ed25519 -C "email@anda.com"
# salin isi ~/.ssh/id_ed25519.pub ke GitHub → Settings → SSH and GPG keys
git remote set-url origin git@github.com:busan6202/saku-sloth.git
git push -u origin main
```

### 8. Alur kerja rutin setelah perubahan

```bash
git pull --rebase origin main   # ambil update terbaru
git add .
git commit -m "feat: deskripsi singkat perubahan"
git push
```

### 9. Perintah Git yang sering dipakai

| Perintah | Fungsi |
| --- | --- |
| `git status` | Lihat file yang berubah |
| `git diff` | Lihat detail perubahan |
| `git log --oneline -10` | 10 commit terakhir |
| `git branch -a` | Daftar branch |
| `git checkout -b fitur-baru` | Buat branch baru |
| `git restore <file>` | Batalkan perubahan file (belum di-stage) |
| `git reset --hard origin/main` | ⚠️ Buang semua perubahan lokal (destruktif) |

> ⚠️ **Jangan pernah** `git push --force` ke `main` publik tanpa alasan kuat — riwayat orang lain bisa hilang.

---

## 🩺 Troubleshooting

| Gejala | Penyebab & Solusi |
| --- | --- |
| `Gagal inisialisasi database Neon` | `DATABASE_URL` salah / Neon suspended. Cek connection string & status project. |
| Login gagal "Email atau kata sandi tidak cocok" | Email belum terdaftar, atau akun lama belum punya email → login pakai username. |
| Data antar akun terlihat sama | Pastikan server versi terbaru (query memakai `user_id`) lalu logout dan login ulang. |
| Sesi langsung logout | Token kedaluwarsa / tabel `user_sessions` terhapus. Login ulang. |
| Bot tidak merespons | `TELEGRAM_BOT_TOKEN`/`WEBHOOK_URL`/`TELEGRAM_WEBHOOK_SECRET` salah. Panggil `POST /api/setup-telegram-menu` sebagai admin dan cek hasil `report`. |
| Bot membalas `401`/`503` | `TELEGRAM_WEBHOOK_SECRET` tidak cocok atau belum diisi di produksi. Isi variabelnya lalu panggil ulang setup webhook. |
| Data hilang setelah deploy | Database berbeda antar environment — pastikan `DATABASE_URL` produksi benar. |
| `npm start` error `EADDRINUSE` | Port terpakai. Jalankan dengan `PORT` lain. |
| CSS/JS tidak berubah di browser | Hard refresh (`Ctrl+Shift+R`) atau cek cache/CDN. |

---

## 📄 Lisensi

MIT License © 2026 busan6202 — lihat [LICENSE](LICENSE).