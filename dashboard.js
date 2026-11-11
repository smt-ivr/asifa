// ============================================================
//  dashboard.js — נתוני לוח הבקרה של מוסד
//  GET /dashboard
// ============================================================
import { requireTenant } from './auth.js';
import { tables } from './tenant_schema.js';

export async function dashboard(env, ctx) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const totals = await env.DB.prepare(`SELECT
            (SELECT COUNT(*) FROM ${t.students}) students,
            (SELECT COUNT(*) FROM ${t.classes}) classes,
            (SELECT COUNT(*) FROM ${t.meetings}) meetings,
            (SELECT COUNT(*) FROM ${t.students} s WHERE NOT EXISTS (SELECT 1 FROM ${t.phones} p WHERE p.student_id = s.id)) no_phone,
            (SELECT COUNT(*) FROM ${t.students} WHERE class_id IS NULL) no_class,
            (SELECT COUNT(*) FROM ${t.classes} WHERE teacher_name IS NULL OR teacher_name = '') no_teacher`).first();
    const { results: classes } = await env.DB.prepare(`SELECT c.id, c.name, c.teacher_name, COUNT(s.id) students
        FROM ${t.classes} c LEFT JOIN ${t.students} s ON s.class_id = c.id GROUP BY c.id ORDER BY c.sort_order, c.name`).all();
    const next = await env.DB.prepare(`SELECT id, name, meeting_date FROM ${t.meetings} ORDER BY COALESCE(meeting_date, '9999') DESC, id DESC LIMIT 1`).first();
    return { totals, classes, latest_meeting: next || null };
}
