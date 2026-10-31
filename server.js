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

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8584715332:AAEF5F54-ipvf8vQGH-Eh7bqrYZYCIuLHjQ';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Daftar Menu Perintah Resmi di Tombol Menu (/) Telegram
const TELEGRAM_BOT_COMMANDS = [
    { command: 'menu', description: '🧭 Buka Menu Utama (Tombol Tanpa Ketik)' },
    { command: 'pemasukan', description: '🟢 ➕ Catat Pemasukan Cepat (Pilih Tombol)' },
    { command: 'pengeluaran', description: '🔴 ➖ Catat Pengeluaran Cepat (Pilih Tombol)' },
    { command: 'saldo', description: '💰 Cek Saldo Berjalan & Rekap Keuangan' },
    { command: 'dompet', description: '👛 Cek Saldo per E-Wallet & Bank' },
    { command: 'edit', description: '✏️ Riwayat & Edit Transaksi Kapan Saja' },
    { command: 'reset', description: '🔄 Hapus Saldo Berjalan / Reset Kembali ke Semula' }
];

async function setupTelegramBotCommands() {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
            body: JSON.stringify({ commands: TELEGRAM_BOT_COMMANDS })
        });
    } catch (err) {
        console.warn("Gagal setMyCommands Telegram:", err.message);
    }
}

