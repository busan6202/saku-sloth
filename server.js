const express = require('express');
const path = require('path');
const crypto = require('crypto');
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

const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '8584715332:AAEF5F54-ipvf8vQGH-Eh7bqrYZYCIuLHjQ').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const PUBLIC_WEBHOOK_URL = (process.env.WEBHOOK_URL || 'https://saku-sloth.vercel.app/api/telegram-webhook').trim();

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

let telegramSetupDone = false;

async function setupTelegramBotCommands(forceWebhookSync = false) {
    const report = {
        commandsSet: false,
        menuButtonSet: false,
        webhookSet: false,
        botUsername: null,
        webhookInfo: null
    };

    try {
        const meRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
        const meData = await meRes.json().catch(() => ({}));
        if (meData?.ok && meData?.result?.username) {
            report.botUsername = meData.result.username;
        }

        // Pastikan Webhook aktif dan menerima message + callback_query (klik tombol inline)
        if (forceWebhookSync || !telegramSetupDone) {
            const whInfoRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
            const whInfoData = await whInfoRes.json().catch(() => ({}));
            report.webhookInfo = whInfoData?.result || null;

            const currentUrl = whInfoData?.result?.url || '';
            const currentAllowed = Array.isArray(whInfoData?.result?.allowed_updates)
                ? whInfoData.result.allowed_updates
                : [];
            const needsCallbackQuery = !currentAllowed.includes('callback_query');

            if (forceWebhookSync || currentUrl !== PUBLIC_WEBHOOK_URL || needsCallbackQuery) {
                const setWhRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
                    body: JSON.stringify({
                        url: PUBLIC_WEBHOOK_URL,
                        allowed_updates: ['message', 'edited_message', 'callback_query'],
                        drop_pending_updates: false
                    })
                });
                const setWhData = await setWhRes.json().catch(() => ({}));
                report.webhookSet = Boolean(setWhData?.ok);
            } else {
                report.webhookSet = true;
            }
        }

        const cmdRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
            body: JSON.stringify({ commands: TELEGRAM_BOT_COMMANDS })
        });
        const cmdData = await cmdRes.json().catch(() => ({}));
        report.commandsSet = Boolean(cmdData?.ok);

        const btnRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setChatMenuButton`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
            body: JSON.stringify({ menu_button: { type: 'commands' } })
        });
        const btnData = await btnRes.json().catch(() => ({}));
        report.menuButtonSet = Boolean(btnData?.ok);

        telegramSetupDone = true;
    } catch (err) {
        console.warn("Gagal sinkronisasi konfigurasi Telegram:", err.message);
    }

    return report;
}

// Inisialisasi Tabel Transaksi + Kolom Wallet + Tabel Sesi Edit/Wizard Telegram (Singleton Promise)
let dbReadyPromise = null;

async function ensureDatabaseReady() {
    if (dbReadyPromise) return dbReadyPromise;
    dbReadyPromise = (async () => {
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
            await pool.query(`
                CREATE TABLE IF NOT EXISTS debts (
                    id SERIAL PRIMARY KEY,
                    type VARCHAR(20) NOT NULL,
                    "desc" TEXT NOT NULL,
                    amount NUMERIC NOT NULL,
                    paid_amount NUMERIC DEFAULT 0,
                    status VARCHAR(20) DEFAULT 'pending',
                    due_date DATE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await pool.query(`
                ALTER TABLE debts
                ADD COLUMN IF NOT EXISTS paid_amount NUMERIC DEFAULT 0
            `);
            await pool.query(`
                ALTER TABLE debts
                ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'
            `);

            // --- TABEL MULTI-USER & SESI AUTENTIKASI ---
            await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    email VARCHAR(160),
                    password_hash TEXT NOT NULL,
                    full_name VARCHAR(100),
                    avatar VARCHAR(50) DEFAULT '🐮',
                    role VARCHAR(20) DEFAULT 'user',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await pool.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS email VARCHAR(160)
            `);
            await pool.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
                ON users (LOWER(email))
                WHERE email IS NOT NULL
            `);
            // Akun admin lama (belum punya email) diberi email default agar bisa masuk via email.
            await pool.query(`
                UPDATE users SET email = 'admin@sakuharian.app'
                WHERE LOWER(username) = 'admin' AND email IS NULL
            `).catch(() => {});
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_sessions (
                    token VARCHAR(64) PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP
                )
            `);
            await pool.query(`
                ALTER TABLE transactions
                ADD COLUMN IF NOT EXISTS user_id INTEGER
            `);
            await pool.query(`
                ALTER TABLE debts
                ADD COLUMN IF NOT EXISTS user_id INTEGER
            `);

            // Seed Akun Default (Admin / Demo) bila tabel pengguna masih kosong
            const userCountRes = await pool.query('SELECT COUNT(*) AS count FROM users');
            if (Number(userCountRes.rows[0]?.count || 0) === 0) {
                const defaultSalt = crypto.randomBytes(16).toString('hex');
                const defaultHash = crypto.pbkdf2Sync('admin123', defaultSalt, 1000, 64, 'sha512').toString('hex');
                const initUserRes = await pool.query(
                    `INSERT INTO users (username, email, password_hash, full_name, avatar, role)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     RETURNING id`,
                    ['admin', 'admin@sakuharian.app', `${defaultSalt}:${defaultHash}`, 'Pemilik Saku', '🐮', 'admin']
                );
                const adminId = initUserRes.rows[0]?.id;
                if (adminId) {
                    await pool.query('UPDATE transactions SET user_id = $1 WHERE user_id IS NULL', [adminId]).catch(() => {});
                    await pool.query('UPDATE debts SET user_id = $1 WHERE user_id IS NULL', [adminId]).catch(() => {});
                }
            }

            // Data lama tanpa pemilik diwariskan ke akun pertama (admin) agar tidak terlihat oleh pengguna lain.
            const ownerRes = await pool.query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
            const legacyOwnerId = ownerRes.rows[0]?.id;
            if (legacyOwnerId) {
                await pool.query('UPDATE transactions SET user_id = $1 WHERE user_id IS NULL', [legacyOwnerId]).catch(() => {});
                await pool.query('UPDATE debts SET user_id = $1 WHERE user_id IS NULL', [legacyOwnerId]).catch(() => {});
            }

            console.log("Berhasil terhubung ke Neon PostgreSQL & sinkronisasi skema Multi-User/Wallet/Menu! 🐘");
            setupTelegramBotCommands(false).catch(() => {});
            return true;
        } catch (err) {
            console.error("Gagal inisialisasi database Neon:", err);
            dbReadyPromise = null;
            return false;
        }
    })();
    return dbReadyPromise;
}

ensureDatabaseReady();

// ================= HELPER AUTENTIKASI & KEAMANAN MULTI-USER =================
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(String(password), salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    if (!stored) return false;
    const cleanStored = String(stored).trim();
    if (!cleanStored.includes(':')) {
        const hash = crypto.createHash('sha256').update(String(password)).digest('hex');
        return hash === cleanStored;
    }
    const [salt, origHash] = cleanStored.split(':');
    const hash = crypto.pbkdf2Sync(String(password), salt, 1000, 64, 'sha512').toString('hex');
    return hash === origHash;
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(normalizeEmail(value));
}

function slugifyUsername(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '')
        .replace(/^[._-]+|[._-]+$/g, '')
        .slice(0, 40);
}

async function generateUniqueUsername(base) {
    const safeBase = slugifyUsername(base) || 'pengguna';
    let candidate = safeBase;
    let counter = 1;
    while (true) {
        const exists = await pool.query('SELECT id FROM users WHERE LOWER(username) = $1', [candidate]);
        if (exists.rows.length === 0) return candidate;
        candidate = `${safeBase}${counter++}`.slice(0, 50);
    }
}

async function resolveAuthUser(req) {
    try {
        const authHeader = req.headers?.authorization || '';
        let token = '';
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7).trim();
        } else if (req.headers?.['x-session-token']) {
            token = String(req.headers['x-session-token']).trim();
        } else if (req.query?.auth_token) {
            token = String(req.query.auth_token).trim();
        }

        if (!token) return null;

        const sessionRes = await pool.query(
            `SELECT u.id, u.username, u.email, u.full_name, u.avatar, u.role
             FROM user_sessions s
             JOIN users u ON s.user_id = u.id
             WHERE s.token = $1 AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)`,
            [token]
        );
        return sessionRes.rows[0] || null;
    } catch {
        return null;
    }
}

// Admin tetap dapat melihat data global (mis. hasil Telegram bot), pengguna biasa hanya miliknya sendiri.
function buildUserScope(user) {
    if (user?.role === 'admin') {
        return { clause: '(user_id = $1 OR user_id IS NULL)', params: [user.id] };
    }
    return { clause: 'user_id = $1', params: [user.id] };
}

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
        await ensureDatabaseReady();
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
        await ensureDatabaseReady();
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
        await ensureDatabaseReady();
        await pool.query(`DELETE FROM telegram_edit_sessions WHERE chat_id = $1`, [String(chatId)]);
    } catch {
        // abaikan
    }
}

function stripMarkdownFormatting(text) {
    return String(text || '').replace(/[*_`]/g, '');
}

