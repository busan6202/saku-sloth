'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
    hashPassword,
    verifyPassword,
    passwordNeedsRehash,
    safeEqualString,
    buildUserScope,
    parseCookies,
    buildSessionCookie,
    buildClearSessionCookie,
    readSessionToken,
    createRateLimiter,
    PASSWORD_ITERATIONS
} = require('../lib/security');

test('hashPassword menghasilkan format pbkdf2 dengan iterasi yang benar', async () => {
    const stored = await hashPassword('rahasia123');
    const parts = stored.split('$');
    assert.equal(parts[0], 'pbkdf2');
    assert.equal(Number(parts[1]), PASSWORD_ITERATIONS);
    assert.equal(parts.length, 4);
    assert.ok(parts[2].length >= 16);
});

test('hashPassword memakai salt acak (dua hash berbeda untuk password sama)', async () => {
    const a = await hashPassword('sama-persis');
    const b = await hashPassword('sama-persis');
    assert.notEqual(a, b);
    assert.equal(await verifyPassword('sama-persis', a), true);
    assert.equal(await verifyPassword('sama-persis', b), true);
});

test('verifyPassword menerima password benar dan menolak password salah', async () => {
    const stored = await hashPassword('moo-moo-2026');
    assert.equal(await verifyPassword('moo-moo-2026', stored), true);
    assert.equal(await verifyPassword('salah', stored), false);
    assert.equal(await verifyPassword('', stored), false);
});

test('verifyPassword masih kompatibel dengan hash lama salt:hash 1000 iterasi', async () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const legacy = `${salt}:${crypto.pbkdf2Sync('admin123', salt, 1000, 64, 'sha512').toString('hex')}`;
    assert.equal(await verifyPassword('admin123', legacy), true);
    assert.equal(passwordNeedsRehash(legacy), true);
});

test('passwordNeedsRehash false untuk hash baru', async () => {
    const stored = await hashPassword('baru');
    assert.equal(passwordNeedsRehash(stored), false);
});

test('verifyPassword menolak hash sha256 telanjang (format tidak dikenal)', async () => {
    const bare = crypto.createHash('sha256').update('admin').digest('hex');
    assert.equal(await verifyPassword('admin', bare), false);
});

test('safeEqualString constant-time dan aman untuk panjang berbeda', () => {
    assert.equal(safeEqualString('abc', 'abc'), true);
    assert.equal(safeEqualString('abc', 'abd'), false);
    assert.equal(safeEqualString('abc', 'abcd'), false);
    assert.equal(safeEqualString(null, undefined), true);
});

test('buildUserScope membatasi user biasa ke data miliknya', () => {
    assert.deepEqual(buildUserScope({ id: 7, role: 'user' }), {
        clause: 'user_id = $1',
        params: [7]
    });
});

test('buildUserScope admin tetap melihat baris legacy tanpa pemilik', () => {
    assert.deepEqual(buildUserScope({ id: 1, role: 'admin' }), {
        clause: '(user_id = $1 OR user_id IS NULL)',
        params: [1]
    });
});

test('parseCookies mem-parse header cookie dengan benar', () => {
    const cookies = parseCookies('a=1; saku_session=abc123; kosong=');
    assert.equal(cookies.a, '1');
    assert.equal(cookies.saku_session, 'abc123');
    assert.equal(cookies.kosong, '');
    assert.deepEqual(parseCookies(''), {});
});

test('cookie sesi memakai HttpOnly dan SameSite=Lax untuk same-origin', () => {
    const cookie = buildSessionCookie({ headers: { host: 'localhost:3000' } }, 'tok', 60);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=60/);
    assert.doesNotMatch(cookie, /Secure/);
});

test('cookie sesi lintas situs memakai SameSite=None; Secure', () => {
    const cookie = buildSessionCookie(
        { headers: { host: 'saku-sloth.vercel.app', origin: 'https://user.github.io' } },
        'tok'
    );
    assert.match(cookie, /SameSite=None/);
    assert.match(cookie, /Secure/);
});

test('buildClearSessionCookie mengosongkan cookie', () => {
    const cookie = buildClearSessionCookie({ headers: { host: 'localhost:3000' } });
    assert.match(cookie, /saku_session=/);
    assert.match(cookie, /Max-Age=0/);
});

test('readSessionToken mendukung Bearer, header khusus, dan cookie', () => {
    assert.equal(readSessionToken({ headers: { authorization: 'Bearer abc' } }), 'abc');
    assert.equal(readSessionToken({ headers: { 'x-session-token': 'def' } }), 'def');
    assert.equal(readSessionToken({ headers: { cookie: 'saku_session=ghi' } }), 'ghi');
    assert.equal(readSessionToken({ headers: {} }), '');
    assert.equal(readSessionToken({ headers: { authorization: 'Basic x' } }), '');
});

test('rate limiter memblokir setelah batas terlampaui', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2, blockMs: 1000 });
    assert.equal(limiter.check('ip').allowed, true);
    assert.equal(limiter.check('ip').allowed, true);
    const blocked = limiter.check('ip');
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfter > 0);
    assert.equal(limiter.check('ip-lain').allowed, true);
    limiter.reset('ip');
    assert.equal(limiter.check('ip').allowed, true);
});