// Inisialisasi Tabel Transaksi + Kolom Wallet + Tabel Sesi Edit/Wizard Telegram
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
                payload TEXT DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            ALTER TABLE telegram_edit_sessions
            ADD COLUMN IF NOT EXISTS payload TEXT DEFAULT '{}'
        `);
        console.log("Berhasil terhubung ke Neon PostgreSQL & sinkronisasi skema Wallet/Menu! 🐘");
        setupTelegramBotCommands();
    } catch (err) {
        console.error("Gagal inisialisasi database Neon:", err);
    }
}
initDatabase();

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

// Pilihan Cepat Tanpa Ketik untuk Pengeluaran & Pemasukan
const EXPENSE_QUICK_ITEMS = [
    { icon: '🍜', label: '🍜 Makan & Minum', desc: 'Makan & Minum', category: 'Makan & Minum' },
    { icon: '☕', label: '☕ Ngopi & Jajan', desc: 'Ngopi & Jajan', category: 'Makan & Minum' },
    { icon: '🛵', label: '🛵 Transport & BBM', desc: 'Transportasi & BBM', category: 'Transportasi' },
    { icon: '🛒', label: '🛒 Belanja Harian', desc: 'Belanja Harian', category: 'Belanja & Lifestyle' },
    { icon: '⚡', label: '⚡ Listrik & Tagihan', desc: 'Bayar Tagihan & Utilitas', category: 'Tagihan & Utilitas' },
    { icon: '🏠', label: '🏠 Rumah & Kos', desc: 'Kebutuhan Rumah / Kos', category: 'Rumah & Sewa' },
    { icon: '💊', label: '💊 Kesehatan & Obat', desc: 'Kesehatan & Obat', category: 'Kesehatan' },
    { icon: '📱', label: '📱 Kuota & Langganan', desc: 'Kuota & Langganan Digital', category: 'Langganan Digital' },
    { icon: '📦', label: '📦 Pengeluaran Lain', desc: 'Pengeluaran Umum', category: 'Umum' }
];

const INCOME_QUICK_ITEMS = [
    { icon: '💼', label: '💼 Gaji Bulanan', desc: 'Gaji Bulanan', category: 'Gaji & Penghasilan' },
    { icon: '🎁', label: '🎁 Bonus & THR', desc: 'Bonus & Tunjangan', category: 'Gaji & Penghasilan' },
    { icon: '💻', label: '💻 Freelance / Proyek', desc: 'Pendapatan Freelance / Proyek', category: 'Gaji & Penghasilan' },
    { icon: '🏪', label: '🏪 Hasil Usaha / Dagang', desc: 'Hasil Usaha & Penjualan', category: 'Gaji & Penghasilan' },
    { icon: '🏦', label: '🏦 Transfer Masuk', desc: 'Transfer Dana Masuk', category: 'Gaji & Penghasilan' },
    { icon: '📈', label: '📈 Cashback & Investasi', desc: 'Cashback / Return Investasi', category: 'Tabungan & Investasi' },
    { icon: '✨', label: '✨ Pemasukan Lain', desc: 'Pemasukan Lainnya', category: 'Umum' }
];

const EXPENSE_QUICK_NOMINALS = [
    { label: '💵 10rb', value: 10000 },
    { label: '💵 15rb', value: 15000 },
    { label: '💵 20rb', value: 20000 },
    { label: '💵 25rb', value: 25000 },
    { label: '💵 35rb', value: 35000 },
    { label: '💵 50rb', value: 50000 },
    { label: '💵 75rb', value: 75000 },
    { label: '💵 100rb', value: 100000 },
    { label: '💵 150rb', value: 150000 },
    { label: '💵 250rb', value: 250000 },
    { label: '💵 500rb', value: 500000 }
];

const INCOME_QUICK_NOMINALS = [
    { label: '💰 50rb', value: 50000 },
    { label: '💰 100rb', value: 100000 },
    { label: '💰 250rb', value: 250000 },
    { label: '💰 500rb', value: 500000 },
    { label: '💰 1 Juta', value: 1000000 },
    { label: '💰 2,5 Juta', value: 2500000 },
    { label: '💰 5 Juta', value: 5000000 },
    { label: '💰 10 Juta', value: 10000000 }
];

// Keyboard Menu Permanen di Bagian Bawah Layar Chat Telegram (Tanpa Perlu Ketik)
const PERSISTENT_REPLY_KEYBOARD = {
    keyboard: [
        [
            { text: '🟢 ➕ Pemasukan' },
            { text: '🔴 ➖ Pengeluaran' }
        ],
        [
            { text: '💰 Cek Saldo' },
            { text: '👛 Saldo E-Wallet' }
        ],
        [
            { text: '📜 Riwayat & Edit' },
            { text: '🔄 Reset Saldo / Data' }
        ],
        [
            { text: '🧭 Menu Utama' },
            { text: '💡 Tips Hemat AI' }
        ]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Pilih tombol menu atau ketik: saldo / transaksi...'
};

// Fallback in-memory untuk sesi edit/wizard Telegram
const memoryEditSessions = new Map();

async function setEditSession(chatId, trxId, field, payloadObj = {}) {
    const payloadStr = JSON.stringify(payloadObj || {});
    memoryEditSessions.set(String(chatId), { trxId: Number(trxId), field, payload: payloadObj || {} });
    try {
        await pool.query(
            `INSERT INTO telegram_edit_sessions (chat_id, trx_id, field, payload, updated_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             ON CONFLICT (chat_id) DO UPDATE
             SET trx_id = EXCLUDED.trx_id, field = EXCLUDED.field, payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP`,
            [String(chatId), Number(trxId), field, payloadStr]
        );
    } catch (e) {
        console.warn("Gagal simpan sesi di DB, gunakan memori:", e.message);
    }
}

async function getEditSession(chatId) {
    try {
        const res = await pool.query(`SELECT trx_id, field, payload FROM telegram_edit_sessions WHERE chat_id = $1`, [String(chatId)]);
        if (res.rows.length > 0) {
            let parsedPayload = {};
            try {
                parsedPayload = JSON.parse(res.rows[0].payload || '{}');
            } catch {
                parsedPayload = {};
            }
            return { trxId: Number(res.rows[0].trx_id), field: res.rows[0].field, payload: parsedPayload };
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

// Fungsi Kirim Pesan Telegram (Otomatis menyertakan Menu Keyboard Bawah jika tidak ada Inline Keyboard)
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    try {
        const payload = {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup || PERSISTENT_REPLY_KEYBOARD
        };
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

// ================= BUILDER MENU & KEYBOARD INTERAKTIF TELEGRAM =================

function buildMainMenuInlineKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '🟢 ➕ Catat Pemasukan', callback_data: 'qa_start:inc' },
                { text: '🔴 ➖ Catat Pengeluaran', callback_data: 'qa_start:exp' }
            ],
            [
                { text: '💰 Cek Saldo Berjalan', callback_data: 'menu_act:saldo' },
                { text: '👛 Saldo E-Wallet & Bank', callback_data: 'menu_act:dompet' }
            ],
            [
                { text: '📜 Riwayat & Edit Transaksi', callback_data: 'menu_act:history' },
                { text: '💡 Tips Hemat Planner', callback_data: 'menu_act:tips' }
            ],
            [
                { text: '🔄 Hapus Saldo Berjalan / Reset Semula', callback_data: 'menu_act:reset_prompt' }
            ]
        ]
    };
}

function buildQuickCategoryKeyboard(typeKey) {
    const items = typeKey === 'inc' ? INCOME_QUICK_ITEMS : EXPENSE_QUICK_ITEMS;
    const rows = [];
    for (let i = 0; i < items.length; i += 2) {
        rows.push(
            items.slice(i, i + 2).map((item, idx) => ({
                text: item.label,
                callback_data: `qa_cat:${typeKey}:${i + idx}`
            }))
        );
    }
    rows.push([
        {
            text: typeKey === 'inc' ? '🔴 Ganti ke Pengeluaran' : '🟢 Ganti ke Pemasukan',
            callback_data: `qa_start:${typeKey === 'inc' ? 'exp' : 'inc'}`
        },
        { text: '⬅️ Menu Utama', callback_data: 'menu_act:main' }
    ]);
    return { inline_keyboard: rows };
}

function buildQuickNominalKeyboard(typeKey, itemIdx) {
    const nominals = typeKey === 'inc' ? INCOME_QUICK_NOMINALS : EXPENSE_QUICK_NOMINALS;
    const rows = [];
    for (let i = 0; i < nominals.length; i += 3) {
        rows.push(
            nominals.slice(i, i + 3).map((nom) => ({
                text: nom.label,
                callback_data: `qa_amt:${typeKey}:${itemIdx}:${nom.value}`
            }))
        );
    }
    rows.push([
        { text: '⌨️ Ketik Nominal Sendiri', callback_data: `qa_type_amt:${typeKey}:${itemIdx}` }
    ]);
    rows.push([
        { text: '⬅️ Pilih Kategori Lain', callback_data: `qa_start:${typeKey}` },
        { text: '🧭 Menu Utama', callback_data: 'menu_act:main' }
    ]);
    return { inline_keyboard: rows };
}

function buildQuickWalletKeyboard(typeKey, itemIdx, amount) {
    const rows = [];
    for (let i = 0; i < POPULAR_WALLETS.length; i += 3) {
        rows.push(
            POPULAR_WALLETS.slice(i, i + 3).map((w) => ({
                text: w.label,
                callback_data: `qa_save:${typeKey}:${itemIdx}:${amount}:${w.id}`
            }))
        );
    }
    rows.push([
        { text: '⬅️ Ubah Nominal', callback_data: `qa_cat:${typeKey}:${itemIdx}` },
        { text: '🧭 Menu Utama', callback_data: 'menu_act:main' }
    ]);
    return { inline_keyboard: rows };
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
            ],
            [
                { text: '🟢 ➕ Pemasukan', callback_data: 'qa_start:inc' },
                { text: '🔴 ➖ Pengeluaran', callback_data: 'qa_start:exp' }
            ],
            [
                { text: '💰 Cek Saldo', callback_data: 'menu_act:saldo' },
                { text: '🔄 Reset Saldo', callback_data: 'menu_act:reset_prompt' }
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
            ],
            [
                { text: '🧭 Kembali ke Menu Utama', callback_data: 'menu_act:main' }
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
                text: `📁 ${cat}`,
                callback_data: `set_c:${trxId}:${i + idx}`
            }))
        );
    }
    rows.push([{ text: '⬅️ Kembali ke Menu Edit', callback_data: `edit_menu:${trxId}` }]);
    return { inline_keyboard: rows };
}

function buildResetConfirmationKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '🗑️ Reset Semua ke Semula (Hapus Data -> Rp 0)', callback_data: 'reset_exec:all' }
            ],
            [
                { text: '🧹 Hapus Saldo Berjalan Saja (Nolkan -> Rp 0)', callback_data: 'reset_exec:zero' }
            ],
            [
                { text: '❌ Batal & Kembali ke Menu', callback_data: 'menu_act:main' }
            ]
        ]
    };
}

function formatTrxDetailMessage(trx, headerTitle = '✅ *DETAIL TRANSAKSI SAKU HARIAN*') {
    const symbol = trx.type === 'income' ? '🟢 PEMASUKAN' : '🔴 PENGELUARAN';
    const sign = trx.type === 'income' ? '+' : '-';
    const formattedAmount = Number(trx.amount || 0).toLocaleString('id-ID');
    return `
${headerTitle}
━━━━━━━━━━━━━━━━━━━
🆔 *ID Transaksi:* #${trx.id}
${symbol}
📝 *Keterangan:* ${trx.desc}
📁 *Kategori:* ${trx.category || 'Umum'}
👛 *Kantong Dana:* ${trx.wallet || 'Tunai'}
💰 *Nominal:* ${sign} Rp ${formattedAmount}
    `.trim();
}

async function getRunningBalanceSummary() {
    const resStats = await pool.query(`
        SELECT
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
            COUNT(*) AS total_count
        FROM transactions
    `);
    const row = resStats.rows[0] || {};
    const totalIncome = Number(row.total_income || 0);
    const totalExpense = Number(row.total_expense || 0);
    const totalCount = Number(row.total_count || 0);
    const balance = totalIncome - totalExpense;
    return { totalIncome, totalExpense, balance, totalCount };
}

async function buildSaldoMessageText() {
    const { totalIncome, totalExpense, balance, totalCount } = await getRunningBalanceSummary();
    const walletRes = await pool.query(`
        SELECT COALESCE(wallet, 'Tunai') as wallet,
               SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) as net
        FROM transactions
        GROUP BY COALESCE(wallet, 'Tunai')
        ORDER BY net DESC
        LIMIT 5
    `);

    let walletLines = '';
    if (walletRes.rows.length > 0) {
        walletLines = '\n👛 *Rincian Kantong Dana Teratas:*\n' + walletRes.rows.map((w) => {
            const netVal = Number(w.net || 0);
            const sign = netVal >= 0 ? '+' : '-';
            return `• *${w.wallet}:* ${sign}Rp ${Math.abs(netVal).toLocaleString('id-ID')}`;
        }).join('\n');
    }

    const statusIcon = balance > 0 ? '💚 Surplus Aman' : balance === 0 ? '⚖️ Saldo Nol (Rp 0)' : '🚨 Defisit (Pengeluaran > Pemasukan)';

    return `
