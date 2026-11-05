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
| `GEMINI_API_KEY` | ❌ | Untuk fitur analisis AI. |
| `PORT` | ❌ | Port lokal (default 3000). |
| `POS_CASH_WALLET` | ❌ | Nama saku untuk pembayaran tunai (default `Tunai`). |
| `POS_QRIS_WALLET` | ❌ | Nama saku untuk pembayaran QRIS (default `QRIS`). |
| `POS_PAYMENT_WEBHOOK_SECRET` | ❌ | Secret header `x-pos-secret` untuk callback pembayaran QRIS. |
| `GOOGLE_SHEETS_WEBHOOK_URL` | ❌ | URL Apps Script `doPost` default untuk sinkronisasi POS. |

> ⚠️ **Jangan pernah commit file `.env`.** File ini sudah masuk `.gitignore`.

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
| `users` | Akun: `username`, `email`, `password_hash`, `full_name`, `avatar`, `role` |
| `pos_products` | Produk POS: SKU/barcode, harga jual, HPP, stok |
| `pos_sales` | Header penjualan: invoice, metode, total, HPP, laba, status |
| `pos_sale_items` | Rincian item per invoice (harga jual & modal saat transaksi) |
| `pos_settings` | Payload QRIS & URL webhook Google Sheets per pengguna |

Migrasi ringan (`ADD COLUMN IF NOT EXISTS`, unique index email, backfill `user_id` data lama) juga berjalan otomatis.

---

## 🛒 Modul POS Kasir (`/pos`)

Halaman kasir terpisah dari dashboard keuangan, tetapi memakai **database, sesi login, dan API yang sama**.

- `/dashboard` → perencana keuangan harian (saldo kantong, utang, laporan).
- `/pos` → layar kasir penuh: katalog, keranjang, pembayaran, struk, dan laporan POS.

### Alur transaksi

1. Kasir memilih produk / scan barcode. Stok dicek sebelum masuk keranjang.
2. Keranjang menghitung total jual, total HPP, dan laba kotor dari data produk.
3. **Tunai** → kasir mengisi uang diterima, sistem menghitung kembalian, transaksi langsung `PAID`.
4. **QRIS** → transaksi dibuat `PENDING`; kasir menekan **Konfirmasi Lunas**, atau payment gateway memanggil webhook.
5. Saat `PAID`, satu fungsi backend otomatis:
   - mengurangi stok produk,
   - mencatat pemasukan ke tabel `transactions` pada saku `Tunai` atau `QRIS`,
   - menyimpan total HPP & laba kotor di `pos_sales` untuk laporan laba/rugi,
   - mengirim rincian item ke Google Sheets (bila webhook diatur).
