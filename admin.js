// ============================================================
//  admin.js — ניהול-על: מוסדות והרשאות כניסה
//  GET    /admin/tenants                    רשימת מוסדות + מספרים
//  POST   /admin/tenants                    { name, active }  — יוצר גם את הטבלאות של המוסד
//  PUT    /admin/tenants/:id                { name, active }
//  DELETE /admin/tenants/:id                { confirm_name }  — מוחק את המוסד וכל הטבלאות שלו
//  GET    /admin/access?tenant_id=:id|super הרשאות של מוסד / של מנהל-על
//  POST   /admin/access                     { tenant_id|null, rule_type: user|ip, username, password, ip, description }
//  PUT    /admin/access/:id                 { description, active, password?, username?, ip? }
//  DELETE /admin/access/:id
//  GET    /admin/login-log                  100 הכניסות האחרונות
// ============================================================
import { readJson, str, int, badRequest, notFound, conflict, forbidden } from './http.js';
import { requireSuper, hashPassword } from './auth.js';
import { getLocalTime } from './time.js';
import { ensureTenantSchema, dropTenantTables, tables } from './tenant_schema.js';
import { welcomeMail, preview, sendMail, validEmail, normalizeEmail, mailReady } from './mail.js';
import { getConfig, fillTemplate, sampleVars } from './settings.js';

// שם משתמש: עברית או אנגלית, ספרות, רווח ו-. _ - @  (2–60 תווים, מתחיל באות או ספרה)
const validUsername = u => /^[\p{L}\p{N}][\p{L}\p{N} ._@'-]{1,59}$/u.test(u);
const USERNAME_MSG = 'שם משתמש: 2–60 תווים — אותיות בעברית או באנגלית, ספרות, רווח';
function cleanEmail(v) {
    const e = normalizeEmail(v);
    if (!e) return null;
    if (!validEmail(e)) throw badRequest('כתובת המייל אינה תקינה');
    return e;
}

async function counts(env, t) {
    if (t.schema_version < 1) return { students: 0, classes: 0, meetings: 0 };
    const x = tables(t.id);
    return env.DB.prepare(`SELECT (SELECT COUNT(*) FROM ${x.students}) students, (SELECT COUNT(*) FROM ${x.classes}) classes,
        (SELECT COUNT(*) FROM ${x.meetings}) meetings`).first();
}

async function shape(env, t) {
    const access = await env.DB.prepare("SELECT SUM(rule_type = 'user') users, SUM(rule_type = 'ip') ips FROM access_rules WHERE tenant_id = ?").bind(t.id).first();
    return { id: t.id, name: t.name, active: !!t.active, created_at: t.created_at, tables_prefix: `t${t.id}_`, phone_managed_by: t.phone_managed_by || 'super',
        stats: await counts(env, t), access: { users: access.users || 0, ips: access.ips || 0 } };
}

async function getTenant(env, id) {
    const t = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    if (!t) throw notFound('המוסד לא נמצא');
    return t;
}

export async function listTenants(env, ctx) {
    requireSuper(ctx);
    const { results } = await env.DB.prepare('SELECT * FROM tenants ORDER BY name').all();
    return Promise.all(results.map(t => shape(env, t)));
}

export async function createTenant(request, env, ctx) {
    requireSuper(ctx);
    const body = await readJson(request);
    const name = str(body.name, 100);
    if (!name) throw badRequest('יש להזין שם מוסד');
    if (await env.DB.prepare('SELECT id FROM tenants WHERE name = ?').bind(name).first()) throw conflict('כבר קיים מוסד בשם הזה');
    const r = await env.DB.prepare('INSERT INTO tenants (name, active, schema_version, created_at, phone_managed_by) VALUES (?, ?, 0, ?, ?)')
        .bind(name, body.active === false ? 0 : 1, getLocalTime(), body.phone_managed_by === 'tenant' ? 'tenant' : 'super').run();
    const t = await getTenant(env, r.meta.last_row_id);
    await ensureTenantSchema(env, t);
    return shape(env, t);
}

export async function updateTenant(request, env, ctx, id) {
    requireSuper(ctx);
    const t = await getTenant(env, id);
    const body = await readJson(request);
    const name = body.name !== undefined ? str(body.name, 100) : t.name;
    if (!name) throw badRequest('יש להזין שם מוסד');
    const active = body.active !== undefined ? (body.active ? 1 : 0) : t.active;
    const managedBy = body.phone_managed_by === 'tenant' || body.phone_managed_by === 'super' ? body.phone_managed_by : (t.phone_managed_by || 'super');
    await env.DB.prepare('UPDATE tenants SET name = ?, active = ?, phone_managed_by = ? WHERE id = ?').bind(name, active, managedBy, id).run();
    if (!active) await env.DB.prepare('DELETE FROM sessions WHERE rule_id IN (SELECT id FROM access_rules WHERE tenant_id = ?)').bind(id).run();
    return shape(env, await getTenant(env, id));
}

export async function deleteTenant(request, env, ctx, id) {
    requireSuper(ctx);
    const t = await getTenant(env, id);
    const body = await readJson(request).catch(() => ({}));
    if (str(body.confirm_name, 100) !== t.name) throw badRequest('לאישור המחיקה יש להקליד את שם המוסד בדיוק', 'confirm_required');
    await dropTenantTables(env, id);
    await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE rule_id IN (SELECT id FROM access_rules WHERE tenant_id = ?)').bind(id),
        env.DB.prepare('DELETE FROM access_rules WHERE tenant_id = ?').bind(id),
        env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(id)
    ]);
    return { deleted: true };
}

