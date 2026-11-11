// ============================================================
//  settings.js — הגדרות המוסד (שם, מספר קו, צינתוקים)
//  הטוקן של ימות לא חוזר לעולם ללקוח — רק האם הוגדר.
// ============================================================
import { readJson, str, int } from './http.js';
import { requireAdmin } from './auth.js';
import { normalizePhone } from './phones.js';

export const DEFAULT_SETTINGS = {
    tzintuk_url: 'https://www.call2all.co.il/ym/api/RunTzintuk',
    tzintuk_caller_id: '',        // ריק = מספר הקו של המוסד
    tzintuk_timeout: 9,           // שניות צלצול
    office_note: '',              // משפט להקראה כשההרשמה נעולה, למשל "לשינויים פנו למזכירות"
    print_footer: ''              // שורה בתחתית הפתקים
};

export function tenantSettings(tenant) {
    let s = {};
    try { s = JSON.parse(tenant.settings || '{}'); } catch (e) { /* ignore */ }
    return { ...DEFAULT_SETTINGS, ...s };
}

export function publicTenant(t) {
    return {
        id: t.id, name: t.name, line_number: t.line_number, active: !!t.active,
        has_yemot_token: !!t.yemot_token, settings: tenantSettings(t), created_at: t.created_at
    };
}

export function cleanSettings(input, current = {}) {
    const s = { ...DEFAULT_SETTINGS, ...current };
    if (input.tzintuk_url !== undefined) {
        const u = str(input.tzintuk_url, 300);
        s.tzintuk_url = /^https:\/\//.test(u) ? u : DEFAULT_SETTINGS.tzintuk_url;
    }
    if (input.tzintuk_caller_id !== undefined) s.tzintuk_caller_id = normalizePhone(input.tzintuk_caller_id);
    if (input.tzintuk_timeout !== undefined) s.tzintuk_timeout = Math.min(30, Math.max(3, int(input.tzintuk_timeout) || 9));
    if (input.office_note !== undefined) s.office_note = str(input.office_note, 200);
    if (input.print_footer !== undefined) s.print_footer = str(input.print_footer, 200);
    return s;
}

export async function getSettings(env, ctx) {
    requireAdmin(ctx);
    return publicTenant(ctx.tenant);
}

export async function updateSettings(request, env, ctx) {
    requireAdmin(ctx);
    const body = await readJson(request);
    const t = ctx.tenant;
    const name = body.name !== undefined ? str(body.name, 100) || t.name : t.name;
    const line = body.line_number !== undefined ? normalizePhone(body.line_number) : t.line_number;
    const settings = cleanSettings(body.settings || {}, tenantSettings(t));
    let token = t.yemot_token;
    if (body.yemot_token !== undefined && body.yemot_token !== null) token = str(body.yemot_token, 200) || null;
    await env.DB.prepare('UPDATE tenants SET name = ?, line_number = ?, yemot_token = ?, settings = ? WHERE id = ?')
        .bind(name, line, token, JSON.stringify(settings), t.id).run();
    const fresh = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(t.id).first();
    return publicTenant(fresh);
}
