const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Koneksi ke Neon PostgreSQL (Konfigurasi SSL yang bersih & aman)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.MONGO_URI,
    ssl: { 
        rejectUnauthorized: false 
    },
    connectionTimeoutMillis: 20000,
    idleTimeoutMillis: 30000,
    max: 5
});

// Inisialisasi tabel transaksi dan penanda update Telegram yang sudah diproses.
const databaseReady = pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        "desc" TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        type VARCHAR(20) NOT NULL,
        category VARCHAR(100) DEFAULT 'Umum',
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_processed_updates (
        update_id BIGINT PRIMARY KEY,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`)).then(() => console.log("Berhasil terhubung ke Neon PostgreSQL! 🐘"))
  .catch(err => console.error("Gagal inisialisasi database Neon:", err));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8584715332:AAEF5F54-ipvf8vQGH-Eh7bqrYZYCIuLHjQ';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Fungsi Kirim Pesan Telegram
async function sendTelegramMessage(chatId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
        });
    } catch (err) {
        console.error("Gagal kirim pesan Telegram:", err.message);
    }
}

// Fungsi Panggil Gemini Teks & Gambar (Auto-Retry 503)
async function callGeminiAPI(prompt, base64Image = null, retries = 3, delay = 2000) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
    let parts = [{ text: prompt }];
    if (base64Image) {
        parts.push({ inline_data: { mime_type: "image/jpeg", data: base64Image } });
    }

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
                body: JSON.stringify({ contents: [{ parts: parts }] })
            });
            const responseText = await response.text();
            if (response.ok) {
                const data = JSON.parse(responseText);
                return data.candidates[0].content.parts[0].text;
            }
            if (response.status === 503 && i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            }
            throw new Error(`Gemini API Error: ${responseText}`);
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Fungsi Panggil Gemini Voice Note (Audio)
async function callGeminiAudioAPI(prompt, base64Audio, retries = 3, delay = 2000) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
    let parts = [
        { text: prompt },
        { inline_data: { mime_type: "audio/ogg", data: base64Audio } }
    ];

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
                body: JSON.stringify({ contents: [{ parts: parts }] })
            });
            const responseText = await response.text();
            if (response.ok) {
                const data = JSON.parse(responseText);
                return data.candidates[0].content.parts[0].text;
            }
            if (response.status === 503 && i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            }
            throw new Error(`Gemini API Error: ${responseText}`);
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Fungsi Simpan Transaksi & Analisis Saku Harian AI
async function saveAndNotify(trxData, chatId, updateId) {
    if (!Number.isSafeInteger(updateId) || updateId < 0) {
        throw new Error('ID update Telegram tidak valid.');
    }

    await databaseReady;
    const query = `
        WITH claimed_update AS (
            INSERT INTO telegram_processed_updates (update_id)
            VALUES ($1)
            ON CONFLICT (update_id) DO NOTHING
            RETURNING update_id
        )
        INSERT INTO transactions ("desc", amount, type, category)
        SELECT $2, $3, $4, $5
        FROM claimed_update
        RETURNING *
    `;
    const values = [updateId, trxData.desc, trxData.amount, trxData.type, trxData.category || 'Umum'];
    const result = await pool.query(query, values);
    if (result.rowCount === 0) {
        console.info(`Update Telegram ${updateId} sudah diproses; transaksi duplikat diabaikan.`);
        return false;
    }

    const savedTrx = result.rows[0];

    const resIncome = await pool.query("SELECT SUM(amount) as total FROM transactions WHERE type = 'income'");
    const resExpense = await pool.query("SELECT SUM(amount) as total FROM transactions WHERE type = 'expense'");
    const totalIncome = Number(resIncome.rows[0].total || 0);
    const totalExpense = Number(resExpense.rows[0].total || 0);
    const balance = totalIncome - totalExpense;

    let financialAdvice = "";
    if (totalExpense > totalIncome) {
        financialAdvice = "\n🚨 *WARNING SAKU HARIAN:* Pengeluaran Anda sudah melewati total pemasukan! Harap lebih berhemat.";
    } else if (totalExpense / totalIncome > 0.8) {
        financialAdvice = "\n⚠️ *WARNING SAKU HARIAN:* Rasio pengeluaran Anda sudah di atas 80% dari pemasukan.";
    } else {
        financialAdvice = "\n💚 *STATUS:* Keuangan Anda sehat dan terkontrol dengan baik!";
    }

    const symbol = savedTrx.type === 'income' ? '🟢 PEMASUKAN' : '🔴 PENGELUARAN';
    const sign = savedTrx.type === 'income' ? '+' : '-';
    const formattedAmount = Number(savedTrx.amount).toLocaleString('id-ID');
    
    const message = `
✅ *BERHASIL DICATAT OLEH SAKU HARIAN*
-----------------------------------
${symbol}
📝 *Keterangan:* ${savedTrx.desc}
📁 *Kategori:* ${savedTrx.category}
💰 *Nominal:* ${sign} Rp ${formattedAmount}
-----------------------------------
💳 *Saldo Berjalan:* Rp ${balance.toLocaleString('id-ID')}
${financialAdvice}
    `.trim();

    await sendTelegramMessage(chatId, message);
    return true;
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
        const query = `INSERT INTO transactions ("desc", amount, type, category) VALUES ($1, $2, $3, $4) RETURNING *`;
        const values = [desc, amount, type, category || 'Umum'];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// API: Export Excel (CSV)
app.get('/api/export-excel', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, "desc", amount, type, category, date FROM transactions ORDER BY date DESC');
        let csvContent = "ID,Keterangan,Nominal,Tipe,Kategori,Tanggal\n";
        result.rows.forEach(row => {
            const desc = `"${row.desc.replace(/"/g, '""')}"`;
            csvContent += `${row.id},${desc},${row.amount},${row.type === 'income' ? 'Pemasukan' : 'Pengeluaran'},"${row.category}","${row.date}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="laporan-keuangan-saku-harian.csv"');
        res.status(200).send(csvContent);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= WEBHOOK TELEGRAM BOT =================
app.post(`/api/telegram-webhook`, async (req, res) => {
    const update = req.body;
    if (!update.message) return res.sendStatus(200);

    const chatId = String(update.message.chat.id);
    const text = update.message.text;
    const photo = update.message.photo;
    const voice = update.message.voice;

    if (ADMIN_TELEGRAM_ID && chatId !== String(ADMIN_TELEGRAM_ID)) {
        await sendTelegramMessage(chatId, "⚠️ Maaf, bot finansial ini terkunci.");
        return res.sendStatus(200);
    }

    try {
        // 1. FOTO NOTA
        if (photo && photo.length > 0) {
            const fileId = photo[photo.length - 1].file_id;
            const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
            const fileData = await fileRes.json();
            const filePath = fileData.result.file_path;
            const imageRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
            const base64Image = Buffer.from(await imageRes.arrayBuffer()).toString('base64');

            await sendTelegramMessage(chatId, "🔍 *Saku Harian sedang memindai nota belanja Anda...*");
            const prompt = `Analisis nota ini. Jawab HANYA format JSON murni TANPA markdown:
            {"desc": "Nama tempat/ringkasan", "amount": angka saja, "type": "expense", "category": "Kategori bebas"}`;
            
            const rawText = await callGeminiAPI(prompt, base64Image);
            let parsed = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
            await saveAndNotify(parsed, chatId, update.update_id);
        } 
        // 2. VOICE NOTE (REKAMAN SUARA)
        else if (voice) {
            const fileId = voice.file_id;
            const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
            const fileData = await fileRes.json();
            const audioRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`);
            const base64Audio = Buffer.from(await audioRes.arrayBuffer()).toString('base64');

            await sendTelegramMessage(chatId, "🎙️ *Saku Harian mendengarkan voice note Anda...*");
            const prompt = `Dengarkan rekaman audio transaksi keuangan ini. Jawab HANYA format JSON murni TANPA markdown:
            {"desc": "Keterangan singkat", "amount": angka saja, "type": "expense" atau "income", "category": "Kategori bebas"}`;
            
            const rawText = await callGeminiAudioAPI(prompt, base64Audio);
            let parsed = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
            await saveAndNotify(parsed, chatId, update.update_id);
        }
        // 3. PESAN TEKS / KONSULTASI
        else if (text) {
            if (text.startsWith('/start')) {
                await sendTelegramMessage(chatId, `
💰 *Halo! Selamat datang di Saku Harian Bot.*
Kirim foto nota, **Voice Note (rekaman suara)**, atau ketik transaksi Anda secara bebas (Contoh: *"Beli bensin 50rb kategori Transport"*). 
Anda juga bisa bertanya apa saja tentang kondisi keuangan Anda!

📋 *Perintah:* /saldo, /history, /reset
                `.trim());
                return res.sendStatus(200);
            }

            if (text.startsWith('/saldo') || text.startsWith('/rekap')) {
                const resIncome = await pool.query("SELECT SUM(amount) as total FROM transactions WHERE type = 'income'");
                const resExpense = await pool.query("SELECT SUM(amount) as total FROM transactions WHERE type = 'expense'");
                const totalIncome = Number(resIncome.rows[0].total || 0);
                const totalExpense = Number(resExpense.rows[0].total || 0);
                const balance = totalIncome - totalExpense;

                await sendTelegramMessage(chatId, `📊 *REKAP KEUANGAN SAKU HARIAN*\n🟢 Pemasukan: Rp ${totalIncome.toLocaleString('id-ID')}\n🔴 Pengeluaran: Rp ${totalExpense.toLocaleString('id-ID')}\n💰 *Saldo:* Rp ${balance.toLocaleString('id-ID')}`);
                return res.sendStatus(200);
            }

            if (text.startsWith('/history') || text.startsWith('/riwayat')) {
                const result = await pool.query("SELECT * FROM transactions ORDER BY date DESC LIMIT 5");
                if (result.rows.length === 0) {
                    await sendTelegramMessage(chatId, "📂 Belum ada catatan transaksi.");
                    return res.sendStatus(200);
                }
                let msg = "📜 *5 TRANSAKSI TERAKHIR*\n";
                result.rows.forEach((t, i) => {
                    msg += `${i+1}. *${t.desc}* (${t.category}) — ${t.type==='income'?'+':'-'}Rp ${Number(t.amount).toLocaleString('id-ID')}\n`;
                });
                await sendTelegramMessage(chatId, msg);
                return res.sendStatus(200);
            }

            if (text.startsWith('/reset')) {
                await pool.query("DELETE FROM transactions");
                await sendTelegramMessage(chatId, "🗑️ *Reset Berhasil!* Semua data keuangan dibersihkan.");
                return res.sendStatus(200);
            }

            const checkPrompt = `Analisis pesan user: "${text}". 
            Jika pesan ini adalah perintah mencatat transaksi uang, balas HANYA format JSON: {"isTransaction": true, "desc": "...", "amount": angka, "type": "expense/income", "category": "..."}
            Jika pesan ini adalah pertanyaan, konsultasi, atau ngobrol (bukan transaksi), balas HANYA format JSON: {"isTransaction": false, "reply": "Jawaban Saku Harian sebagai asisten keuangan yang cerdas dan bijak"}`;

            const aiResp = await callGeminiAPI(checkPrompt);
            let cleanedJson = aiResp.replace(/```json/g, '').replace(/```/g, '').trim();
            const firstOpen = cleanedJson.indexOf('{');
            const lastClose = cleanedJson.lastIndexOf('}');
            if (firstOpen !== -1 && lastClose !== -1) cleanedJson = cleanedJson.substring(firstOpen, lastClose + 1);
            
            const parsed = JSON.parse(cleanedJson);

            if (parsed.isTransaction) {
                await saveAndNotify(parsed, chatId, update.update_id);
            } else {
                await sendTelegramMessage(chatId, `🤖 *Saku Harian:* ${parsed.reply}`);
            }
        }
    } catch (err) {
        console.error("Error:", err);
        await sendTelegramMessage(chatId, "⚠️ Saku Harian sedang sibuk atau format pesan kurang jelas. Silakan ulangi.");
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));
}

module.exports = app;