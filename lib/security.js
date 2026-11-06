'use strict';

const crypto = require('crypto');

/**
 * Modul keamanan bersama untuk Saku Harian.
 * Semua fungsi di sini murni (tidak menyentuh DB) agar mudah diuji.
 */

const PASSWORD_DIGEST = 'sha512';
const PASSWORD_KEYLEN = 64;
const PASSWORD_ITERATIONS = Number(process.env.PASSWORD_ITERATIONS) || 210000;
const LEGACY_PASSWORD_ITERATIONS = 1000;
const PASSWORD_PREFIX = 'pbkdf2';
const SESSION_COOKIE_NAME = 'saku_session';

function pbkdf2(password, salt, iterations) {
    return new Promise((resolve, reject) => {
        crypto.pbkdf2(String(password), String(salt), iterations, PASSWORD_KEYLEN, PASSWORD_DIGEST, (err, key) => {
            if (err) reject(err);
            else resolve(key);
        });
    });
}

/** Hash password baru dengan format `pbkdf2$iterasi$salt$hash` (PBKDF2-SHA512). */
async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const key = await pbkdf2(password, salt, PASSWORD_ITERATIONS);
    return `${PASSWORD_PREFIX}$${PASSWORD_ITERATIONS}$${salt}$${key.toString('hex')}`;
}

/** Perbandingan string constant-time (aman dari timing attack). */
function safeEqualString(a, b) {
    const left = Buffer.from(String(a ?? ''));
    const right = Buffer.from(String(b ?? ''));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function parseStoredPassword(stored) {
    const clean = String(stored || '').trim();
    if (!clean) return null;

    if (clean.startsWith(`${PASSWORD_PREFIX}$`)) {
        const [, iterationsRaw, salt, hash] = clean.split('$');
        const iterations = Number(iterationsRaw);
        if (!iterations || !salt || !hash) return null;
        return { iterations, salt, hash, format: 'pbkdf2' };
    }

    // Format lama: `salt:hash` dengan 1.000 iterasi.
    if (clean.includes(':')) {
        const [salt, hash] = clean.split(':');
        if (!salt || !hash) return null;
        return { iterations: LEGACY_PASSWORD_ITERATIONS, salt, hash, format: 'legacy-pbkdf2' };
    }

    return null;
}

/** Verifikasi password terhadap hash tersimpan (mendukung format lama). */
async function verifyPassword(password, stored) {
    const parsed = parseStoredPassword(stored);
    if (!parsed) return false;
    const key = await pbkdf2(password, parsed.salt, parsed.iterations);
    return safeEqualString(key.toString('hex'), parsed.hash);
}

/** True bila hash masih memakai format/iterasi lama sehingga perlu diperbarui. */
function passwordNeedsRehash(stored) {
    const parsed = parseStoredPassword(stored);
    if (!parsed) return true;
    return parsed.format !== 'pbkdf2' || parsed.iterations < PASSWORD_ITERATIONS;
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function parseCookies(header) {
    const out = {};
    const raw = String(header || '');
    if (!raw) return out;
    raw.split(';').forEach((pair) => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        const name = pair.slice(0, idx).trim();
        if (!name) return;
        const value = pair.slice(idx + 1).trim();
        try {
            out[name] = decodeURIComponent(value);
        } catch {
            out[name] = value;
        }
    });
    return out;
}

function isCrossSiteRequest(req) {
    const origin = req?.headers?.origin;
    const host = req?.headers?.host;
    if (!origin || !host) return false;
    try {
        return new URL(origin).host !== host;
    } catch {
        return true;
    }
}

/**
 * Bangun header Set-Cookie untuk sesi.
 * @param {import('http').IncomingMessage} req
 * @param {string} token
 * @param {number} [maxAgeSeconds] kosong = cookie sesi (hilang saat browser ditutup)
 */
function buildSessionCookie(req, token, maxAgeSeconds) {
    const crossSite = isCrossSiteRequest(req);
    const parts = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        `SameSite=${crossSite ? 'None' : 'Lax'}`
    ];
    const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
    if (crossSite || req?.secure || forwardedProto === 'https') parts.push('Secure');
    if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) parts.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
    return parts.join('; ');
}

function buildClearSessionCookie(req) {
    const crossSite = isCrossSiteRequest(req);
    const parts = [
        `${SESSION_COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        `SameSite=${crossSite ? 'None' : 'Lax'}`,
        'Max-Age=0'
    ];
    const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
    if (crossSite || req?.secure || forwardedProto === 'https') parts.push('Secure');
    return parts.join('; ');
}

function readSessionToken(req) {
    const authHeader = String(req?.headers?.authorization || '');
    if (authHeader.startsWith('Bearer ')) {
        const bearer = authHeader.slice(7).trim();
        if (bearer) return bearer;
    }
    const headerToken = req?.headers?.['x-session-token'];
    if (headerToken) return String(headerToken).trim();
    const cookies = parseCookies(req?.headers?.cookie);
    return cookies[SESSION_COOKIE_NAME] || '';
}

/**
 * Scope data per pengguna. Admin tetap melihat baris legacy tanpa pemilik
 * agar data lama tidak "hilang" setelah migrasi multi-user.
 */
function buildUserScope(user) {
    if (user?.role === 'admin') {
        return { clause: '(user_id = $1 OR user_id IS NULL)', params: [user.id] };
    }
    return { clause: 'user_id = $1', params: [user.id] };
}

/**
 * Rate limiter in-memory sederhana (cukup untuk mencegah brute-force dasar).
 * @param {{windowMs?: number, max?: number, blockMs?: number}} [options]
 */
function createRateLimiter(options = {}) {
    const windowMs = Number(options.windowMs) || 15 * 60 * 1000;
    const max = Number(options.max) || 10;
    const blockMs = Number(options.blockMs) || windowMs;
    const hits = new Map();

    // Bersihkan entri kedaluwarsa secara berkala agar memori tidak tumbuh tanpa batas.
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) {
            if (entry.resetAt <= now && (!entry.blockedUntil || entry.blockedUntil <= now)) hits.delete(key);
        }
    }, Math.max(60 * 1000, windowMs));
    if (typeof timer.unref === 'function') timer.unref();

    function check(key) {
        const now = Date.now();
        const id = String(key || 'unknown');
        let entry = hits.get(id);
        if (!entry || (entry.resetAt <= now && (!entry.blockedUntil || entry.blockedUntil <= now))) {
            entry = { count: 0, resetAt: now + windowMs, blockedUntil: 0 };
            hits.set(id, entry);
        }
        if (entry.blockedUntil && entry.blockedUntil > now) {
            return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
        }
        entry.count += 1;
        if (entry.count > max) {
            entry.blockedUntil = now + blockMs;
            return { allowed: false, retryAfter: Math.ceil(blockMs / 1000) };
        }
        return { allowed: true, retryAfter: 0 };
    }

    function reset(key) {
        hits.delete(String(key || 'unknown'));
    }

    return { check, reset };
}

module.exports = {
    PASSWORD_ITERATIONS,
    SESSION_COOKIE_NAME,
    hashPassword,
    verifyPassword,
    passwordNeedsRehash,
    safeEqualString,
    generateSessionToken,
    parseCookies,
    isCrossSiteRequest,
    buildSessionCookie,
    buildClearSessionCookie,
    readSessionToken,
    buildUserScope,
    createRateLimiter
};
