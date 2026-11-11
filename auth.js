// ============================================================
//  auth.js — כניסה למערכת והרשאות
//  כל הרשאה (access_rules) היא שם משתמש + סיסמה, או כתובת IP מורשית.
//  הרשאה עם tenant_id = מוסד אחד בלבד. בלי tenant_id = מנהל-על (רואה את כל המוסדות).
//  POST /auth/login  { username, password }  — או בלי פרטים: בדיקה לפי IP בלבד
//  POST /auth/google { credential }            — כניסה עם Google לפי המייל של המשתמש
//  הכניסה מחזירה טוקן (Authorization: Bearer) בתוקף 30 יום.
// ============================================================
import { ApiError, unauthorized, forbidden, badRequest, notFound, readJson, str } from './http.js';
import { getLocalTime } from './time.js';
import { ensureTenantSchema } from './tenant_schema.js';
import { normalizeEmail } from './mail.js';

const SESSION_DAYS = 30;
const MAX_FAILS = 8;   // ניסיונות כושלים מאותה כתובת ברבע שעה
const ITERATIONS = 100000;

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const randomToken = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));

export async function hashPassword(password, salt = b64(crypto.getRandomValues(new Uint8Array(16)))) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS }, key, 256);
    return { hash: b64(bits), salt };
}

