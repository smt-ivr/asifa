// ============================================================
//  tenants.js — ניהול מוסדות (מנהל-על בלבד)
//  כל מוסד: שם, מספרי חיוג (ApiDID) שמזהים אותו בשיחה, ומשתמש מנהל ראשון
// ============================================================
import { readJson, str, int, badRequest, notFound, conflict } from './http.js';
import { requireSuper, hashPassword, validatePassword } from './auth.js';
import { stamp } from './time.js';
import { normalizePhone } from './phones.js';
import { publicTenant, cleanSettings, tenantSettings } from './settings.js';

const cleanDids = list => [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/))
    .map(normalizePhone).filter(d => d.length >= 7))];

async function withStats(env, t) {
    const [dids, counts] = await Promise.all([
        env.DB.prepare('SELECT did FROM tenant_dids WHERE tenant_id = ? ORDER BY did').bind(t.id).all(),
        env.DB.prepare(`SELECT (SELECT COUNT(*) FROM students WHERE tenant_id = ?1 AND active = 1) students,
            (SELECT COUNT(*) FROM classes WHERE tenant_id = ?1 AND active = 1) classes,
            (SELECT COUNT(*) FROM meetings WHERE tenant_id = ?1) meetings,
            (SELECT COUNT(*) FROM users WHERE tenant_id = ?1) users`).bind(t.id).first()
    ]);
    return { ...publicTenant(t), dids: dids.results.map(r => r.did), stats: counts };
}

export async function listTenants(env, ctx) {
    requireSuper(ctx);
    const { results } = await env.DB.prepare('SELECT * FROM tenants ORDER BY name').all();
    return Promise.all(results.map(t => withStats(env, t)));
}

async function saveDids(env, tenantId, dids) {
    for (const did of dids) {
        const other = await env.DB.prepare('SELECT tenant_id FROM tenant_dids WHERE did = ? AND tenant_id != ?').bind(did, tenantId).first();
        if (other) throw conflict(`המספר ${did} כבר משויך למוסד אחר`, 'did_taken');
    }
    await env.DB.batch([
        env.DB.prepare('DELETE FROM tenant_dids WHERE tenant_id = ?').bind(tenantId),
        ...dids.map(d => env.DB.prepare('INSERT INTO tenant_dids (did, tenant_id) VALUES (?, ?)').bind(d, tenantId))
    ]);
}

export async function createTenant(request, env, ctx) {
    requireSuper(ctx);
    const body = await readJson(request);
    const name = str(body.name, 100);
    if (!name) throw badRequest('חסר שם מוסד');
    const dids = cleanDids(body.dids);
    const adminUser = str(body.admin_username, 60);
    if (adminUser) {
        validatePassword(body.admin_password);
        if (await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(adminUser).first()) throw conflict('שם המשתמש כבר קיים', 'username_taken');
    }
    const r = await env.DB.prepare('INSERT INTO tenants (name, line_number, yemot_token, settings, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
        .bind(name, normalizePhone(body.line_number) || dids[0] || null, str(body.yemot_token, 200) || null,
            JSON.stringify(cleanSettings(body.settings || {})), stamp()).run();
    const id = r.meta.last_row_id;
    await saveDids(env, id, dids);
    if (adminUser) {
        const h = await hashPassword(String(body.admin_password));
        await env.DB.prepare(`INSERT INTO users (tenant_id, username, display_name, role, password_hash, password_salt, created_at)
            VALUES (?, ?, ?, 'admin', ?, ?, ?)`).bind(id, adminUser, str(body.admin_display_name, 60) || 'מנהל', h.hash, h.salt, stamp()).run();
    }
    return withStats(env, await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first());
}

export async function updateTenant(request, env, ctx, id) {
    requireSuper(ctx);
    const t = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    if (!t) throw notFound('המוסד לא נמצא');
    const body = await readJson(request);
    const name = body.name !== undefined ? (str(body.name, 100) || t.name) : t.name;
    const line = body.line_number !== undefined ? normalizePhone(body.line_number) : t.line_number;
    const active = body.active !== undefined ? (body.active ? 1 : 0) : t.active;
    const token = body.yemot_token !== undefined && body.yemot_token !== null ? (str(body.yemot_token, 200) || null) : t.yemot_token;
    const settings = body.settings ? cleanSettings(body.settings, tenantSettings(t)) : tenantSettings(t);
    await env.DB.prepare('UPDATE tenants SET name = ?, line_number = ?, active = ?, yemot_token = ?, settings = ? WHERE id = ?')
        .bind(name, line, active, token, JSON.stringify(settings), id).run();
    if (body.dids !== undefined) await saveDids(env, id, cleanDids(body.dids));
    return withStats(env, await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first());
}

export async function tenantByDid(env, did) {
    const d = normalizePhone(did);
    if (!d) return null;
    return env.DB.prepare('SELECT t.* FROM tenant_dids x JOIN tenants t ON t.id = x.tenant_id WHERE x.did = ? AND t.active = 1').bind(d).first();
}

export async function tenantById(env, id) {
    const n = int(id);
    if (!n) return null;
    return env.DB.prepare('SELECT * FROM tenants WHERE id = ? AND active = 1').bind(n).first();
}