💰 *SALDO BERJALAN & REKAP SAKU HARIAN*
━━━━━━━━━━━━━━━━━━━
🟢 *Total Pemasukan:* +Rp ${totalIncome.toLocaleString('id-ID')}
🔴 *Total Pengeluaran:* -Rp ${totalExpense.toLocaleString('id-ID')}
🧾 *Total Aktivitas:* ${totalCount} transaksi
━━━━━━━━━━━━━━━━━━━
💳 *SALDO BERJALAN:* *Rp ${balance.toLocaleString('id-ID')}*
📌 *Status:* ${statusIcon}
${walletLines}

👇 _Pilih tombol aksi cepat di bawah ini tanpa perlu ketik:_
    `.trim();
}

function buildSaldoInlineKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '🟢 ➕ Pemasukan', callback_data: 'qa_start:inc' },
                { text: '🔴 ➖ Pengeluaran', callback_data: 'qa_start:exp' }
            ],
            [
                { text: '👛 Semua Saldo E-Wallet', callback_data: 'menu_act:dompet' },
                { text: '📜 Riwayat & Edit', callback_data: 'menu_act:history' }
            ],
            [
                { text: '🔄 Hapus Saldo Berjalan / Reset Semula', callback_data: 'menu_act:reset_prompt' }
            ],
            [
                { text: '🧭 Menu Utama', callback_data: 'menu_act:main' }
            ]
        ]
    };
}

async function buildDompetMessageText() {
    const result = await pool.query(`
        SELECT COALESCE(wallet, 'Tunai') as wallet,
               SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as pemasukan,
               SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as pengeluaran
        FROM transactions
        GROUP BY COALESCE(wallet, 'Tunai')
        ORDER BY (SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)) DESC
    `);
    if (!result.rows.length) {
        return "👛 *SALDO PER KANTONG DANA / E-WALLET*\n━━━━━━━━━━━━━━━━━━━\nBelum ada aktivitas transaksi di kantong dana Anda.\n\n👇 Klik *🟢 ➕ Pemasukan* atau *🔴 ➖ Pengeluaran* di bawah untuk mulai mencatat!";
    }
    let msg = "👛 *SALDO PER KANTONG DANA / E-WALLET*\n━━━━━━━━━━━━━━━━━━━\n";
    result.rows.forEach((r) => {
        const inc = Number(r.pemasukan || 0);
        const exp = Number(r.pengeluaran || 0);
        const net = inc - exp;
        msg += `• *${r.wallet}:* *Rp ${net.toLocaleString('id-ID')}*\n   _(🟢 +Rp ${inc.toLocaleString('id-ID')} | 🔴 -Rp ${exp.toLocaleString('id-ID')})_\n`;
    });
    return msg.trim();
}

async function buildHistoryMessagePayload() {
    const result = await pool.query("SELECT * FROM transactions ORDER BY date DESC, id DESC LIMIT 6");
    if (result.rows.length === 0) {
        return {
            text: "📂 *RIWAYAT TRANSAKSI KOSONG*\n━━━━━━━━━━━━━━━━━━━\nBelum ada catatan transaksi saat ini.\n\n👇 Klik tombol di bawah untuk mencatat transaksi pertama Anda:",
            keyboard: {
                inline_keyboard: [
                    [
                        { text: '🟢 ➕ Catat Pemasukan', callback_data: 'qa_start:inc' },
                        { text: '🔴 ➖ Catat Pengeluaran', callback_data: 'qa_start:exp' }
                    ],
                    [{ text: '🧭 Menu Utama', callback_data: 'menu_act:main' }]
                ]
            }
        };
    }
    let msg = "📜 *RIWAYAT & EDIT TRANSAKSI KAPAN SAJA*\n━━━━━━━━━━━━━━━━━━━\n";
    const buttons = [];
    result.rows.forEach((t, i) => {
        const sign = t.type === 'income' ? '+' : '-';
        const icon = t.type === 'income' ? '🟢' : '🔴';
        const wallet = t.wallet || 'Tunai';
        msg += `${i + 1}. ${icon} *#${t.id} ${t.desc}* (${t.category} · 👛 ${wallet}) — *${sign}Rp ${Number(t.amount).toLocaleString('id-ID')}*\n`;
        buttons.push([
            {
                text: `✏️ Edit #${t.id}: ${String(t.desc).slice(0, 16)} (Rp ${Number(t.amount).toLocaleString('id-ID')})`,
                callback_data: `edit_menu:${t.id}`
            }
        ]);
    });
    buttons.push([
        { text: '🔄 Hapus Saldo / Reset Semula', callback_data: 'menu_act:reset_prompt' },
        { text: '🧭 Menu Utama', callback_data: 'menu_act:main' }
    ]);
    msg += "\n👇 _Tekan tombol transaksi di bawah ini untuk mengedit atau menghapus:_";
    return { text: msg, keyboard: { inline_keyboard: buttons } };
}