// Fungsi Kirim Pesan Telegram (Anti-Gagal: Otomatis fallback ke Plain Text jika Markdown gagal parse)
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    const activeMarkup = replyMarkup || PERSISTENT_REPLY_KEYBOARD;
    try {
        const payload = {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            reply_markup: activeMarkup
        };
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            // Fallback tanpa parse_mode agar karakter khusus pada deskripsi tidak pernah menggagalkan pengiriman
            const fallbackPayload = {
                chat_id: chatId,
                text: stripMarkdownFormatting(text),
                reply_markup: activeMarkup
            };
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
                body: JSON.stringify(fallbackPayload)
            });
        }
    } catch (err) {
        console.error("Gagal kirim pesan Telegram:", err.message);
    }
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
    if (!messageId) {
        await sendTelegramMessage(chatId, text, replyMarkup);
        return;
    }
    try {
        const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            // Coba edit tanpa parse_mode terlebih dahulu
            const plainPayload = { chat_id: chatId, message_id: messageId, text: stripMarkdownFormatting(text) };
            if (replyMarkup) plainPayload.reply_markup = replyMarkup;
            const retryRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
                body: JSON.stringify(plainPayload)
            });
            const retryData = await retryRes.json().catch(() => ({}));
            if (!retryRes.ok || !retryData.ok) {
                // Jika tetap tidak bisa diedit (misal pesan sama / pesan lama), kirim pesan baru agar user selalu melihat hasil eksekusi
                await sendTelegramMessage(chatId, text, replyMarkup);
            }
        }
    } catch (err) {
        await sendTelegramMessage(chatId, text, replyMarkup);
    }
}

