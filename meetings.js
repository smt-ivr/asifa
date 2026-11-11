// ============================================================
//  meetings.js — אסיפות (בטבלאות של המוסד)
//  GET    /meetings                רשימה
//  POST   /meetings                { name }  — יוצר אסיפה עם ברירות מחדל
//  GET    /meetings/:id            האסיפה + כל כיתות המוסד עם ההגדרות שלהן באסיפה
//  PUT    /meetings/:id            { name, meeting_date, durations: [5,10], notes,
//                                    classes: [{ class_id, start_time, end_time, durations: [5,10] }] }
//                                  classes מחליף את רשימת הכיתות המשתתפות
//  DELETE /meetings/:id
// ============================================================
import { readJson, str, int, badRequest, notFound } from './http.js';
import { requireTenant } from './auth.js';
import { getLocalTime, validDate, validTime, toMinutes } from './time.js';
import { tables } from './tenant_schema.js';

const parse = s => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (e) { return []; } };

function cleanDurations(list, label) {
    const out = [...new Set((Array.isArray(list) ? list : []).map(int).filter(n => n >= 1 && n <= 120))].sort((a, b) => a - b);
    if (!out.length) throw badRequest(`יש לבחור לפחות אורך פגישה אחד${label ? ` (${label})` : ''}`);
    return out.slice(0, 8);
}

const shape = m => ({ ...m, durations: parse(m.durations) });

async function getMeeting(env, t, id) {
    const m = await env.DB.prepare(`SELECT * FROM ${t.meetings} WHERE id = ?`).bind(id).first();
    if (!m) throw notFound('האסיפה לא נמצאה');
    return m;
}

export async function listMeetings(env, ctx) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const { results } = await env.DB.prepare(`SELECT m.*, (SELECT COUNT(*) FROM ${t.meetingClasses} mc WHERE mc.meeting_id = m.id) classes_count
        FROM ${t.meetings} m ORDER BY COALESCE(m.meeting_date, '9999') DESC, m.id DESC`).all();
    return results.map(shape);
}

export async function createMeeting(request, env, ctx) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const name = str((await readJson(request)).name, 100);
    if (!name) throw badRequest('יש להזין שם לאסיפה');
    const now = getLocalTime();
    const r = await env.DB.prepare(`INSERT INTO ${t.meetings} (name, durations, created_at, updated_at) VALUES (?, '[5,10]', ?, ?)`).bind(name, now, now).run();
    return meetingDetails(env, ctx, r.meta.last_row_id);
}

export async function meetingDetails(env, ctx, id) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const m = shape(await getMeeting(env, t, id));
    const { results } = await env.DB.prepare(`SELECT c.id class_id, c.name class_name, c.teacher_name,
            (SELECT COUNT(*) FROM ${t.students} s WHERE s.class_id = c.id) students,
            mc.start_time, mc.end_time, mc.durations
        FROM ${t.classes} c LEFT JOIN ${t.meetingClasses} mc ON mc.class_id = c.id AND mc.meeting_id = ?
        ORDER BY c.sort_order, c.name`).bind(id).all();
    m.classes = results.map(r => ({ ...r, included: !!r.start_time, durations: r.durations ? parse(r.durations) : [] }));
    return m;
}

export async function updateMeeting(request, env, ctx, id) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const m = await getMeeting(env, t, id);
    const b = await readJson(request);
    const name = b.name !== undefined ? str(b.name, 100) : m.name;
    if (!name) throw badRequest('יש להזין שם לאסיפה');
    let date = b.meeting_date !== undefined ? (str(b.meeting_date, 10) || null) : m.meeting_date;
    if (date && !validDate(date)) throw badRequest('תאריך האסיפה לא תקין');
    const durations = b.durations !== undefined ? cleanDurations(b.durations) : parse(m.durations);
    const stmts = [env.DB.prepare(`UPDATE ${t.meetings} SET name = ?, meeting_date = ?, durations = ?, notes = ?, updated_at = ? WHERE id = ?`)
        .bind(name, date, JSON.stringify(durations), b.notes !== undefined ? (str(b.notes, 1000) || null) : m.notes, getLocalTime(), id)];

    if (Array.isArray(b.classes)) {
        const { results: all } = await env.DB.prepare(`SELECT id, name FROM ${t.classes}`).all();
        const names = new Map(all.map(c => [c.id, c.name]));
        stmts.push(env.DB.prepare(`DELETE FROM ${t.meetingClasses} WHERE meeting_id = ?`).bind(id));
        const seen = new Set();
        for (const c of b.classes) {
            const classId = int(c.class_id);
            if (!names.has(classId) || seen.has(classId)) continue;
            seen.add(classId);
            const label = names.get(classId);
            if (!validTime(c.start_time) || !validTime(c.end_time)) throw badRequest(`יש להזין שעת התחלה וסיום ל${label}`);
            if (toMinutes(c.end_time) <= toMinutes(c.start_time)) throw badRequest(`בכיתה ${label} שעת הסיום חייבת להיות אחרי שעת ההתחלה`);
            const d = cleanDurations(c.durations, label);
            stmts.push(env.DB.prepare(`INSERT INTO ${t.meetingClasses} (meeting_id, class_id, start_time, end_time, durations) VALUES (?, ?, ?, ?, ?)`)
                .bind(id, classId, c.start_time, c.end_time, JSON.stringify(d)));
        }
    }
    await env.DB.batch(stmts);
    return meetingDetails(env, ctx, id);
}

export async function deleteMeeting(env, ctx, id) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    await getMeeting(env, t, id);
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM ${t.meetingClasses} WHERE meeting_id = ?`).bind(id),
        env.DB.prepare(`DELETE FROM ${t.meetings} WHERE id = ?`).bind(id)
    ]);
    return { deleted: true };
}
