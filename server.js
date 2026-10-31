const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

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

// Inisialisasi Tabel Transaksi + Kolom Wallet + Tabel Sesi Edit Telegram
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                "desc" TEXT NOT NULL,
                amount NUMERIC NOT NULL,
                type VARCHAR(20) NOT NULL,
                category VARCHAR(100) DEFAULT 'Umum',
                wallet VARCHAR(80) DEFAULT 'Tunai',
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            ALTER TABLE transactions
            ADD COLUMN IF NOT EXISTS wallet VARCHAR(80) DEFAULT 'Tunai'
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS telegram_edit_sessions (
                chat_id VARCHAR(64) PRIMARY KEY,
                trx_id INTEGER NOT NULL,
                field VARCHAR(40) NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Berhasil terhubung ke Neon PostgreSQL & sinkronisasi skema Wallet/Edit! 🐘");
    } catch (err) {
        console.error("Gagal inisialisasi database Neon:", err);
    }
}
initDatabase();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8584715332:AAEF5F54-ipvf8vQGH-Eh7bqrYZYCIuLHjQ';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const POPULAR_WALLETS = [
    { id: 'GoPay', label: '💚 GoPay' },
    { id: 'DANA', label: '💙 DANA' },
    { id: 'OVO', label: '💜 OVO' },
    { id: 'ShopeePay', label: '🧡 ShopeePay' },
    { id: 'LinkAja', label: '❤️ LinkAja' },
    { id: 'QRIS', label: '📱 QRIS' },
    { id: 'Flip', label: '🧡 Flip' },
    { id: 'Tunai', label: '💵 Tunai' },
    { id: 'BCA', label: '🏦 BCA' },
    { id: 'Mandiri', label: '🏦 Mandiri' },
    { id: 'BRI', label: '🏦 BRI' },
    { id: 'BNI', label: '🏦 BNI' },
    { id: 'BSI', label: '🏦 BSI' },
    { id: 'CIMB Niaga', label: '🏦 CIMB Niaga' },
    { id: 'SeaBank', label: '🌊 SeaBank' },
    { id: 'Bank Jago', label: '🟡 Bank Jago' },
    { id: 'Blu BCA', label: '🩵 Blu BCA' },
    { id: 'Jenius', label: '💠 Jenius' }
];

const POPULAR_CATEGORIES = [
    'Makan & Minum',
    'Transportasi',
    'Belanja & Lifestyle',
    'Tagihan & Utilitas',
    'Rumah & Sewa',
    'Kesehatan',
    'Langganan Digital',
    'Tabungan & Investasi',
    'Gaji & Penghasilan',
    'Umum'
];

// Fallback in-memory untuk sesi edit Telegram
const memoryEditSessions = new Map();

async function setEditSession(chatId, trxId, field) {
    memoryEditSessions.set(String(chatId), { trxId: Number(trxId), field });
    try {
        await pool.query(
            `INSERT INTO telegram_edit_sessions (chat_id, trx_id, field, updated_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (chat_id) DO UPDATE SET trx_id = EXCLUDED.trx_id, field = EXCLUDED.field, updated_at = CURRENT_TIMESTAMP`,
            [String(chatId), Number(trxId), field]
        );
    } catch (e) {
        console.warn("Gagal simpan sesi edit di DB, gunakan memori:", e.message);
    }
}

async function getEditSession(chatId) {
    try {
        const res = await pool.query(`SELECT trx_id, field FROM telegram_edit_sessions WHERE chat_id = $1`, [String(chatId)]);
        if (res.rows.length > 0) {
            return { trxId: Number(res.rows[0].trx_id), field: res.rows[0].field };
        }
    } catch {
        // abaikan jika tabel belum siap
    }
    return memoryEditSessions.get(String(chatId)) || null;
}

async function clearEditSession(chatId) {
    memoryEditSessions.delete(String(chatId));
    try {
        await pool.query(`DELETE FROM telegram_edit_sessions WHERE chat_id = $1`, [String(chatId)]);
    } catch {
        // abaikan
    }
}

