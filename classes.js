// ============================================================
//  classes.js — כיתות ומלמדים
// ============================================================
import { readJson, str, int, badRequest, notFound, conflict } from './http.js';
import { requireAdmin, requireTenant, classScope } from './auth.js';
import { stamp } from './time.js';
import { normalizePhone } from './phones.js';

export async function listClasses(env, ctx) {
    requireTenant(ctx);
    const scope = classScope(ctx);
    const { results } = await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.active = 1) students
        FROM classes c WHERE c.tenant_id = ? ${scope ? 'AND c.id = ?' : ''} ORDER BY c.sort_order, c.name`)
        .bind(...(scope ? [ctx.tenantId, scope] : [ctx.tenantId])).all();
    return results;
}

function fields(body, current = {}) {
    const name = body.name !== undefined ? str(body.name, 60) : current.name;
    if (!name) throw badRequest('חסר שם כיתה');
    return {
        name,
        teacher_name: body.teacher_name !== undefined ? str(body.teacher_name, 80) : current.teacher_name ?? null,
        teacher_phone: body.teacher_phone !== undefined ? normalizePhone(body.teacher_phone) : current.teacher_phone ?? null,
        location: body.location !== undefined ? str(body.location, 80) : current.location ?? null,
        sort_order: body.sort_order !== undefined ? (int(body.sort_order) ?? 0) : current.sort_order ?? 0,
        active: body.active !== undefined ? (body.active ? 1 : 0) : current.active ?? 1
    };
}

export async function createClass(request, env, ctx) {
    requireAdmin(ctx);
    const f = fields(await readJson(request));
    try {
        const r = await env.DB.prepare(`INSERT INTO classes (tenant_id, name, teacher_name, teacher_phone, location, sort_order, active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(ctx.tenantId, f.name, f.teacher_name, f.teacher_phone, f.location, f.sort_order, f.active, stamp()).run();
        return env.DB.prepare('SELECT * FROM classes WHERE id = ?').bind(r.meta.last_row_id).first();
    } catch (e) {
        if (/UNIQUE/.test(e.message)) throw conflict('כבר קיימת כיתה בשם הזה', 'class_exists');
        throw e;
    }
}

export async function updateClass(request, env, ctx, id) {
    requireAdmin(ctx);
    const c = await env.DB.prepare('SELECT * FROM classes WHERE id = ? AND tenant_id = ?').bind(id, ctx.tenantId).first();
    if (!c) throw notFound('הכיתה לא נמצאה');
    const f = fields(await readJson(request), c);
    try {
        await env.DB.prepare('UPDATE classes SET name = ?, teacher_name = ?, teacher_phone = ?, location = ?, sort_order = ?, active = ? WHERE id = ?')
            .bind(f.name, f.teacher_name, f.teacher_phone, f.location, f.sort_order, f.active, id).run();
    } catch (e) {
        if (/UNIQUE/.test(e.message)) throw conflict('כבר קיימת כיתה בשם הזה', 'class_exists');
        throw e;
    }
    return env.DB.prepare('SELECT * FROM classes WHERE id = ?').bind(id).first();
}

export async function deleteClass(env, ctx, id) {
    requireAdmin(ctx);
    const used = await env.DB.prepare('SELECT COUNT(*) n FROM students WHERE class_id = ? AND tenant_id = ?').bind(id, ctx.tenantId).first();
    if (used.n) throw conflict(`בכיתה יש ${used.n} תלמידים. העבירו או מחקו אותם קודם, או סמנו את הכיתה כלא פעילה`, 'class_in_use');
    const r = await env.DB.prepare('DELETE FROM classes WHERE id = ? AND tenant_id = ?').bind(id, ctx.tenantId).run();
    if (!r.meta.changes) throw notFound('הכיתה לא נמצאה');
    return { deleted: true };
}

// מציאת כיתה לפי שם או יצירתה (לייבוא)
export async function classIdByName(env, tenantId, name, cache) {
    const key = str(name, 60);
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    let c = await env.DB.prepare('SELECT id FROM classes WHERE tenant_id = ? AND name = ?').bind(tenantId, key).first();
    if (!c) {
        const r = await env.DB.prepare('INSERT INTO classes (tenant_id, name, sort_order, active, created_at) VALUES (?, ?, 0, 1, ?)').bind(tenantId, key, stamp()).run();
        c = { id: r.meta.last_row_id };
    }
    cache.set(key, c.id);
    return c.id;
}
