// ============================================================
//  students.js — תלמידים וטלפונים (בטבלאות של המוסד)
//  GET    /students?class_id=           כל התלמידים עם הטלפונים
//  POST   /students                     { first_name, last_name, class_id, id_number, father_name, phones: [{ label, phone }] }
//  PUT    /students/:id                 אותו גוף (שדות שלא נשלחו לא משתנים)
//  DELETE /students/:id
//  POST   /students/delete              { ids: [...] }  מחיקה מרובה
//  POST   /students/import              { rows: [{ first_name, last_name, class_name, id_number, father_name, phones: [{label, phone}] }] }
//         תלמיד קיים (לפי ת.ז, או שם+משפחה+כיתה) מתעדכן; כיתה שאינה קיימת נוצרת.
// ============================================================
import { readJson, str, int, badRequest, notFound } from './http.js';
import { requireTenant } from './auth.js';
import { getLocalTime } from './time.js';
import { tables } from './tenant_schema.js';
import { classIdByName } from './classes.js';

const MAX_PHONES = 8;

// "+972-52-123 4567" / "52-1234567" -> "0521234567"
export function normalizePhone(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.slice(3);
    if (d && !d.startsWith('0') && (d.length === 9 || d.length === 8)) d = '0' + d;
    return d;
}
const validPhone = p => /^0\d{8,9}$/.test(p);

function cleanPhones(list) {
    const out = [];
    for (const item of Array.isArray(list) ? list : []) {
        const phone = normalizePhone(typeof item === 'object' ? item.phone : item);
        if (!phone) continue;
        if (!validPhone(phone)) throw badRequest(`מספר טלפון לא תקין: ${typeof item === 'object' ? item.phone : item}`, 'bad_phone');
        if (out.some(x => x.phone === phone)) continue;
        out.push({ phone, label: typeof item === 'object' ? (str(item.label, 40) || null) : null });
    }
    return out.slice(0, MAX_PHONES);
}

const cleanId = v => str(v, 12).replace(/\D/g, '') || null;

async function withPhones(env, t, rows) {
    if (!rows.length) return [];
    const { results } = await env.DB.prepare(`SELECT student_id, phone, label FROM ${t.phones} ORDER BY student_id, sort_order, id`).all();
    const map = new Map();
    for (const p of results) {
        if (!map.has(p.student_id)) map.set(p.student_id, []);
        map.get(p.student_id).push({ phone: p.phone, label: p.label });
    }
    return rows.map(r => ({ ...r, phones: map.get(r.id) || [] }));
}

export async function listStudents(env, ctx, url) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const classId = int(url.searchParams.get('class_id'));
    const { results } = await env.DB.prepare(`SELECT s.*, c.name class_name, c.teacher_name FROM ${t.students} s
        LEFT JOIN ${t.classes} c ON c.id = s.class_id ${classId ? 'WHERE s.class_id = ?' : ''}
        ORDER BY c.sort_order, c.name, s.last_name, s.first_name`).bind(...(classId ? [classId] : [])).all();
    return withPhones(env, t, results);
}

async function getOne(env, t, id) {
    const s = await env.DB.prepare(`SELECT s.*, c.name class_name, c.teacher_name FROM ${t.students} s LEFT JOIN ${t.classes} c ON c.id = s.class_id WHERE s.id = ?`).bind(id).first();
    if (!s) throw notFound('התלמיד לא נמצא');
    const { results } = await env.DB.prepare(`SELECT phone, label FROM ${t.phones} WHERE student_id = ? ORDER BY sort_order, id`).bind(id).all();
    return { ...s, phones: results };
}

const phoneStatements = (env, t, studentId, phones) => [
    env.DB.prepare(`DELETE FROM ${t.phones} WHERE student_id = ?`).bind(studentId),
    ...phones.map((p, i) => env.DB.prepare(`INSERT INTO ${t.phones} (student_id, phone, label, sort_order) VALUES (?, ?, ?, ?)`).bind(studentId, p.phone, p.label, i))
];

async function checkClass(env, t, classId) {
    if (!classId) return null;
    if (!await env.DB.prepare(`SELECT id FROM ${t.classes} WHERE id = ?`).bind(classId).first()) throw badRequest('הכיתה לא נמצאה');
    return classId;
}