// ---------- הרשאות ----------
const ruleShape = r => ({ id: r.id, tenant_id: r.tenant_id, rule_type: r.rule_type, username: r.username, ip: r.ip, email: r.email || null,
    description: r.description, active: !!r.active, last_used_at: r.last_used_at, created_at: r.created_at });

const validIp = ip => /^[0-9a-fA-F:.]{3,45}$/.test(ip);

export async function listAccess(env, ctx, url) {
    requireSuper(ctx);
    const scope = url.searchParams.get('tenant_id');
    const { results } = scope === 'super'
        ? await env.DB.prepare('SELECT * FROM access_rules WHERE tenant_id IS NULL ORDER BY rule_type, id').all()
        : await env.DB.prepare('SELECT * FROM access_rules WHERE tenant_id = ? ORDER BY rule_type, id').bind(int(scope) || 0).all();
    return results.map(ruleShape);
}

async function checkEmailUnique(env, email, exceptId = 0) {
    if (email && await env.DB.prepare('SELECT id FROM access_rules WHERE email = ? AND id != ?').bind(email, exceptId).first()) throw conflict('כתובת המייל כבר שייכת למשתמש אחר');
}

async function checkUnique(env, type, value, exceptId = 0) {
    const col = type === 'user' ? 'username' : 'ip';
    const r = await env.DB.prepare(`SELECT id FROM access_rules WHERE rule_type = ? AND ${col} = ? AND id != ?`).bind(type, value, exceptId).first();
    if (r) throw conflict(type === 'user' ? 'שם המשתמש כבר קיים במערכת' : 'כתובת ה-IP כבר מורשית (במוסד זה או באחר)');
}

function checkPassword(p) {
    if (String(p || '').length < 6) throw badRequest('הסיסמה חייבת להכיל לפחות 6 תווים');
}

export async function createAccess(request, env, ctx) {
    requireSuper(ctx);
    const body = await readJson(request);
    const tenantId = body.tenant_id ? int(body.tenant_id) : null;
    if (tenantId) await getTenant(env, tenantId);
    const type = body.rule_type === 'ip' ? 'ip' : 'user';
    const description = str(body.description, 100) || null;
    const now = getLocalTime();
    let r;
    if (type === 'user') {
        const username = str(body.username, 60).replace(/\s+/g, ' ');
        if (!validUsername(username)) throw badRequest(USERNAME_MSG);
        checkPassword(body.password);
        await checkUnique(env, 'user', username);
        const email = cleanEmail(body.email);
        await checkEmailUnique(env, email);
        const h = await hashPassword(String(body.password));
        r = await env.DB.prepare(`INSERT INTO access_rules (tenant_id, rule_type, username, password_hash, password_salt, email, description, active, created_at)
            VALUES (?, 'user', ?, ?, ?, ?, ?, 1, ?)`).bind(tenantId, username, h.hash, h.salt, email, description, now).run();
    } else {
        const ip = str(body.ip, 45);
        if (!validIp(ip)) throw badRequest('כתובת IP לא תקינה');
        await checkUnique(env, 'ip', ip);
        r = await env.DB.prepare(`INSERT INTO access_rules (tenant_id, rule_type, ip, description, active, created_at) VALUES (?, 'ip', ?, ?, 1, ?)`)
            .bind(tenantId, ip, description, now).run();
    }
    return ruleShape(await env.DB.prepare('SELECT * FROM access_rules WHERE id = ?').bind(r.meta.last_row_id).first());
}

export async function updateAccess(request, env, ctx, id) {
    requireSuper(ctx);
    const r = await env.DB.prepare('SELECT * FROM access_rules WHERE id = ?').bind(id).first();
    if (!r) throw notFound('ההרשאה לא נמצאה');
    const body = await readJson(request);
    if (r.id === ctx.rule.id && body.active === false) throw forbidden('לא ניתן להשבית את ההרשאה שדרכה נכנסתם');
    const stmts = [];
    const description = body.description !== undefined ? (str(body.description, 100) || null) : r.description;
    const active = body.active !== undefined ? (body.active ? 1 : 0) : r.active;
    if (r.rule_type === 'user') {
        const username = body.username !== undefined ? str(body.username, 60).replace(/\s+/g, ' ') : r.username;
        if (!validUsername(username)) throw badRequest(USERNAME_MSG);
        await checkUnique(env, 'user', username, id);
        const email = body.email !== undefined ? cleanEmail(body.email) : r.email;
        await checkEmailUnique(env, email, id);
        stmts.push(env.DB.prepare('UPDATE access_rules SET username = ?, email = ?, description = ?, active = ? WHERE id = ?').bind(username, email, description, active, id));
        if (body.password) {
            checkPassword(body.password);
            const h = await hashPassword(String(body.password));
            stmts.push(env.DB.prepare('UPDATE access_rules SET password_hash = ?, password_salt = ? WHERE id = ?').bind(h.hash, h.salt, id));
            stmts.push(env.DB.prepare('DELETE FROM sessions WHERE rule_id = ? AND token != ?').bind(id, ''));
        }
    } else {
        const ip = body.ip !== undefined ? str(body.ip, 45) : r.ip;
        if (!validIp(ip)) throw badRequest('כתובת IP לא תקינה');
        await checkUnique(env, 'ip', ip, id);
        stmts.push(env.DB.prepare('UPDATE access_rules SET ip = ?, description = ?, active = ? WHERE id = ?').bind(ip, description, active, id));
    }
    if (!active) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE rule_id = ?').bind(id));
    await env.DB.batch(stmts);
    return ruleShape(await env.DB.prepare('SELECT * FROM access_rules WHERE id = ?').bind(id).first());
}

