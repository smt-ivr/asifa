// ============================================================
//  users.js — משתמשי המוסד (מנהלים ומלמדים)
// ============================================================
import { readJson, str, int, badRequest, notFound, conflict, forbidden } from './http.js';
import { requireAdmin, hashPassword, validatePassword } from './auth.js';
import { stamp } from './time.js';

const pub = u => ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role, class_id: u.class_id, active: !!u.active, last_login_at: u.last_login_at, created_at: u.created_at });

export async function listUsers(env, ctx) {
    requireAdmin(ctx);
    const { results } = await env.DB.prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY role, username').bind(ctx.tenantId).all();
    return results.map(pub);
}

async function checkClass(env, ctx, classId) {
    if (!classId) return null;
    const c = await env.DB.prepare('SELECT id FROM classes WHERE id = ? AND tenant_id = ?').bind(classId, ctx.tenantId).first();
    if (!c) throw badRequest('הכיתה לא נמצאה');
    return classId;
}

export async function createUser(request, env, ctx) {
    requireAdmin(ctx);
    const body = await readJson(request);
    const username = str(body.username, 60);
    if (!/^[\w.@-]{3,60}$/.test(username)) throw badRequest('שם משתמש: לפחות 3 תווים באנגלית/ספרות');
    const role = body.role === 'teacher' ? 'teacher' : 'admin';
    validatePassword(body.password);
    if (await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()) throw conflict('שם המשתמש כבר קיים', 'username_taken');
    const classId = role === 'teacher' ? await checkClass(env, ctx, int(body.class_id)) : null;
    if (role === 'teacher' && !classId) throw badRequest('יש לבחור כיתה למלמד');
    const h = await hashPassword(String(body.password));
    const r = await env.DB.prepare(`INSERT INTO users (tenant_id, username, display_name, role, class_id, password_hash, password_salt, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(ctx.tenantId, username, str(body.display_name, 60) || username, role, classId, h.hash, h.salt, stamp()).run();
    return pub(await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(r.meta.last_row_id).first());
}

export async function updateUser(request, env, ctx, id) {
    requireAdmin(ctx);
    const u = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').bind(id, ctx.tenantId).first();
    if (!u) throw notFound('המשתמש לא נמצא');
    const body = await readJson(request);
    if (u.id === ctx.user.id && body.active === false) throw forbidden('לא ניתן להשבית את המשתמש שלך');
    const role = body.role !== undefined ? (body.role === 'teacher' ? 'teacher' : 'admin') : u.role;
    const classId = role === 'teacher' ? await checkClass(env, ctx, body.class_id !== undefined ? int(body.class_id) : u.class_id) : null;
    if (role === 'teacher' && !classId) throw badRequest('יש לבחור כיתה למלמד');
    const stmts = [env.DB.prepare('UPDATE users SET display_name = ?, role = ?, class_id = ?, active = ? WHERE id = ?')
        .bind(body.display_name !== undefined ? str(body.display_name, 60) : u.display_name, role, classId,
            body.active !== undefined ? (body.active ? 1 : 0) : u.active, id)];
    if (body.password) {
        validatePassword(body.password);
        const h = await hashPassword(String(body.password));
        stmts.push(env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').bind(h.hash, h.salt, id));
        stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
    }
    if (body.active === false) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
    await env.DB.batch(stmts);
    return pub(await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first());
}

export async function deleteUser(env, ctx, id) {
    requireAdmin(ctx);
    if (id === ctx.user.id) throw forbidden('לא ניתן למחוק את המשתמש שלך');
    const r = await env.DB.prepare('DELETE FROM users WHERE id = ? AND tenant_id = ?').bind(id, ctx.tenantId).run();
    if (!r.meta.changes) throw notFound('המשתמש לא נמצא');
    return { deleted: true };
}