6. Struk bisa dicetak atau dikirim ke WhatsApp pelanggan.
7. Tombol **Download Excel/CSV** di laporan menarik rincian item per rentang tanggal.

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
    sheet.appendRow(['Timestamp', 'ID Transaksi', 'Nama Produk', 'SKU', 'Qty',
                     'Harga Satuan', 'Harga Modal', 'Subtotal', 'Metode Bayar',
                     'Saku Tujuan', 'Laba Bersih']);
  }
  const payload = JSON.parse(e.postData.contents);
  (payload.rows || []).forEach(function (row) {
    sheet.appendRow([
      row.Timestamp, row['ID Transaksi'], row['Nama Produk'], row.SKU, row.Qty,
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

**Akun awal:** jika tabel `users` masih kosong, dibuat akun admin:

| Field | Nilai |
| --- | --- |
| Email | `admin@sakuharian.app` |
| Username | `admin` |
| Kata sandi | `admin123` |

> Segera ganti kata sandi/akun ini untuk penggunaan produksi.

---

## 🔑 Cara Kerja Login (Email)

1. **Daftar** → isi nama, email, kata sandi (min. 6 karakter), pilih maskot.
   - Email divalidasi formatnya dan harus unik (case-insensitive).
   - Username internal dibuat otomatis dari email (mis. `andriadi@gmail.com` → `andriadi`, ditambah angka bila bentrok).
2. Backend menyimpan hash `PBKDF2` (salt + hash, format `salt:hash`).
3. Backend membuat token sesi acak 32 byte dan menyimpannya di `user_sessions` (berlaku 30 hari).
4. Klien menyimpan token di `localStorage` dan mengirimnya sebagai header `Authorization: Bearer <token>`.
5. Setiap request data (transaksi/utang/ekspor) difilter dengan `user_id` dari token.
6. Login lama dengan **username** tetap didukung untuk akun yang sudah ada.

**Kenapa data tidak tercampur antar pengguna:**

- Tidak ada lagi header `X-User-Id` yang bisa dipalsukan.
- Semua query memakai `buildUserScope()` → `user_id = $1` (admin: ditambah data global `user_id IS NULL`).
- Cache `localStorage` dibersihkan otomatis saat logout atau ganti akun.

---

## 🤖 Setup Bot Telegram

1. Chat **@BotFather** → `/newbot` → simpan **token**.
2. Isi `TELEGRAM_BOT_TOKEN` di `.env`.
3. Untuk server publik, isi `WEBHOOK_URL`, misal `https://saku-sloth.vercel.app/api/telegram-webhook`.
4. Jalankan server. Webhook + menu perintah tersinkron otomatis saat start, atau paksa lewat:

```bash
curl -X GET https://domain-anda.vercel.app/api/setup-telegram-menu
```

5. Buka bot di Telegram, kirim `/menu` untuk melihat tombol interaktif.

---

## ☁️ Deploy ke Vercel

### Opsi A — Dashboard

1. Push repo ke GitHub (lihat [bagian Push ke GitHub](#-push-ke-github-langkah-lengkap)).
2. Buka https://vercel.com → **Add New → Project**.
3. Import repository `saku-sloth`.
4. Framework preset: **Other** (biarkan default; `vercel.json` sudah mengatur build & route).
5. Tambahkan **Environment Variables**: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`,
   `WEBHOOK_URL` → `https://<nama-project>.vercel.app/api/telegram-webhook`, `GEMINI_API_KEY` (opsional).
6. Klik **Deploy**.
7. Setelah dapat domain, buka `https://<domain>/api/setup-telegram-menu` sekali agar webhook terpasang.

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

Semua endpoint data memerlukan header `Authorization: Bearer <token>`.

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
| GET/PUT | `/api/pos/settings` | Payload QRIS & URL webhook Sheets |
| POST | `/api/pos/checkout` | Checkout (`CASH` langsung lunas, `QRIS` pending) |
| POST | `/api/pos/sales/:id/pay` | Konfirmasi pelunasan QRIS |
| POST | `/api/pos/sales/:id/cancel` | Batalkan transaksi pending |
| GET | `/api/pos/sales` | Riwayat transaksi (`?from=&to=&status=`) |
| GET | `/api/pos/sales/:id` | Detail transaksi + item |
| POST | `/api/pos/sales/:id/sync-sheet` | Kirim ulang ke Google Sheets |
| GET | `/api/pos/summary` | Omzet, HPP, laba, tunai/QRIS, pending |
| GET | `/api/pos/export-excel` | Unduh rincian item (CSV) |
| POST | `/api/pos/webhook/payment` | Callback pembayaran QRIS (secret header) |

### Lain-lain

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/api/setup-telegram-menu` | Sinkron menu & webhook bot |
| POST | `/api/telegram-webhook` | Endpoint webhook Telegram |

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
| Bot tidak merespons | `TELEGRAM_BOT_TOKEN`/`WEBHOOK_URL` salah. Buka `/api/setup-telegram-menu` dan cek hasil `report`. |
| Data hilang setelah deploy | Database berbeda antar environment — pastikan `DATABASE_URL` produksi benar. |
| `npm start` error `EADDRINUSE` | Port terpakai. Jalankan dengan `PORT` lain. |
| CSS/JS tidak berubah di browser | Hard refresh (`Ctrl+Shift+R`) atau cek cache/CDN. |

---

## 📄 Lisensi

MIT License © 2026 busan6202 — lihat [LICENSE](LICENSE).