async function answerCallbackQuery(callbackQueryId, text = '') {
    if (!callbackQueryId) return;
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

function sanitizeSafeText(val) {
    return String(val || '').replace(/[*_`[\]]/g, '');
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
📝 *Keterangan:* ${sanitizeSafeText(trx.desc)}
📁 *Kategori:* ${sanitizeSafeText(trx.category || 'Umum')}
👛 *Kantong Dana:* ${sanitizeSafeText(trx.wallet || 'Tunai')}
💰 *Nominal:* ${sign} Rp ${formattedAmount}
    `.trim();
}

async function getRunningBalanceSummary() {
    await ensureDatabaseReady();
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
        LIMIT 6
    `);

    let walletLines = '';
    if (walletRes.rows.length > 0) {
        walletLines = '\n👛 *Rincian Kantong Dana Teratas:*\n' + walletRes.rows.map((w) => {
            const netVal = Number(w.net || 0);
            const sign = netVal >= 0 ? '+' : '-';
            return `• *${sanitizeSafeText(w.wallet)}:* ${sign}Rp ${Math.abs(netVal).toLocaleString('id-ID')}`;
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

👇 Pilih tombol aksi cepat di bawah ini tanpa perlu ketik:
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
    await ensureDatabaseReady();
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
        msg += `• *${sanitizeSafeText(r.wallet)}:* *Rp ${net.toLocaleString('id-ID')}*\n   (🟢 +Rp ${inc.toLocaleString('id-ID')} | 🔴 -Rp ${exp.toLocaleString('id-ID')})\n`;
    });
    return msg.trim();
}

async function buildHistoryMessagePayload() {
    await ensureDatabaseReady();
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
        const wallet = sanitizeSafeText(t.wallet || 'Tunai');
        const safeDesc = sanitizeSafeText(t.desc);
        const safeCat = sanitizeSafeText(t.category || 'Umum');
        msg += `${i + 1}. ${icon} *#${t.id} ${safeDesc}* (${safeCat} · 👛 ${wallet}) — *${sign}Rp ${Number(t.amount).toLocaleString('id-ID')}*\n`;
        buttons.push([
            {
                text: `✏️ Edit #${t.id}: ${safeDesc.slice(0, 16)} (Rp ${Number(t.amount).toLocaleString('id-ID')})`,
                callback_data: `edit_menu:${t.id}`
            }
        ]);
    });
    buttons.push([
        { text: '🔄 Hapus Saldo / Reset Semula', callback_data: 'menu_act:reset_prompt' },
        { text: '🧭 Menu Utama', callback_data: 'menu_act:main' }
    ]);
    msg += "\n👇 Tekan tombol transaksi di bawah ini untuk mengedit atau menghapus:";
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

// Parser Lokal Pintar untuk Pesan Transaksi Natural (Fallback Cepat Tanpa Tergantung AI)
function parseNaturalTransactionText(rawText) {
    const clean = String(rawText || '').trim();
    if (!clean) return null;

    let multiplier = 1;
    if (/\b(\d+[.,]?\d*)\s*(jt|juta)\b/i.test(clean)) multiplier = 1000000;
    else if (/\b(\d+[.,]?\d*)\s*(rb|ribu|k)\b/i.test(clean)) multiplier = 1000;

    const numMatch = clean.match(/(\d+(?:[.,]\d+)?)/);
    if (!numMatch) return null;

    const rawNum = numMatch[1];
    let amount = 0;
    if (multiplier > 1) {
        amount = Math.round(parseFloat(rawNum.replace(',', '.')) * multiplier);
    } else {
        amount = Number(rawNum.replace(/[^0-9]/g, ''));
    }

    if (!Number.isFinite(amount) || amount <= 0) return null;

    const lower = clean.toLowerCase();
    const isIncome = /\b(gaji|masuk|pemasukan|bonus|thr|setoran|terima|jual|penjualan|freelance|komisi|cashback|untung|dividen)\b/i.test(lower);
    const type = isIncome ? 'income' : 'expense';

    let detectedWallet = 'Tunai';
    for (const w of POPULAR_WALLETS) {
        if (lower.includes(w.id.toLowerCase())) {
            detectedWallet = w.id;
            break;
        }
    }

    let category = isIncome ? 'Gaji & Penghasilan' : 'Umum';
    if (/makan|minum|kopi|jajan|sarapan|siang|malam|nasi|bakso|mie|resto|warung/.test(lower)) category = 'Makan & Minum';
    else if (/bensin|bbm|grab|gojek|ojek|parkir|tol|transport|kereta|bus/.test(lower)) category = 'Transportasi';
    else if (/listrik|pln|air|pdam|tagihan|cicilan|kredit|bpjs|pajak/.test(lower)) category = 'Tagihan & Utilitas';
    else if (/wifi|internet|kuota|pulsa|netflix|spotify|langganan/.test(lower)) category = 'Langganan Digital';
    else if (/belanja|alfamart|indomaret|supermarket|sembako|baju|shopee|tokopedia/.test(lower)) category = 'Belanja & Lifestyle';
    else if (/kos|sewa|kontrakan|rumah/.test(lower)) category = 'Rumah & Sewa';
    else if (/obat|dokter|apotek|rs|kesehatan/.test(lower)) category = 'Kesehatan';
    else if (/tabung|investasi|emas|reksadana/.test(lower)) category = 'Tabungan & Investasi';

    let desc = clean
        .replace(/(\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|k)?/gi, '')
        .replace(/\b(rp\.?|via|pakai|pake|dengan|ke|dari)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!desc) {
        desc = isIncome ? 'Pemasukan Harian' : 'Pengeluaran Harian';
    }

    return {
        isTransaction: true,
        desc: desc.charAt(0).toUpperCase() + desc.slice(1),
        amount,
        type,
        category,
        wallet: detectedWallet
    };
}

// Fungsi Panggil Gemini Teks & Gambar
async function callGeminiAPI(prompt, base64Image = null, retries = 2, delay = 1200) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY tidak tersedia');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const parts = [{ text: prompt }];
    if (base64Image) {
        parts.push({ inline_data: { mime_type: "image/jpeg", data: base64Image } });
    }

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
                body: JSON.stringify({ contents: [{ parts }] })
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
            throw new Error(`Gemini API Error (${response.status}): ${responseText}`);
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Fungsi Panggil Gemini Voice Note (Audio)
async function callGeminiAudioAPI(prompt, base64Audio, retries = 2, delay = 1200) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY tidak tersedia');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const parts = [
        { text: prompt },
        { inline_data: { mime_type: "audio/ogg", data: base64Audio } }
    ];

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
                body: JSON.stringify({ contents: [{ parts }] })
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
            throw new Error(`Gemini API Error (${response.status}): ${responseText}`);
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Fungsi Simpan Transaksi & Analisis Saku Harian AI
async function saveAndNotify(trxData, chatId, existingMessageId = null) {
    await ensureDatabaseReady();
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

👇 Klik tombol di bawah kapan saja untuk mengedit, mencatat lagi, atau reset saldo:
    `.trim();

    if (existingMessageId) {
        await editTelegramMessage(chatId, existingMessageId, message, buildTransactionActionKeyboard(savedTrx.id));
    } else {
        await sendTelegramMessage(chatId, message, buildTransactionActionKeyboard(savedTrx.id));
    }
    return savedTrx;
}

// ================= REST API UNTUK WEB APP =================

// ================= REST API AUTENTIKASI (MULTI-USER) =================

// API: Registrasi Pengguna Baru
app.post('/api/auth/register', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const { email, username, password, fullName, avatar } = req.body || {};
        const cleanEmail = normalizeEmail(email);
        if (!cleanEmail) {
            return res.status(400).json({ error: 'Email wajib diisi untuk membuat akun.' });
        }
        if (!isValidEmail(cleanEmail)) {
            return res.status(400).json({ error: 'Format email tidak valid. Contoh: nama@email.com.' });
        }
        if (!password || String(password).length < 6) {
            return res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
        }

        const existingEmail = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
        if (existingEmail.rows.length > 0) {
            return res.status(409).json({ error: 'Email ini sudah terdaftar. Silakan masuk dengan email tersebut.' });
        }

        let cleanUsername = slugifyUsername(username);
        if (cleanUsername) {
            if (cleanUsername.length < 3) {
                return res.status(400).json({ error: 'Username minimal 3 karakter (huruf, angka, titik, strip, underscore).' });
            }
            const existingUsername = await pool.query('SELECT id FROM users WHERE LOWER(username) = $1', [cleanUsername]);
            if (existingUsername.rows.length > 0) {
                return res.status(409).json({ error: 'Username sudah digunakan. Silakan pilih username lain.' });
            }
        } else {
            cleanUsername = await generateUniqueUsername(cleanEmail.split('@')[0]);
        }

        const pHash = hashPassword(String(password));
        const finalName = String(fullName || cleanUsername).trim() || cleanUsername;
        const finalAvatar = String(avatar || '🐮').slice(0, 10);

        const insertRes = await pool.query(
            `INSERT INTO users (username, email, password_hash, full_name, avatar, role)
             VALUES ($1, $2, $3, $4, $5, 'user')
             RETURNING id, username, email, full_name, avatar, role, created_at`,
            [cleanUsername, cleanEmail, pHash, finalName, finalAvatar]
        );
        const newUser = insertRes.rows[0];

        const token = generateSessionToken();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await pool.query(
            'INSERT INTO user_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
            [token, newUser.id, expiresAt]
        );

        res.status(201).json({
            ok: true,
            message: 'Pendaftaran akun berhasil! Selamat datang di Saku Harian. 🐮✨',
            user: {
                id: newUser.id,
                username: newUser.username,
                email: newUser.email,
                fullName: newUser.full_name,
                avatar: newUser.avatar,
                role: newUser.role
            },
            token
        });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Gagal mendaftarkan akun.' });
    }
});

// API: Masuk Akun (Login via email, tetap mendukung username lama)
app.post('/api/auth/login', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const { email, username, identifier, password } = req.body || {};
        const rawIdentifier = String(identifier || email || username || '').trim();
        if (!rawIdentifier || !password) {
            return res.status(400).json({ error: 'Email dan kata sandi harus diisi.' });
        }

        const isEmailLogin = rawIdentifier.includes('@');
        const userRes = isEmailLogin
            ? await pool.query(
                'SELECT id, username, email, password_hash, full_name, avatar, role FROM users WHERE LOWER(email) = $1',
                [normalizeEmail(rawIdentifier)]
            )
            : await pool.query(
                'SELECT id, username, email, password_hash, full_name, avatar, role FROM users WHERE LOWER(username) = $1',
                [rawIdentifier.toLowerCase()]
            );
        if (userRes.rows.length === 0) {
            return res.status(401).json({ error: 'Email atau kata sandi tidak cocok.' });
        }
        const user = userRes.rows[0];
        const isValid = verifyPassword(String(password), user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Email atau kata sandi tidak cocok.' });
        }

        const token = generateSessionToken();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await pool.query(
            'INSERT INTO user_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
            [token, user.id, expiresAt]
        );

        res.json({
            ok: true,
            message: 'Berhasil masuk ke Saku Harian! 🐮✨',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.full_name,
                avatar: user.avatar,
                role: user.role
            },
            token
        });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Gagal memproses login.' });
    }
});

// API: Cek Sesi Pengguna Aktif
app.get('/api/auth/me', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) {
            return res.status(401).json({ ok: false, error: 'Sesi tidak valid atau telah berakhir.' });
        }
        res.json({
            ok: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.full_name,
                avatar: user.avatar,
                role: user.role
            }
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// API: Keluar (Logout)
app.post('/api/auth/logout', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const authHeader = req.headers?.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : (req.body?.token || '');
        if (token) {
            await pool.query('DELETE FROM user_sessions WHERE token = $1', [token]).catch(() => {});
        }
        res.json({ ok: true, message: 'Berhasil keluar.' });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// API: Setup / Sinkronisasi Menu Komando & Webhook Telegram
app.get('/api/setup-telegram-menu', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const report = await setupTelegramBotCommands(true);
        res.json({
            success: true,
            report,
            commands: TELEGRAM_BOT_COMMANDS
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Ambil Semua Transaksi
app.get('/api/transactions', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        }
        const scope = buildUserScope(user);
        const result = await pool.query(
            `SELECT * FROM transactions WHERE ${scope.clause} ORDER BY date DESC, id DESC`,
            scope.params
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Tambah Transaksi Baru
app.post('/api/transactions', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        }
        const { desc, amount, type, category, wallet, date } = req.body;
        const parsedDate = date && !Number.isNaN(new Date(date).getTime()) ? new Date(date) : new Date();
        const query = `INSERT INTO transactions ("desc", amount, type, category, wallet, date, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`;
        const values = [desc, amount, type, category || 'Umum', wallet || 'Tunai', parsedDate, user.id];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// API: Hapus / Reset Saldo Berjalan atau Reset Semua Transaksi ke Semula (Rp 0)
app.post('/api/transactions/reset', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        }
        const scope = buildUserScope(user);
        const mode = String(req.body?.mode || 'all').toLowerCase();
        const targetWallet = String(req.body?.wallet || '').trim();

        if (mode === 'all') {
            await pool.query(`DELETE FROM transactions WHERE ${scope.clause}`, scope.params);
            if (user.role === 'admin') {
                memoryEditSessions.clear();
                await pool.query('DELETE FROM telegram_edit_sessions').catch(() => {});
            }
            return res.json({
                success: true,
                mode: 'all',
                balance: 0,
                message: 'Seluruh transaksi Anda telah dihapus dan saldo direset kembali ke Rp 0.'
            });
        }

        if (mode === 'wallet' && targetWallet && targetWallet !== 'all') {
            const wRes = await pool.query(
                `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS net
                 FROM transactions
                 WHERE ${scope.clause} AND LOWER(COALESCE(wallet, 'Tunai')) = LOWER($2)`,
                [...scope.params, targetWallet]
            );
            const walletNet = Number(wRes.rows[0]?.net || 0);
            if (walletNet === 0) {
                return res.json({
                    success: true,
                    mode: 'wallet',
                    wallet: targetWallet,
                    balance: 0,
                    transaction: null,
                    message: `Saldo kantong ${targetWallet} sudah Rp 0.`
                });
            }
            const adjType = walletNet > 0 ? 'expense' : 'income';
            const adjAmount = Math.abs(walletNet);
            const ins = await pool.query(
                `INSERT INTO transactions ("desc", amount, type, category, wallet, date, user_id)
                 VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)
                 RETURNING *`,
                [`Penyesuaian Hapus Saldo ${targetWallet} (Rp 0)`, adjAmount, adjType, 'Umum', targetWallet, user.id]
            );
            return res.json({
                success: true,
                mode: 'wallet',
                wallet: targetWallet,
                balance: 0,
                transaction: ins.rows[0],
                message: `Saldo kantong ${targetWallet} berhasil dinolkan ke Rp 0.`
            });
        }

        // Default mode === 'zero': Nolkan Saldo Berjalan tanpa menghapus riwayat transaksi
        const balanceRes = await pool.query(
            `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS balance
             FROM transactions WHERE ${scope.clause}`,
            scope.params
        );
        const balance = Number(balanceRes.rows[0]?.balance || 0);
        if (balance === 0) {
            return res.json({
                success: true,
                mode: 'zero',
                balance: 0,
                transaction: null,
                message: 'Saldo berjalan saat ini sudah Rp 0.'
            });
        }

        const adjType = balance > 0 ? 'expense' : 'income';
        const adjAmount = Math.abs(balance);
        const ins = await pool.query(
            `INSERT INTO transactions ("desc", amount, type, category, wallet, date, user_id)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)
             RETURNING *`,
            ['Penyesuaian Hapus Saldo Berjalan (Rp 0)', adjAmount, adjType, 'Umum', 'Tunai', user.id]
        );
        return res.json({
            success: true,
            mode: 'zero',
            balance: 0,
            transaction: ins.rows[0],
            message: 'Saldo berjalan berhasil dinolkan kembali ke Rp 0.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Reset / Hapus Semua Transaksi (DELETE)
app.delete('/api/transactions', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const scope = buildUserScope(user);
        await pool.query(`DELETE FROM transactions WHERE ${scope.clause}`, scope.params);
        if (user.role === 'admin') {
            memoryEditSessions.clear();
            await pool.query('DELETE FROM telegram_edit_sessions').catch(() => {});
        }
        res.json({ success: true, mode: 'all', balance: 0, message: 'Semua transaksi Anda berhasil direset kembali ke Rp 0.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Edit / Update Transaksi Kapan Saja
app.put('/api/transactions/:id', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const scope = buildUserScope(user);
        const trxId = Number(req.params.id);
        if (!Number.isFinite(trxId)) return res.status(400).json({ error: 'ID transaksi tidak valid.' });

        const existingRes = await pool.query(
            `SELECT * FROM transactions WHERE id = $2 AND ${scope.clause}`,
            [...scope.params, trxId]
        );
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

// API: Hapus Transaksi Spesifik
app.delete('/api/transactions/:id', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const scope = buildUserScope(user);
        const trxId = Number(req.params.id);
        if (!Number.isFinite(trxId)) return res.status(400).json({ error: 'ID transaksi tidak valid.' });
        await pool.query(
            `DELETE FROM transactions WHERE id = $2 AND ${scope.clause}`,
            [...scope.params, trxId]
        );
        res.json({ success: true, id: trxId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// API: Export Google Sheets (CSV/TSV)
app.get('/api/export-googlesheet', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const scope = buildUserScope(user);
        const result = await pool.query(
            `SELECT id, "desc", amount, type, category, wallet, date FROM transactions WHERE ${scope.clause} ORDER BY date DESC`,
            scope.params
        );
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
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const scope = buildUserScope(user);
        const result = await pool.query(
            `SELECT id, "desc", amount, type, category, wallet, date FROM transactions WHERE ${scope.clause} ORDER BY date DESC`,
            scope.params
        );
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

// ================= API PIUTANG & UTANG =================

// API: Ambil semua piutang & utang
app.get('/api/debts', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const scope = buildUserScope(user);
        const result = await pool.query(
            `SELECT * FROM debts WHERE ${scope.clause} ORDER BY created_at DESC, id DESC`,
            scope.params
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Ringkasan total piutang & utang
app.get('/api/debts/summary', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const scope = buildUserScope(user);
        const pQuery = `SELECT COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(paid_amount), 0) AS paid FROM debts WHERE type = 'piutang' AND ${scope.clause}`;
        const uQuery = `SELECT COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(paid_amount), 0) AS paid FROM debts WHERE type = 'utang' AND ${scope.clause}`;
        const piutang = await pool.query(pQuery, scope.params);
        const utang = await pool.query(uQuery, scope.params);
        const pTotal = Number(piutang.rows[0]?.total || 0);
        const pPaid = Number(piutang.rows[0]?.paid || 0);
        const uTotal = Number(utang.rows[0]?.total || 0);
        const uPaid = Number(utang.rows[0]?.paid || 0);
        res.json({
            piutang: { total: pTotal, paid: pPaid, outstanding: pTotal - pPaid },
            utang: { total: uTotal, paid: uPaid, outstanding: uTotal - uPaid },
            net: (pTotal - pPaid) - (uTotal - uPaid)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Tambah piutang atau utang baru
app.post('/api/debts', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const { type, desc, amount, due_date, status, paid_amount } = req.body;
        if (!type || !['piutang', 'utang'].includes(type)) {
            return res.status(400).json({ error: "Type harus 'piutang' atau 'utang'" });
        }
        if (!desc || !amount || Number(amount) <= 0) {
            return res.status(400).json({ error: 'Deskripsi dan nominal harus diisi dengan benar' });
        }
        const numAmount = Number(amount);
        const numPaid = Math.max(0, Number(paid_amount) || 0);
        let finalStatus = status;
        if (!finalStatus) {
            finalStatus = numPaid >= numAmount ? 'paid' : numPaid > 0 ? 'partial' : 'pending';
        }
        const query = `
            INSERT INTO debts (type, "desc", amount, due_date, status, paid_amount, user_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `;
        const result = await pool.query(query, [type, desc.trim(), numAmount, due_date || null, finalStatus, numPaid, user.id]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// API: Update data / status / pembayaran piutang atau utang
app.put('/api/debts/:id', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const debtId = Number(req.params.id);
        if (!Number.isFinite(debtId)) return res.status(400).json({ error: 'ID utang/piutang tidak valid.' });
        const scope = buildUserScope(user);
        const owned = await pool.query(
            `SELECT id FROM debts WHERE id = $2 AND ${scope.clause}`,
            [...scope.params, debtId]
        );
        if (owned.rows.length === 0) return res.status(404).json({ error: 'Data utang/piutang tidak ditemukan.' });
        const { type, desc, amount, due_date, status, paid_amount } = req.body;
        const updateFields = [];
        const values = [];
        let paramIdx = 1;

        if (type !== undefined) {
            if (!['piutang', 'utang'].includes(type)) return res.status(400).json({ error: "Type harus 'piutang' atau 'utang'" });
            updateFields.push(`type = $${paramIdx++}`);
            values.push(type);
        }
        if (desc !== undefined) {
            if (!String(desc).trim()) return res.status(400).json({ error: 'Deskripsi tidak boleh kosong' });
            updateFields.push(`"desc" = $${paramIdx++}`);
            values.push(String(desc).trim());
        }
        if (amount !== undefined) {
            const numAmount = Number(amount);
            if (!Number.isFinite(numAmount) || numAmount <= 0) return res.status(400).json({ error: 'Nominal harus lebih dari 0' });
            updateFields.push(`amount = $${paramIdx++}`);
            values.push(numAmount);
        }
        if (due_date !== undefined) {
            updateFields.push(`due_date = $${paramIdx++}`);
            values.push(due_date || null);
        }
        if (paid_amount !== undefined) {
            const numPaid = Math.max(0, Number(paid_amount) || 0);
            updateFields.push(`paid_amount = $${paramIdx++}`);
            values.push(numPaid);
        }
        if (status !== undefined) {
            updateFields.push(`status = $${paramIdx++}`);
            values.push(status);
        }

        if (updateFields.length === 0) return res.status(400).json({ error: 'Tidak ada field untuk diupdate' });
        values.push(debtId);
        const query = `UPDATE debts SET ${updateFields.join(', ')} WHERE id = $${paramIdx} RETURNING *`;
        const result = await pool.query(query, values);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Data utang/piutang tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// API: Hapus piutang atau utang
app.delete('/api/debts/:id', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const debtId = Number(req.params.id);
        if (!Number.isFinite(debtId)) return res.status(400).json({ error: 'ID utang/piutang tidak valid.' });
        const scope = buildUserScope(user);
        await pool.query(
            `DELETE FROM debts WHERE id = $2 AND ${scope.clause}`,
            [...scope.params, debtId]
        );
        res.json({ success: true, id: debtId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= WEBHOOK TELEGRAM BOT =================
app.post(`/api/telegram-webhook`, async (req, res) => {
    await ensureDatabaseReady();
    const update = req.body || {};

    // 1. HANDLE TOMBOL INTERAKTIF (CALLBACK QUERY DARI INLINE KEYBOARD)
    if (update.callback_query) {
        const cb = update.callback_query;
        const chatId = String(cb.message?.chat?.id || cb.from?.id || '');
        const messageId = cb.message?.message_id;
        const data = String(cb.data || '');

        if (!chatId) {
            await answerCallbackQuery(cb.id);
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
                        `🧭 *MENU UTAMA SAKU HARIAN SMART PLANNER*\n━━━━━━━━━━━━━━━━━━━\n💳 *Saldo Berjalan:* *Rp ${balance.toLocaleString('id-ID')}*\n\n👇 Silakan pencet tombol menu di bawah ini tanpa perlu repot mengetik:`,
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

🦥 Tips Saku: Pisahkan e-wallet harian (GoPay/DANA/OVO) dari rekening tabungan utama (BCA/Mandiri/SeaBank) agar saldo tidak bocor halus!
                    `.trim();
                    await editTelegramMessage(chatId, messageId, tipsMsg, buildMainMenuInlineKeyboard());
                    return res.sendStatus(200);
                }

                if (sub === 'reset_prompt') {
                    await answerCallbackQuery(cb.id, '⚠️ Pilih Mode Hapus / Reset Saldo');
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
                        `✅ *RESET KEMBALI KE SEMULA BERHASIL!*\n━━━━━━━━━━━━━━━━━━━\n🗑️ Seluruh riwayat transaksi telah dihapus.\n💳 *Saldo Berjalan Sekarang:* *Rp 0*\n\n👇 Silakan mulai mencatat kembali dengan menekan tombol di bawah:`,
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
                        ['Penyesuaian Hapus Saldo Berjalan (Rp 0)', adjAmount, adjType, 'Umum', 'Tunai']
                    );
                    await answerCallbackQuery(cb.id, '✅ Saldo berjalan dinolkan ke Rp 0!');
                    await editTelegramMessage(
                        chatId,
                        messageId,
                        `🧹 *SALDO BERJALAN BERHASIL DIHAPUS / DINOLKAN!*\n━━━━━━━━━━━━━━━━━━━\n⚖️ Penyesuaian otomatis sebesar *Rp ${adjAmount.toLocaleString('id-ID')}* telah dicatat.\n💳 *Saldo Berjalan Sekarang:* *Rp 0*\n\nRiwayat transaksi lama tetap tersimpan.`,
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

                await setEditSession(chatId, 0, 'qa_custom_amt', { typeKey, itemIdx });

                await answerCallbackQuery(cb.id, `${chosen.label} dipilih`);
                const msg = `
${typeKey === 'inc' ? '🟢 *CATAT PEMASUKAN*' : '🔴 *CATAT PENGELUARAN*'}
━━━━━━━━━━━━━━━━━━━
📌 *Kategori:* ${chosen.label}

👇 *Langkah 2/3:* Pencet salah satu *Tombol Nominal* di bawah ini (atau langsung ketik nominal/keterangan di chat):
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
                    `⌨️ *KETIK NOMINAL UNTUK ${chosen.label.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━\nSilakan ketik nominalnya saja (contoh: 35000) atau keterangan beserta nominal (contoh: Nasi Padang 35000).`
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
                    `💰 *UBAH NOMINAL TRANSAKSI #${trxId}*\nSilakan balas pesan ini dengan mengetikkan *nominal baru* (angka saja, contoh: 45000), atau ketik /batal untuk membatalkan.`
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
            await answerCallbackQuery(cb.id, 'Memproses aksi...');
        }
        return res.sendStatus(200);
    }

    const msgObj = update.message || update.edited_message;
    if (!msgObj) return res.sendStatus(200);

    const chatId = String(msgObj.chat?.id || '');
    if (!chatId) return res.sendStatus(200);

    const text = msgObj.text;
    const photo = msgObj.photo;
    const voice = msgObj.voice;

    try {
        const cleanText = String(text || '').trim();
        const lowerText = cleanText.toLowerCase();
        // Normalisasi: hilangkan @NamaBot pada command & variasi karakter emoji (FE0F)
        const normalizedCmd = lowerText.split('@')[0].replace(/\uFE0F/g, '').replace(/\s+/g, ' ').trim();
        const hasDigits = /\d/.test(normalizedCmd);

        // DETEKSI TOMBOL MENU KEYBOARD BAWAH ATAU COMMAND '/' ATAU KATA KUNCI LANGSUNG
        const isMenuTrigger =
            normalizedCmd === '/start' ||
            normalizedCmd === '/menu' ||
            normalizedCmd === '/help' ||
            (!hasDigits && (
                normalizedCmd === 'menu' ||
                normalizedCmd.includes('menu utama') ||
                normalizedCmd === 'bantuan' ||
                normalizedCmd === 'mulai'
            ));

        const isIncomeTrigger =
            normalizedCmd === '/pemasukan' ||
            normalizedCmd === '/income' ||
            normalizedCmd === '/masuk' ||
            (!hasDigits && (
                normalizedCmd.includes('pemasukan') ||
                normalizedCmd === 'uang masuk' ||
                normalizedCmd === 'catat masuk'
            ));

        const isExpenseTrigger =
            normalizedCmd === '/pengeluaran' ||
            normalizedCmd === '/expense' ||
            normalizedCmd === '/keluar' ||
            (!hasDigits && (
                normalizedCmd.includes('pengeluaran') ||
                normalizedCmd === 'uang keluar' ||
                normalizedCmd === 'catat keluar'
            ));

        const isSaldoTrigger =
            normalizedCmd === '/saldo' ||
            normalizedCmd === '/rekap' ||
            (!hasDigits && (
                normalizedCmd === 'saldo' ||
                normalizedCmd.includes('cek saldo') ||
                normalizedCmd.includes('info saldo') ||
                normalizedCmd === 'rekap' ||
                normalizedCmd === 'saldo berjalan'
            ));

        const isDompetTrigger =
            normalizedCmd === '/dompet' ||
            normalizedCmd === '/wallet' ||
            (!hasDigits && (
                normalizedCmd === 'dompet' ||
                normalizedCmd === 'wallet' ||
                normalizedCmd.includes('saldo e-wallet') ||
                normalizedCmd.includes('cek dompet') ||
                normalizedCmd.includes('kantong dana')
            ));

        const isHistoryTrigger =
            normalizedCmd === '/history' ||
            normalizedCmd === '/riwayat' ||
            normalizedCmd === '/edit' ||
            (!hasDigits && (
                normalizedCmd === 'riwayat' ||
                normalizedCmd === 'history' ||
                normalizedCmd === 'edit' ||
                normalizedCmd.includes('riwayat & edit') ||
                normalizedCmd.includes('edit transaksi')
            ));

        const isResetTrigger =
            normalizedCmd === '/reset' ||
            normalizedCmd === '/hapus' ||
            (!hasDigits && (
                normalizedCmd === 'reset' ||
                normalizedCmd.includes('hapus saldo') ||
                normalizedCmd.includes('reset saldo') ||
                normalizedCmd.includes('reset data') ||
                normalizedCmd.includes('nolkan saldo')
            ));

        const isTipsTrigger =
            normalizedCmd === '/tips' ||
            (!hasDigits && (
                normalizedCmd === 'tips' ||
                normalizedCmd.includes('tips hemat') ||
                normalizedCmd.includes('saran hemat')
            ));

        if (normalizedCmd === '/batal' || normalizedCmd === 'batal') {
            await clearEditSession(chatId);
            await sendTelegramMessage(chatId, "✅ Aksi dibatalkan. Silakan pilih tombol menu di bawah.");
            return res.sendStatus(200);
        }

        // EKSEKUSI TOMBOL MENU / COMMAND SECARA INSTAN
        if (isMenuTrigger) {
            await clearEditSession(chatId);
            const { balance } = await getRunningBalanceSummary();
            await sendTelegramMessage(
                chatId,
                `👋 *Selamat datang di Saku Harian Smart Planner Bot!*\nKeyboard menu cepat di bagian bawah layar sudah aktif.`
            );
            await sendTelegramMessage(
                chatId,
                `🧭 *MENU UTAMA SAKU HARIAN*\n━━━━━━━━━━━━━━━━━━━\n💳 *Saldo Berjalan:* *Rp ${balance.toLocaleString('id-ID')}*\n\n✨ *Pilih Tombol Menu Tanpa Ketik:*\n• Pencet *🟢 ➕ Pemasukan* atau *🔴 ➖ Pengeluaran*\n• Ketik *saldo* atau pencet *💰 Cek Saldo* kapan saja\n• Pencet *🔄 Hapus Saldo Berjalan / Reset Semula* untuk mengembalikan saldo ke *Rp 0*`,
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
📝 *Keterangan:* ${sanitizeSafeText(customDesc || chosen.desc)}
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

            // Normalisasi kategori untuk nota Alfamart / Indomaret / supermarket / sembako
            const lowerDesc = String(parsed.desc || '').toLowerCase();
            if (/alfamart|indomaret|supermarket|sembako|mini market|ceriamart/.test(lowerDesc)) {
                parsed.category = 'Belanja & Lifestyle';
            }
            // Fallback wallet jika Gemini tidak mengembalikan wallet yang valid
            if (!parsed.wallet || parsed.wallet === 'Kategori bebas') {
                parsed.wallet = 'Tunai';
            }

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

            // Normalisasi kategori untuk nota Alfamart / Indomaret / supermarket / sembako
            const lowerDesc = String(parsed.desc || '').toLowerCase();
            if (/alfamart|indomaret|supermarket|sembako|mini market|ceriamart/.test(lowerDesc)) {
                parsed.category = 'Belanja & Lifestyle';
            }
            // Fallback wallet jika Gemini tidak mengembalikan wallet yang valid
            if (!parsed.wallet || parsed.wallet === 'Kategori bebas') {
                parsed.wallet = 'Tunai';
            }

            await saveAndNotify(parsed, chatId);
        }
        // 3. PESAN TEKS BEBAS (DENGAN FALLBACK PARSER LOKAL PINTAR)
        else if (cleanText) {
            const localParsed = parseNaturalTransactionText(cleanText);
            if (localParsed && localParsed.isTransaction) {
                await saveAndNotify(localParsed, chatId);
                return res.sendStatus(200);
            }

            try {
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
            } catch {
                const { balance } = await getRunningBalanceSummary();
                await sendTelegramMessage(
                    chatId,
                    `🧭 *MENU SAKU HARIAN SMART PLANNER*\n━━━━━━━━━━━━━━━━━━━\n💳 *Saldo Berjalan:* *Rp ${balance.toLocaleString('id-ID')}*\n\n👇 Silakan pilih tombol aksi cepat di bawah ini tanpa perlu repot mengetik:`,
                    buildMainMenuInlineKeyboard()
                );
            }
        }
    } catch (err) {
        console.error("Error:", err);
        await sendTelegramMessage(
            chatId,
            "🧭 Silakan gunakan tombol menu cepat di bawah ini untuk mencatat *🟢 Pemasukan*, *🔴 Pengeluaran*, *💰 Cek Saldo*, atau *🔄 Hapus/Reset Saldo*:",
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
