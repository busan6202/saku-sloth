const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const cors = require('cors');
const {
    hashPassword,
    verifyPassword,
    passwordNeedsRehash,
    safeEqualString,
    generateSessionToken,
    readSessionToken,
    buildSessionCookie,
    buildClearSessionCookie,
    buildUserScope,
    createRateLimiter
} = require('./lib/security');
require('dotenv').config();

const app = express();
// Limit dinaikkan agar ikon produk kustom (data URL gambar) muat di payload JSON.
app.use(express.json({ limit: '1mb' }));

// --- CORS: same-origin, origin terdaftar di CORS_ORIGINS, dan hosting statis GitHub Pages ---
const ALLOWED_ORIGINS = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

// Frontend juga bisa dibuka sebagai hosting statis (GitHub Pages) yang memanggil API ini
// dari domain berbeda. Tanpa izin ini semua request diblokir browser ("Failed to fetch").
function isOriginAllowed(origin, req) {
    if (!origin) return true; // same-origin / non-browser client
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    try {
        const url = new URL(origin);
        if (url.host === req.headers.host) return true;
        if (url.protocol === 'https:' && (url.hostname === 'github.io' || url.hostname.endsWith('.github.io'))) return true;
        if (['localhost', '127.0.0.1'].includes(url.hostname)) return true;
    } catch {
        return false;
    }
    return false;
}

app.use((req, res, next) => {
    cors({
        origin(origin, callback) {
            callback(null, isOriginAllowed(origin, req));
        },
        credentials: true,
        allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'x-session-token', 'x-pos-secret'],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    })(req, res, next);
});

// --- Proteksi CSRF ringan: permintaan yang mengubah data via cookie harus same-origin/terdaftar ---
app.use((req, res, next) => {
    const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (safeMethod) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    const cookies = req.headers.cookie || '';
    if (!cookies.includes('saku_session=')) return next();
    if (isOriginAllowed(origin, req)) return next();
    return res.status(403).json({ error: 'Permintaan lintas situs ditolak.' });
});

// --- Jangan bocorkan detail error internal ke klien pada produksi ---
app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
        if (res.statusCode >= 500 && body && typeof body === 'object' && typeof body.error === 'string') {
            console.error(`[server-error] ${req.method} ${req.originalUrl}:`, body.error);
            if (process.env.NODE_ENV === 'production') {
                return originalJson({ error: 'Terjadi kesalahan pada server. Silakan coba lagi.' });
            }
        }
        return originalJson(body);
    };
    next();
});

// --- Static file whitelist: jangan menyajikan source server/.env lewat express.static(__dirname) ---
const PUBLIC_STATIC_FILES = new Set([
    'index.html',
    'style.css',
    'script.js',
    'pos.html',
    'pos.css',
    'pos.js',
    'harga.html',
    'harga.css',
    'harga.js',
    'struk.html',
    'sw.js',
    'sayur-nusantara.js',
    'favicon.ico',
    'manifest.webmanifest'
]);

// Akun kasir tidak boleh membuka dashboard utama, bahkan dengan sesi yang valid.
async function isCashierSession(req) {
    if (!readSessionToken(req)) return false;
    try {
        const user = await resolveAuthUser(req);
        return user?.role === 'cashier';
    } catch {
        return false;
    }
}

app.get('/struk', (req, res) => res.sendFile(path.join(__dirname, 'struk.html')));
app.get('/struk/:invoice', (req, res) => res.sendFile(path.join(__dirname, 'struk.html')));

app.get('/:file', async (req, res, next) => {
    try {
        const name = String(req.params.file || '');
        if (name === 'pos') return res.sendFile(path.join(__dirname, 'pos.html'));
        if (name === 'struk') return res.sendFile(path.join(__dirname, 'struk.html'));
        if (name === 'harga') {
            if (await isCashierSession(req)) return res.redirect('/pos');
            return res.sendFile(path.join(__dirname, 'harga.html'));
        }
        if (!PUBLIC_STATIC_FILES.has(name)) return next();
        if (name === 'index.html' && await isCashierSession(req)) {
            return res.redirect('/pos');
        }
        if (name === 'harga.html' && await isCashierSession(req)) {
            return res.redirect('/pos');
        }
        if (name === 'sw.js') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Service-Worker-Allowed', '/');
        }
        res.sendFile(path.join(__dirname, name));
    } catch (err) {
        next(err);
    }
});
app.use('/icons', express.static(path.join(__dirname, 'icons'), { fallthrough: false, maxAge: '7d' }));

// Akun kasir hanya boleh memakai modul POS. Endpoint dashboard keuangan ditolak.
app.use(async (req, res, next) => {
    try {
        if (!req.path.startsWith('/api/')) return next();
        if (req.path.startsWith('/api/pos') || req.path.startsWith('/api/auth') || req.path === '/api/telegram-webhook') return next();
        const user = await resolveAuthUser(req);
        if (user && user.role === 'cashier') {
            return res.status(403).json({ error: 'Akun kasir hanya dapat mengakses modul POS.' });
        }
        return next();
    } catch {
        return next();
    }
});

app.get('/', async (req, res, next) => {
    try {
        if (await isCashierSession(req)) return res.redirect('/pos');
        res.sendFile(path.join(__dirname, 'index.html'));
    } catch (err) {
        next(err);
    }
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

// Token bot WAJIB berasal dari environment. Jangan pernah menaruh token asli di source.
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_WEBHOOK_SECRET = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const TELEGRAM_ALLOWED_CHAT_IDS = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const PUBLIC_WEBHOOK_URL = (process.env.WEBHOOK_URL || 'https://saku-sloth.vercel.app/api/telegram-webhook').trim();

if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN belum diatur — fitur bot Telegram nonaktif.');
}
if (!TELEGRAM_WEBHOOK_SECRET) {
    console.warn('[telegram] TELEGRAM_WEBHOOK_SECRET belum diatur — webhook tidak memverifikasi secret_token.');
}

// Rate limiter untuk endpoint autentikasi (brute-force protection).
const authRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, blockMs: 15 * 60 * 1000 });
const registerRateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20, blockMs: 60 * 60 * 1000 });

function clientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