// Fungsi Kirim Pesan Telegram (Mendukung Inline Keyboard)
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    try {
        const payload = { chat_id: chatId, text, parse_mode: 'Markdown' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error("Gagal kirim pesan Telegram:", err.message);
    }
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
    try {
        const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            await sendTelegramMessage(chatId, text, replyMarkup);
        }
    } catch (err) {
        await sendTelegramMessage(chatId, text, replyMarkup);
    }
}

async function answerCallbackQuery(callbackQueryId, text = '') {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text })
        });
    } catch (err) {
        console.error("Gagal answerCallbackQuery:", err.message);
    }
}

function buildTransactionActionKeyboard(trxId) {
    return {
        inline_keyboard: [
            [
                { text: '✏️ Edit Transaksi', callback_data: `edit_menu:${trxId}` },
                { text: '👛 Ganti Wallet', callback_data: `edit_wallet_menu:${trxId}` }
            ],
            [
                { text: '📁 Ganti Kategori', callback_data: `edit_cat_menu:${trxId}` },
                { text: '🗑️ Hapus', callback_data: `del_trx:${trxId}` }
            ]
        ]
    };
}

function buildEditFieldKeyboard(trxId) {
    return {
        inline_keyboard: [
            [
                { text: '💰 Ubah Nominal', callback_data: `ask_amt:${trxId}` },
                { text: '📝 Ubah Keterangan', callback_data: `ask_desc:${trxId}` }
            ],
            [
                { text: '👛 Pilih Wallet / Bank', callback_data: `edit_wallet_menu:${trxId}` },
                { text: '📁 Pilih Kategori', callback_data: `edit_cat_menu:${trxId}` }
            ],
            [
                { text: '🔄 Ubah Tipe (Masuk/Keluar)', callback_data: `toggle_t:${trxId}` },
                { text: '🗑️ Hapus Transaksi', callback_data: `del_trx:${trxId}` }
            ]
        ]
    };
}

function buildWalletPickerKeyboard(trxId) {
    const rows = [];
    for (let i = 0; i < POPULAR_WALLETS.length; i += 3) {
        rows.push(
            POPULAR_WALLETS.slice(i, i + 3).map((w) => ({
                text: w.label,
                callback_data: `set_w:${trxId}:${w.id}`
            }))
        );
    }
    rows.push([{ text: '⬅️ Kembali ke Menu Edit', callback_data: `edit_menu:${trxId}` }]);
    return { inline_keyboard: rows };
}

function buildCategoryPickerKeyboard(trxId) {
    const rows = [];
    for (let i = 0; i < POPULAR_CATEGORIES.length; i += 2) {
        rows.push(
            POPULAR_CATEGORIES.slice(i, i + 2).map((cat, idx) => ({
                text: cat,
                callback_data: `set_c:${trxId}:${i + idx}`
            }))
        );
    }
    rows.push([{ text: '⬅️ Kembali ke Menu Edit', callback_data: `edit_menu:${trxId}` }]);
    return { inline_keyboard: rows };
}

