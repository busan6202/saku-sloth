const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

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

// Konfigurasi Telegram & Gemini AI
const TELEGRAM_BOT_TOKEN = '8909744436:AAHE6zdwMLlRpVo85IjJrxouA3IA9mW2YzU';

// Inisialisasi Google GenAI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Fungsi Kirim Pesan Balasan ke Telegram
async function sendTelegramMessage(chatId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
        });
    } catch (err) {
        console.error("Gagal kirim pesan Telegram:", err);
    }
}

// Fungsi Simpan Transaksi & Notifikasi
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

// API: Ambil Semua Transaksi untuk Web
app.get('/api/transactions', async (req, res) => {
    try {
        const transactions = await Transaction.find().sort({ date: -1 });
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Tambah Transaksi via Web
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
    res.sendStatus(200); // Respon cepat ke Telegram

    const update = req.body;
    if (!update.message) return;

    const chatId = update.message.chat.id;
    const text = update.message.text;
    const photo = update.message.photo;

    try {
        // 1. Jika pengguna mengirim FOTO (Nota / Struk Belanja)
        if (photo && photo.length > 0) {
            const fileId = photo[photo.length - 1].file_id;
            
            const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
            const fileData = await fileRes.json();
            const filePath = fileData.result.file_path;
            const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

            const imageRes = await fetch(downloadUrl);
            const arrayBuffer = await imageRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const base64Image = buffer.toString('base64');

            await sendTelegramMessage(chatId, "🔍 *Gemini sedang membaca nota Anda...* Mohon tunggu sebentar.");

            const prompt = `Analisis nota/struk belanja ini. Ekstrak data berikut ke dalam format JSON murni TANPA markdown block (tanpa backtick json):
            {
              "desc": "Nama tempat/toko atau ringkasan barang utama",
              "amount": total nominal angka saja (tanpa titik/koma/Rp),
              "type": "expense",
              "category": pilih salah satu dari: ["Makan & Minum", "Transportasi", "Langganan Digital", "Kesehatan & Self-Care", "Belanja & Lifestyle", "Tagihan & Utilitas"]
            }`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: 'image/jpeg',
                                    data: base64Image
                                }
                            }
                        ]
                    }
                ]
            });

            let jsonText = response.text.trim();
            jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
            const firstBrace = jsonText.indexOf('{');
            const lastBrace = jsonText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                jsonText = jsonText.substring(firstBrace, lastBrace + 1);
            }

            const parsedData = JSON.parse(jsonText);
            await saveAndNotify(parsedData, chatId);
        } 
        // 2. Jika pengguna mengirim TEKS
        else if (text) {
            if (text.startsWith('/start')) {
                await sendTelegramMessage(chatId, "Halo! 🌱 Selamat datang di Saku-Sloth Bot. Kirim foto nota belanja atau ketik catatan keuangan Anda (contoh: *Beli makan siang 35ribu*), dan Gemini akan mencatatnya otomatis!");
                return;
            }

            const prompt = `Analisis kalimat transaksi keuangan berikut: "${text}". Ekstrak ke format JSON murni TANPA markdown block (tanpa backtick json):
            {
              "desc": "Keterangan singkat transaksi",
              "amount": total nominal berupa angka saja (contoh: 20000),
              "type": "expense" atau "income",
              "category": pilih salah satu dari: ["Makan & Minum", "Transportasi", "Langganan Digital", "Kesehatan & Self-Care", "Belanja & Lifestyle", "Tagihan & Utilitas", "Gaji Utama", "Side Hustle / Freelance", "Investasi & Dividen"]
            }`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt
            });

            let jsonText = response.text.trim();
            jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
            const firstBrace = jsonText.indexOf('{');
            const lastBrace = jsonText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                jsonText = jsonText.substring(firstBrace, lastBrace + 1);
            }

            const parsedData = JSON.parse(jsonText);
            await saveAndNotify(parsedData, chatId);
        }
    } catch (err) {
        console.error("Gagal memproses AI Telegram:", err);
        await sendTelegramMessage(chatId, "⚠️ Maaf, Gemini gagal membaca atau memahami input Anda. Pastikan format teks jelas atau foto nota terlihat terang.");
    }
});

// Jalankan Server untuk Lokal & Vercel Export
const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server lokal berjalan di port ${PORT}`);
    });
}

module.exports = app;