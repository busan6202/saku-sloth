# saku-sloth

Transaksi dari Telegram menggunakan ID update sebagai kunci idempotensi. Jika Telegram mengirim ulang update yang sama, transaksi hanya disimpan sekali sehingga saldo tidak bertambah ganda. Tabel penanda update dibuat otomatis saat aplikasi tersambung ke PostgreSQL.