export async function deleteAccess(env, ctx, id) {
    requireSuper(ctx);
    if (id === ctx.rule.id) throw forbidden('לא ניתן למחוק את ההרשאה שדרכה נכנסתם');
    const r = await env.DB.prepare('SELECT * FROM access_rules WHERE id = ?').bind(id).first();
    if (!r) throw notFound('ההרשאה לא נמצאה');
    if (!r.tenant_id) {
        const n = await env.DB.prepare('SELECT COUNT(*) n FROM access_rules WHERE tenant_id IS NULL AND active = 1').first();
        if (n.n <= 1) throw forbidden('זו ההרשאה האחרונה של מנהל-על');
    }
    await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE rule_id = ?').bind(id),
        env.DB.prepare('DELETE FROM access_rules WHERE id = ?').bind(id)
    ]);
    return { deleted: true };
}

export async function loginLog(env, ctx) {
    requireSuper(ctx);
    const { results } = await env.DB.prepare(`SELECT l.*, t.name tenant_name FROM login_log l LEFT JOIN tenants t ON t.id = l.tenant_id
        ORDER BY l.id DESC LIMIT 100`).all();
    return results;
}

// ---------- מייל פתיחת חשבון ----------
//  POST /admin/access/:id/welcome  { password?, send: false }  — תצוגה מקדימה (לא נשלח)
//                                  { password?, send: true }   — שליחה
//  הסיסמה לא נשמרת במערכת, לכן נכללת במייל רק אם מוזנת עכשיו (בדרך כלל מיד ביצירת המשתמש)
export async function welcomeEmail(request, env, ctx, id) {
    requireSuper(ctx);
    const r = await env.DB.prepare("SELECT * FROM access_rules WHERE id = ? AND rule_type = 'user'").bind(id).first();
    if (!r) throw notFound('המשתמש לא נמצא');
    const body = await readJson(request);
    const email = body.to ? cleanEmail(body.to) : r.email;
    if (!email) throw badRequest('למשתמש אין כתובת מייל. הוסיפו אותה בעריכת המשתמש');
    const tenant = r.tenant_id ? await env.DB.prepare('SELECT name FROM tenants WHERE id = ?').bind(r.tenant_id).first() : null;
    const cfg = await getConfig(env);
    const m = welcomeMail(cfg, {
        tenantName: tenant ? tenant.name : null, displayName: r.description, username: r.username,
        password: body.password ? String(body.password).slice(0, 100) : null, email, google: cfg.google_enabled && !!cfg.google_client_id && email === r.email
    }, fillTemplate);
    if (!body.send) return { ...preview(m), from: cfg.mail_from || null, mail_ready: mailReady(cfg) };
    return sendMail(cfg, m);
}

// תצוגה מקדימה של התבנית (גם לפני שמירה) עם נתונים לדוגמה
export async function previewTemplate(request, env, ctx) {
    requireSuper(ctx);
    const body = await readJson(request);
    const cfg = { ...(await getConfig(env)) };
    for (const k of ['welcome_subject', 'welcome_title', 'welcome_body', 'welcome_button', 'welcome_note', 'mail_from', 'site_url']) if (body[k] !== undefined) cfg[k] = String(body[k]);
    const v = sampleVars();
    const m = welcomeMail(cfg, { tenantName: v.tenant, displayName: v.name, username: v.username, password: v.password, email: v.email, google: true }, fillTemplate);
    return { ...preview(m), from: cfg.mail_from || null, mail_ready: mailReady(cfg) };
}

// מייל בדיקה (עם התבנית השמורה ונתונים לדוגמה)
export async function testMail(request, env, ctx) {
    requireSuper(ctx);
    const to = cleanEmail((await readJson(request)).to);
    if (!to) throw badRequest('יש להזין כתובת מייל לבדיקה');
    const cfg = await getConfig(env);
    const v = sampleVars();
    const m = welcomeMail(cfg, { tenantName: v.tenant, displayName: v.name, username: v.username, password: v.password, email: to, google: true }, fillTemplate);
    m.subject = `[בדיקה] ${m.subject}`;
    return sendMail(cfg, m);
}
