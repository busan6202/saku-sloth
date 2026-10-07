# saku-sloth

Transaksi dari Telegram menggunakan ID update sebagai kunci idempotensi. Jika Telegram mengirim ulang update yang sama, transaksi hanya disimpan sekali sehingga saldo tidak bertambah ganda. Tabel penanda update dibuat otomatis saat aplikasi tersambung ke PostgreSQL.

## Perencanaan keuangan

Dashboard mendukung budget bulanan per kategori dan beberapa target tabungan. Tabel `monthly_budgets` dan `savings_goals` dibuat otomatis saat server terhubung ke PostgreSQL.

Analisis keuangan AI menggunakan `GEMINI_API_KEY` di server. Analisis hanya berjalan setelah diminta pengguna. Ringkasan pemasukan/pengeluaran per kategori, tren enam bulan, budget, dan target tabungan dikirim ke Google Gemini; deskripsi transaksi tidak dikirim. Pastikan pengguna mengetahui dan menyetujui pemrosesan ini.

## Login Google

Login menggunakan Google Identity Services di browser dan verifikasi ID token di server dengan `google-auth-library`. Token hanya disimpan di memori halaman dan setiap endpoint data API memverifikasinya. Transaksi, budget, target tabungan, analisis AI, dan ekspor Excel dibatasi menurut Google subject pengguna. Integrasi Telegram tetap mencatat ke akun pemilik awal.

Sebelum deploy:

1. Buat OAuth Client ID bertipe **Web application** di Google Cloud Console. Tambahkan origin situs dashboard ke **Authorized JavaScript origins**.
2. Atur environment variables di deployment server:
   - `GOOGLE_CLIENT_ID`: OAuth Client ID yang sama dengan client web.
   - `GOOGLE_BOOTSTRAP_EMAIL`: alamat Google pemilik awal. Untuk instalasi ini gunakan `busan6202@gmail.com`.
   - `TELEGRAM_BOT_TOKEN`, `ADMIN_TELEGRAM_ID`, dan `TELEGRAM_WEBHOOK_SECRET`: wajib jika memakai integrasi Telegram. Atur secret webhook yang acak pada Telegram `setWebhook` dan server; server menolak webhook tanpa header rahasia yang sesuai atau pesan dari ID admin lain.
3. Deploy frontend dan API bersama. Jangan menaruh client secret atau `GEMINI_API_KEY` di frontend.

Saat pemilik awal dengan email terverifikasi tersebut pertama kali masuk, data transaksi, budget, dan target lama yang belum memiliki pemilik akan dihubungkan ke akun Google-nya. Akun lain tidak dapat membaca data tersebut. Seluruh tabel diberi kolom pemilik secara otomatis saat server mulai; sebelum rilis, buat backup PostgreSQL dan pastikan `GOOGLE_BOOTSTRAP_EMAIL` sudah disetel.

Nilai token login tidak disimpan di `localStorage`; pengguna mungkin perlu memilih akun kembali setelah memuat ulang halaman. Analisis Gemini tetap memerlukan `GEMINI_API_KEY`.