function formatTrxDetailMessage(trx, headerTitle = '✅ *DETAIL TRANSAKSI SAKU HARIAN*') {
    const symbol = trx.type === 'income' ? '🟢 PEMASUKAN' : '🔴 PENGELUARAN';
    const sign = trx.type === 'income' ? '+' : '-';
    const formattedAmount = Number(trx.amount || 0).toLocaleString('id-ID');
    return `
${headerTitle}
-----------------------------------
🆔 *ID Transaksi:* #${trx.id}
${symbol}
📝 *Keterangan:* ${trx.desc}
📁 *Kategori:* ${trx.category || 'Umum'}
👛 *Kantong Dana:* ${trx.wallet || 'Tunai'}
💰 *Nominal:* ${sign} Rp ${formattedAmount}
    `.trim();
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
async function saveAndNotify(trxData, chatId) {
    const walletName = trxData.wallet || 'Tunai';
    const query = `INSERT INTO transactions ("desc", amount, type, category, wallet) VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const values = [trxData.desc, trxData.amount, trxData.type, trxData.category || 'Umum', walletName];

    const result = await pool.query(query, values);
    const savedTrx = result.rows[0];

    const resIncome = await pool.query("SELECT SUM(amount) as total FROM transactions WHERE type = 'income'");
    const resExpense = await pool.query("SELECT SUM(amount) as total FROM transactions WHERE type = 'expense'");
    const totalIncome = Number(resIncome.rows[0].total || 0);
    const totalExpense = Number(resExpense.rows[0].total || 0);
    const balance = totalIncome - totalExpense;

    let financialAdvice = "";
    if (totalExpense > totalIncome) {
        financialAdvice = "\n🚨 *WARNING SAKU HARIAN:* Pengeluaran Anda sudah melewati total pemasukan! Harap lebih berhemat.";
    } else if (totalIncome > 0 && totalExpense / totalIncome > 0.8) {
        financialAdvice = "\n⚠️ *WARNING SAKU HARIAN:* Rasio pengeluaran Anda sudah di atas 80% dari pemasukan.";
    } else {
        financialAdvice = "\n💚 *STATUS:* Keuangan Anda sehat dan terkontrol dengan baik!";
    }

    const message = `
${formatTrxDetailMessage(savedTrx, '✅ *BERHASIL DICATAT OLEH SAKU HARIAN*')}
-----------------------------------
💳 *Saldo Berjalan:* Rp ${balance.toLocaleString('id-ID')}
${financialAdvice}
_Klik tombol di bawah kapan saja jika ingin mengedit transaksi atau mengganti kantong dana:_
    `.trim();

    await sendTelegramMessage(chatId, message, buildTransactionActionKeyboard(savedTrx.id));
}

// ================= REST API UNTUK WEB APP =================

// API: Ambil Semua Transaksi
app.get('/api/transactions', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM transactions ORDER BY date DESC, id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Tambah Transaksi Baru
app.post('/api/transactions', async (req, res) => {
    try {
        const { desc, amount, type, category, wallet, date } = req.body;
        const parsedDate = date && !Number.isNaN(new Date(date).getTime()) ? new Date(date) : new Date();
        const query = `INSERT INTO transactions ("desc", amount, type, category, wallet, date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
        const values = [desc, amount, type, category || 'Umum', wallet || 'Tunai', parsedDate];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// API: Edit / Update Transaksi Kapan Saja
app.put('/api/transactions/:id', async (req, res) => {
    try {
        const trxId = Number(req.params.id);
        if (!Number.isFinite(trxId)) return res.status(400).json({ error: 'ID transaksi tidak valid.' });

        const existingRes = await pool.query('SELECT * FROM transactions WHERE id = $1', [trxId]);
        if (existingRes.rows.length === 0) {
            return res.status(404).json({ error: 'Transaksi tidak ditemukan di server.' });
        }
        const current = existingRes.rows[0];

        const nextDesc = req.body.desc !== undefined ? String(req.body.desc).trim() : current.desc;
        const nextAmount = req.body.amount !== undefined ? Number(req.body.amount) : Number(current.amount);
        const nextType = req.body.type !== undefined ? String(req.body.type) : current.type;
        const nextCategory = req.body.category !== undefined ? String(req.body.category).trim() : current.category;
        const nextWallet = req.body.wallet !== undefined ? String(req.body.wallet).trim() : (current.wallet || 'Tunai');
        const nextDate = req.body.date && !Number.isNaN(new Date(req.body.date).getTime())
            ? new Date(req.body.date)
            : current.date;

        const updateQuery = `
            UPDATE transactions
            SET "desc" = $1, amount = $2, type = $3, category = $4, wallet = $5, date = $6
            WHERE id = $7
            RETURNING *
        `;
        const updated = await pool.query(updateQuery, [
            nextDesc,
            nextAmount,
            nextType,
            nextCategory || 'Umum',
            nextWallet || 'Tunai',
            nextDate,
            trxId
        ]);

        res.json(updated.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// API: Hapus Transaksi
app.delete('/api/transactions/:id', async (req, res) => {
    try {
        const trxId = Number(req.params.id);
        if (!Number.isFinite(trxId)) return res.status(400).json({ error: 'ID transaksi tidak valid.' });
        await pool.query('DELETE FROM transactions WHERE id = $1', [trxId]);
        res.json({ success: true, id: trxId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// API: Export Google Sheets (CSV/TSV)
app.get('/api/export-googlesheet', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, "desc", amount, type, category, wallet, date FROM transactions ORDER BY date DESC');
        let csvContent = "\uFEFFID,Keterangan,Nominal,Tipe,Kategori,Kantong Dana,Tanggal\n";
        result.rows.forEach(row => {
            const desc = `"${String(row.desc || '').replace(/"/g, '""')}"`;
            csvContent += `${row.id},${desc},${row.amount},${row.type === 'income' ? 'Pemasukan' : 'Pengeluaran'},"${row.category}","${row.wallet || 'Tunai'}","${row.date}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="saku-smart-planner-googlesheets.csv"');
        res.status(200).send(csvContent);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Export Excel (CSV)
app.get('/api/export-excel', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, "desc", amount, type, category, wallet, date FROM transactions ORDER BY date DESC');
        let csvContent = "ID,Keterangan,Nominal,Tipe,Kategori,Kantong Dana,Tanggal\n";
        result.rows.forEach(row => {
            const desc = `"${String(row.desc || '').replace(/"/g, '""')}"`;
            csvContent += `${row.id},${desc},${row.amount},${row.type === 'income' ? 'Pemasukan' : 'Pengeluaran'},"${row.category}","${row.wallet || 'Tunai'}","${row.date}"\n`;
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

    // 1. HANDLE TOMBOL OPSI PILIHAN (CALLBACK QUERY) UNTUK EDIT TRANSAKSI & WALLET
    if (update.callback_query) {
        const cb = update.callback_query;
        const chatId = String(cb.message?.chat?.id || '');
        const messageId = cb.message?.message_id;
        const data = String(cb.data || '');

        if (ADMIN_TELEGRAM_ID && chatId !== String(ADMIN_TELEGRAM_ID)) {
            await answerCallbackQuery(cb.id, 'Akses terkunci');
            return res.sendStatus(200);
        }

        try {
            const parts = data.split(':');
            const action = parts[0];
            const trxId = Number(parts[1]);

            if (action === 'edit_menu') {
                const resTrx = await pool.query('SELECT * FROM transactions WHERE id = $1', [trxId]);
                if (!resTrx.rows.length) {
                    await answerCallbackQuery(cb.id, 'Transaksi tidak ditemukan');
                    return res.sendStatus(200);
                }
                const trx = resTrx.rows[0];
                await answerCallbackQuery(cb.id, 'Pilih bagian yang ingin diedit');
                await editTelegramMessage(
                    chatId,
                    messageId,
                    `${formatTrxDetailMessage(trx, '✏️ *MODE EDIT TRANSAKSI*')}\n\n👇 *Pilih bagian yang ingin Anda ubah:*`,
                    buildEditFieldKeyboard(trxId)
                );
                return res.sendStatus(200);
            }

            if (action === 'edit_wallet_menu') {
                await answerCallbackQuery(cb.id, 'Pilih Kantong Dana / Wallet');
                await editTelegramMessage(
                    chatId,
                    messageId,
                    `👛 *PILIH KANTONG DANA / WALLET (#${trxId})*\nKlik salah satu Bank atau E-Wallet di bawah ini:`,
                    buildWalletPickerKeyboard(trxId)
                );
                return res.sendStatus(200);
            }

            if (action === 'set_w') {
                const newWallet = parts.slice(2).join(':') || 'Tunai';
                const updated = await pool.query(
                    'UPDATE transactions SET wallet = $1 WHERE id = $2 RETURNING *',
                    [newWallet, trxId]
                );
                await answerCallbackQuery(cb.id, `Wallet diubah ke ${newWallet}!`);
                if (updated.rows.length) {
                    await editTelegramMessage(
                        chatId,
                        messageId,
                        formatTrxDetailMessage(updated.rows[0], `✅ *WALLET DIUBAH KE ${newWallet.toUpperCase()}*`),
                        buildTransactionActionKeyboard(trxId)
                    );
                }
                return res.sendStatus(200);
            }

            if (action === 'edit_cat_menu') {
                await answerCallbackQuery(cb.id, 'Pilih Kategori');
                await editTelegramMessage(
                    chatId,
                    messageId,
                    `📁 *PILIH KATEGORI TRANSAKSI (#${trxId})*\nKlik kategori yang sesuai di bawah ini:`,
                    buildCategoryPickerKeyboard(trxId)
                );
                return res.sendStatus(200);
            }

            if (action === 'set_c') {
                const catIdx = Number(parts[2]);
                const newCat = POPULAR_CATEGORIES[catIdx] || 'Umum';
                const updated = await pool.query(
                    'UPDATE transactions SET category = $1 WHERE id = $2 RETURNING *',
                    [newCat, trxId]
                );
                await answerCallbackQuery(cb.id, `Kategori diubah ke ${newCat}!`);
                if (updated.rows.length) {
                    await editTelegramMessage(
                        chatId,
                        messageId,
                        formatTrxDetailMessage(updated.rows[0], `✅ *KATEGORI DIUBAH KE ${newCat.toUpperCase()}*`),
                        buildTransactionActionKeyboard(trxId)
                    );
                }
                return res.sendStatus(200);
            }

            if (action === 'toggle_t') {
                const resTrx = await pool.query('SELECT * FROM transactions WHERE id = $1', [trxId]);
                if (resTrx.rows.length) {
                    const nextType = resTrx.rows[0].type === 'income' ? 'expense' : 'income';
                    const updated = await pool.query(
                        'UPDATE transactions SET type = $1 WHERE id = $2 RETURNING *',
                        [nextType, trxId]
                    );
                    await answerCallbackQuery(cb.id, `Tipe diubah!`);
                    await editTelegramMessage(
                        chatId,
                        messageId,
                        formatTrxDetailMessage(updated.rows[0], '✅ *TIPE TRANSAKSI BERHASIL DIUBAH*'),
                        buildTransactionActionKeyboard(trxId)
                    );
                }
                return res.sendStatus(200);
            }

            if (action === 'ask_amt') {
                await setEditSession(chatId, trxId, 'amount');
                await answerCallbackQuery(cb.id, 'Ketik nominal baru');
                await sendTelegramMessage(
                    chatId,
                    `💰 *UBAH NOMINAL TRANSAKSI #${trxId}*\nSilakan balas pesan ini dengan mengetikkan *nominal baru* (angka saja, contoh: \`45000\`), atau ketik /batal untuk membatalkan.`
                );
                return res.sendStatus(200);
            }

            if (action === 'ask_desc') {
                await setEditSession(chatId, trxId, 'desc');
                await answerCallbackQuery(cb.id, 'Ketik keterangan baru');
                await sendTelegramMessage(
                    chatId,
                    `📝 *UBAH KETERANGAN TRANSAKSI #${trxId}*\nSilakan balas pesan ini dengan mengetikkan *keterangan baru*, atau ketik /batal untuk membatalkan.`
                );
                return res.sendStatus(200);
            }

            if (action === 'del_trx') {
                await pool.query('DELETE FROM transactions WHERE id = $1', [trxId]);
                await answerCallbackQuery(cb.id, 'Transaksi dihapus');
                await editTelegramMessage(chatId, messageId, `🗑️ *Transaksi #${trxId} telah dihapus.*`);
                return res.sendStatus(200);
            }
        } catch (err) {
            console.error("Callback Query Error:", err);
            await answerCallbackQuery(cb.id, 'Terjadi kesalahan');
        }
        return res.sendStatus(200);
    }

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
        // CEK APAKAH USER SEDANG DALAM SESI EDIT NOMINAL / KETERANGAN
        if (text && !text.startsWith('/')) {
            const activeSession = await getEditSession(chatId);
            if (activeSession) {
                if (activeSession.field === 'amount') {
                    const cleanedNum = Number(String(text).replace(/[^0-9]/g, ''));
                    if (Number.isFinite(cleanedNum) && cleanedNum > 0) {
                        const updated = await pool.query(
                            'UPDATE transactions SET amount = $1 WHERE id = $2 RETURNING *',
                            [cleanedNum, activeSession.trxId]
                        );
                        await clearEditSession(chatId);
                        if (updated.rows.length) {
                            await sendTelegramMessage(
                                chatId,
                                formatTrxDetailMessage(updated.rows[0], '✅ *NOMINAL BERHASIL DIPERBARUI*'),
                                buildTransactionActionKeyboard(activeSession.trxId)
                            );
                            return res.sendStatus(200);
                        }
                    }
                } else if (activeSession.field === 'desc') {
                    const updated = await pool.query(
                        'UPDATE transactions SET "desc" = $1 WHERE id = $2 RETURNING *',
                        [text.trim(), activeSession.trxId]
                    );
                    await clearEditSession(chatId);
                    if (updated.rows.length) {
                        await sendTelegramMessage(
                            chatId,
                            formatTrxDetailMessage(updated.rows[0], '✅ *KETERANGAN BERHASIL DIPERBARUI*'),
                            buildTransactionActionKeyboard(activeSession.trxId)
                        );
                        return res.sendStatus(200);
                    }
                }
            }
        }

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
            {"desc": "Nama tempat/ringkasan", "amount": angka saja, "type": "expense", "category": "Kategori bebas", "wallet": "GoPay/DANA/OVO/ShopeePay/LinkAja/BCA/Mandiri/BRI/BNI/Tunai"}`;

            const rawText = await callGeminiAPI(prompt, base64Image);
            let parsed = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
            await saveAndNotify(parsed, chatId);
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
            {"desc": "Keterangan singkat", "amount": angka saja, "type": "expense" atau "income", "category": "Kategori bebas", "wallet": "GoPay/DANA/OVO/ShopeePay/LinkAja/BCA/Mandiri/BRI/BNI/SeaBank/Bank Jago/Tunai"}`;

            const rawText = await callGeminiAudioAPI(prompt, base64Audio);
            let parsed = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
            await saveAndNotify(parsed, chatId);
        }
        // 3. PESAN TEKS / PERINTAH / KONSULTASI
        else if (text) {
            if (text.startsWith('/batal')) {
                await clearEditSession(chatId);
                await sendTelegramMessage(chatId, "✅ Mode edit telah dibatalkan.");
                return res.sendStatus(200);
            }

            if (text.startsWith('/start')) {
                await sendTelegramMessage(chatId, `
💰 *Halo! Selamat datang di Saku Harian Smart Planner Bot.*
Kirim foto nota, *Voice Note*, atau ketik transaksi beserta kantong dana/wallet Anda (Contoh: *"Beli kopi 25rb pakai GoPay"* atau *"Gaji masuk 8jt ke BCA"*).

✨ *Fitur Baru:*
• Setiap transaksi bisa *diedit kapan saja* melalui tombol opsi pilihan!
• Mendukung berbagai kantong dana: *GoPay, DANA, OVO, ShopeePay, LinkAja, BCA, Mandiri, BRI, BNI, SeaBank, Bank Jago, Tunai*, dll.

📋 *Perintah:*
/edit — Pilih & edit transaksi kapan saja
/dompet — Cek saldo per Kantong Dana / E-Wallet
/history — Riwayat transaksi & tombol edit
/saldo — Rekap total saldo
/reset — Hapus semua data
                `.trim());
                return res.sendStatus(200);
            }

            if (text.startsWith('/dompet') || text.startsWith('/wallet')) {
                const result = await pool.query(`
                    SELECT COALESCE(wallet, 'Tunai') as wallet,
                           SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as pemasukan,
                           SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as pengeluaran
                    FROM transactions
                    GROUP BY COALESCE(wallet, 'Tunai')
                    ORDER BY (SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)) DESC
                `);
                if (!result.rows.length) {
                    await sendTelegramMessage(chatId, "👛 Belum ada aktivitas di kantong dana Anda.");
                    return res.sendStatus(200);
                }
                let msg = "👛 *SALDO PER KANTONG DANA / E-WALLET*\n-----------------------------------\n";
                result.rows.forEach((r) => {
                    const net = Number(r.pemasukan || 0) - Number(r.pengeluaran || 0);
                    msg += `• *${r.wallet}:* Rp ${net.toLocaleString('id-ID')} _(Masuk: +Rp ${Number(r.pemasukan || 0).toLocaleString('id-ID')} | Keluar: -Rp ${Number(r.pengeluaran || 0).toLocaleString('id-ID')})_\n`;
                });
                await sendTelegramMessage(chatId, msg);
                return res.sendStatus(200);
            }

            if (text.startsWith('/saldo') || text.startsWith('/rekap')) {
                const resIncome = await pool.query("SELECT SUM(amount) as total FROM transactions WHERE type = 'income'");
                const resExpense = await pool.query("SELECT SUM(amount) as total FROM transactions WHERE type = 'expense'");
                const totalIncome = Number(resIncome.rows[0].total || 0);
                const totalExpense = Number(resExpense.rows[0].total || 0);
                const balance = totalIncome - totalExpense;

                await sendTelegramMessage(chatId, `📊 *REKAP KEUANGAN SAKU HARIAN*\n🟢 Pemasukan: Rp ${totalIncome.toLocaleString('id-ID')}\n🔴 Pengeluaran: Rp ${totalExpense.toLocaleString('id-ID')}\n💰 *Saldo Bersih:* Rp ${balance.toLocaleString('id-ID')}\n\nKetik /dompet untuk melihat rincian per Bank/E-Wallet atau /edit untuk mengubah transaksi.`);
                return res.sendStatus(200);
            }

            if (text.startsWith('/history') || text.startsWith('/riwayat') || text.startsWith('/edit')) {
                const result = await pool.query("SELECT * FROM transactions ORDER BY date DESC, id DESC LIMIT 6");
                if (result.rows.length === 0) {
                    await sendTelegramMessage(chatId, "📂 Belum ada catatan transaksi yang bisa ditampilkan.");
                    return res.sendStatus(200);
                }
                let msg = "📜 *PILIH TRANSAKSI UNTUK DIEDIT KAPAN SAJA*\n-----------------------------------\n";
                const buttons = [];
                result.rows.forEach((t, i) => {
                    const sign = t.type === 'income' ? '+' : '-';
                    const wallet = t.wallet || 'Tunai';
                    msg += `${i + 1}. *#${t.id} ${t.desc}* (${t.category} · 👛 ${wallet}) — ${sign}Rp ${Number(t.amount).toLocaleString('id-ID')}\n`;
                    buttons.push([
                        {
                            text: `✏️ Edit #${t.id}: ${String(t.desc).slice(0, 18)} (Rp ${Number(t.amount).toLocaleString('id-ID')})`,
                            callback_data: `edit_menu:${t.id}`
                        }
                    ]);
                });
                msg += "\n👇 _Tekan tombol transaksi di bawah ini untuk mengubah nominal, keterangan, kategori, atau wallet:_";
                await sendTelegramMessage(chatId, msg, { inline_keyboard: buttons });
                return res.sendStatus(200);
            }

            if (text.startsWith('/reset')) {
                await pool.query("DELETE FROM transactions");
                await sendTelegramMessage(chatId, "🗑️ *Reset Berhasil!* Semua data keuangan dibersihkan.");
                return res.sendStatus(200);
            }

            const checkPrompt = `Analisis pesan user: "${text}".
            Daftar wallet/bank populer: GoPay, DANA, OVO, ShopeePay, LinkAja, BCA, Mandiri, BRI, BNI, BSI, SeaBank, Bank Jago, Blu BCA, Tunai.
            Jika pesan ini adalah perintah mencatat transaksi uang, balas HANYA format JSON:
            {"isTransaction": true, "desc": "...", "amount": angka, "type": "expense/income", "category": "...", "wallet": "nama wallet/bank jika disebutkan atau Tunai"}
            Jika pesan ini adalah pertanyaan, konsultasi, atau ngobrol (bukan transaksi), balas HANYA format JSON:
            {"isTransaction": false, "reply": "Jawaban Saku Harian sebagai asisten keuangan yang cerdas dan bijak"}`;

            const aiResp = await callGeminiAPI(checkPrompt);
            let cleanedJson = aiResp.replace(/```json/g, '').replace(/```/g, '').trim();
            const firstOpen = cleanedJson.indexOf('{');
            const lastClose = cleanedJson.lastIndexOf('}');
            if (firstOpen !== -1 && lastClose !== -1) cleanedJson = cleanedJson.substring(firstOpen, lastClose + 1);

            const parsed = JSON.parse(cleanedJson);

            if (parsed.isTransaction) {
                await saveAndNotify(parsed, chatId);
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