function sameHash(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

const clientIp = request => request.headers.get('cf-connecting-ip') || '';
const utcNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

async function loadTenant(env, id) {
    return id ? env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first() : null;
}

function who(rule, tenant) {
    return {
        role: rule.tenant_id ? 'tenant' : 'super',
        method: rule.rule_type,
        email: rule.email || null,
        name: rule.rule_type === 'user' ? (rule.description || rule.username) : (rule.description || 'כניסה לפי IP'),
        username: rule.username || null,
        tenant: tenant ? { id: tenant.id, name: tenant.name } : null
    };
}

async function log(env, request, { success, method, username, tenantId }) {
    try {
        await env.DB.prepare('INSERT INTO login_log (created_at, success, method, username, tenant_id, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(utcNow(), success ? 1 : 0, method, username || null, tenantId || null, clientIp(request), (request.headers.get('user-agent') || '').slice(0, 300)).run();
    } catch (e) { /* רישום לא חוסם כניסה */ }
}

export async function login(request, env) {
    const body = await readJson(request).catch(() => ({}));
    const username = str(body.username, 60).replace(/\s+/g, ' ');
    const password = String(body.password || '');
    const ip = clientIp(request);

    const since = new Date(Date.now() - 15 * 60000).toISOString().replace('T', ' ').slice(0, 19);
    const fails = await env.DB.prepare('SELECT COUNT(*) n FROM login_log WHERE ip = ? AND success = 0 AND created_at > ?').bind(ip, since).first();
    if (fails.n >= MAX_FAILS) throw new ApiError(429, 'too_many_attempts', 'יותר מדי ניסיונות כניסה שגויים. נסו שוב בעוד רבע שעה');

    let rule = null;
    if (username) {
        const r = await env.DB.prepare("SELECT * FROM access_rules WHERE rule_type = 'user' AND username = ? AND active = 1").bind(username).first();
        if (r && sameHash((await hashPassword(password, r.password_salt)).hash, r.password_hash)) rule = r;
    } else {
        rule = ip ? await env.DB.prepare("SELECT * FROM access_rules WHERE rule_type = 'ip' AND ip = ? AND active = 1").bind(ip).first() : null;
    }
    const tenant = rule ? await loadTenant(env, rule.tenant_id) : null;
    if (rule && rule.tenant_id && (!tenant || !tenant.active)) rule = null;

    // כניסה לפי IP בלי הצלחה היא בדיקה שקטה — לא נרשמת ככישלון
    if (username || rule) await log(env, request, { success: !!rule, method: username ? 'user' : 'ip', username, tenantId: rule ? rule.tenant_id : null });
    if (!rule) {
        if (!username) return { authorized: false, ip };
        throw new ApiError(401, 'bad_credentials', 'שם משתמש או סיסמה שגויים');
    }
    return openSession(env, rule, tenant);
}

// אפשרויות למסך הכניסה (מזהה Google ציבורי)
export const loginOptions = env => ({ google_client_id: env.GOOGLE_CLIENT_ID || null });

async function openSession(env, rule, tenant) {
    const token = randomToken();
    const now = getLocalTime();
    await env.DB.batch([
        env.DB.prepare('INSERT INTO sessions (token, rule_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
            .bind(token, rule.id, new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(), now),
        env.DB.prepare('UPDATE access_rules SET last_used_at = ? WHERE id = ?').bind(now, rule.id),
        env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date().toISOString())
    ]);
    return { authorized: true, token, user: who(rule, tenant) };
}

// POST /auth/google { credential } — אסימון מכפתור Google. Google מאמת את החתימה (tokeninfo);
// אנחנו בודקים שהוא הונפק לאתר שלנו, שהמייל מאומת, ושיש משתמש פעיל עם המייל הזה.
export async function loginGoogle(request, env) {
    if (!env.GOOGLE_CLIENT_ID) throw new ApiError(403, 'google_off', 'הכניסה עם Google אינה זמינה');
    const body = await readJson(request);
    const credential = str(body.credential, 4096);
    if (!credential) throw badRequest('חסר אסימון Google');
    const ip = clientIp(request);
    const since = new Date(Date.now() - 15 * 60000).toISOString().replace('T', ' ').slice(0, 19);
    const fails = await env.DB.prepare('SELECT COUNT(*) n FROM login_log WHERE ip = ? AND success = 0 AND created_at > ?').bind(ip, since).first();
    if (fails.n >= MAX_FAILS) throw new ApiError(429, 'too_many_attempts', 'יותר מדי ניסיונות כניסה שגויים. נסו שוב בעוד רבע שעה');

    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    const g = res.ok ? await res.json() : null;
    if (!g || !g.email || g.aud !== env.GOOGLE_CLIENT_ID || String(g.email_verified) !== 'true' || Number(g.exp) * 1000 < Date.now()) {
        throw new ApiError(401, 'google_failed', 'האימות מול Google נכשל. נסו שוב');
    }
    const email = normalizeEmail(g.email);
    let rule = await env.DB.prepare("SELECT * FROM access_rules WHERE rule_type = 'user' AND email = ? AND active = 1").bind(email).first();
    const tenant = rule ? await loadTenant(env, rule.tenant_id) : null;
    if (rule && rule.tenant_id && (!tenant || !tenant.active)) rule = null;
    await log(env, request, { success: !!rule, method: 'google', username: email, tenantId: rule ? rule.tenant_id : null });
    if (!rule) throw new ApiError(401, 'no_user', `אין במערכת משתמש פעיל עם המייל ${g.email}. פנו למנהל המערכת`);
    return openSession(env, rule, tenant);
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

// הקשר הבקשה: { rule, role, tenant }  — tenant = המוסד שבו פועלים (למנהל-על: לפי X-Tenant)
export async function authenticate(request, env) {
    const token = bearer(request);
    if (!token) throw unauthorized();
    const rule = await env.DB.prepare(`SELECT r.*, s.expires_at FROM sessions s JOIN access_rules r ON r.id = s.rule_id
        WHERE s.token = ? AND r.active = 1`).bind(token).first();
    if (!rule || rule.expires_at < new Date().toISOString()) throw unauthorized('פג תוקף הכניסה, יש להיכנס מחדש');
    // הרשאת IP תקפה רק מאותה כתובת
    if (rule.rule_type === 'ip' && rule.ip !== clientIp(request)) throw unauthorized('הכתובת שלכם השתנתה, יש להיכנס מחדש');

    const role = rule.tenant_id ? 'tenant' : 'super';
    let tenant = null;
    if (role === 'tenant') {
        tenant = await loadTenant(env, rule.tenant_id);
        if (!tenant || !tenant.active) throw unauthorized('המוסד אינו פעיל');
    } else {
        const t = parseInt(request.headers.get('X-Tenant') || '', 10);
        if (t > 0) {
            tenant = await loadTenant(env, t);
            if (!tenant) throw notFound('המוסד לא נמצא');
        }
    }
    if (tenant) await ensureTenantSchema(env, tenant);
    return { rule, role, tenant, user: who(rule, tenant) };
}

export function requireSuper(ctx) {
    if (ctx.role !== 'super') throw forbidden('אזור זה זמין למנהל-על בלבד');
}

export function requireTenant(ctx) {
    if (!ctx.tenant) throw badRequest('יש לבחור מוסד', 'tenant_required');
}
