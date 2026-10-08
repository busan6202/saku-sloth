# Saku Sloth

Dashboard keuangan pribadi dengan Supabase Auth, Supabase Database, dan backend Express di Vercel. Google OAuth digunakan untuk login. Row Level Security (RLS) membatasi data ke pemilik akun; Telegram menggunakan fungsi database server-side yang hanya dapat dipanggil dengan service role key.

## Menyiapkan Supabase

1. Buat project di [Supabase](https://supabase.com/dashboard) dan simpan password database di tempat aman.
2. Di **Project Settings → API**, catat Project URL, publishable/anon key, dan service_role key.
3. Buka **SQL Editor**, pilih project yang benar, lalu jalankan seluruh [`supabase-setup.sql`](./supabase-setup.sql).
4. Di **Authentication → Providers → Google**, aktifkan Google OAuth dan masukkan OAuth Client ID/Secret dari Google Cloud. Tambahkan callback Supabase yang ditampilkan di halaman provider sebagai authorized redirect URI di Google Cloud, biasanya `https://<project-ref>.supabase.co/auth/v1/callback`.
5. Di **Authentication → URL Configuration**, set Site URL ke domain dashboard, misalnya `https://saku-sloth.vercel.app`, dan tambahkan domain deployment/preview yang diperlukan ke Redirect URLs.
6. Di Vercel, atur environment variables berikut untuk semua environment yang dipakai, lalu redeploy:

   | Variable | Nilai |
   | --- | --- |
   | `SUPABASE_URL` | Project URL Supabase |
   | `SUPABASE_ANON_KEY` | Publishable/anon key dari Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key; rahasia server-side, jangan pernah taruh di frontend |
   | `TELEGRAM_BOT_TOKEN` | Token bot Telegram, jika memakai bot |
   | `TELEGRAM_WEBHOOK_SECRET` | Secret webhook 32-256 karakter: huruf, angka, `_`, atau `-` |
   | `GEMINI_API_KEY` | API key Gemini, jika memakai analisis AI atau input nota/voice |

   `SUPABASE_ANON_KEY` memang digunakan di browser untuk memulai login. Keamanan data berasal dari RLS, bukan dari menyembunyikan anon key. Jangan menambahkan `service_role` key ke file frontend, `index.html`, atau variabel Vercel yang terekspos ke browser.

## Memindahkan data dari Neon

Jangan hapus project Neon atau menonaktifkan Firebase sebelum data di Supabase berhasil diverifikasi. Login Google di Supabase menghasilkan user ID baru, jadi ID Firebase lama perlu dipetakan ke email pemilik yang sama.

1. Ekspor dan simpan backup CSV tabel `transactions`, `monthly_budgets`, `savings_goals`, serta `telegram_user_links` dari Neon. Jangan bagikan file CSV atau data transaksi ke pihak lain.
2. Impor CSV ke tabel dengan nama yang sama di Supabase. Pertahankan nilai `id` dan `user_id` lama dari Firebase. Untuk `telegram_user_links`, impor hanya jika ingin mempertahankan tautan bot; jika tidak, pengguna dapat menautkan bot kembali dari dashboard.
3. Dari daftar pengguna Firebase, catat pasangan UID lama dan email Google masing-masing. Di SQL Editor Supabase, masukkan pemetaan yang sesuai:

   ```sql
   INSERT INTO public.legacy_user_migrations (legacy_user_id, email)
   VALUES
       ('UID_FIREBASE_LAMA', 'email-google@example.com')
   ON CONFLICT (legacy_user_id) DO UPDATE
   SET email = EXCLUDED.email, claimed_at = NULL;
   ```

   Ulangi baris `VALUES` untuk setiap akun yang datanya diimpor. Jangan memasukkan password, token, atau secret ke tabel pemetaan.
4. Setelah impor selesai, setel sequence ID agar transaksi baru tidak bentrok dengan ID hasil impor:

   ```sql
   SELECT setval(pg_get_serial_sequence('public.transactions', 'id'),
                 COALESCE((SELECT MAX(id) FROM public.transactions), 1),
                 EXISTS (SELECT 1 FROM public.transactions));
   SELECT setval(pg_get_serial_sequence('public.monthly_budgets', 'id'),
                 COALESCE((SELECT MAX(id) FROM public.monthly_budgets), 1),
                 EXISTS (SELECT 1 FROM public.monthly_budgets));
   SELECT setval(pg_get_serial_sequence('public.savings_goals', 'id'),
                 COALESCE((SELECT MAX(id) FROM public.savings_goals), 1),
                 EXISTS (SELECT 1 FROM public.savings_goals));
   ```

5. Deploy versi aplikasi dengan environment Supabase, lalu login menggunakan email Google yang sama. Saat login, backend mencocokkan pemetaan email dan secara atomik memindahkan `user_id` transaksi, budget, target, dan tautan Telegram ke Supabase Auth UID. Login pertama akun tersebut akan menjalankan pemetaan sekali.
6. Periksa semua transaksi, budget, target tabungan, dan fitur Telegram untuk akun yang dimigrasikan. Setelah semua benar, Firebase/Neon lama dapat dihentikan secara terpisah.

Jika transaksi lama memiliki `user_id` kosong atau tidak punya pasangan UID/email, jangan login dan mengklaim semua baris secara massal. Identifikasi pemilik data tersebut di SQL Editor dan buat pemetaan yang tepat terlebih dahulu agar data tidak masuk ke akun yang salah.

## Login dan data

Supabase Google provider menangani login dan sesi di browser. Backend memvalidasi access token melalui Supabase Auth sebelum melayani API. Operasi transaksi, budget, target tabungan, dan kode Telegram menggunakan token pengguna dengan RLS; fungsi bot dan pemetaan data lama menggunakan `SUPABASE_SERVICE_ROLE_KEY` hanya di server.

## Bot Telegram

Setel `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_WEBHOOK_SECRET` di Vercel, lalu pasang webhook Telegram ke `https://saku-sloth.vercel.app/api/telegram-webhook` dengan `secret_token` yang sama. Webhook perlu dikirim sebagai POST oleh Telegram; membuka URL di browser hanya menguji endpoint GET.

Pengguna login ke dashboard, pilih **Hubungkan Telegram**, lalu kirim `/link KODE` dalam chat pribadi bot sebelum kode kedaluwarsa (10 menit). Bot mendukung input transaksi, `/saldo`, `/history`, `/reset`, dan `/unlink`. Operasi database bot memakai fungsi terbatas di [`supabase-setup.sql`](./supabase-setup.sql); fungsi tersebut tidak tersedia untuk role `anon` atau `authenticated`.

## Analisis AI

Analisis hanya dikirim ke Google Gemini setelah diminta pengguna. Ringkasan angka agregat per kategori, tren, budget, dan target tabungan dikirim; keterangan transaksi tidak dikirim. Fitur ini memerlukan `GEMINI_API_KEY`. Bot dapat memakai Gemini untuk memproses nota dan voice note; pastikan pengguna memahami pemrosesan eksternal tersebut.

## Menjalankan lokal

Gunakan Node.js 20 atau lebih baru, atur environment variable Supabase/opsional di `.env`, lalu jalankan:

```sh
npm install
npm start
```

Mulai dari `.env.example` dan isi kredensial project sendiri di `.env` (file tersebut tidak masuk Git):

```sh
Copy-Item .env.example .env
```
