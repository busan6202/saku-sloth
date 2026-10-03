const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Koneksi ke Neon PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.MONGO_URI,
    ssl: { rejectUnauthorized: false }
});

// Buat tabel transaksi otomatis jika belum ada saat server nyala
pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        desc TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        type VARCHAR(20) NOT NULL,
        category VARCHAR(100) DEFAULT 'Umum',
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).then(() => console.log("Berhasil terhubung ke Neon PostgreSQL! 🐘"))
  .catch(err => console.error("Gagal inisialisasi database Neon:", err));

// Konfigurasi Token
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8584715332:AAEF5F54-ipvf8vQGH-Eh7bqrYZYCIuLHjQ';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Fungsi Kirim Pesan ke Telegram
async function sendTelegramMessage(chatId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Connection': 'close' 
            },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
        });
    } catch (err) {
        console.error("Gagal kirim pesan Telegram:", err.message);
    }
}

// Fungsi Panggil Gemini via REST API Fetch Murni
async function callGeminiAPI(prompt, base64Image = null) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    let parts = [{ text: prompt }];
    if (base64Image) {
        parts.push({
            inline_data: {
                mime_type: "image/jpeg",
                data: base64Image
            }
        });
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Connection': 'close'
        },
        body: JSON.stringify({
            contents: [{ parts: parts }]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API Error: ${errorText}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

// Fungsi Simpan & Notifikasi
async function saveAndNotify(trxData, chatId) {
    const query = `INSERT INTO transactions (desc, amount, type, category) VALUES ($1, $2, $3, $4) RETURNING *`;
    const values = [trxData.desc, trxData.amount, trxData.type, trxData.category || 'Umum'];
    
    const result = await pool.query(query, values);
    const savedTrx = result.rows[0];

    const symbol = savedTrx.type === 'income' ? '🟢 PEMASUKAN' : '🔴 PENGELUARAN';
    const sign = savedTrx.type === 'income' ? '+' : '-';
    const formattedAmount = Number(savedTrx.amount).toLocaleString('id-ID');
    
    const message = `
✅ *BERHASIL DICATAT OLEH GEMINI*
-----------------------------------
${symbol}
📝 *Keterangan:* ${savedTrx.desc}
📁 *Kategori:* ${savedTrx.category}
💰 *Nominal:* ${sign} Rp ${formattedAmount}
    `.trim();

    await sendTelegramMessage(chatId, message);
}

// API: Ambil Semua Transaksi (Untuk Web)
app.get('/api/transactions', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM transactions ORDER BY date DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Tambah Transaksi (Untuk Web)
app.post('/api/transactions', async (req, res) => {
    try {
        const { desc, amount, type, category } = req.body;
        const query = `INSERT INTO transactions (desc, amount, type, category) VALUES ($1, $2, $3, $4) RETURNING *`;
        const values = [desc, amount, type, category || 'Umum'];
        
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ================= WEBHOOK TELEGRAM BOT =================
app.post(`/api/telegram-webhook`, async (req, res) => {
    const update = req.body;
    if (!update.message) {
        return res.sendStatus(200);
    }

    const chatId = String(update.message.chat.id);
    const text = update.message.text;
    const photo = update.message.photo;

    // Pengaman Whitelist: Hanya merespon ADMIN_TELEGRAM_ID Anda
    if (ADMIN_TELEGRAM_ID && chatId !== String(ADMIN_TELEGRAM_ID)) {
        await sendTelegramMessage(chatId, "⚠️ Maaf, bot pencatat keuangan pribadi ini terkunci.");
        return res.sendStatus(200);
    }

    try {
        if (photo && photo.length > 0) {
            const fileId = photo[photo.length - 1].file_id;
            const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
            const fileData = await fileRes.json();
            const filePath = fileData.result.file_path;
            const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

            const imageRes = await fetch(downloadUrl);
            const arrayBuffer = await imageRes.arrayBuffer();
            const base64Image = Buffer.from(arrayBuffer).toString('base64');

            await sendTelegramMessage(chatId, "🔍 *Gemini sedang membaca nota Anda...*");

            const prompt = `Analisis nota/struk belanja ini. Ekstrak data ke format JSON murni TANPA markdown:
            {"desc": "Nama tempat/toko atau ringkasan", "amount": angka saja, "type": "expense", "category": pilih dari ["Makan & Minum", "Transportasi", "Langganan Digital", "Kesehatan & Self-Care", "Belanja & Lifestyle", "Tagihan & Utilitas"]}`;

            const rawTextResponse = await callGeminiAPI(prompt, base64Image);

            let jsonText = rawTextResponse.trim();
            if (jsonText.includes("```")) {
                jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
            }
            const firstOpen = jsonText.indexOf('{');
            const lastClose = jsonText.lastIndexOf('}');
            if (firstOpen !== -1 && lastClose !== -1) {
                jsonText = jsonText.substring(firstOpen, lastClose + 1);
            }

            const parsedData = JSON.parse(jsonText);
            await saveAndNotify(parsedData, chatId);
        } 
        else if (text) {
            if (text.startsWith('/start')) {
                await sendTelegramMessage(chatId, "Halo! 🌱 Saku-Sloth Bot aktif (Neon DB) dan aman. Kirim foto nota atau ketik catatan transaksi Anda!");
                return res.sendStatus(200);
            }

            const prompt = `Analisis transaksi: "${text}". Ekstrak ke format JSON murni TANPA markdown:
            {"desc": "Keterangan singkat", "amount": angka saja, "type": "expense" atau "income", "category": pilih dari ["Makan & Minum", "Transportasi", "Langganan Digital", "Kesehatan & Self-Care", "Belanja & Lifestyle", "Tagihan & Utilitas", "Gaji Utama", "Side Hustle / Freelance", "Investasi & Dividen"]}`;

            const rawTextResponse = await callGeminiAPI(prompt);

            let jsonText = rawTextResponse.trim();
            if (jsonText.includes("```")) {
                jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
            }
            const firstOpen = jsonText.indexOf('{');
            const lastClose = jsonText.lastIndexOf('}');
            if (firstOpen !== -1 && lastClose !== -1) {
                jsonText = jsonText.substring(firstOpen, lastClose + 1);
            }

            const parsedData = JSON.parse(jsonText);
            await saveAndNotify(parsedData, chatId);
        }
    } catch (err) {
        console.error("Gagal memproses AI:", err.message || err);
        await sendTelegramMessage(chatId, "⚠️ Maaf, Gemini gagal membaca input Anda. Pastikan format teks atau foto jelas.");
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server lokal di port ${PORT}`));
}

module.exports = app;