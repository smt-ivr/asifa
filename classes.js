// ============================================================
//  classes.js — כיתות ומלמדים (בטבלאות של המוסד)
//  GET /classes · POST /classes · PUT /classes/:id · DELETE /classes/:id
//  כיתות נוצרות גם אוטומטית בייבוא תלמידים (classIdByName)
// ============================================================
import { readJson, str, int, badRequest, notFound, conflict } from './http.js';
import { requireTenant } from './auth.js';
import { getLocalTime } from './time.js';
import { tables } from './tenant_schema.js';

export async function listClasses(env, ctx) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const { results } = await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM ${t.students} s WHERE s.class_id = c.id) students
        FROM ${t.classes} c ORDER BY c.sort_order, c.name`).all();
    return results;
}

function fields(body, cur = {}) {
    const name = body.name !== undefined ? str(body.name, 60) : cur.name;
    if (!name) throw badRequest('יש להזין שם כיתה');
    return {
        name,
        teacher_name: body.teacher_name !== undefined ? (str(body.teacher_name, 80) || null) : (cur.teacher_name ?? null),
        sort_order: body.sort_order !== undefined ? (int(body.sort_order) ?? 0) : (cur.sort_order ?? 0)
    };
}

const unique = e => { if (/UNIQUE/.test(e.message)) throw conflict('כבר קיימת כיתה בשם הזה'); throw e; };

export async function createClass(request, env, ctx) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const f = fields(await readJson(request));
    const r = await env.DB.prepare(`INSERT INTO ${t.classes} (name, teacher_name, sort_order, created_at) VALUES (?, ?, ?, ?)`)
        .bind(f.name, f.teacher_name, f.sort_order, getLocalTime()).run().catch(unique);
    return env.DB.prepare(`SELECT * FROM ${t.classes} WHERE id = ?`).bind(r.meta.last_row_id).first();
}

export async function updateClass(request, env, ctx, id) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const c = await env.DB.prepare(`SELECT * FROM ${t.classes} WHERE id = ?`).bind(id).first();
    if (!c) throw notFound('הכיתה לא נמצאה');
    const f = fields(await readJson(request), c);
    await env.DB.prepare(`UPDATE ${t.classes} SET name = ?, teacher_name = ?, sort_order = ? WHERE id = ?`)
        .bind(f.name, f.teacher_name, f.sort_order, id).run().catch(unique);
    return env.DB.prepare(`SELECT * FROM ${t.classes} WHERE id = ?`).bind(id).first();
}

export async function deleteClass(env, ctx, id) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const n = await env.DB.prepare(`SELECT COUNT(*) n FROM ${t.students} WHERE class_id = ?`).bind(id).first();
    if (n.n) throw conflict(`בכיתה יש ${n.n} תלמידים. העבירו אותם לכיתה אחרת או מחקו אותם קודם`);
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM ${t.meetingClasses} WHERE class_id = ?`).bind(id),
        env.DB.prepare(`DELETE FROM ${t.classes} WHERE id = ?`).bind(id)
    ]);
    return { deleted: true };
}

// מזהה כיתה לפי שם; יוצר אותה אם אינה קיימת
export async function classIdByName(env, tenantId, name, cache) {
    const key = str(name, 60);
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    const t = tables(tenantId);
    let c = await env.DB.prepare(`SELECT id FROM ${t.classes} WHERE name = ?`).bind(key).first();
    if (!c) {
        const r = await env.DB.prepare(`INSERT INTO ${t.classes} (name, sort_order, created_at) VALUES (?, 0, ?)`).bind(key, getLocalTime()).run();
        c = { id: r.meta.last_row_id };
    }
    cache.set(key, c.id);
    return c.id;
}
