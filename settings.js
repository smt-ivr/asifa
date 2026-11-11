// ============================================================
//  settings.js — הגדרות המערכת (מנהל-על, נערכות באתר)
//  GET  /admin/settings            כל ההגדרות (המפתח של Resend לא חוזר — רק האם מוגדר)
//  PUT  /admin/settings            עדכון; מפתח ריק = ללא שינוי, clear_resend_key = מחיקה
//  POST /admin/settings/preview    תצוגה מקדימה של מייל הפתיחה עם טקסט לא שמור ונתונים לדוגמה
//  POST /admin/settings/test-mail  { to } שליחת מייל בדיקה
//  ערך שלא נקבע באתר נלקח מ-wrangler.toml / סודות הוורקר.
// ============================================================
import { readJson, str, badRequest } from './http.js';
import { requireSuper } from './auth.js';
import { getLocalTime } from './time.js';

export const DEFAULT_WELCOME = {
    welcome_subject: 'חשבון חדש במערכת אסיפת הורים — {מוסד}',
    welcome_title: 'נפתח לכם חשבון במערכת אסיפת הורים',
    welcome_body: 'שלום {שם},\n\nנפתח עבורכם חשבון לניהול אסיפות ההורים של {מוסד}. במערכת מכניסים את התלמידים והכיתות, ומגדירים אסיפות עם שעות ואורכי פגישה לכל כיתה.\n\nאלה פרטי הכניסה שלכם:',
    welcome_button: 'כניסה למערכת',
    welcome_note: 'מומלץ לשמור את המייל הזה במקום בטוח ולא להעביר את הסיסמה לאחרים.'
};

const FIELDS = {
    resend_api_key: 200, mail_from: 200, site_url: 300, google_enabled: 1, google_client_id: 200,
    welcome_subject: 200, welcome_title: 200, welcome_body: 4000, welcome_button: 60, welcome_note: 1000
};

let cache = null;

async function readAll(env) {
    if (cache && cache.at > Date.now() - 30000) return cache.values;
    const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
    const values = Object.fromEntries(results.map(r => [r.key, r.value]));
    cache = { at: Date.now(), values };
    return values;
}

// ההגדרות בפועל: מה שנשמר באתר, ואם אין — ברירת המחדל מהוורקר
export async function getConfig(env) {
    const s = await readAll(env);
    const pick = (k, fallback) => (s[k] !== undefined && s[k] !== null && s[k] !== '' ? s[k] : fallback);
    return {
        resend_api_key: pick('resend_api_key', env.RESEND_API_KEY || ''),
        mail_from: pick('mail_from', env.MAIL_FROM || ''),
        site_url: pick('site_url', env.SITE_URL || 'https://smti.uk/asifa/'),
        google_enabled: pick('google_enabled', '1') === '1',
        google_client_id: pick('google_client_id', env.GOOGLE_CLIENT_ID || ''),
        welcome_subject: pick('welcome_subject', DEFAULT_WELCOME.welcome_subject),
        welcome_title: pick('welcome_title', DEFAULT_WELCOME.welcome_title),
        welcome_body: pick('welcome_body', DEFAULT_WELCOME.welcome_body),
        welcome_button: pick('welcome_button', DEFAULT_WELCOME.welcome_button),
        welcome_note: pick('welcome_note', DEFAULT_WELCOME.welcome_note)
    };
}

export async function getSettings(env, ctx) {
    requireSuper(ctx);
    const c = await getConfig(env);
    const { resend_api_key, ...rest } = c;
    return { ...rest, resend_key_set: !!resend_api_key, resend_key_hint: resend_api_key ? `••••${resend_api_key.slice(-4)}` : '', defaults: DEFAULT_WELCOME };
}

export async function updateSettings(request, env, ctx) {
    requireSuper(ctx);
    const body = await readJson(request);
    const now = getLocalTime();
    const stmts = [];
    for (const [k, max] of Object.entries(FIELDS)) {
        if (body[k] === undefined) continue;
        let v = k === 'google_enabled' ? (body[k] ? '1' : '0') : String(body[k] ?? '').slice(0, max);
        if (k !== 'welcome_body' && k !== 'welcome_note') v = v.trim();
        if (k === 'resend_api_key' && !v) continue;   // ריק = לא לשנות את המפתח
        if (k === 'resend_api_key' && !/^re_[\w-]{10,}$/.test(v)) throw badRequest('מפתח Resend אמור להתחיל ב-re_');
        if (k === 'site_url' && v && !/^https:\/\//.test(v)) throw badRequest('כתובת האתר חייבת להתחיל ב-https://');
        stmts.push(env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(k, v, now));
    }
    if (body.clear_resend_key) stmts.push(env.DB.prepare("DELETE FROM settings WHERE key = 'resend_api_key'"));
    if (stmts.length) await env.DB.batch(stmts);
    cache = null;
    return getSettings(env, ctx);
}

// החלפת {שם} {מוסד} {שם_משתמש} {מייל} בטקסט
export function fillTemplate(text, vars) {
    return String(text || '').replace(/\{([^{}]+)\}/g, (m, k) => (vars[k.trim()] !== undefined ? vars[k.trim()] : m));
}

export const TEMPLATE_VARS = ['שם', 'מוסד', 'שם_משתמש', 'מייל'];

export function sampleVars() {
    return { name: 'ר׳ משה כהן', tenant: 'חיידר בת עין', username: 'מזכירות בת עין', password: 'sod1234', email: 'office@example.com' };
}

export { str };
