// ============================================================
//  auth.js — כניסה למערכת, סיסמאות (PBKDF2) והרשאות
//  תפקידים:
//    super   — מנהל-על (בעל המערכת). רואה את כל המוסדות; פועל בתוך מוסד עם כותרת X-Tenant
//    admin   — מנהל/מזכירות של מוסד
//    teacher — מלמד: צפייה בכיתה שלו וטיפול בבקשות "חזרו אליי"
// ============================================================
import { ApiError, unauthorized, forbidden, badRequest, readJson, str } from './http.js';
import { stamp } from './time.js';

const ITERATIONS = 100000;
const SESSION_DAYS = 30;
const MAX_FAILS = 8;          // ניסיונות כושלים מאותה כתובת ברבע שעה

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const randomB64 = n => b64(crypto.getRandomValues(new Uint8Array(n)));
export const randomToken = () => randomB64(32).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));

export async function hashPassword(password, salt = randomB64(16)) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS }, key, 256);
    return { hash: b64(bits), salt };
}

function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

export function validatePassword(p) {
    if (String(p || '').length < 8) throw badRequest('הסיסמה חייבת להכיל לפחות 8 תווים', 'weak_password');
}

const publicUser = (u, tenant) => ({
    id: u.id, username: u.username, display_name: u.display_name, role: u.role,
    class_id: u.class_id, tenant_id: u.tenant_id, tenant_name: tenant ? tenant.name : null
});

export async function login(request, env) {
    const body = await readJson(request);
    const username = str(body.username, 60);
    const password = String(body.password || '');
    const ip = request.headers.get('cf-connecting-ip') || '';
    const now = stamp();

    const since = new Date(Date.now() - 15 * 60000).toISOString().replace('T', ' ').slice(0, 19);
    const fails = await env.DB.prepare('SELECT COUNT(*) n FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > ?').bind(ip, since).first();
    if (fails.n >= MAX_FAILS) throw new ApiError(429, 'too_many_attempts', 'יותר מדי ניסיונות כניסה. נסו שוב בעוד רבע שעה');

    const user = username ? await env.DB.prepare('SELECT * FROM users WHERE username = ? AND active = 1').bind(username).first() : null;
    let ok = false;
    if (user) {
        const { hash } = await hashPassword(password, user.password_salt);
        ok = safeEqual(hash, user.password_hash);
    }
    let tenant = null;
    if (ok && user.tenant_id) {
        tenant = await env.DB.prepare('SELECT id, name, active FROM tenants WHERE id = ?').bind(user.tenant_id).first();
        if (!tenant || !tenant.active) ok = false;
    }
    // login_attempts נשמר ב-UTC לצורך חישוב חלון הזמן
    await env.DB.prepare('INSERT INTO login_attempts (username, ip, success, created_at) VALUES (?, ?, ?, ?)')
        .bind(username, ip, ok ? 1 : 0, new Date().toISOString().replace('T', ' ').slice(0, 19)).run();
    if (!ok) throw new ApiError(401, 'bad_credentials', 'שם משתמש או סיסמה שגויים');

    const token = randomToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    await env.DB.batch([
        env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at, ip, created_at) VALUES (?, ?, ?, ?, ?)').bind(token, user.id, expires, ip, now),
        env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id),
        env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date().toISOString())
    ]);
    return { token, expires_at: expires, user: publicUser(user, tenant) };
}

export async function logout(request, env) {
    const token = bearer(request);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return { logged_out: true };
}

function bearer(request) {
    const h = request.headers.get('Authorization') || '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// מחזיר הקשר בקשה: { user, role, tenantId, tenant }
export async function authenticate(request, env) {
    const token = bearer(request);
    if (!token) throw unauthorized();
    const row = await env.DB.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND u.active = 1`).bind(token).first();
    if (!row || row.expires_at < new Date().toISOString()) throw unauthorized('פג תוקף הכניסה, יש להיכנס מחדש');

    let tenantId = row.tenant_id;
    if (row.role === 'super') {
        const t = parseInt(request.headers.get('X-Tenant') || '', 10);
        tenantId = Number.isInteger(t) && t > 0 ? t : null;
    }
    let tenant = null;
    if (tenantId) {
        tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
        if (!tenant) throw new ApiError(404, 'tenant_not_found', 'המוסד לא נמצא');
        if (!tenant.active && row.role !== 'super') throw forbidden('המוסד אינו פעיל');
    }
    return { user: row, role: row.role, tenantId, tenant, token };
}

export function me(ctx) {
    return publicUser(ctx.user, ctx.tenant);
}

export async function changePassword(request, env, ctx) {
    const body = await readJson(request);
    const { hash } = await hashPassword(String(body.current || ''), ctx.user.password_salt);
    if (!safeEqual(hash, ctx.user.password_hash)) throw badRequest('הסיסמה הנוכחית שגויה', 'bad_password');
    validatePassword(body.next);
    const h = await hashPassword(String(body.next));
    await env.DB.batch([
        env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').bind(h.hash, h.salt, ctx.user.id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(ctx.user.id, ctx.token)
    ]);
    return { changed: true };
}

// ---------- בדיקות הרשאה ----------
export function requireTenant(ctx) {
    if (!ctx.tenantId) throw new ApiError(400, 'tenant_required', 'יש לבחור מוסד');
}
export function requireAdmin(ctx) {
    requireTenant(ctx);
    if (ctx.role !== 'admin' && ctx.role !== 'super') throw forbidden();
}
export function requireSuper(ctx) {
    if (ctx.role !== 'super') throw forbidden();
}
// מלמד רואה רק את הכיתה שלו
export function classScope(ctx) {
    return ctx.role === 'teacher' ? (ctx.user.class_id || -1) : null;
}