function guardRateLimit(limiter, req, res) {
    const result = limiter.check(clientIp(req));
    if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfter));
        res.status(429).json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${result.retryAfter} detik.` });
        return false;
    }
    return true;
}

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

    if (!TELEGRAM_BOT_TOKEN) return report;

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
                const webhookPayload = {
                    url: PUBLIC_WEBHOOK_URL,
                    allowed_updates: ['message', 'edited_message', 'callback_query'],
                    drop_pending_updates: false
                };
                // Telegram akan mengirim header X-Telegram-Bot-Api-Secret-Token yang harus
                // cocok dengan nilai ini, sehingga webhook tidak bisa dipalsukan pihak lain.
                if (TELEGRAM_WEBHOOK_SECRET) webhookPayload.secret_token = TELEGRAM_WEBHOOK_SECRET;

                const setWhRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
                    body: JSON.stringify(webhookPayload)
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
                    owner_id INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await pool.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS email VARCHAR(160)
            `);
            // Akun kasir menempel ke akun pemilik (owner) agar memakai data POS yang sama.
            await pool.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS owner_id INTEGER
            `);
            await pool.query(`
                CREATE INDEX IF NOT EXISTS users_owner_idx ON users (owner_id)
            `);
            // Pemetaan chat Telegram -> akun agar data bot terisolasi per pengguna.
            await pool.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(64)
            `);
            await pool.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_chat_unique_idx
                ON users (telegram_chat_id)
                WHERE telegram_chat_id IS NOT NULL
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

            // --- SKEMA MODUL POS KASIR ---
            await pool.query(`
                CREATE TABLE IF NOT EXISTS pos_products (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    sku VARCHAR(64),
                    barcode VARCHAR(64),
                    name VARCHAR(160) NOT NULL,
                    category VARCHAR(50) NOT NULL DEFAULT 'UMUM',
                    unit VARCHAR(20) NOT NULL DEFAULT 'PCS',
                    is_weighable BOOLEAN NOT NULL DEFAULT FALSE,
                    price_sell NUMERIC(14,2) NOT NULL DEFAULT 0,
                    price_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
                    stock NUMERIC(10,3) NOT NULL DEFAULT 0,
                    min_stock NUMERIC(10,3) NOT NULL DEFAULT 0,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            // Ikon produk kustom (data URL PNG/JPEG/WebP) opsional per produk.
            await pool.query(`ALTER TABLE pos_products ADD COLUMN IF NOT EXISTS icon_url TEXT`);
            await pool.query(`CREATE INDEX IF NOT EXISTS pos_products_user_idx ON pos_products (user_id)`);
            await pool.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS pos_products_barcode_unique_idx
                ON pos_products (user_id, LOWER(barcode))
                WHERE barcode IS NOT NULL AND barcode <> ''
            `);
            await pool.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS pos_products_sku_unique_idx
                ON pos_products (user_id, LOWER(sku))
                WHERE sku IS NOT NULL AND sku <> ''
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS pos_sales (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    invoice_no VARCHAR(48) UNIQUE NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                    payment_method VARCHAR(20) NOT NULL DEFAULT 'CASH',
                    wallet VARCHAR(80) NOT NULL DEFAULT 'Tunai',
                    total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
                    total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
                    gross_profit NUMERIC(14,2) NOT NULL DEFAULT 0,
                    paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
                    change_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
                    customer_name VARCHAR(120),
                    customer_phone VARCHAR(32),
                    note TEXT,
                    cashier_id INTEGER,
                    cashier_name VARCHAR(100),
                    sheet_synced BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    paid_at TIMESTAMP
                )
            `);
            await pool.query(`CREATE INDEX IF NOT EXISTS pos_sales_user_date_idx ON pos_sales (user_id, created_at DESC)`);
            await pool.query(`ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS cashier_id INTEGER`);
            await pool.query(`ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS cashier_name VARCHAR(100)`);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS pos_sale_items (
                    id SERIAL PRIMARY KEY,
                    sale_id INTEGER NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
                    product_id INTEGER REFERENCES pos_products(id) ON DELETE SET NULL,
                    product_name VARCHAR(160) NOT NULL,
                    sku VARCHAR(64),
                    unit VARCHAR(20) NOT NULL DEFAULT 'PCS',
                    qty NUMERIC(10,3) NOT NULL,
                    unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
                    unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
                    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
                    subtotal_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
                    profit NUMERIC(14,2) NOT NULL DEFAULT 0
                )
            `);
            await pool.query(`CREATE INDEX IF NOT EXISTS pos_sale_items_sale_idx ON pos_sale_items (sale_id)`);

            // Migrasi aman dari versi stok/qty integer ke desimal (timbangan kg/ons)
            await pool.query(`ALTER TABLE pos_products ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'UMUM'`);
            await pool.query(`ALTER TABLE pos_products ADD COLUMN IF NOT EXISTS unit VARCHAR(20) NOT NULL DEFAULT 'PCS'`);
            await pool.query(`ALTER TABLE pos_products ADD COLUMN IF NOT EXISTS is_weighable BOOLEAN NOT NULL DEFAULT FALSE`);
            await pool.query(`ALTER TABLE pos_products ALTER COLUMN stock TYPE NUMERIC(10,3) USING stock::numeric`);
            await pool.query(`ALTER TABLE pos_products ALTER COLUMN min_stock TYPE NUMERIC(10,3) USING min_stock::numeric`);
            await pool.query(`ALTER TABLE pos_sale_items ADD COLUMN IF NOT EXISTS unit VARCHAR(20) NOT NULL DEFAULT 'PCS'`);
            await pool.query(`ALTER TABLE pos_sale_items ALTER COLUMN qty TYPE NUMERIC(10,3) USING qty::numeric`);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS pos_spoilage_logs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    product_id INTEGER REFERENCES pos_products(id) ON DELETE SET NULL,
                    product_name VARCHAR(160) NOT NULL,
                    unit VARCHAR(20) NOT NULL DEFAULT 'KG',
                    qty_lost NUMERIC(10,3) NOT NULL,
                    loss_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
                    reason VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await pool.query(`CREATE INDEX IF NOT EXISTS pos_spoilage_user_date_idx ON pos_spoilage_logs (user_id, created_at DESC)`);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS pos_purchases (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    wallet VARCHAR(80) NOT NULL DEFAULT 'Tunai',
                    total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
                    note TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS pos_purchase_items (
                    id SERIAL PRIMARY KEY,
                    purchase_id INTEGER NOT NULL REFERENCES pos_purchases(id) ON DELETE CASCADE,
                    product_id INTEGER REFERENCES pos_products(id) ON DELETE SET NULL,
                    product_name VARCHAR(160) NOT NULL,
                    unit VARCHAR(20) NOT NULL DEFAULT 'KG',
                    qty NUMERIC(10,3) NOT NULL,
                    cost_per_unit NUMERIC(14,2) NOT NULL DEFAULT 0,
                    sell_price NUMERIC(14,2),
                    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0
                )
            `);
            await pool.query(`CREATE INDEX IF NOT EXISTS pos_purchase_items_purchase_idx ON pos_purchase_items (purchase_id)`);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS pos_settings (
                    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    qris_payload TEXT,
                    sheets_webhook_url TEXT,
                    store_name VARCHAR(120),
                    store_address TEXT,
                    store_logo TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await pool.query(`ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS store_name VARCHAR(120)`);
            await pool.query(`ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS store_address TEXT`);
            await pool.query(`ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS store_logo TEXT`);

            // Tidak ada lagi akun admin/password default yang ditanam otomatis.
            // Akun admin (bila ada) dibuat manual dan wajib memakai kata sandi kuat.

            // Data lama tanpa pemilik diwariskan HANYA ke akun admin agar tidak terlihat
            // oleh pengguna biasa (dan tidak pernah ke akun bot Telegram).
            const ownerRes = await pool.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
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
// hashPassword / verifyPassword / generateSessionToken / buildUserScope
// berasal dari lib/security.js (lihat require di bagian atas file).

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
        // Token diambil dari header Authorization / x-session-token / cookie HttpOnly.
        // Tidak lagi menerima token lewat query string (?auth_token=) karena mudah bocor di log.
        const token = readSessionToken(req);
        if (!token) return null;

        const sessionRes = await pool.query(
            `SELECT u.id, u.username, u.email, u.full_name, u.avatar, u.role, u.owner_id
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

// buildUserScope diimpor dari lib/security.js (admin tetap melihat baris legacy).

// Akun kasir hanya boleh memakai modul POS, bukan dashboard keuangan.
function isCashier(user) {
    return user?.role === 'cashier';
}

// Data POS selalu milik akun pemilik, sehingga kasir melihat katalog & transaksi toko yang sama.
function posOwnerId(user) {
    return Number(user?.owner_id) || Number(user?.id);
}

/**
 * Petakan chat Telegram ke satu akun pengguna.
 * Setiap chat mendapat akunnya sendiri (data terisolasi). Bila chat belum pernah
 * terdaftar, akun bot dibuat otomatis dengan kata sandi acak (tidak bisa login web).
 */
async function resolveTelegramUser(chatId) {
    const id = String(chatId || '').trim();
    if (!id) return null;

    const existing = await pool.query(
        'SELECT id, username, role FROM users WHERE telegram_chat_id = $1 LIMIT 1',
        [id]
    );
    if (existing.rows.length) return existing.rows[0];

    const digits = id.replace(/[^0-9]/g, '').slice(-12) || crypto.randomBytes(4).toString('hex');
    const username = `tg_${digits}`;
    const randomPassword = await hashPassword(crypto.randomBytes(24).toString('hex'));

    try {
        const inserted = await pool.query(
            `INSERT INTO users (username, email, password_hash, full_name, avatar, role, telegram_chat_id)
             VALUES ($1, NULL, $2, $3, '🐮', 'user', $4)
             RETURNING id, username, role`,
            [username, randomPassword, 'Pengguna Telegram', id]
        );
        return inserted.rows[0];
    } catch {
        // Balapan dua pesan bersamaan: ambil baris yang sudah dibuat oleh request lain.
        const retry = await pool.query(
            'SELECT id, username, role FROM users WHERE telegram_chat_id = $1 LIMIT 1',
            [id]
        );
        return retry.rows[0] || null;
    }
}

/** True bila daftar chat diizinkan (kosong = semua chat boleh, masing-masing terisolasi). */
function isTelegramChatAllowed(chatId) {
    if (TELEGRAM_ALLOWED_CHAT_IDS.length === 0) return true;
    return TELEGRAM_ALLOWED_CHAT_IDS.includes(String(chatId));
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

async function getRunningBalanceSummary(userId) {
    await ensureDatabaseReady();
    if (!Number.isFinite(Number(userId))) throw new Error('getRunningBalanceSummary butuh userId');
    const resStats = await pool.query(`
        SELECT
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
            COUNT(*) AS total_count
        FROM transactions
        WHERE user_id = $1
    `, [Number(userId)]);
    const row = resStats.rows[0] || {};
    const totalIncome = Number(row.total_income || 0);
    const totalExpense = Number(row.total_expense || 0);
    const totalCount = Number(row.total_count || 0);
    const balance = totalIncome - totalExpense;
    return { totalIncome, totalExpense, balance, totalCount };
}

async function buildSaldoMessageText(userId) {
    const { totalIncome, totalExpense, balance, totalCount } = await getRunningBalanceSummary(userId);
    const walletRes = await pool.query(`
        SELECT COALESCE(wallet, 'Tunai') as wallet,
               SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) as net
        FROM transactions
        WHERE user_id = $1
        GROUP BY COALESCE(wallet, 'Tunai')
        ORDER BY net DESC
        LIMIT 6
    `, [Number(userId)]);

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

async function buildDompetMessageText(userId) {
    await ensureDatabaseReady();
    const result = await pool.query(`
        SELECT COALESCE(wallet, 'Tunai') as wallet,
               SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as pemasukan,
               SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as pengeluaran
        FROM transactions
        WHERE user_id = $1
        GROUP BY COALESCE(wallet, 'Tunai')
        ORDER BY (SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)) DESC
    `, [Number(userId)]);
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

async function buildHistoryMessagePayload(userId) {
    await ensureDatabaseReady();
    const result = await pool.query(
        'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC, id DESC LIMIT 6',
        [Number(userId)]
    );
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

async function buildResetPromptText(userId) {
    const { balance, totalCount } = await getRunningBalanceSummary(userId);
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
async function saveAndNotify(trxData, chatId, existingMessageId, userId) {
    await ensureDatabaseReady();
    if (!Number.isFinite(Number(userId))) throw new Error('saveAndNotify butuh userId');
    const walletName = trxData.wallet || 'Tunai';
    const query = `INSERT INTO transactions ("desc", amount, type, category, wallet, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
    const values = [trxData.desc, trxData.amount, trxData.type, trxData.category || 'Umum', walletName, Number(userId)];

    const result = await pool.query(query, values);
    const savedTrx = result.rows[0];

    const { totalIncome, totalExpense, balance } = await getRunningBalanceSummary(userId);

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
        if (!guardRateLimit(registerRateLimiter, req, res)) return;
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

        const pHash = await hashPassword(String(password));
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
        const sessionTtlSeconds = 30 * 24 * 60 * 60;
        const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000);
        await pool.query(
            'INSERT INTO user_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
            [token, newUser.id, expiresAt]
        );
        res.setHeader('Set-Cookie', buildSessionCookie(req, token, sessionTtlSeconds));

        res.status(201).json({
            ok: true,
            message: 'Pendaftaran akun berhasil! Selamat datang di Saku Harian. 🐮✨',
            user: {
                id: newUser.id,
                username: newUser.username,
                email: newUser.email,
                fullName: newUser.full_name,
                avatar: newUser.avatar,
                role: newUser.role,
                ownerId: null
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
        if (!guardRateLimit(authRateLimiter, req, res)) return;
        await ensureDatabaseReady();
        const { email, username, identifier, password, remember } = req.body || {};
        const rawIdentifier = String(identifier || email || username || '').trim();
        if (!rawIdentifier || !password) {
            return res.status(400).json({ error: 'Email dan kata sandi harus diisi.' });
        }

        const isEmailLogin = rawIdentifier.includes('@');
        const userRes = isEmailLogin
            ? await pool.query(
                'SELECT id, username, email, password_hash, full_name, avatar, role, owner_id FROM users WHERE LOWER(email) = $1',
                [normalizeEmail(rawIdentifier)]
            )
            : await pool.query(
                'SELECT id, username, email, password_hash, full_name, avatar, role, owner_id FROM users WHERE LOWER(username) = $1',
                [rawIdentifier.toLowerCase()]
            );
        if (userRes.rows.length === 0) {
            return res.status(401).json({ error: 'Email atau kata sandi tidak cocok.' });
        }
        const user = userRes.rows[0];
        const isValid = await verifyPassword(String(password), user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Email atau kata sandi tidak cocok.' });
        }

        // Perbarui hash lama (1.000 iterasi) ke format baru saat login berhasil.
        if (passwordNeedsRehash(user.password_hash)) {
            const upgraded = await hashPassword(String(password));
            await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [upgraded, user.id]).catch(() => {});
        }

        const token = generateSessionToken();
        const sessionTtlSeconds = remember === false ? null : 30 * 24 * 60 * 60;
        const expiresAt = new Date(Date.now() + (sessionTtlSeconds || 12 * 60 * 60) * 1000);
        await pool.query(
            'INSERT INTO user_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
            [token, user.id, expiresAt]
        );
        res.setHeader('Set-Cookie', buildSessionCookie(req, token, sessionTtlSeconds || undefined));

        res.json({
            ok: true,
            message: 'Berhasil masuk ke Saku Harian! 🐮✨',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.full_name,
                avatar: user.avatar,
                role: user.role,
                ownerId: user.owner_id || null
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
                role: user.role,
                ownerId: user.owner_id || null
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
        const token = readSessionToken(req) || String(req.body?.token || '');
        if (token) {
            await pool.query('DELETE FROM user_sessions WHERE token = $1', [token]).catch(() => {});
        }
        res.setHeader('Set-Cookie', buildClearSessionCookie(req));
        res.json({ ok: true, message: 'Berhasil keluar.' });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// API: Setup / Sinkronisasi Menu Komando & Webhook Telegram
// Wajib login sebagai admin: endpoint ini mengubah konfigurasi bot & webhook global.
app.post('/api/setup-telegram-menu', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        }
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Hanya admin yang dapat mengubah konfigurasi bot.' });
        }
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

// ================= REST API MODUL POS =================

app.get('/pos', (req, res) => {
    res.sendFile(path.join(__dirname, 'pos.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// PWA "Saku Harga" — ubah harga produk cepat dari ponsel (khusus pemilik toko).
app.get('/harga/', (req, res) => res.redirect(301, '/harga'));
app.get('/harga', async (req, res, next) => {
    try {
        if (await isCashierSession(req)) return res.redirect('/pos');
        res.sendFile(path.join(__dirname, 'harga.html'));
    } catch (err) {
        next(err);
    }
});

// Sembunyikan HPP / harga modal & laba dari response API bila pengguna adalah akun kasir (karyawan).
// Pemilik toko (owner) tetap menerima seluruh data lengkap.
function sanitizePosProductForUser(row, user) {
    if (!row || !isCashier(user)) return row;
    const { price_cost: _omitCost, ...safe } = row;
    return safe;
}

function sanitizePosSaleForUser(sale, user) {
    if (!sale || !isCashier(user)) return sale;
    const { total_cost: _omitTotalCost, gross_profit: _omitGrossProfit, ...safe } = sale;
    return safe;
}

function sanitizePosSaleItemForUser(item, user) {
    if (!item || !isCashier(user)) return item;
    const { unit_cost: _uc1, unitCost: _uc2, subtotal_cost: _sc1, subtotalCost: _sc2, profit: _p, ...safe } = item;
    return safe;
}

// API: Daftar produk POS (pencarian nama/SKU/barcode)
app.get('/api/pos/products', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });

        const keyword = String(req.query.q || '').trim();
        const includeInactive = String(req.query.include_inactive || '') === '1';
        const params = [posOwnerId(user)];
        let query = `SELECT * FROM pos_products WHERE user_id = $1`;
        if (!includeInactive) query += ' AND is_active = TRUE';
        if (keyword) {
            params.push(`%${keyword.toLowerCase()}%`);
            query += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(COALESCE(sku, '')) LIKE $${params.length} OR LOWER(COALESCE(barcode, '')) LIKE $${params.length})`;
        }
        query += ' ORDER BY name ASC';
        const result = await pool.query(query, params);
        res.json(result.rows.map((row) => sanitizePosProductForUser(row, user)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Ringkasan harga produk untuk PWA "Saku Harga".
// Payload sengaja ringan (tanpa ikon/deskripsi) supaya sinkronisasi harga cepat & hemat kuota.
// Dukung mode delta lewat ?since=<epoch-ms> agar hanya baris yang berubah yang dikirim ulang.
app.get('/api/pos/products/price-sync', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });

        res.setHeader('Cache-Control', 'no-store');
        const ownerId = posOwnerId(user);
        const params = [ownerId];
        let query = `SELECT id, name, sku, barcode, unit, category, is_weighable, is_active,
                            price_sell, price_cost, stock, min_stock, icon_url,
                            EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_ms
                     FROM pos_products WHERE user_id = $1`;
        const since = Number(req.query.since);
        if (Number.isFinite(since) && since > 0) {
            params.push(since);
            query += ` AND EXTRACT(EPOCH FROM updated_at) * 1000 > $${params.length}`;
        }
        query += ' ORDER BY name ASC';
        const result = await pool.query(query, params);

        let liveSales = null;
        if (!isCashier(user)) {
            const rawToday = req.query.todayFrom;
            let todayStart;
            if (rawToday && !Number.isNaN(new Date(rawToday).getTime())) {
                todayStart = new Date(rawToday);
            } else {
                todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
            }
            const [summaryRes, recentRes] = await Promise.all([
                pool.query(
                    `SELECT COALESCE(SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END), 0)::int AS transactions,
                            COALESCE(SUM(CASE WHEN status = 'PAID' THEN total_amount ELSE 0 END), 0) AS omzet,
                            COALESCE(SUM(CASE WHEN status = 'PAID' THEN total_cost ELSE 0 END), 0) AS hpp,
                            COALESCE(SUM(CASE WHEN status = 'PAID' THEN gross_profit ELSE 0 END), 0) AS laba,
                            COALESCE(SUM(CASE WHEN status = 'PAID' AND payment_method = 'CASH' THEN total_amount ELSE 0 END), 0) AS cash_total,
                            COALESCE(SUM(CASE WHEN status = 'PAID' AND payment_method = 'QRIS' THEN total_amount ELSE 0 END), 0) AS qris_total,
                            COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0)::int AS pending
                     FROM pos_sales
                     WHERE user_id = $1 AND created_at >= $2`,
                    [ownerId, todayStart]
                ),
                pool.query(
                    `SELECT s.id, s.invoice_no, s.status, s.payment_method, s.wallet,
                            s.total_amount, s.total_cost, s.gross_profit,
                            s.paid_amount, s.change_amount, s.customer_name,
                            s.cashier_id, s.cashier_name, s.created_at, s.paid_at,
                            (SELECT COUNT(*) FROM pos_sale_items i WHERE i.sale_id = s.id)::int AS item_count,
                            (SELECT STRING_AGG(
                                i.product_name || ' ×' ||
                                TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM i.qty::text)) ||
                                ' ' || COALESCE(i.unit, 'PCS'),
                                ', ' ORDER BY i.id
                             ) FROM pos_sale_items i WHERE i.sale_id = s.id) AS items_summary
                     FROM pos_sales s
                     WHERE s.user_id = $1 AND s.created_at >= $2 AND s.status IN ('PAID', 'PENDING')
                     ORDER BY COALESCE(s.paid_at, s.created_at) DESC, s.id DESC
                     LIMIT 20`,
                    [ownerId, todayStart]
                )
            ]);
            const sRow = summaryRes.rows[0] || {};
            liveSales = {
                summary: {
                    transactions: Number(sRow.transactions || 0),
                    omzet: Number(sRow.omzet || 0),
                    hpp: Number(sRow.hpp || 0),
                    laba: Number(sRow.laba || 0),
                    cashTotal: Number(sRow.cash_total || 0),
                    qrisTotal: Number(sRow.qris_total || 0),
                    pending: Number(sRow.pending || 0)
                },
                recent: recentRes.rows
            };
        }

        res.json({
            serverTime: Date.now(),
            products: result.rows.map((row) => sanitizePosProductForUser(row, user)),
            liveSales
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Cari satu produk lewat barcode (scan)
app.get('/api/pos/products/lookup', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const code = String(req.query.code || '').trim();
        if (!code) return res.status(400).json({ error: 'Barcode/SKU wajib diisi.' });
        const result = await pool.query(
            `SELECT * FROM pos_products
             WHERE user_id = $1 AND is_active = TRUE
               AND (LOWER(barcode) = LOWER($2) OR LOWER(sku) = LOWER($2))
             LIMIT 1`,
            [posOwnerId(user), code]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Produk dengan barcode tersebut tidak ditemukan.' });
        res.json(sanitizePosProductForUser(result.rows[0], user));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Tambah produk POS
app.post('/api/pos/products', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        if (isCashier(user)) return res.status(403).json({ error: 'Hanya pemilik atau admin toko yang dapat menambah produk.' });

        const name = String(req.body?.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Nama produk wajib diisi.' });

        const sku = String(req.body?.sku || '').trim() || null;
        const barcode = String(req.body?.barcode || '').trim() || null;
        const category = toCategoryLabel(req.body?.category);
        const unit = toUnitLabel(req.body?.unit);
        const isWeighable = Boolean(req.body?.is_weighable);
        const priceSell = toMoney(req.body?.price_sell);
        const priceCost = toMoney(req.body?.price_cost);
        const stock = toQty(req.body?.stock);
        const minStock = toQty(req.body?.min_stock) || 0;
        const iconUrl = normalizeIconValue(req.body?.icon_url);

        const result = await pool.query(
            `INSERT INTO pos_products
                (user_id, sku, barcode, name, category, unit, is_weighable, price_sell, price_cost, stock, min_stock, icon_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [posOwnerId(user), sku, barcode, name, category, unit, isWeighable, priceSell, priceCost, stock, minStock, iconUrl]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'SKU atau barcode sudah dipakai produk lain.' });
        }
        res.status(400).json({ error: err.message });
    }
});

// API: Ubah produk POS (termasuk stok)
app.put('/api/pos/products/:id', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        if (isCashier(user)) return res.status(403).json({ error: 'Hanya pemilik atau admin toko yang dapat mengubah data produk.' });
        const productId = Number(req.params.id);
        if (!Number.isFinite(productId)) return res.status(400).json({ error: 'ID produk tidak valid.' });

        const existingRes = await pool.query('SELECT * FROM pos_products WHERE id = $1 AND user_id = $2', [productId, posOwnerId(user)]);
        const current = existingRes.rows[0];
        if (!current) return res.status(404).json({ error: 'Produk tidak ditemukan.' });

        const name = req.body?.name !== undefined ? String(req.body.name).trim() : current.name;
        if (!name) return res.status(400).json({ error: 'Nama produk wajib diisi.' });
        const sku = req.body?.sku !== undefined ? (String(req.body.sku).trim() || null) : current.sku;
        const barcode = req.body?.barcode !== undefined ? (String(req.body.barcode).trim() || null) : current.barcode;
        const category = req.body?.category !== undefined ? toCategoryLabel(req.body.category) : current.category;
        const unit = req.body?.unit !== undefined ? toUnitLabel(req.body.unit) : current.unit;
        const isWeighable = req.body?.is_weighable !== undefined ? Boolean(req.body.is_weighable) : current.is_weighable;
        const priceSell = req.body?.price_sell !== undefined ? toMoney(req.body.price_sell) : Number(current.price_sell);
        const priceCost = req.body?.price_cost !== undefined ? toMoney(req.body.price_cost) : Number(current.price_cost);
        const stock = req.body?.stock !== undefined ? toQty(req.body.stock) : current.stock;
        const minStock = req.body?.min_stock !== undefined ? toQty(req.body.min_stock) : current.min_stock;
        const isActive = req.body?.is_active !== undefined ? Boolean(req.body.is_active) : current.is_active;
        const iconUrl = req.body?.icon_url !== undefined ? normalizeIconValue(req.body.icon_url) : current.icon_url;

        const result = await pool.query(
            `UPDATE pos_products
             SET sku = $1, barcode = $2, name = $3, category = $4, unit = $5, is_weighable = $6,
                 price_sell = $7, price_cost = $8, stock = $9, min_stock = $10,
                 is_active = $11, icon_url = $12, updated_at = CURRENT_TIMESTAMP
             WHERE id = $13 AND user_id = $14
             RETURNING *`,
            [sku, barcode, name, category, unit, isWeighable, priceSell, priceCost, stock, minStock, isActive, iconUrl, productId, posOwnerId(user)]
        );
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'SKU atau barcode sudah dipakai produk lain.' });
        }
        res.status(400).json({ error: err.message });
    }
});

// API: Ubah cepat harga jual & HPP produk (khusus pemilik toko, bukan kasir).
// Dipakai PWA "Saku Harga" supaya pemilik bisa memperbarui harga tanpa membuka layar POS.
app.put('/api/pos/products/:id/price', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        if (isCashier(user)) return res.status(403).json({ error: 'Hanya pemilik toko yang dapat mengubah harga.' });

        const productId = Number(req.params.id);
        if (!Number.isFinite(productId)) return res.status(400).json({ error: 'ID produk tidak valid.' });

        const hasSell = req.body?.price_sell !== undefined && req.body?.price_sell !== null && req.body?.price_sell !== '';
        const hasCost = req.body?.price_cost !== undefined && req.body?.price_cost !== null && req.body?.price_cost !== '';
        if (!hasSell && !hasCost) return res.status(400).json({ error: 'Isi minimal harga jual atau HPP.' });

        const owned = await pool.query('SELECT id FROM pos_products WHERE id = $1 AND user_id = $2', [productId, posOwnerId(user)]);
        if (owned.rows.length === 0) return res.status(404).json({ error: 'Produk tidak ditemukan.' });

        const sets = [];
        const values = [];
        if (hasSell) {
            values.push(Math.max(0, toMoney(req.body.price_sell)));
            sets.push(`price_sell = $${values.length}`);
        }
        if (hasCost) {
            values.push(Math.max(0, toMoney(req.body.price_cost)));
            sets.push(`price_cost = $${values.length}`);
        }
        values.push(productId, posOwnerId(user));

        const result = await pool.query(
            `UPDATE pos_products
             SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
             WHERE id = $${values.length - 1} AND user_id = $${values.length}
             RETURNING id, name, sku, barcode, unit, category, is_weighable, is_active,
                       price_sell, price_cost, stock, min_stock, icon_url,
                       EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_ms`,
            values
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// API: Nonaktifkan produk POS (riwayat penjualan tetap tersimpan)
app.delete('/api/pos/products/:id', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        if (isCashier(user)) return res.status(403).json({ error: 'Hanya pemilik atau admin toko yang dapat menonaktifkan produk.' });
        const productId = Number(req.params.id);
        if (!Number.isFinite(productId)) return res.status(400).json({ error: 'ID produk tidak valid.' });
        const result = await pool.query(
            `UPDATE pos_products SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND user_id = $2 RETURNING id`,
            [productId, posOwnerId(user)]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
        res.json({ success: true, id: productId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Pengaturan POS (payload QRIS, webhook Google Sheets, & identitas toko/struk)
app.get('/api/pos/settings', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const result = await pool.query(
            'SELECT qris_payload, sheets_webhook_url, store_name, store_address, store_logo, updated_at FROM pos_settings WHERE user_id = $1',
            [posOwnerId(user)]
        );
        res.json({
            qris_payload: result.rows[0]?.qris_payload || '',
            sheets_webhook_url: result.rows[0]?.sheets_webhook_url || '',
            store_name: result.rows[0]?.store_name || '',
            store_address: result.rows[0]?.store_address || '',
            store_logo: result.rows[0]?.store_logo || '',
            env_sheets_webhook: Boolean(POS_SHEETS_WEBHOOK_URL),
            cash_wallet: POS_CASH_WALLET,
            qris_wallet: POS_QRIS_WALLET,
            is_cashier: isCashier(user)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/pos/settings', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        if (isCashier(user)) {
            return res.status(403).json({ error: 'Hanya pemilik toko yang dapat mengubah pengaturan POS.' });
        }

        const existingRes = await pool.query(
            'SELECT qris_payload, sheets_webhook_url, store_name, store_address, store_logo FROM pos_settings WHERE user_id = $1',
            [posOwnerId(user)]
        );
        const existing = existingRes.rows[0] || {};

        const qrisPayload = req.body?.qris_payload !== undefined
            ? (String(req.body.qris_payload).trim() || null)
            : (existing.qris_payload || null);
        const sheetsWebhook = req.body?.sheets_webhook_url !== undefined
            ? (String(req.body.sheets_webhook_url).trim() || null)
            : (existing.sheets_webhook_url || null);
        const storeName = req.body?.store_name !== undefined
            ? (String(req.body.store_name).trim().slice(0, 120) || null)
            : (existing.store_name || null);
        const storeAddress = req.body?.store_address !== undefined
            ? (String(req.body.store_address).trim() || null)
            : (existing.store_address || null);
        const storeLogo = req.body?.store_logo !== undefined
            ? (String(req.body.store_logo).trim() || null)
            : (existing.store_logo || null);

        if (sheetsWebhook && !isSafeWebhookUrl(sheetsWebhook)) {
            return res.status(400).json({ error: 'URL webhook tidak valid atau mengarah ke jaringan privat.' });
        }

        const result = await pool.query(
            `INSERT INTO pos_settings (user_id, qris_payload, sheets_webhook_url, store_name, store_address, store_logo, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id)
             DO UPDATE SET qris_payload = EXCLUDED.qris_payload,
                           sheets_webhook_url = EXCLUDED.sheets_webhook_url,
                           store_name = EXCLUDED.store_name,
                           store_address = EXCLUDED.store_address,
                           store_logo = EXCLUDED.store_logo,
                           updated_at = CURRENT_TIMESTAMP
             RETURNING qris_payload, sheets_webhook_url, store_name, store_address, store_logo, updated_at`,
            [posOwnerId(user), qrisPayload, sheetsWebhook, storeName, storeAddress, storeLogo]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Rate limiter untuk cek struk belanja publik oleh pembeli (anti spam / brute-force)
const publicReceiptLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, blockMs: 60 * 1000 });

// API Publik: Melihat struk belanja digital tanpa perlu login (diakses via QR code oleh pembeli)
app.get('/api/pos/public/receipt/:invoice', async (req, res) => {
    try {
        if (!guardRateLimit(publicReceiptLimiter, req, res)) return;
        await ensureDatabaseReady();

        const rawInvoice = String(req.params.invoice || '').trim();
        if (!rawInvoice || rawInvoice.length > 48 || !/^[\w-]+$/.test(rawInvoice)) {
            return res.status(400).json({ error: 'Nomor invoice tidak valid.' });
        }

        const saleRes = await pool.query(
            `SELECT s.id, s.invoice_no, s.status, s.payment_method, s.wallet,
                    s.total_amount, s.paid_amount, s.change_amount,
                    s.customer_name, s.note, s.cashier_name,
                    s.created_at, s.paid_at,
                    p.store_name, p.store_address, p.store_logo
             FROM pos_sales s
             LEFT JOIN pos_settings p ON p.user_id = s.user_id
             WHERE s.invoice_no = $1
             LIMIT 1`,
            [rawInvoice]
        );

        if (saleRes.rows.length === 0) {
            return res.status(404).json({ error: 'Struk penjualan tidak ditemukan.' });
        }

        const sale = saleRes.rows[0];
        const itemsRes = await pool.query(
            `SELECT product_name, sku, unit, qty, unit_price, subtotal
             FROM pos_sale_items
             WHERE sale_id = $1
             ORDER BY id ASC`,
            [sale.id]
        );

        res.json({
            invoice_no: sale.invoice_no,
            status: sale.status,
            payment_method: sale.payment_method,
            wallet: sale.wallet,
            total_amount: Number(sale.total_amount),
            paid_amount: Number(sale.paid_amount),
            change_amount: Number(sale.change_amount),
            customer_name: sale.customer_name || null,
            note: sale.note || null,
            cashier_name: sale.cashier_name || 'Kasir',
            created_at: sale.created_at,
            paid_at: sale.paid_at,
            store_name: sale.store_name || 'SAKU KASIR',
            store_address: sale.store_address || '',
            store_logo: sale.store_logo || '',
            items: itemsRes.rows.map((item) => ({
                product_name: item.product_name,
                sku: item.sku,
                unit: item.unit,
                qty: Number(item.qty),
                unit_price: Number(item.unit_price),
                subtotal: Number(item.subtotal)
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= AKUN KASIR (hanya pemilik toko) =================

// API: Daftar akun kasir milik pemilik toko
app.get('/api/pos/cashiers', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        if (isCashier(user)) return res.status(403).json({ error: 'Hanya pemilik toko yang dapat mengelola akun kasir.' });
        const result = await pool.query(
            `SELECT id, username, email, full_name, avatar, created_at
             FROM users
             WHERE owner_id = $1 AND role = 'cashier'
             ORDER BY created_at ASC`,
            [user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Buat akun kasir baru yang menempel ke akun pemilik
app.post('/api/pos/cashiers', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        if (isCashier(user)) return res.status(403).json({ error: 'Hanya pemilik toko yang dapat mengelola akun kasir.' });

        const fullName = String(req.body?.fullName || req.body?.full_name || '').trim().slice(0, 100);
        const cleanEmail = normalizeEmail(req.body?.email || '');
        const password = String(req.body?.password || '');
        if (!fullName) return res.status(400).json({ error: 'Nama kasir wajib diisi.' });
        if (!isValidEmail(cleanEmail)) return res.status(400).json({ error: 'Format email kasir tidak valid.' });
        if (password.length < 6) return res.status(400).json({ error: 'Kata sandi kasir minimal 6 karakter.' });

        const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email ini sudah terdaftar. Gunakan email lain.' });
        }

        const baseUsername = slugifyUsername(req.body?.username || cleanEmail.split('@')[0]) || 'kasir';
        const username = await generateUniqueUsername(baseUsername);
        const insertRes = await pool.query(
            `INSERT INTO users (username, email, password_hash, full_name, avatar, role, owner_id)
             VALUES ($1, $2, $3, $4, $5, 'cashier', $6)
             RETURNING id, username, email, full_name, avatar, created_at`,
            [username, cleanEmail, await hashPassword(password), fullName, String(req.body?.avatar || '🧑‍🍳').slice(0, 10), user.id]
        );
        res.status(201).json(insertRes.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Email atau username sudah dipakai.' });
        res.status(400).json({ error: err.message });
    }
});

// API: Ubah nama / reset kata sandi kasir
app.put('/api/pos/cashiers/:id', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        if (isCashier(user)) return res.status(403).json({ error: 'Hanya pemilik toko yang dapat mengelola akun kasir.' });
        const cashierId = Number(req.params.id);
        if (!Number.isFinite(cashierId)) return res.status(400).json({ error: 'ID kasir tidak valid.' });

        const owned = await pool.query(
            `SELECT id FROM users WHERE id = $1 AND owner_id = $2 AND role = 'cashier'`,
            [cashierId, user.id]
        );
        if (owned.rows.length === 0) return res.status(404).json({ error: 'Akun kasir tidak ditemukan.' });

        const fullName = req.body?.fullName !== undefined ? String(req.body.fullName).trim().slice(0, 100) : null;
        const password = req.body?.password !== undefined ? String(req.body.password) : '';
        if (password && password.length < 6) {
            return res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
        }

        const result = await pool.query(
            `UPDATE users
             SET full_name = COALESCE($1, full_name),
                 password_hash = COALESCE($2, password_hash)
             WHERE id = $3 AND owner_id = $4 AND role = 'cashier'
             RETURNING id, username, email, full_name, avatar, created_at`,
            [fullName || null, password ? await hashPassword(password) : null, cashierId, user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// API: Hapus akun kasir (sesi login kasir ikut dihapus)
app.delete('/api/pos/cashiers/:id', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        if (isCashier(user)) return res.status(403).json({ error: 'Hanya pemilik toko yang dapat mengelola akun kasir.' });
        const cashierId = Number(req.params.id);
        if (!Number.isFinite(cashierId)) return res.status(400).json({ error: 'ID kasir tidak valid.' });
        const result = await pool.query(
            `DELETE FROM users WHERE id = $1 AND owner_id = $2 AND role = 'cashier' RETURNING id`,
            [cashierId, user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Akun kasir tidak ditemukan.' });
        res.json({ success: true, id: cashierId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Checkout kasir (CASH langsung lunas, QRIS menunggu konfirmasi)
app.post('/api/pos/checkout', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });

        const method = String(req.body?.paymentMethod || 'CASH').toUpperCase() === 'QRIS' ? 'QRIS' : 'CASH';
        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        if (rawItems.length === 0) return res.status(400).json({ error: 'Keranjang masih kosong.' });

        // Baris dengan nominal manual (mis. "cabai Rp 5.000") tidak digabung agar harga tetap.
        const lines = [];
        const merged = new Map();
        for (const raw of rawItems) {
            const productId = Number(raw?.productId ?? raw?.product_id);
            if (!Number.isFinite(productId)) continue;
            const override = raw?.subtotal !== undefined && raw?.subtotal !== null && raw?.subtotal !== ''
                ? toMoney(raw.subtotal)
                : null;
            if (override !== null && override > 0) {
                lines.push({ productId, qty: 0, override });
                continue;
            }
            const qty = toQty(raw?.qty);
            if (qty <= 0) continue;
            merged.set(productId, toQty((merged.get(productId) || 0) + qty));
        }
        for (const [productId, qty] of merged.entries()) {
            lines.push({ productId, qty, override: null });
        }
        if (lines.length === 0) return res.status(400).json({ error: 'Item keranjang tidak valid.' });

        const productIds = [...new Set(lines.map((line) => line.productId))];
        const productsRes = await pool.query(
            `SELECT * FROM pos_products
             WHERE user_id = $1 AND is_active = TRUE AND id = ANY($2::int[])`,
            [posOwnerId(user), productIds]
        );
        const products = new Map(productsRes.rows.map((row) => [Number(row.id), row]));

        const saleItems = [];
        const stockNeeded = new Map();
        let totalAmount = 0;
        let totalCost = 0;
        for (const line of lines) {
            const product = products.get(line.productId);
            if (!product) return res.status(400).json({ error: `Produk #${line.productId} tidak ditemukan atau sudah nonaktif.` });

            const unitPrice = toMoney(product.price_sell);
            const unitCost = toMoney(product.price_cost);
            let qty = line.qty;
            let subtotal = toMoney(unitPrice * qty);
            if (line.override !== null) {
                if (!product.is_weighable) {
                    return res.status(400).json({ error: `Nominal manual hanya untuk produk timbangan (${product.name}).` });
                }
                if (unitPrice <= 0) return res.status(400).json({ error: `Harga jual ${product.name} belum diatur.` });
                subtotal = line.override;
                // Berat yang didapat dihitung dari nominal yang dibayar pembeli.
                qty = Math.round((subtotal / unitPrice) * 1000) / 1000;
            }
            if (qty <= 0) return res.status(400).json({ error: `Kuantitas ${product.name} tidak valid.` });

            const needed = Math.round(((stockNeeded.get(line.productId) || 0) + qty) * 1000) / 1000;
            stockNeeded.set(line.productId, needed);
            if (Number(product.stock) < needed) {
                return res.status(409).json({ error: `Stok ${product.name} tidak cukup (tersisa ${product.stock} ${product.unit}).` });
            }

            const subtotalCost = toMoney(unitCost * qty);
            totalAmount = toMoney(totalAmount + subtotal);
            totalCost = toMoney(totalCost + subtotalCost);
            saleItems.push({
                productId: line.productId,
                productName: product.name,
                sku: product.sku || null,
                unit: product.unit || 'PCS',
                qty,
                unitPrice,
                unitCost,
                subtotal,
                subtotalCost,
                profit: toMoney(subtotal - subtotalCost)
            });
        }
        const grossProfit = toMoney(totalAmount - totalCost);

        const paidAmount = method === 'CASH' ? toMoney(req.body?.paidAmount) : 0;
        if (method === 'CASH' && paidAmount < totalAmount) {
            return res.status(400).json({ error: 'Uang diterima kurang dari total belanja.' });
        }

        const customerName = String(req.body?.customerName || '').trim().slice(0, 120) || null;
        const customerPhone = String(req.body?.customerPhone || '').trim().slice(0, 32) || null;
        const note = String(req.body?.note || '').trim().slice(0, 500) || null;

        const client = await pool.connect();
        let sale;
        try {
            await client.query('BEGIN');
            const insertRes = await client.query(
                `INSERT INTO pos_sales
                    (user_id, invoice_no, status, payment_method, wallet, total_amount, total_cost, gross_profit,
                     paid_amount, change_amount, customer_name, customer_phone, note, cashier_id, cashier_name)
                 VALUES ($1, $2, 'PENDING', $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12, $13)
                 RETURNING *`,
                [
                    posOwnerId(user),
                    buildPosInvoiceNo(),
                    method,
                    posWalletFor(method),
                    totalAmount,
                    totalCost,
                    grossProfit,
                    method === 'CASH' ? paidAmount : 0,
                    customerName,
                    customerPhone,
                    note,
                    user.id,
                    String(user.full_name || user.username || 'Kasir').slice(0, 100)
                ]
            );
            sale = insertRes.rows[0];
            for (const item of saleItems) {
                await client.query(
                    `INSERT INTO pos_sale_items
                        (sale_id, product_id, product_name, sku, unit, qty, unit_price, unit_cost, subtotal, subtotal_cost, profit)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [sale.id, item.productId, item.productName, item.sku, item.unit, item.qty, item.unitPrice, item.unitCost, item.subtotal, item.subtotalCost, item.profit]
                );
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }

        if (method === 'QRIS') {
            return res.status(201).json({
                sale: sanitizePosSaleForUser(sale, user),
                items: saleItems.map((item) => sanitizePosSaleItemForUser(item, user)),
                status: 'PENDING'
            });
        }

        let paidResult;
        try {
            paidResult = await markPosSalePaid(sale.id);
        } catch (err) {
            await pool.query(`UPDATE pos_sales SET status = 'CANCELLED' WHERE id = $1`, [sale.id]).catch(() => {});
            return res.status(409).json({ error: err.message });
        }
        if (paidResult.error) {
            await pool.query(`UPDATE pos_sales SET status = 'CANCELLED' WHERE id = $1`, [sale.id]).catch(() => {});
            return res.status(409).json({ error: 'Transaksi gagal diproses. Silakan ulangi.' });
        }
        syncPosSaleToSheets(posOwnerId(user), sale.id).catch(() => {});
        res.status(201).json({
            sale: sanitizePosSaleForUser(paidResult.sale, user),
            items: (paidResult.items || []).map((item) => sanitizePosSaleItemForUser(item, user)),
            status: 'PAID'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Konfirmasi pembayaran QRIS (manual dari layar kasir)
app.post('/api/pos/sales/:id/pay', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const saleId = Number(req.params.id);
        if (!Number.isFinite(saleId)) return res.status(400).json({ error: 'ID transaksi tidak valid.' });

        const owned = await pool.query('SELECT id FROM pos_sales WHERE id = $1 AND user_id = $2', [saleId, posOwnerId(user)]);
        if (owned.rows.length === 0) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });

        const result = await markPosSalePaid(saleId);
        if (result.error === 'not_found') return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
        if (result.error) return res.status(409).json({ error: 'Transaksi tidak dapat dibayar pada status saat ini.' });

        if (!result.alreadyPaid) syncPosSaleToSheets(posOwnerId(user), saleId).catch(() => {});
        res.json({
            sale: sanitizePosSaleForUser(result.sale, user),
            items: (result.items || []).map((item) => sanitizePosSaleItemForUser(item, user)),
            status: 'PAID',
            alreadyPaid: Boolean(result.alreadyPaid)
        });
    } catch (err) {
        res.status(409).json({ error: err.message });
    }
});

// API: Batalkan transaksi yang belum lunas
app.post('/api/pos/sales/:id/cancel', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const saleId = Number(req.params.id);
        if (!Number.isFinite(saleId)) return res.status(400).json({ error: 'ID transaksi tidak valid.' });
        const result = await pool.query(
            `UPDATE pos_sales SET status = 'CANCELLED'
             WHERE id = $1 AND user_id = $2 AND status = 'PENDING'
             RETURNING id, invoice_no, status`,
            [saleId, posOwnerId(user)]
        );
        if (result.rows.length === 0) return res.status(409).json({ error: 'Hanya transaksi PENDING yang dapat dibatalkan.' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Riwayat transaksi POS
app.get('/api/pos/sales', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });

        const { clauses, params } = parsePosDateRange(req, 2);
        const status = String(req.query.status || '').toUpperCase();
        const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
        const conditions = ['user_id = $1', ...clauses];
        const values = [posOwnerId(user), ...params];
        if (status && ['PENDING', 'PAID', 'CANCELLED'].includes(status)) {
            values.push(status);
            conditions.push(`status = $${values.length}`);
        }
        values.push(limit);
        const result = await pool.query(
            `SELECT s.*,
                    (SELECT COUNT(*) FROM pos_sale_items i WHERE i.sale_id = s.id)::int AS item_count,
                    (SELECT STRING_AGG(
                        i.product_name || ' ×' ||
                        TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM i.qty::text)) ||
                        ' ' || COALESCE(i.unit, 'PCS'),
                        ', ' ORDER BY i.id
                     ) FROM pos_sale_items i WHERE i.sale_id = s.id) AS items_summary
             FROM pos_sales s
             WHERE ${conditions.join(' AND ')}
             ORDER BY s.created_at DESC, s.id DESC
             LIMIT $${values.length}`,
            values
        );
        res.json(result.rows.map((row) => sanitizePosSaleForUser(row, user)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Detail transaksi POS + rincian item
app.get('/api/pos/sales/:id', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const saleId = Number(req.params.id);
        if (!Number.isFinite(saleId)) return res.status(400).json({ error: 'ID transaksi tidak valid.' });
        const saleRes = await pool.query('SELECT * FROM pos_sales WHERE id = $1 AND user_id = $2', [saleId, posOwnerId(user)]);
        if (saleRes.rows.length === 0) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
        const itemsRes = await pool.query('SELECT * FROM pos_sale_items WHERE sale_id = $1 ORDER BY id', [saleId]);
        res.json({
            sale: sanitizePosSaleForUser(saleRes.rows[0], user),
            items: itemsRes.rows.map((item) => sanitizePosSaleItemForUser(item, user))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Kirim ulang transaksi ke Google Sheets
app.post('/api/pos/sales/:id/sync-sheet', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const saleId = Number(req.params.id);
        if (!Number.isFinite(saleId)) return res.status(400).json({ error: 'ID transaksi tidak valid.' });
        const owned = await pool.query('SELECT id FROM pos_sales WHERE id = $1 AND user_id = $2', [saleId, posOwnerId(user)]);
        if (owned.rows.length === 0) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
        const result = await syncPosSaleToSheets(posOwnerId(user), saleId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Ringkasan penjualan POS (omzet, HPP, laba)
app.get('/api/pos/summary', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const { clauses, params } = parsePosDateRange(req, 2);
        const conditions = ['user_id = $1', ...clauses];
        const values = [posOwnerId(user), ...params];
        const paidRes = await pool.query(
            `SELECT COUNT(*)::int AS transactions,
                    COALESCE(SUM(total_amount), 0) AS omzet,
                    COALESCE(SUM(total_cost), 0) AS hpp,
                    COALESCE(SUM(gross_profit), 0) AS laba,
                    COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END), 0) AS cash_total,
                    COALESCE(SUM(CASE WHEN payment_method = 'QRIS' THEN total_amount ELSE 0 END), 0) AS qris_total
             FROM pos_sales
             WHERE ${conditions.join(' AND ')} AND status = 'PAID'`,
            values
        );
        const pendingRes = await pool.query(
            `SELECT COUNT(*)::int AS pending FROM pos_sales WHERE ${conditions.join(' AND ')} AND status = 'PENDING'`,
            values
        );
        const row = paidRes.rows[0] || {};
        if (isCashier(user)) {
            return res.json({
                transactions: Number(row.transactions || 0),
                omzet: Number(row.omzet || 0),
                cashTotal: Number(row.cash_total || 0),
                qrisTotal: Number(row.qris_total || 0),
                pending: Number(pendingRes.rows[0]?.pending || 0)
            });
        }
        const laba = Number(row.laba || 0);

        // Susut/layu & belanja kulakan dihitung terpisah agar laba bersih akurat.
        const spoilRange = parsePosDateRange(req, 2);
        const spoilRes = await pool.query(
            `SELECT COALESCE(SUM(loss_amount), 0) AS loss, COUNT(*)::int AS entries
             FROM pos_spoilage_logs
             WHERE user_id = $1${spoilRange.clauses.length ? ` AND ${spoilRange.clauses.join(' AND ')}` : ''}`,
            [posOwnerId(user), ...spoilRange.params]
        );
        const purchaseRange = parsePosDateRange(req, 2);
        const purchaseRes = await pool.query(
            `SELECT COALESCE(SUM(total_amount), 0) AS total
             FROM pos_purchases
             WHERE user_id = $1${purchaseRange.clauses.length ? ` AND ${purchaseRange.clauses.join(' AND ')}` : ''}`,
            [posOwnerId(user), ...purchaseRange.params]
        );
        const spoilageLoss = Number(spoilRes.rows[0]?.loss || 0);

        res.json({
            transactions: Number(row.transactions || 0),
            omzet: Number(row.omzet || 0),
            hpp: Number(row.hpp || 0),
            laba: laba,
            cashTotal: Number(row.cash_total || 0),
            qrisTotal: Number(row.qris_total || 0),
            pending: Number(pendingRes.rows[0]?.pending || 0),
            spoilageLoss,
            spoilageEntries: Number(spoilRes.rows[0]?.entries || 0),
            netProfit: Number((laba - spoilageLoss).toFixed(2)),
            purchaseTotal: Number(purchaseRes.rows[0]?.total || 0)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Ekspor rincian POS ke Excel/CSV
app.get('/api/pos/export-excel', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        if (isCashier(user)) return res.status(403).json({ error: 'Hanya pemilik toko yang dapat mengunduh laporan Excel/CSV.' });
        const { clauses, params } = parsePosDateRange(req, 2);
        const conditions = ['s.user_id = $1', ...clauses.map((c) => `s.${c}`)];
        const result = await pool.query(
            `SELECT s.invoice_no, s.created_at, s.payment_method, s.wallet,
                    i.product_name, i.sku, i.unit, i.qty, i.unit_price, i.unit_cost, i.subtotal, i.profit
             FROM pos_sale_items i
             JOIN pos_sales s ON s.id = i.sale_id
             WHERE ${conditions.join(' AND ')} AND s.status = 'PAID'
             ORDER BY s.created_at DESC, i.id ASC`,
            [posOwnerId(user), ...params]
        );
        const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        let csv = '\uFEFFTimestamp,ID Transaksi,Nama Produk,SKU,Satuan,Qty,Harga Satuan,Harga Modal,Subtotal,Metode Bayar,Saku Tujuan,Laba Bersih\n';
        result.rows.forEach((row) => {
            csv += [
                escapeCsv(new Date(row.created_at).toISOString()),
                escapeCsv(row.invoice_no),
                escapeCsv(row.product_name),
                escapeCsv(row.sku),
                escapeCsv(row.unit),
                row.qty,
                row.unit_price,
                row.unit_cost,
                row.subtotal,
                escapeCsv(row.payment_method),
                escapeCsv(row.wallet),
                row.profit
            ].join(',') + '\n';
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="laporan-pos-saku-harian.csv"');
        res.status(200).send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Catat barang susut/layu (mengurangi stok & laba bersih)
app.post('/api/pos/spoilage', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });

        const productId = Number(req.body?.productId);
        const qtyLost = toQty(req.body?.qty ?? req.body?.qty_lost);
        const reason = String(req.body?.reason || 'Layu/Busuk').trim().slice(0, 100);
        if (!Number.isFinite(productId) || qtyLost <= 0) {
            return res.status(400).json({ error: 'Produk dan jumlah susut wajib diisi.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const productRes = await client.query(
                'SELECT * FROM pos_products WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [productId, posOwnerId(user)]
            );
            const product = productRes.rows[0];
            if (!product) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Produk tidak ditemukan.' });
            }
            if (Number(product.stock) < qtyLost) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: `Stok ${product.name} hanya ${product.stock} ${product.unit}.` });
            }

            const lossAmount = toMoney(Number(product.price_cost) * qtyLost);
            await client.query(
                'UPDATE pos_products SET stock = stock - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [qtyLost, product.id]
            );
            const logRes = await client.query(
                `INSERT INTO pos_spoilage_logs (user_id, product_id, product_name, unit, qty_lost, loss_amount, reason)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [posOwnerId(user), product.id, product.name, product.unit || 'PCS', qtyLost, lossAmount, reason || null]
            );
            await client.query('COMMIT');
            const row = logRes.rows[0];
            if (isCashier(user)) {
                const { loss_amount: _omitLoss, ...safeRow } = row;
                return res.status(201).json(safeRow);
            }
            res.status(201).json(row);
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Riwayat barang susut
app.get('/api/pos/spoilage', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        const { clauses, params } = parsePosDateRange(req, 2);
        const result = await pool.query(
            `SELECT * FROM pos_spoilage_logs
             WHERE user_id = $1${clauses.length ? ` AND ${clauses.join(' AND ')}` : ''}
             ORDER BY created_at DESC, id DESC LIMIT 200`,
            [posOwnerId(user), ...params]
        );
        res.json(result.rows.map((row) => {
            if (!isCashier(user)) return row;
            const { loss_amount: _omitLoss, ...safeRow } = row;
            return safeRow;
        }));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Kulakan pagi — stok masuk sekaligus update HPP, memotong saldo saku modal
app.post('/api/pos/purchases', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const user = await resolveAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        if (isCashier(user)) return res.status(403).json({ error: 'Hanya pemilik toko yang dapat mencatat kulakan.' });

        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        if (rawItems.length === 0) return res.status(400).json({ error: 'Daftar kulakan masih kosong.' });
        const wallet = String(req.body?.wallet || POS_CASH_WALLET).trim().slice(0, 80) || POS_CASH_WALLET;
        const note = String(req.body?.note || '').trim().slice(0, 500) || null;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            let totalAmount = 0;
            const prepared = [];
            for (const raw of rawItems) {
                const productId = Number(raw?.productId);
                const qty = toQty(raw?.qty);
                const costPerUnit = toMoney(raw?.costPerUnit ?? raw?.cost_per_unit);
                const sellPrice = raw?.sellPrice !== undefined && raw?.sellPrice !== '' ? toMoney(raw.sellPrice) : null;
                if (!Number.isFinite(productId) || qty <= 0 || costPerUnit < 0) continue;
                const productRes = await client.query(
                    'SELECT * FROM pos_products WHERE id = $1 AND user_id = $2 FOR UPDATE',
                    [productId, posOwnerId(user)]
                );
                const product = productRes.rows[0];
                if (!product) throw new Error(`Produk #${productId} tidak ditemukan.`);
                const subtotal = toMoney(costPerUnit * qty);
                totalAmount = toMoney(totalAmount + subtotal);
                prepared.push({ product, qty, costPerUnit, sellPrice, subtotal });
            }
            if (prepared.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Item kulakan tidak valid.' });
            }

            const purchaseRes = await client.query(
                `INSERT INTO pos_purchases (user_id, wallet, total_amount, note)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [posOwnerId(user), wallet, totalAmount, note]
            );
            const purchase = purchaseRes.rows[0];

            for (const item of prepared) {
                await client.query(
                    `UPDATE pos_products
                     SET stock = stock + $1,
                         price_cost = $2,
                         price_sell = COALESCE($3, price_sell),
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $4`,
                    [item.qty, item.costPerUnit, item.sellPrice, item.product.id]
                );
                await client.query(
                    `INSERT INTO pos_purchase_items
                        (purchase_id, product_id, product_name, unit, qty, cost_per_unit, sell_price, subtotal)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [purchase.id, item.product.id, item.product.name, item.product.unit || 'PCS', item.qty, item.costPerUnit, item.sellPrice, item.subtotal]
                );
            }

            await client.query(
                `INSERT INTO transactions ("desc", amount, type, category, wallet, date, user_id)
                 VALUES ($1, $2, 'expense', 'Kulakan POS', $3, CURRENT_TIMESTAMP, $4)`,
                [`Kulakan POS #${purchase.id}`, totalAmount, wallet, posOwnerId(user)]
            );
            await client.query('COMMIT');
            res.status(201).json({ ...purchase, items: prepared.length });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// API: Webhook callback pembayaran QRIS (dari penyedia payment gateway)
app.post('/api/pos/webhook/payment', async (req, res) => {
    try {
        await ensureDatabaseReady();
        const secret = req.headers['x-pos-secret'] || req.headers['x-webhook-secret'] || req.query.secret;
        if (!POS_PAYMENT_WEBHOOK_SECRET) {
            return res.status(503).json({ error: 'Webhook pembayaran belum dikonfigurasi di server.' });
        }
        if (!safeSecretEquals(secret, POS_PAYMENT_WEBHOOK_SECRET)) {
            return res.status(401).json({ error: 'Secret webhook tidak valid.' });
        }

        const invoiceNo = String(req.body?.invoiceNo || req.body?.invoice_no || '').trim();
        if (!invoiceNo) return res.status(400).json({ error: 'invoiceNo wajib diisi.' });
        const status = String(req.body?.status || 'PAID').toUpperCase();

        const saleRes = await pool.query('SELECT * FROM pos_sales WHERE invoice_no = $1', [invoiceNo]);
        const sale = saleRes.rows[0];
        if (!sale) return res.status(404).json({ error: 'Invoice tidak ditemukan.' });

        if (status === 'PAID') {
            const result = await markPosSalePaid(sale.id);
            if (result.error) return res.status(409).json({ error: 'Transaksi tidak dapat dilunasi pada status saat ini.' });
            if (!result.alreadyPaid) syncPosSaleToSheets(sale.user_id, sale.id).catch(() => {});
            return res.json({ success: true, invoiceNo, status: 'PAID', alreadyPaid: Boolean(result.alreadyPaid) });
        }

        if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(status)) {
            await pool.query(
                `UPDATE pos_sales SET status = 'CANCELLED' WHERE id = $1 AND status = 'PENDING'`,
                [sale.id]
            );
            return res.json({ success: true, invoiceNo, status: 'CANCELLED' });
        }

        res.status(400).json({ error: 'Status webhook tidak dikenali.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= MODUL POS KASIR =================
const POS_CASH_WALLET = (process.env.POS_CASH_WALLET || 'Tunai').trim();
const POS_QRIS_WALLET = (process.env.POS_QRIS_WALLET || 'QRIS').trim();
const POS_PAYMENT_WEBHOOK_SECRET = (process.env.POS_PAYMENT_WEBHOOK_SECRET || '').trim();
const POS_SHEETS_WEBHOOK_URL = (process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim();

function toMoney(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 100) / 100;
}

// Kuantitas mendukung timbangan desimal (contoh 0.25 kg / 1.5 ons).
function toQty(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.round(num * 1000) / 1000;
}

function toUnitLabel(value, fallback = 'PCS') {
    const label = String(value || '').trim().toUpperCase().slice(0, 20);
    return label || fallback;
}

function toCategoryLabel(value) {
    const label = String(value || '').trim().toUpperCase().slice(0, 50);
    return label || 'UMUM';
}

// Ikon produk bisa berupa:
// - data URL gambar (hasil unggah & resize di browser)
// - path lokal repo, mis. icons/vegetables/carrot.png
// - token katalog sayur, mis. sayur:daun-singkong
const POS_ICON_MAX_LENGTH = 400 * 1024; // ~400 KB

function normalizeIconValue(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return null;
    if (/^sayur:[a-z0-9-]{1,64}$/i.test(raw)) return raw.toLowerCase();
    if (/^(icons|assets)\/(?![^/]*\.\.)[A-Za-z0-9/_.-]+\.(png|webp|svg|jpe?g)$/i.test(raw)) return raw;
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(raw)) return null;
    if (raw.length > POS_ICON_MAX_LENGTH) {
        const err = new Error('Ukuran ikon terlalu besar. Gunakan gambar PNG kecil (maksimal ~300 KB).');
        err.statusCode = 400;
        throw err;
    }
    return raw;
}

function buildPosInvoiceNo() {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    return `POS-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function posWalletFor(method) {
    return method === 'QRIS' ? POS_QRIS_WALLET : POS_CASH_WALLET;
}

function safeSecretEquals(input, expected) {
    if (!input || !expected) return false;
    const a = Buffer.from(String(input));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

// Rentang tanggal laporan: `to` dibuat inklusif sampai akhir hari.
function parsePosDateRange(req, startIndex = 1) {
    const clauses = [];
    const params = [];
    const fromRaw = req.query?.from;
    const toRaw = req.query?.to;
    if (fromRaw && !Number.isNaN(new Date(fromRaw).getTime())) {
        params.push(new Date(fromRaw));
        clauses.push(`created_at >= $${startIndex + params.length - 1}`);
    }
    if (toRaw && !Number.isNaN(new Date(toRaw).getTime())) {
        const end = new Date(toRaw);
        end.setHours(23, 59, 59, 999);
        params.push(end);
        clauses.push(`created_at <= $${startIndex + params.length - 1}`);
    }
    return { clauses, params };
}

// Cegah SSRF: hanya URL publik http(s) yang boleh dipanggil server.
function isSafeWebhookUrl(rawUrl) {
    try {
        const url = new URL(String(rawUrl));
        if (!['http:', 'https:'].includes(url.protocol)) return false;
        const host = url.hostname.toLowerCase();
        if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
        if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
        const private172 = host.match(/^172\.(\d+)\./);
        if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
        return true;
    } catch {
        return false;
    }
}

async function getPosSheetsWebhookUrl(userId) {
    try {
        const res = await pool.query('SELECT sheets_webhook_url FROM pos_settings WHERE user_id = $1', [userId]);
        const perUser = String(res.rows[0]?.sheets_webhook_url || '').trim();
        return perUser || POS_SHEETS_WEBHOOK_URL;
    } catch {
        return POS_SHEETS_WEBHOOK_URL;
    }
}

// Kirim rincian item ke Google Apps Script (doPost). Kegagalan tidak boleh membatalkan transaksi.
async function syncPosSaleToSheets(userId, saleId) {
    try {
        const webhookUrl = await getPosSheetsWebhookUrl(userId);
        if (!webhookUrl) return { synced: false, reason: 'no_webhook' };
        if (!isSafeWebhookUrl(webhookUrl)) return { synced: false, reason: 'unsafe_url' };

        const saleRes = await pool.query('SELECT * FROM pos_sales WHERE id = $1 AND user_id = $2', [saleId, userId]);
        const sale = saleRes.rows[0];
        if (!sale || sale.status !== 'PAID') return { synced: false, reason: 'not_paid' };

        const itemsRes = await pool.query(
            'SELECT product_name, sku, unit, qty, unit_price, unit_cost, subtotal, subtotal_cost, profit FROM pos_sale_items WHERE sale_id = $1 ORDER BY id',
            [saleId]
        );

        const payload = {
            timestamp: sale.paid_at || sale.created_at,
            invoiceNo: sale.invoice_no,
            status: sale.status,
            paymentMethod: sale.payment_method,
            wallet: sale.wallet,
            totalAmount: Number(sale.total_amount),
            totalCost: Number(sale.total_cost),
            grossProfit: Number(sale.gross_profit),
            paidAmount: Number(sale.paid_amount),
            changeAmount: Number(sale.change_amount),
            customerName: sale.customer_name || '',
            rows: itemsRes.rows.map((item) => ({
                Timestamp: sale.paid_at || sale.created_at,
                'ID Transaksi': sale.invoice_no,
                'Nama Produk': item.product_name,
                SKU: item.sku || '',
                Satuan: item.unit || '',
                Qty: Number(item.qty),
                'Harga Satuan': Number(item.unit_price),
                'Harga Modal': Number(item.unit_cost),
                Subtotal: Number(item.subtotal),
                'Metode Bayar': sale.payment_method,
                'Saku Tujuan': sale.wallet,
                'Laba Bersih': Number(item.profit)
            }))
        };

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined
        });
        const synced = response.ok;
        await pool.query('UPDATE pos_sales SET sheet_synced = $1 WHERE id = $2', [synced, saleId]).catch(() => {});
        return { synced };
    } catch (err) {
        console.warn('Sinkronisasi Google Sheets POS gagal:', err.message);
        return { synced: false, reason: 'request_failed' };
    }
}

// Finalisasi transaksi: kurangi stok, catat pemasukan ke saku, ubah status menjadi PAID.
async function markPosSalePaid(saleId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const saleRes = await client.query('SELECT * FROM pos_sales WHERE id = $1 FOR UPDATE', [saleId]);
        if (saleRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { error: 'not_found' };
        }
        const sale = saleRes.rows[0];
        const itemsRes = await client.query('SELECT * FROM pos_sale_items WHERE sale_id = $1 ORDER BY id', [saleId]);

        if (sale.status === 'PAID') {
            await client.query('COMMIT');
            return { sale, items: itemsRes.rows, alreadyPaid: true };
        }
        if (sale.status !== 'PENDING') {
            await client.query('ROLLBACK');
            return { error: 'invalid_status', sale };
        }

        for (const item of itemsRes.rows) {
            if (!item.product_id) continue;
            const productRes = await client.query(
                'SELECT id, name, stock FROM pos_products WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [item.product_id, sale.user_id]
            );
            if (productRes.rows.length === 0) {
                throw new Error(`Produk ${item.product_name} sudah tidak tersedia.`);
            }
            if (Number(productRes.rows[0].stock) < Number(item.qty)) {
                throw new Error(`Stok ${productRes.rows[0].name} tidak cukup (tersisa ${productRes.rows[0].stock}).`);
            }
        }

        for (const item of itemsRes.rows) {
            if (!item.product_id) continue;
            await client.query(
                'UPDATE pos_products SET stock = stock - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [Number(item.qty), item.product_id]
            );
        }

        const paidAmount = sale.payment_method === 'CASH'
            ? toMoney(sale.paid_amount || 0)
            : toMoney(sale.total_amount);
        const changeAmount = sale.payment_method === 'CASH'
            ? Math.max(0, toMoney(paidAmount - Number(sale.total_amount || 0)))
            : 0;

        const updatedRes = await client.query(
            `UPDATE pos_sales
             SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, paid_amount = $1, change_amount = $2
             WHERE id = $3
             RETURNING *`,
            [paidAmount, changeAmount, saleId]
        );

        await client.query(
            `INSERT INTO transactions ("desc", amount, type, category, wallet, date, user_id)
             VALUES ($1, $2, 'income', $3, $4, CURRENT_TIMESTAMP, $5)`,
            [`Penjualan POS ${sale.invoice_no}`, Number(sale.total_amount), 'Penjualan POS', sale.wallet, sale.user_id]
        );

        await client.query('COMMIT');
        return { sale: updatedRes.rows[0], items: itemsRes.rows };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// ================= WEBHOOK TELEGRAM BOT =================
app.post(`/api/telegram-webhook`, async (req, res) => {
    // Verifikasi bahwa request benar-benar berasal dari Telegram.
    // Telegram mengirim secret_token yang kita daftarkan lewat setWebhook.
    if (TELEGRAM_WEBHOOK_SECRET) {
        const incoming = String(req.headers['x-telegram-bot-api-secret-token'] || '');
        if (!safeEqualString(incoming, TELEGRAM_WEBHOOK_SECRET)) {
            return res.sendStatus(401);
        }
    } else if (process.env.NODE_ENV === 'production') {
        // Jangan terima webhook tanpa verifikasi di produksi.
        return res.status(503).json({ error: 'Webhook Telegram belum dikonfigurasi.' });
    }

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

        if (!isTelegramChatAllowed(chatId)) {
            await answerCallbackQuery(cb.id, 'Chat ini belum diizinkan memakai bot.');
            return res.sendStatus(200);
        }

        try {
            const telegramUser = await resolveTelegramUser(chatId);
            if (!telegramUser) {
                await answerCallbackQuery(cb.id, 'Akun bot belum siap. Coba lagi.');
                return res.sendStatus(200);
            }
            const userId = telegramUser.id;

            const parts = data.split(':');
            const action = parts[0];

            // --- A. NAVIGASI MENU UTAMA TANPA KETIK ---
            if (action === 'menu_act') {
                const sub = parts[1];
                await clearEditSession(chatId);

                if (sub === 'main') {
                    await answerCallbackQuery(cb.id, '🧭 Menu Utama Saku Harian');
                    const { balance } = await getRunningBalanceSummary(userId);
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
                    const msg = await buildSaldoMessageText(userId);
                    await editTelegramMessage(chatId, messageId, msg, buildSaldoInlineKeyboard());
                    return res.sendStatus(200);
                }

                if (sub === 'dompet') {
                    await answerCallbackQuery(cb.id, '👛 Memuat Saldo E-Wallet & Bank...');
                    const msg = await buildDompetMessageText(userId);
                    await editTelegramMessage(chatId, messageId, msg, buildSaldoInlineKeyboard());
                    return res.sendStatus(200);
                }

                if (sub === 'history') {
                    await answerCallbackQuery(cb.id, '📜 Memuat Riwayat & Edit...');
                    const { text: hText, keyboard: hKb } = await buildHistoryMessagePayload(userId);
                    await editTelegramMessage(chatId, messageId, hText, hKb);
                    return res.sendStatus(200);
                }

                if (sub === 'tips') {
                    await answerCallbackQuery(cb.id, '💡 Tips Hemat Finansial');
                    const { totalIncome, balance } = await getRunningBalanceSummary(userId);
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
                    const promptText = await buildResetPromptText(userId);
                    await editTelegramMessage(chatId, messageId, promptText, buildResetConfirmationKeyboard());
                    return res.sendStatus(200);
                }
            }

            // --- B. EKSEKUSI HAPUS SALDO BERJALAN / RESET KEMBALI KE SEMULA ---
            if (action === 'reset_exec') {
                const mode = parts[1];
                await clearEditSession(chatId);

                if (mode === 'all') {
                    await pool.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
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
                    const { balance } = await getRunningBalanceSummary(userId);
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
                        `INSERT INTO transactions ("desc", amount, type, category, wallet, user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
                        ['Penyesuaian Hapus Saldo Berjalan (Rp 0)', adjAmount, adjType, 'Umum', 'Tunai', userId]
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
                    messageId,
                    userId
                );
                return res.sendStatus(200);
            }

            // --- D. EDIT TRANSAKSI EXISTING ---
            const trxId = Number(parts[1]);

            if (action === 'edit_menu') {
                const resTrx = await pool.query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [trxId, userId]);
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
                    'UPDATE transactions SET wallet = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
                    [newWallet, trxId, userId]
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
                    'UPDATE transactions SET category = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
                    [newCat, trxId, userId]
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
                const resTrx = await pool.query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [trxId, userId]);
                if (resTrx.rows.length) {
                    const nextType = resTrx.rows[0].type === 'income' ? 'expense' : 'income';
                    const updated = await pool.query(
                        'UPDATE transactions SET type = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
                        [nextType, trxId, userId]
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
                await pool.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [trxId, userId]);
                await answerCallbackQuery(cb.id, 'Transaksi dihapus');
                const { balance } = await getRunningBalanceSummary(userId);
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

    if (!isTelegramChatAllowed(chatId)) {
        await sendTelegramMessage(chatId, '⛔ Chat ini belum diizinkan memakai bot Saku Harian.');
        return res.sendStatus(200);
    }

    const text = msgObj.text;
    const photo = msgObj.photo;
    const voice = msgObj.voice;

    try {
        const telegramUser = await resolveTelegramUser(chatId);
        if (!telegramUser) {
            await sendTelegramMessage(chatId, '⚠️ Akun bot belum siap. Silakan coba lagi.');
            return res.sendStatus(200);
        }
        const userId = telegramUser.id;

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
            const { balance } = await getRunningBalanceSummary(userId);
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
            const msg = await buildSaldoMessageText(userId);
            await sendTelegramMessage(chatId, msg, buildSaldoInlineKeyboard());
            return res.sendStatus(200);
        }

        if (isDompetTrigger) {
            await clearEditSession(chatId);
            const msg = await buildDompetMessageText(userId);
            await sendTelegramMessage(chatId, msg, buildSaldoInlineKeyboard());
            return res.sendStatus(200);
        }

        if (isHistoryTrigger) {
            await clearEditSession(chatId);
            const { text: hText, keyboard: hKb } = await buildHistoryMessagePayload(userId);
            await sendTelegramMessage(chatId, hText, hKb);
            return res.sendStatus(200);
        }

        if (isResetTrigger) {
            await clearEditSession(chatId);
            const promptText = await buildResetPromptText(userId);
            await sendTelegramMessage(chatId, promptText, buildResetConfirmationKeyboard());
            return res.sendStatus(200);
        }

        if (isTipsTrigger) {
            await clearEditSession(chatId);
            const { totalIncome, balance } = await getRunningBalanceSummary(userId);
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
                            'UPDATE transactions SET amount = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
                            [cleanedNum, activeSession.trxId, userId]
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
                        'UPDATE transactions SET "desc" = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
                        [cleanText, activeSession.trxId, userId]
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

            await saveAndNotify(parsed, chatId, null, userId);
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

            await saveAndNotify(parsed, chatId, null, userId);
        }
        // 3. PESAN TEKS BEBAS (DENGAN FALLBACK PARSER LOKAL PINTAR)
        else if (cleanText) {
            const localParsed = parseNaturalTransactionText(cleanText);
            if (localParsed && localParsed.isTransaction) {
                await saveAndNotify(localParsed, chatId, null, userId);
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
                    await saveAndNotify(parsed, chatId, null, userId);
                } else {
                    await sendTelegramMessage(chatId, `🤖 *Saku Harian:* ${parsed.reply}`, buildMainMenuInlineKeyboard());
                }
            } catch {
                const { balance } = await getRunningBalanceSummary(userId);
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
