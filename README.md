# Saku Sloth

Dashboard keuangan pribadi dengan Supabase Auth, Supabase Database, backend Express di Vercel, dan bot Telegram. Pengguna membuat akun sendiri dengan email dan password; Row Level Security (RLS) membatasi transaksi, budget, target, dan kode Telegram ke UID akun tersebut. Setiap pengguna menautkan Telegram pribadinya dari dashboard, sehingga bot hanya bekerja pada data akun yang ditautkan.

## Menyiapkan Supabase

1. Buat project di [Supabase](https://supabase.com/dashboard).
2. Di **Project Settings → API**, catat Project URL, publishable/anon key, dan service role key.
3. Di **Authentication → Providers → Email**, aktifkan pendaftaran email/password. Pilih apakah email harus dikonfirmasi. Jika konfirmasi aktif, atur **Authentication → URL Configuration → Site URL** ke domain dashboard dan masukkan semua origin yang digunakan ke **Redirect URLs**, misalnya `https://saku-sloth.vercel.app` dan `http://localhost:3000` untuk development. Form pendaftaran meminta link konfirmasi kembali ke origin halaman yang sedang digunakan; origin tersebut harus terdaftar di Redirect URLs.
4. Buka **SQL Editor**, lalu jalankan seluruh [`supabase-setup.sql`](./supabase-setup.sql). Skrip membuat tabel, RLS per pengguna, dan fungsi server-only untuk Telegram serta pemindahan data lama.
5. Di Vercel, atur environment variables untuk semua environment yang digunakan, lalu redeploy:

   | Variable | Nilai |
   | --- | --- |
   | `SUPABASE_URL` | Project URL Supabase |
   | `SUPABASE_ANON_KEY` | Publishable/anon key Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role key; rahasia server-side, jangan taruh di frontend |
   | `TELEGRAM_BOT_TOKEN` | Token bot Telegram, jika memakai bot |
   | `TELEGRAM_WEBHOOK_SECRET` | Secret webhook 32-256 karakter: huruf, angka, `_`, atau `-` |
   | `GEMINI_API_KEY` | API key Gemini, jika memakai analisis AI atau input nota/voice |

   Anon key boleh dikirim ke browser; keamanan data bergantung pada RLS. Jangan pernah menaruh service role key di frontend, `index.html`, atau variabel Vercel yang terekspos ke browser.

## Akun pengguna dan privasi data

Pengguna baru memilih **Buat akun**, lalu mendaftarkan email dan password masing-masing. Jika konfirmasi email diaktifkan di Supabase, pengguna harus mengonfirmasi email sebelum masuk. Gunakan alamat email unik dan password yang tidak dibagikan.

Semua tabel data pengguna memiliki policy RLS yang membandingkan `user_id` dengan `auth.uid()`. Backend juga memverifikasi access token Supabase untuk setiap permintaan. Kode tautan Telegram dibuat melalui RPC server-only setelah backend memverifikasi sesi pengguna. Fungsi bot dan migrasi data lama juga hanya bisa dipanggil server-side menggunakan `SUPABASE_SERVICE_ROLE_KEY`; key tersebut tidak boleh dikirim ke browser. Setiap pengguna harus masuk ke akunnya sendiri dan menautkan Telegram dari dashboard melalui kode sekali pakai.

## Memindahkan data lama dari Neon

Jangan hapus database Neon sebelum data hasil impor diverifikasi.

1. Ekspor dan simpan backup tabel `transactions`, `monthly_budgets`, `savings_goals`, serta `telegram_user_links` dari Neon.
2. Impor CSV ke tabel bernama sama di Supabase. Pertahankan nilai `id` dan `user_id` Firebase lama. Impor `telegram_user_links` hanya jika ingin mempertahankan tautan bot.
3. Masukkan setiap pasangan UID Firebase lama dan alamat email pemilik di SQL Editor Supabase:

   ```sql
   INSERT INTO public.legacy_user_migrations (legacy_user_id, email)
   VALUES ('UID_FIREBASE_LAMA', 'email-pemilik@example.com')
   ON CONFLICT (legacy_user_id) DO UPDATE
   SET email = EXCLUDED.email, claimed_at = NULL;
   ```

   Ulangi satu pasangan per akun yang datanya diimpor. Jangan petakan UID yang pemiliknya belum dipastikan.
4. Sesudah impor ID numerik, setel sequence agar tidak bentrok dengan baris berikutnya:

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

5. Deploy aplikasi, lalu pengguna mendaftar atau masuk di Supabase Auth menggunakan email yang dipetakan. Saat sesi disiapkan, backend memindahkan baris data UID lama milik email tersebut ke UID Supabase yang baru, satu kali.
6. Verifikasi transaksi, budget, target, dan tautan Telegram setiap akun sebelum menghentikan Neon.

Baris tanpa `user_id` atau tanpa pemilik terverifikasi tidak otomatis diklaim. Identifikasi dan petakan pemiliknya dengan benar sebelum migrasi agar data tidak masuk ke akun yang salah.

## Bot Telegram

Atur `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_WEBHOOK_SECRET` di Vercel. Daftarkan webhook Telegram ke `https://saku-sloth.vercel.app/api/telegram-webhook` dengan `secret_token` yang sama.

Pengguna masuk ke akun dashboard masing-masing, pilih **Hubungkan Telegram**, lalu kirim `/link KODE` di chat pribadi bot sebelum kode kedaluwarsa dalam 10 menit. Bot mendukung input transaksi, `/saldo`, `/history`, `/reset`, dan `/unlink`. Fungsi database bot hanya tersedia untuk service role server dan mengambil UID pemilik dari tautan Telegram; pengguna Telegram yang berbeda tidak dapat membaca transaksi satu sama lain.

## Analisis AI

Analisis keuangan hanya dikirim ke Google Gemini setelah diminta pengguna. Ringkasan angka agregat per kategori, tren, budget, dan target tabungan dikirim; keterangan transaksi tidak dikirim. Bot dapat memakai Gemini untuk memproses nota dan voice note. Fitur tersebut memerlukan `GEMINI_API_KEY`; pastikan pengguna memahami pemrosesan eksternal.

## Menjalankan lokal

Gunakan Node.js 20 atau lebih baru. Salin `.env.example` menjadi `.env`, isi konfigurasi sendiri, lalu jalankan:

```sh
npm install
npm start
```
