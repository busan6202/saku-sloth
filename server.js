const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Koneksi ke MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Berhasil terhubung ke MongoDB Atlas! 🌱"))
    .catch((err) => console.error("Koneksi database gagal:", err));

// Skema & Model Transaksi Keuangan
const transactionSchema = new mongoose.Schema({
    desc: { type: String, required: true },
    amount: { type: Number, required: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    category: { type: String, default: 'Umum' },
    date: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

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

// Fungsi Panggil Gemini via REST API Fetch Murni (Menghindari ECONNRESET SDK)
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
    const newTransaction = new Transaction(trxData);
    await newTransaction.save();

    const symbol = newTransaction.type === 'income' ? '🟢 PEMASUKAN' : '🔴 PENGELUARAN';
    const sign = newTransaction.type === 'income' ? '+' : '-';
    const formattedAmount = Number(newTransaction.amount).toLocaleString('id-ID');
    
    const message = `
✅ *BERHASIL DICATAT OLEH GEMINI*
-----------------------------------
${symbol}
📝 *Keterangan:* ${newTransaction.desc}
📁 *Kategori:* ${newTransaction.category}
💰 *Nominal:* ${sign} Rp ${formattedAmount}
    `.trim();

    await sendTelegramMessage(chatId, message);
}

// API: Ambil Semua Transaksi (Untuk Web)
app.get('/api/transactions', async (req, res) => {
    try {
        const transactions = await Transaction.find().sort({ date: -1 });
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Tambah Transaksi (Untuk Web)
app.post('/api/transactions', async (req, res) => {
    try {
        const { desc, amount, type, category } = req.body;
        const newTransaction = new Transaction({ desc, amount, type, category });
        await newTransaction.save();
        res.status(201).json(newTransaction);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ================= WEBHOOK TELEGRAM BOT =================
app.post(`/api/telegram-webhook`, async (req, res) => {
    res.sendStatus(200); // Segera beri respon 200 ke Telegram

    const update = req.body;
    if (!update.message) return;

    const chatId = String(update.message.chat.id);
    const text = update.message.text;
    const photo = update.message.photo;

    // Pengaman Whitelist: Hanya merespon ADMIN_TELEGRAM_ID Anda
    if (ADMIN_TELEGRAM_ID && chatId !== String(ADMIN_TELEGRAM_ID)) {
        await sendTelegramMessage(chatId, "⚠️ Maaf, bot pencatat keuangan pribadi ini terkunci.");
        return;
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

            let jsonText = rawTextResponse.trim().replace(/```json/g, '').replace(/```/g, '');
            const parsedData = JSON.parse(jsonText.substring(jsonText.indexOf('{'), jsonText.lastIndexOf('}') + 1));
            await saveAndNotify(parsedData, chatId);
        } 
        else if (text) {
            if (text.startsWith('/start')) {
                await sendTelegramMessage(chatId, "Halo! 🌱 Saku-Sloth Bot aktif dan aman. Kirim foto nota atau ketik catatan transaksi Anda!");
                return;
            }

            const prompt = `Analisis transaksi: "${text}". Ekstrak ke format JSON murni TANPA markdown:
            {"desc": "Keterangan singkat", "amount": angka saja, "type": "expense" atau "income", "category": pilih dari ["Makan & Minum", "Transportasi", "Langganan Digital", "Kesehatan & Self-Care", "Belanja & Lifestyle", "Tagihan & Utilitas", "Gaji Utama", "Side Hustle / Freelance", "Investasi & Dividen"]}`;

            const rawTextResponse = await callGeminiAPI(prompt);

            let jsonText = rawTextResponse.trim().replace(/```json/g, '').replace(/```/g, '');
            const parsedData = JSON.parse(jsonText.substring(jsonText.indexOf('{'), jsonText.lastIndexOf('}') + 1));
            await saveAndNotify(parsedData, chatId);
        }
    } catch (err) {
        console.error("Gagal memproses AI:", err.message || err);
        await sendTelegramMessage(chatId, "⚠️ Maaf, Gemini gagal membaca input Anda. Pastikan format teks atau foto jelas.");
    }
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server lokal di port ${PORT}`));
}

module.exports = app;