export async function createStudent(request, env, ctx) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const b = await readJson(request);
    const first = str(b.first_name, 60);
    if (!first) throw badRequest('יש להזין שם פרטי');
    const phones = cleanPhones(b.phones);
    const classId = await checkClass(env, t, int(b.class_id));
    const now = getLocalTime();
    const r = await env.DB.prepare(`INSERT INTO ${t.students} (first_name, last_name, class_id, id_number, father_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(first, str(b.last_name, 60), classId, cleanId(b.id_number), str(b.father_name, 60) || null, now, now).run();
    await env.DB.batch(phoneStatements(env, t, r.meta.last_row_id, phones));
    return getOne(env, t, r.meta.last_row_id);
}

export async function updateStudent(request, env, ctx, id) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const s = await getOne(env, t, id);
    const b = await readJson(request);
    const first = b.first_name !== undefined ? str(b.first_name, 60) : s.first_name;
    if (!first) throw badRequest('יש להזין שם פרטי');
    const stmts = [env.DB.prepare(`UPDATE ${t.students} SET first_name = ?, last_name = ?, class_id = ?, id_number = ?, father_name = ?, updated_at = ? WHERE id = ?`)
        .bind(first, b.last_name !== undefined ? str(b.last_name, 60) : s.last_name,
            b.class_id !== undefined ? await checkClass(env, t, int(b.class_id)) : s.class_id,
            b.id_number !== undefined ? cleanId(b.id_number) : s.id_number,
            b.father_name !== undefined ? (str(b.father_name, 60) || null) : s.father_name, getLocalTime(), id)];
    if (b.phones !== undefined) stmts.push(...phoneStatements(env, t, id, cleanPhones(b.phones)));
    await env.DB.batch(stmts);
    return getOne(env, t, id);
}

export async function deleteStudent(env, ctx, id) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    await getOne(env, t, id);
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM ${t.phones} WHERE student_id = ?`).bind(id),
        env.DB.prepare(`DELETE FROM ${t.students} WHERE id = ?`).bind(id)
    ]);
    return { deleted: 1 };
}

export async function deleteStudents(request, env, ctx) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const ids = ((await readJson(request)).ids || []).map(int).filter(Boolean).slice(0, 5000);
    if (!ids.length) throw badRequest('לא נבחרו תלמידים');
    const stmts = [];
    for (let i = 0; i < ids.length; i += 90) {
        const part = ids.slice(i, i + 90), q = part.map(() => '?').join(',');
        stmts.push(env.DB.prepare(`DELETE FROM ${t.phones} WHERE student_id IN (${q})`).bind(...part));
        stmts.push(env.DB.prepare(`DELETE FROM ${t.students} WHERE id IN (${q})`).bind(...part));
    }
    await env.DB.batch(stmts);
    return { deleted: ids.length };
}

export async function importStudents(request, env, ctx) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const body = await readJson(request);
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    if (!rows.length) throw badRequest('לא נמצאו שורות לייבוא');
    const cache = new Map();
    const now = getLocalTime();
    const out = { created: 0, updated: 0, classes_created: 0, errors: [] };
    const before = (await env.DB.prepare(`SELECT COUNT(*) n FROM ${t.classes}`).first()).n;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || {};
        try {
            const first = str(row.first_name, 60);
            if (!first) throw new Error('חסר שם פרטי');
            const last = str(row.last_name, 60);
            const phones = cleanPhones(row.phones);
            const classId = await classIdByName(env, ctx.tenant.id, row.class_name, cache);
            const idNumber = cleanId(row.id_number);
            let existing = idNumber ? await env.DB.prepare(`SELECT id FROM ${t.students} WHERE id_number = ?`).bind(idNumber).first() : null;
            if (!existing) existing = await env.DB.prepare(`SELECT id FROM ${t.students} WHERE first_name = ? AND last_name = ? AND class_id IS ?`).bind(first, last, classId).first();
            let id;
            if (existing) {
                id = existing.id;
                await env.DB.prepare(`UPDATE ${t.students} SET first_name = ?, last_name = ?, class_id = COALESCE(?, class_id), id_number = COALESCE(?, id_number),
                    father_name = COALESCE(?, father_name), updated_at = ? WHERE id = ?`)
                    .bind(first, last, classId, idNumber, str(row.father_name, 60) || null, now, id).run();
                out.updated++;
            } else {
                const r = await env.DB.prepare(`INSERT INTO ${t.students} (first_name, last_name, class_id, id_number, father_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
                    .bind(first, last, classId, idNumber, str(row.father_name, 60) || null, now, now).run();
                id = r.meta.last_row_id;
                out.created++;
            }
            if (phones.length) await env.DB.batch(phoneStatements(env, t, id, phones));
        } catch (e) {
            out.errors.push({ row: i + 1, message: e.message });
        }
    }
    out.classes_created = (await env.DB.prepare(`SELECT COUNT(*) n FROM ${t.classes}`).first()).n - before;
    return out;
}
