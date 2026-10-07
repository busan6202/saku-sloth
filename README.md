# saku-sloth

Dashboard dan bot Telegram menggunakan Neon Data API (PostgREST), bukan koneksi TCP langsung ke PostgreSQL. Transaksi Telegram menggunakan ID update sebagai kunci idempotensi; RPC database memastikan update yang dikirim ulang tidak membuat transaksi ganda.

## Perencanaan keuangan

Dashboard mendukung budget bulanan per kategori dan beberapa target tabungan. Tabel serta kebijakan akses disiapkan melalui skrip SQL yang harus dijalankan satu kali di Neon.

Analisis keuangan AI menggunakan `GEMINI_API_KEY` di server. Analisis hanya berjalan setelah diminta pengguna. Ringkasan pemasukan/pengeluaran per kategori, tren enam bulan, budget, dan target tabungan dikirim ke Google Gemini; deskripsi transaksi tidak dikirim. Pastikan pengguna mengetahui dan menyetujui pemrosesan ini.

## Login Google melalui Firebase

Login menggunakan Firebase Authentication dengan penyedia Google. Firebase menyediakan paket Spark gratis untuk kebutuhan awal; aplikasi ini memakai Firebase untuk login dan Neon Data API untuk menyimpan data. Server memeriksa token melalui Firebase Authentication, lalu meneruskan Firebase ID token ke Neon. Row Level Security (RLS) membatasi setiap operasi ke UID Firebase pemilik data. Tidak perlu membuat OAuth Client ID sendiri atau membuka Google Cloud Console.

### Persiapan Firebase

1. Buka [Firebase Console](https://console.firebase.google.com/), buat project, lalu tambahkan aplikasi Web dari **Project settings → General → Your apps**.
2. Di **Authentication → Sign-in method**, aktifkan **Google** dan pilih alamat email dukungan.
3. Di **Authentication → Settings → Authorized domains**, tambahkan domain tempat dashboard berjalan (misalnya `saku-sloth.vercel.app`, tanpa `https://` atau path).
4. Dari konfigurasi aplikasi Web, salin nilai `apiKey`, `authDomain`, `projectId`, dan `appId`.

### Pengaturan deployment

Konfigurasi Web Firebase untuk project `saku-sloth` dan email pemilik awal `busan6202@gmail.com` sudah disiapkan sebagai nilai default di server. Biasanya tidak perlu menambahkan environment variables Firebase di Vercel. Jika ingin mengganti project atau email pemilik, atur `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, atau `FIREBASE_BOOTSTRAP_EMAIL` di environment variables server, lalu deploy ulang.

### Menyiapkan Neon Data API

1. Aktifkan Neon Data API pada database `neondb` dan pastikan Data API dapat diakses dari deployment Vercel (tanpa IP Allow atau private networking yang memblokirnya).
2. Di pengaturan autentikasi Data API Neon, tambahkan Firebase sebagai custom JWT provider. JWKS URL:
   `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`
   Audience harus `saku-sloth` (nilai `FIREBASE_PROJECT_ID`).
3. Buka **Neon SQL Editor**, pilih database `neondb`, lalu jalankan seluruh isi [`neon-data-api-setup.sql`](./neon-data-api-setup.sql). Buat backup terlebih dahulu. Skrip menyiapkan tabel, mengganti policy yang sudah ada pada tabel aplikasi terkait dengan RLS per pengguna, dan membuat RPC Telegram; migrasi data lama yang masih tanpa `user_id` dilakukan saat pemilik masuk pertama kali.
4. Tambahkan `NEON_DATA_API_URL` di environment Vercel dengan URL REST base, tanpa menambahkan path resource. Untuk endpoint saat ini:
   `https://ep-winter-poetry-arl51lwx.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1`
5. Hapus `DATABASE_URL`/`DATABASE_URI` dari deployment bila tidak dibutuhkan bagian lain. Aplikasi tidak lagi membuka koneksi PostgreSQL melalui `pg`.

Skrip SQL menggunakan `busan6202@gmail.com` sebagai email pemilik awal. Jika `FIREBASE_BOOTSTRAP_EMAIL` diubah, sesuaikan juga nilai di database, setelah menjalankan skrip:

```sql
UPDATE public.app_settings
SET value = lower('email-pemilik-anda@example.com')
WHERE key = 'bootstrap_owner_email';
```

Jangan memberi akses Data API `anonymous` langsung ke tabel keuangan. Skrip hanya memberi akses tabel kepada role `authenticated` dengan RLS per UID; role `anonymous` hanya dapat menjalankan RPC Telegram yang memeriksa secret webhook. Pastikan Neon berhasil memuat ulang schema setelah skrip selesai; skrip mengirim `NOTIFY pgrst, 'reload schema'`.

Firebase Web API key memang dikirim ke browser dan bukan kata sandi. Jangan pernah menaruh token bot Telegram, `GEMINI_API_KEY`, atau kredensial database di frontend. Batasi API key pada layanan yang diperlukan melalui pengaturan Firebase/Google Cloud dan jangan gunakan key ini sebagai pengganti aturan keamanan. `GOOGLE_CLIENT_ID` tidak lagi digunakan oleh aplikasi untuk login.

Saat akun pemilik masuk pertama kali, data lama akan dipindahkan secara aman ke identitas Firebase yang baru. Pastikan `FIREBASE_BOOTSTRAP_EMAIL` benar dan buat backup database sebelum pergantian provider. Login pertama membutuhkan koneksi ke Firebase untuk menyiapkan sesi serta memigrasikan data pemilik lama.

### Menghubungkan bot Telegram

Atur `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_WEBHOOK_SECRET` di environment variables server, lalu pastikan webhook bot Telegram dikonfigurasi dengan URL `/api/telegram-webhook` dan secret token yang sama. Secret harus hanya memakai huruf, angka, `_`, atau `-`, dan minimal 32 karakter. Setelah mengubah secret, pemilik perlu keluar lalu masuk kembali agar nilainya disinkronkan secara aman ke Neon. `ADMIN_TELEGRAM_ID` tidak lagi digunakan.

Membuka URL webhook langsung di browser hanya mengirim GET dan tidak mendaftarkan webhook. Telegram harus didaftarkan ke URL tersebut dengan `setWebhook` (POST) dan `secret_token` yang sama persis dengan `TELEGRAM_WEBHOOK_SECRET`; gunakan `getWebhookInfo` untuk memeriksa apakah URL sudah terpasang dan apakah ada `last_error_message`. Jangan membagikan token bot atau secret. Endpoint GET aplikasi hanya menampilkan pesan bahwa endpoint aktif, bukan status koneksi Telegram.

1. Login ke dashboard menggunakan akun Google.
2. Pilih **Hubungkan Telegram**, lalu buka tautan `@duitandaBOT` yang tersedia dan salin kode sekali pakai.
3. Kirim `/link KODE` di chat pribadi bot dalam waktu 10 menit.

Setelah berhasil tertaut, bot menyimpan transaksi, membaca saldo/riwayat, dan menjalankan `/reset` hanya untuk akun pemilik Telegram tersebut. Perintah `/unlink` melepas tautan. Setiap pengguna harus menautkan Telegram sendiri; bot tidak menerima pesan grup. Kode tautan disimpan melalui Data API di bawah RLS; Telegram memakai fungsi database terbatas sehingga tidak mendapat akses langsung ke tabel. Analisis AI di bot tetap memerlukan `GEMINI_API_KEY`.