async function buildResetPromptText() {
    const { balance, totalCount } = await getRunningBalanceSummary();
    return `
⚠️ *HAPUS SALDO BERJALAN / RESET KE SEMULA*
━━━━━━━━━━━━━━━━━━━
💳 *Saldo Berjalan Saat Ini:* *Rp ${balance.toLocaleString('id-ID')}*
🧾 *Total Data Tersimpan:* ${totalCount} transaksi

Silakan pilih mode reset yang Anda inginkan:
1️⃣ *🗑️ Reset Semua ke Semula (Rp 0)*
Menghapus seluruh catatan transaksi dan mengembalikan semua saldo ke *Rp 0* seperti semula.

2️⃣ *🧹 Hapus Saldo Berjalan Saja (Nolkan ke Rp 0)*
Membuat penyesuaian otomatis agar *Saldo Berjalan menjadi Rp 0* tanpa menghapus riwayat transaksi sebelumnya.
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
async function saveAndNotify(trxData, chatId, existingMessageId = null) {
    const walletName = trxData.wallet || 'Tunai';
    const query = `INSERT INTO transactions ("desc", amount, type, category, wallet) VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const values = [trxData.desc, trxData.amount, trxData.type, trxData.category || 'Umum', walletName];

    const result = await pool.query(query, values);
    const savedTrx = result.rows[0];

    const { totalIncome, totalExpense, balance } = await getRunningBalanceSummary();

    let financialAdvice = "";
    if (totalExpense > totalIncome && totalIncome > 0) {
        financialAdvice = "\n🚨 *WARNING SAKU HARIAN:* Pengeluaran Anda sudah melewati total pemasukan! Harap lebih berhemat.";
    } else if (totalIncome > 0 && totalExpense / totalIncome > 0.8) {
        financialAdvice = "\n⚠️ *WARNING SAKU HARIAN:* Rasio pengeluaran Anda sudah di atas 80% dari pemasukan.";
    } else {
        financialAdvice = "\n💚 *STATUS:* Keuangan Anda sehat dan terkontrol dengan baik!";
    }

    const message = `
${formatTrxDetailMessage(savedTrx, '✅ *BERHASIL DICATAT OLEH SAKU HARIAN*')}
━━━━━━━━━━━━━━━━━━━
💳 *Saldo Berjalan:* *Rp ${balance.toLocaleString('id-ID')}*
${financialAdvice}
_Klik tombol di bawah kapan saja untuk mengedit, mencatat lagi, atau reset saldo:_
    `.trim();

    if (existingMessageId) {
        await editTelegramMessage(chatId, existingMessageId, message, buildTransactionActionKeyboard(savedTrx.id));
    } else {
        await sendTelegramMessage(chatId, message, buildTransactionActionKeyboard(savedTrx.id));
    }
    return savedTrx;
}

// ================= REST API UNTUK WEB APP =================

