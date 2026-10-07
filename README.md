# saku-sloth

Transaksi dari Telegram menggunakan ID update sebagai kunci idempotensi. Jika Telegram mengirim ulang update yang sama, transaksi hanya disimpan sekali sehingga saldo tidak bertambah ganda. Tabel penanda update dibuat otomatis saat aplikasi tersambung ke PostgreSQL.

## Perencanaan keuangan

Dashboard mendukung budget bulanan per kategori dan beberapa target tabungan. Tabel `monthly_budgets` dan `savings_goals` dibuat otomatis saat server terhubung ke PostgreSQL.

Analisis keuangan AI menggunakan `GEMINI_API_KEY` di server. Analisis hanya berjalan setelah diminta pengguna. Ringkasan pemasukan/pengeluaran per kategori, tren enam bulan, budget, dan target tabungan dikirim ke Google Gemini; deskripsi transaksi tidak dikirim. Pastikan pengguna mengetahui dan menyetujui pemrosesan ini.

## Login Google melalui Firebase

Login menggunakan Firebase Authentication dengan penyedia Google. Firebase menyediakan paket Spark gratis untuk kebutuhan awal; aplikasi ini memakai Firebase hanya untuk login dan tetap menyimpan data keuangan di Neon PostgreSQL. Server memeriksa token melalui Firebase Authentication sebelum mengizinkan akses transaksi, budget, target tabungan, analisis, dan ekspor. Tidak perlu membuat OAuth Client ID sendiri atau membuka Google Cloud Console.

### Persiapan Firebase

1. Buka [Firebase Console](https://console.firebase.google.com/), buat project, lalu tambahkan aplikasi Web dari **Project settings → General → Your apps**.
2. Di **Authentication → Sign-in method**, aktifkan **Google** dan pilih alamat email dukungan.
3. Di **Authentication → Settings → Authorized domains**, tambahkan domain tempat dashboard berjalan (misalnya `saku-sloth.vercel.app`, tanpa `https://` atau path).
4. Dari konfigurasi aplikasi Web, salin nilai `apiKey`, `authDomain`, `projectId`, dan `appId`.

### Pengaturan deployment

Di pengaturan environment variables server/deployment (contohnya Vercel → Project → Settings → Environment Variables), tambahkan:

- `FIREBASE_API_KEY`: nilai `apiKey` dari konfigurasi aplikasi Web.
- `FIREBASE_AUTH_DOMAIN`: nilai `authDomain`.
- `FIREBASE_PROJECT_ID`: nilai `projectId`.
- `FIREBASE_APP_ID`: nilai `appId`.
- `FIREBASE_BOOTSTRAP_EMAIL`: email akun pemilik data awal. Untuk instalasi ini gunakan `busan6202@gmail.com`.

Nilai konfigurasi Firebase Web bukan kata sandi dan boleh dikirim ke browser. Jangan pernah menaruh token bot Telegram, `GEMINI_API_KEY`, atau kredensial database di frontend. Setelah menyimpan variabel, deploy ulang aplikasi. `GOOGLE_CLIENT_ID` tidak lagi digunakan untuk login.

Saat akun pemilik masuk pertama kali, data lama akan dipindahkan secara aman ke identitas Firebase yang baru. Pastikan `FIREBASE_BOOTSTRAP_EMAIL` benar dan buat backup database sebelum pergantian provider. Login pertama membutuhkan koneksi ke Firebase untuk menyiapkan sesi serta memigrasikan data pemilik lama.

Jika menggunakan integrasi Telegram, atur juga `TELEGRAM_BOT_TOKEN`, `ADMIN_TELEGRAM_ID`, dan `TELEGRAM_WEBHOOK_SECRET`. Webhook hanya menerima secret yang cocok dan pesan dari ID admin. Analisis Gemini tetap memerlukan `GEMINI_API_KEY`.