// API: Setup / Sinkronisasi Menu Komando Telegram
app.get('/api/setup-telegram-menu', async (req, res) => {
    try {
        await setupTelegramBotCommands();
        res.json({ success: true, commands: TELEGRAM_BOT_COMMANDS });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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

// API: Reset / Hapus Semua Transaksi atau Nolkan Saldo Berjalan
app.delete('/api/transactions', async (req, res) => {
    try {
        await pool.query('DELETE FROM transactions');
        res.json({ success: true, message: 'Semua transaksi berhasil direset kembali ke semula (Rp 0).' });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

    // 1. HANDLE TOMBOL INTERAKTIF (CALLBACK QUERY)
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

            // --- A. NAVIGASI MENU UTAMA TANPA KETIK ---
            if (action === 'menu_act') {
                const sub = parts[1];
                await clearEditSession(chatId);

                if (sub === 'main') {
                    await answerCallbackQuery(cb.id, '🧭 Menu Utama Saku Harian');
                    const { balance } = await getRunningBalanceSummary();
                    await editTelegramMessage(
                        chatId,
                        messageId,
                        `🧭 *MENU UTAMA SAKU HARIAN SMART PLANNER*\n━━━━━━━━━━━━━━━━━━━\n💳 *Saldo Berjalan:* *Rp ${balance.toLocaleString('id-ID')}*\n\n👇 _Silakan pencet tombol menu di bawah ini tanpa perlu repot mengetik:_`,
                        buildMainMenuInlineKeyboard()
                    );
                    return res.sendStatus(200);
                }

                if (sub === 'saldo') {
                    await answerCallbackQuery(cb.id, '💰 Memuat Saldo Berjalan...');
                    const msg = await buildSaldoMessageText();
                    await editTelegramMessage(chatId, messageId, msg, buildSaldoInlineKeyboard());
                    return res.sendStatus(200);
                }

                if (sub === 'dompet') {
                    await answerCallbackQuery(cb.id, '👛 Memuat Saldo E-Wallet & Bank...');
                    const msg = await buildDompetMessageText();
                    await editTelegramMessage(chatId, messageId, msg, buildSaldoInlineKeyboard());
                    return res.sendStatus(200);
                }

                if (sub === 'history') {
                    await answerCallbackQuery(cb.id, '📜 Memuat Riwayat & Edit...');
                    const { text: hText, keyboard: hKb } = await buildHistoryMessagePayload();
                    await editTelegramMessage(chatId, messageId, hText, hKb);
                    return res.sendStatus(200);
                }

                if (sub === 'tips') {
                    await answerCallbackQuery(cb.id, '💡 Tips Hemat Finansial');
                    const { totalIncome, totalExpense, balance } = await getRunningBalanceSummary();
                    const safeDaily = Math.max(0, Math.round(balance / Math.max(1, 30 - new Date().getDate() + 1)));
                    const tipsMsg = `
💡 *SARAN HEMAT SMART FINANCIAL PLANNER*
━━━━━━━━━━━━━━━━━━━
💳 *Saldo Berjalan:* Rp ${balance.toLocaleString('id-ID')}
🛡️ *Batas Aman Harian (Safe-to-Spend):* *Rp ${safeDaily.toLocaleString('id-ID')} / hari*

📌 *Rekomendasi Aturan 50/30/20:*
• 🏠 *50% Kebutuhan Pokok:* Maks Rp ${Math.round(totalIncome * 0.5).toLocaleString('id-ID')}
• ☕ *30% Keinginan & Gaya Hidup:* Maks Rp ${Math.round(totalIncome * 0.3).toLocaleString('id-ID')}
• 🐷 *20% Tabungan & Investasi:* Min Rp ${Math.round(totalIncome * 0.2).toLocaleString('id-ID')}

🦥 _Tips Saku: Pisahkan e-wallet harian (GoPay/DANA/OVO) dari rekening tabungan utama (BCA/Mandiri/SeaBank) agar saldo tidak bocor halus!_
                    `.trim();
                    await editTelegramMessage(chatId, messageId, tipsMsg, buildMainMenuInlineKeyboard());
                    return res.sendStatus(200);
                }

                if (sub === 'reset_prompt') {
                    await answerCallbackQuery(cb.id, '⚠️ Konfirmasi Reset Saldo');
                    const promptText = await buildResetPromptText();
                    await editTelegramMessage(chatId, messageId, promptText, buildResetConfirmationKeyboard());
                    return res.sendStatus(200);
                }
            }

            // --- B. EKSEKUSI HAPUS SALDO BERJALAN / RESET KEMBALI KE SEMULA ---
            if (action === 'reset_exec') {
                const mode = parts[1];
                await clearEditSession(chatId);

                if (mode === 'all') {
                    await pool.query('DELETE FROM transactions');
                    await answerCallbackQuery(cb.id, '✅ Semua data & saldo direset ke Rp 0!');
                    await editTelegramMessage(
                        chatId,
                        messageId,
                        `✅ *RESET KEMBALI KE SEMULA BERHASIL!*\n━━━━━━━━━━━━━━━━━━━\n🗑️ Seluruh riwayat transaksi telah dihapus.\n💳 *Saldo Berjalan Sekarang:* *Rp 0*\n\n👇 _Silakan mulai mencatat kembali dengan menekan tombol di bawah:_`,
                        buildMainMenuInlineKeyboard()
                    );
                    return res.sendStatus(200);
                }

                if (mode === 'zero') {
                    const { balance } = await getRunningBalanceSummary();
                    if (balance === 0) {
                        await answerCallbackQuery(cb.id, 'Saldo berjalan sudah Rp 0');
                        await editTelegramMessage(
                            chatId,
                            messageId,
                            `ℹ️ *SALDO BERJALAN SUDAH RP 0*\n━━━━━━━━━━━━━━━━━━━\n💳 *Saldo Berjalan Saat Ini:* *Rp 0*\nTidak diperlukan penyesuaian saldo.`,
                            buildMainMenuInlineKeyboard()
                        );
                        return res.sendStatus(200);
                    }
                    const adjType = balance > 0 ? 'expense' : 'income';
                    const adjAmount = Math.abs(balance);
                    await pool.query(
                        `INSERT INTO transactions ("desc", amount, type, category, wallet) VALUES ($1, $2, $3, $4, $5)`,
                        ['Penyesuaian Reset Saldo Berjalan (Rp 0)', adjAmount, adjType, 'Umum', 'Tunai']
                    );
                    await answerCallbackQuery(cb.id, '✅ Saldo berjalan dinolkan ke Rp 0!');
                    await editTelegramMessage(
                        chatId,
                        messageId,
                        `🧹 *SALDO BERJALAN BERHASIL DIHAPUS / DINOLKAN!*\n━━━━━━━━━━━━━━━━━━━\n⚖️ Penyesuaian otomatis sebesar *Rp ${adjAmount.toLocaleString('id-ID')}* telah dicatat.\n💳 *Saldo Berjalan Sekarang:* *Rp 0*\n\n_Riwayat transaksi lama tetap tersimpan._`,
                        buildMainMenuInlineKeyboard()
                    );
                    return res.sendStatus(200);
                }
            }

            // --- C. WIZARD PENCATATAN CEPAT TANPA KETIK (PEMASUKAN / PENGELUARAN) ---
            if (action === 'qa_start') {
                const typeKey = parts[1] === 'inc' ? 'inc' : 'exp';
                await clearEditSession(chatId);
                await answerCallbackQuery(
                    cb.id,
                    typeKey === 'inc' ? '🟢 Pilih Kategori Pemasukan' : '🔴 Pilih Kategori Pengeluaran'
                );
                const title = typeKey === 'inc'
                    ? '🟢 *CATAT PEMASUKAN CEPAT (TANPA KETIK)*\n━━━━━━━━━━━━━━━━━━━\n👇 *Langkah 1/3:* Pencet kategori pemasukan di bawah ini:'
                    : '🔴 *CATAT PENGELUARAN CEPAT (TANPA KETIK)*\n━━━━━━━━━━━━━━━━━━━\n👇 *Langkah 1/3:* Pencet kategori pengeluaran di bawah ini:';
                await editTelegramMessage(chatId, messageId, title, buildQuickCategoryKeyboard(typeKey));
                return res.sendStatus(200);
            }

            if (action === 'qa_cat') {
                const typeKey = parts[1] === 'inc' ? 'inc' : 'exp';
                const itemIdx = Number(parts[2]) || 0;
                const items = typeKey === 'inc' ? INCOME_QUICK_ITEMS : EXPENSE_QUICK_ITEMS;
                const chosen = items[itemIdx] || items[0];

                // Simpan sesi agar user juga bisa langsung ketik angka jika mau
                await setEditSession(chatId, 0, 'qa_custom_amt', { typeKey, itemIdx });

                await answerCallbackQuery(cb.id, `${chosen.label} dipilih`);
                const msg = `
${typeKey === 'inc' ? '🟢 *CATAT PEMASUKAN*' : '🔴 *CATAT PENGELUARAN*'}
━━━━━━━━━━━━━━━━━━━
📌 *Kategori:* ${chosen.label}

👇 *Langkah 2/3:* Pencet salah satu *Tombol Nominal* di bawah ini _(atau langsung ketik nominal/keterangan di chat)_:
                `.trim();
                await editTelegramMessage(chatId, messageId, msg, buildQuickNominalKeyboard(typeKey, itemIdx));
                return res.sendStatus(200);
            }

            if (action === 'qa_type_amt') {
                const typeKey = parts[1] === 'inc' ? 'inc' : 'exp';
                const itemIdx = Number(parts[2]) || 0;
                const items = typeKey === 'inc' ? INCOME_QUICK_ITEMS : EXPENSE_QUICK_ITEMS;
                const chosen = items[itemIdx] || items[0];

                await setEditSession(chatId, 0, 'qa_custom_amt', { typeKey, itemIdx });
                await answerCallbackQuery(cb.id, 'Silakan ketik nominal');
                await sendTelegramMessage(
                    chatId,
                    `⌨️ *KETIK NOMINAL UNTUK ${chosen.label.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━\nSilakan ketik nominalnya saja (contoh: \`35000\`) atau keterangan beserta nominal (contoh: \`Nasi Padang 35000\`).`
                );
                return res.sendStatus(200);
            }

            if (action === 'qa_amt') {
                const typeKey = parts[1] === 'inc' ? 'inc' : 'exp';
                const itemIdx = Number(parts[2]) || 0;
                const amount = Number(parts[3]) || 0;
                const items = typeKey === 'inc' ? INCOME_QUICK_ITEMS : EXPENSE_QUICK_ITEMS;
                const chosen = items[itemIdx] || items[0];

                await clearEditSession(chatId);
                await answerCallbackQuery(cb.id, `Nominal Rp ${amount.toLocaleString('id-ID')}`);
                const msg = `
${typeKey === 'inc' ? '🟢 *CATAT PEMASUKAN*' : '🔴 *CATAT PENGELUARAN*'}
━━━━━━━━━━━━━━━━━━━
📌 *Kategori:* ${chosen.label}
💰 *Nominal:* *Rp ${amount.toLocaleString('id-ID')}*

👇 *Langkah 3/3:* Pencet *Kantong Dana (E-Wallet / Bank)* untuk langsung menyimpan:
                `.trim();
                await editTelegramMessage(chatId, messageId, msg, buildQuickWalletKeyboard(typeKey, itemIdx, amount));
                return res.sendStatus(200);
            }

            if (action === 'qa_save') {
                const typeKey = parts[1] === 'inc' ? 'inc' : 'exp';
                const itemIdx = Number(parts[2]) || 0;
                const amount = Number(parts[3]) || 0;
                const wallet = parts.slice(4).join(':') || 'Tunai';
                const items = typeKey === 'inc' ? INCOME_QUICK_ITEMS : EXPENSE_QUICK_ITEMS;
                const chosen = items[itemIdx] || items[0];

                const activeSession = await getEditSession(chatId);
                const customDesc = (activeSession?.field === 'qa_custom_wallet' && activeSession?.payload?.customDesc)
                    ? activeSession.payload.customDesc
                    : chosen.desc;

                await clearEditSession(chatId);
                await answerCallbackQuery(cb.id, `✅ Disimpan ke ${wallet}!`);

                await saveAndNotify(
                    {
                        desc: customDesc,
                        amount,
                        type: typeKey === 'inc' ? 'income' : 'expense',
                        category: chosen.category,
                        wallet
                    },
                    chatId,
                    messageId
                );
                return res.sendStatus(200);
            }

            // --- D. EDIT TRANSAKSI EXISTING ---
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
                const { balance } = await getRunningBalanceSummary();
                await editTelegramMessage(
                    chatId,
                    messageId,
                    `🗑️ *Transaksi #${trxId} telah dihapus.*\n💳 *Saldo Berjalan Sekarang:* *Rp ${balance.toLocaleString('id-ID')}*`,
                    buildMainMenuInlineKeyboard()
                );
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
        const cleanText = String(text || '').trim();
        const lowerText = cleanText.toLowerCase();

        // DETEKSI TOMBOL MENU KEYBOARD BAWAH ATAU KATA KUNCI LANGSUNG (TANPA HARUS PAKAI '/')
        const isMenuTrigger =
            lowerText === '/start' ||
            lowerText === '/menu' ||
            lowerText === 'menu' ||
            lowerText === '🧭 menu utama' ||
            lowerText === 'menu utama' ||
            lowerText === 'bantuan' ||
            lowerText === '/help';

        const isIncomeTrigger =
            lowerText === '/pemasukan' ||
            lowerText === 'pemasukan' ||
            lowerText === '🟢 ➕ pemasukan' ||
            lowerText === '➕ pemasukan' ||
            lowerText === 'catat pemasukan';

        const isExpenseTrigger =
            lowerText === '/pengeluaran' ||
            lowerText === 'pengeluaran' ||
            lowerText === '🔴 ➖ pengeluaran' ||
            lowerText === '➖ pengeluaran' ||
            lowerText === 'catat pengeluaran';

        const isSaldoTrigger =
            lowerText === '/saldo' ||
            lowerText === '/rekap' ||
            lowerText === 'saldo' ||
            lowerText === 'cek saldo' ||
            lowerText === '💰 cek saldo' ||
            lowerText === 'rekap' ||
            lowerText === 'info saldo';

        const isDompetTrigger =
            lowerText === '/dompet' ||
            lowerText === '/wallet' ||
            lowerText === 'dompet' ||
            lowerText === 'wallet' ||
            lowerText === '👛 saldo e-wallet' ||
            lowerText === 'saldo e-wallet' ||
            lowerText === 'cek dompet';

        const isHistoryTrigger =
            lowerText === '/history' ||
            lowerText === '/riwayat' ||
            lowerText === '/edit' ||
            lowerText === 'riwayat' ||
            lowerText === 'history' ||
            lowerText === 'edit' ||
            lowerText === '📜 riwayat & edit';

        const isResetTrigger =
            lowerText === '/reset' ||
            lowerText === 'reset' ||
            lowerText === 'hapus saldo' ||
            lowerText === 'reset saldo' ||
            lowerText === '🔄 reset saldo / data' ||
            lowerText === 'reset data';

        const isTipsTrigger =
            lowerText === '/tips' ||
            lowerText === 'tips' ||
            lowerText === '💡 tips hemat ai' ||
            lowerText === 'tips hemat';

        if (lowerText === '/batal' || lowerText === 'batal') {
            await clearEditSession(chatId);
            await sendTelegramMessage(chatId, "✅ Aksi dibatalkan. Silakan pilih tombol menu di bawah.");
            return res.sendStatus(200);
        }

        // JIKA USER MENEKAN TOMBOL MENU ATAU KETIK KATA KUNCI MENU, PRIORITASKAN MENU!
        if (isMenuTrigger) {
            await clearEditSession(chatId);
            const { balance } = await getRunningBalanceSummary();
            // Kirim pesan pembuka yang memastikan Reply Keyboard bawah selalu aktif
            await sendTelegramMessage(
                chatId,
                `👋 *Selamat datang di Saku Harian Smart Planner Bot!*\nSekarang Anda *tidak perlu repot ketik-ketik* — cukup pencet tombol berikon di bawah layar atau tombol menu interaktif berikut:`
            );
            await sendTelegramMessage(
                chatId,
                `🧭 *MENU UTAMA SAKU HARIAN*\n━━━━━━━━━━━━━━━━━━━\n💳 *Saldo Berjalan:* *Rp ${balance.toLocaleString('id-ID')}*\n\n✨ *Cara Pakai Super Mudah:*\n• Pencet *🟢 ➕ Pemasukan* atau *🔴 ➖ Pengeluaran*\n• Ketik *saldo* atau pencet *💰 Cek Saldo* kapan saja\n• Pencet *🔄 Reset Saldo / Data* untuk mengembalikan saldo ke *Rp 0*`,
                buildMainMenuInlineKeyboard()
            );
            return res.sendStatus(200);
        }

        if (isIncomeTrigger) {
            await clearEditSession(chatId);
            await sendTelegramMessage(
                chatId,
                `🟢 *CATAT PEMASUKAN CEPAT (TANPA KETIK)*\n━━━━━━━━━━━━━━━━━━━\n👇 *Langkah 1/3:* Pencet kategori pemasukan di bawah ini:`,
                buildQuickCategoryKeyboard('inc')
            );
            return res.sendStatus(200);
        }

        if (isExpenseTrigger) {
            await clearEditSession(chatId);
            await sendTelegramMessage(
                chatId,
                `🔴 *CATAT PENGELUARAN CEPAT (TANPA KETIK)*\n━━━━━━━━━━━━━━━━━━━\n👇 *Langkah 1/3:* Pencet kategori pengeluaran di bawah ini:`,
                buildQuickCategoryKeyboard('exp')
            );
            return res.sendStatus(200);
        }

        if (isSaldoTrigger) {
            await clearEditSession(chatId);
            const msg = await buildSaldoMessageText();
            await sendTelegramMessage(chatId, msg, buildSaldoInlineKeyboard());
            return res.sendStatus(200);
        }

        if (isDompetTrigger) {
            await clearEditSession(chatId);
            const msg = await buildDompetMessageText();
            await sendTelegramMessage(chatId, msg, buildSaldoInlineKeyboard());
            return res.sendStatus(200);
        }

        if (isHistoryTrigger) {
            await clearEditSession(chatId);
            const { text: hText, keyboard: hKb } = await buildHistoryMessagePayload();
            await sendTelegramMessage(chatId, hText, hKb);
            return res.sendStatus(200);
        }

        if (isResetTrigger) {
            await clearEditSession(chatId);
            const promptText = await buildResetPromptText();
            await sendTelegramMessage(chatId, promptText, buildResetConfirmationKeyboard());
            return res.sendStatus(200);
        }

        if (isTipsTrigger) {
            await clearEditSession(chatId);
            const { totalIncome, balance } = await getRunningBalanceSummary();
            const safeDaily = Math.max(0, Math.round(balance / Math.max(1, 30 - new Date().getDate() + 1)));
            const tipsMsg = `
💡 *SARAN HEMAT SMART FINANCIAL PLANNER*
━━━━━━━━━━━━━━━━━━━
💳 *Saldo Berjalan:* Rp ${balance.toLocaleString('id-ID')}
🛡️ *Batas Aman Harian (Safe-to-Spend):* *Rp ${safeDaily.toLocaleString('id-ID')} / hari*

📌 *Rekomendasi Aturan 50/30/20:*
• 🏠 *50% Kebutuhan Pokok:* Maks Rp ${Math.round(totalIncome * 0.5).toLocaleString('id-ID')}
• ☕ *30% Keinginan & Gaya Hidup:* Maks Rp ${Math.round(totalIncome * 0.3).toLocaleString('id-ID')}
• 🐷 *20% Tabungan & Investasi:* Min Rp ${Math.round(totalIncome * 0.2).toLocaleString('id-ID')}
            `.trim();
            await sendTelegramMessage(chatId, tipsMsg, buildMainMenuInlineKeyboard());
            return res.sendStatus(200);
        }

        // CEK APAKAH USER SEDANG DALAM SESI EDIT TRANSAKSI ATAU INPUT NOMINAL WIZARD
        if (cleanText && !cleanText.startsWith('/')) {
            const activeSession = await getEditSession(chatId);
            if (activeSession) {
                if (activeSession.field === 'qa_custom_amt') {
                    const { typeKey = 'exp', itemIdx = 0 } = activeSession.payload || {};
                    const items = typeKey === 'inc' ? INCOME_QUICK_ITEMS : EXPENSE_QUICK_ITEMS;
                    const chosen = items[itemIdx] || items[0];

                    // Ekstrak angka nominal (mendukung format 25000, 25.000, 25rb, 25k, 2jt)
                    let multiplier = 1;
                    if (/\b(\d+[.,]?\d*)\s*(jt|juta)\b/i.test(cleanText)) multiplier = 1000000;
                    else if (/\b(\d+[.,]?\d*)\s*(rb|ribu|k)\b/i.test(cleanText)) multiplier = 1000;

                    const numMatch = cleanText.match(/(\d+(?:[.,]\d+)?)/);
                    let parsedAmt = 0;
                    if (numMatch) {
                        const rawNum = numMatch[1];
                        if (multiplier > 1) {
                            parsedAmt = Math.round(parseFloat(rawNum.replace(',', '.')) * multiplier);
                        } else {
                            parsedAmt = Number(rawNum.replace(/[^0-9]/g, ''));
                        }
                    }

                    const customDesc = cleanText
                        .replace(/(\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|k)?/gi, '')
                        .replace(/rp\.?/gi, '')
                        .trim();

                    if (Number.isFinite(parsedAmt) && parsedAmt > 0) {
                        await setEditSession(chatId, 0, 'qa_custom_wallet', {
                            typeKey,
                            itemIdx,
                            customDesc: customDesc || chosen.desc
                        });
                        const msg = `
${typeKey === 'inc' ? '🟢 *CATAT PEMASUKAN*' : '🔴 *CATAT PENGELUARAN*'}
━━━━━━━━━━━━━━━━━━━
📝 *Keterangan:* ${customDesc || chosen.desc}
📁 *Kategori:* ${chosen.label}
💰 *Nominal:* *Rp ${parsedAmt.toLocaleString('id-ID')}*

👇 *Langkah 3/3:* Pencet *Kantong Dana (E-Wallet / Bank)* untuk langsung menyimpan:
                        `.trim();
                        await sendTelegramMessage(chatId, msg, buildQuickWalletKeyboard(typeKey, itemIdx, parsedAmt));
                        return res.sendStatus(200);
                    }
                } else if (activeSession.field === 'amount') {
                    const cleanedNum = Number(String(cleanText).replace(/[^0-9]/g, ''));
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
                        [cleanText, activeSession.trxId]
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
            {"desc": "Nama tempat/ringkasan", "amount": angka saja, "type": "expense", "category": "Kategori bebas", "wallet": "GoPay/DANA/OVO/ShopeePay/LinkAja/QRIS/BCA/Mandiri/BRI/BNI/Tunai"}`;

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
            {"desc": "Keterangan singkat", "amount": angka saja, "type": "expense" atau "income", "category": "Kategori bebas", "wallet": "GoPay/DANA/OVO/ShopeePay/LinkAja/QRIS/BCA/Mandiri/BRI/BNI/SeaBank/Bank Jago/Tunai"}`;

            const rawText = await callGeminiAudioAPI(prompt, base64Audio);
            let parsed = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
            await saveAndNotify(parsed, chatId);
        }
        // 3. PESAN TEKS BEBAS / AI NATURAL LANGUAGE
        else if (cleanText) {
            const checkPrompt = `Analisis pesan user: "${cleanText}".
            Daftar wallet/bank populer: GoPay, DANA, OVO, ShopeePay, LinkAja, QRIS, Flip, BCA, Mandiri, BRI, BNI, BSI, CIMB Niaga, SeaBank, Bank Jago, Blu BCA, Jenius, Tunai.
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
                await sendTelegramMessage(chatId, `🤖 *Saku Harian:* ${parsed.reply}`, buildMainMenuInlineKeyboard());
            }
        }
    } catch (err) {
        console.error("Error:", err);
        await sendTelegramMessage(
            chatId,
            "⚠️ Format pesan kurang jelas. Anda bisa langsung menekan tombol *🟢 ➕ Pemasukan*, *🔴 ➖ Pengeluaran*, atau *💰 Cek Saldo* pada menu di bawah!",
            buildMainMenuInlineKeyboard()
        );
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));
}

module.exports = app;
