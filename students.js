// ============================================================
//  students.js — תלמידים וטלפוני הורים, כולל ייבוא מאקסל (הדבקה)
// ============================================================
import { readJson, str, int, badRequest, notFound, conflict } from './http.js';
import { requireAdmin, requireTenant, classScope } from './auth.js';
import { stamp } from './time.js';
import { normalizePhone, validPhone } from './phones.js';
import { classIdByName } from './classes.js';

const validCode = c => /^\d{1,8}$/.test(c);

export async function listStudents(env, ctx, url) {
    requireTenant(ctx);
    const scope = classScope(ctx);
    const classId = scope || int(url.searchParams.get('class_id'));
    const params = [ctx.tenantId];
    let where = 's.tenant_id = ?';
    if (classId) { where += ' AND s.class_id = ?'; params.push(classId); }
    const { results } = await env.DB.prepare(`SELECT s.*, c.name class_name,
            (SELECT group_concat(phone, ',') FROM student_phones p WHERE p.student_id = s.id) phones
        FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE ${where} ORDER BY c.sort_order, c.name, s.last_name, s.first_name`).bind(...params).all();
    return results.map(r => ({ ...r, phones: r.phones ? r.phones.split(',') : [] }));
}

async function nextCode(env, tenantId) {
    const r = await env.DB.prepare("SELECT MAX(CAST(code AS INTEGER)) m FROM students WHERE tenant_id = ? AND code GLOB '[0-9]*'").bind(tenantId).first();
    return String(Math.max(100, r.m || 0) + 1);
}

function cleanPhones(list) {
    const arr = (Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/)).map(normalizePhone).filter(Boolean);
    const bad = arr.find(p => !validPhone(p));
    if (bad) throw badRequest(`מספר טלפון לא תקין: ${bad}`, 'bad_phone');
    return [...new Set(arr)].slice(0, 6);
}

async function checkClass(env, ctx, classId) {
    if (!classId) return null;
    const c = await env.DB.prepare('SELECT id FROM classes WHERE id = ? AND tenant_id = ?').bind(classId, ctx.tenantId).first();
    if (!c) throw badRequest('הכיתה לא נמצאה');
    return classId;
}

async function getOne(env, ctx, id) {
    const s = await env.DB.prepare(`SELECT s.*, c.name class_name, (SELECT group_concat(phone, ',') FROM student_phones p WHERE p.student_id = s.id) phones
        FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ? AND s.tenant_id = ?`).bind(id, ctx.tenantId).first();
    if (!s) throw notFound('התלמיד לא נמצא');
    return { ...s, phones: s.phones ? s.phones.split(',') : [] };
}

function phoneStatements(env, ctx, studentId, phones) {
    const now = stamp();
    return [
        env.DB.prepare('DELETE FROM student_phones WHERE student_id = ?').bind(studentId),
        ...phones.map(p => env.DB.prepare('INSERT INTO student_phones (tenant_id, student_id, phone, source, created_at) VALUES (?, ?, ?, ?, ?)')
            .bind(ctx.tenantId, studentId, p, 'web', now))
    ];
}

export async function createStudent(request, env, ctx) {
    requireAdmin(ctx);
    const body = await readJson(request);
    const first = str(body.first_name, 60);
    if (!first) throw badRequest('חסר שם פרטי');
    let code = str(body.code, 8) || await nextCode(env, ctx.tenantId);
    if (!validCode(code)) throw badRequest('קוד תלמיד חייב להכיל ספרות בלבד (עד 8)');
    if (await env.DB.prepare('SELECT id FROM students WHERE tenant_id = ? AND code = ?').bind(ctx.tenantId, code).first()) throw conflict(`הקוד ${code} כבר בשימוש`, 'code_taken');
    const phones = cleanPhones(body.phones);
    const classId = await checkClass(env, ctx, int(body.class_id));
    const r = await env.DB.prepare(`INSERT INTO students (tenant_id, class_id, code, first_name, last_name, father_name, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)`).bind(ctx.tenantId, classId, code, first, str(body.last_name, 60), str(body.father_name, 60) || null, stamp()).run();
    const id = r.meta.last_row_id;
    await env.DB.batch(phoneStatements(env, ctx, id, phones));
    return getOne(env, ctx, id);
}

export async function updateStudent(request, env, ctx, id) {
    requireAdmin(ctx);
    const s = await getOne(env, ctx, id);
    const body = await readJson(request);
    const code = body.code !== undefined ? str(body.code, 8) : s.code;
    if (!validCode(code)) throw badRequest('קוד תלמיד חייב להכיל ספרות בלבד (עד 8)');
    if (code !== s.code && await env.DB.prepare('SELECT id FROM students WHERE tenant_id = ? AND code = ?').bind(ctx.tenantId, code).first()) throw conflict(`הקוד ${code} כבר בשימוש`, 'code_taken');
    const first = body.first_name !== undefined ? str(body.first_name, 60) : s.first_name;
    if (!first) throw badRequest('חסר שם פרטי');
    const classId = body.class_id !== undefined ? await checkClass(env, ctx, int(body.class_id)) : s.class_id;
    const stmts = [env.DB.prepare('UPDATE students SET code = ?, first_name = ?, last_name = ?, father_name = ?, class_id = ?, active = ? WHERE id = ?')
        .bind(code, first, body.last_name !== undefined ? str(body.last_name, 60) : s.last_name,
            body.father_name !== undefined ? (str(body.father_name, 60) || null) : s.father_name, classId,
            body.active !== undefined ? (body.active ? 1 : 0) : s.active, id)];
    if (body.phones !== undefined) stmts.push(...phoneStatements(env, ctx, id, cleanPhones(body.phones)));
    await env.DB.batch(stmts);
    return getOne(env, ctx, id);
}

export async function deleteStudent(env, ctx, id) {
    requireAdmin(ctx);
    await getOne(env, ctx, id);
    await env.DB.batch([
        env.DB.prepare('DELETE FROM booking_slots WHERE booking_id IN (SELECT id FROM bookings WHERE student_id = ?)').bind(id),
        env.DB.prepare('DELETE FROM bookings WHERE student_id = ?').bind(id),
        env.DB.prepare('DELETE FROM absences WHERE student_id = ?').bind(id),
        env.DB.prepare('DELETE FROM student_phones WHERE student_id = ?').bind(id),
        env.DB.prepare('DELETE FROM students WHERE id = ? AND tenant_id = ?').bind(id, ctx.tenantId)
    ]);
    return { deleted: true };
}

// ייבוא: rows = [{ code, first_name, last_name, father_name, class_name, phones }]
// קוד קיים -> עדכון; טלפונים מתווספים (לא נמחקים) אלא אם replace_phones
export async function importStudents(request, env, ctx) {
    requireAdmin(ctx);
    const body = await readJson(request);
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 3000) : [];
    if (!rows.length) throw badRequest('לא נמצאו שורות לייבוא');
    const classCache = new Map();
    const now = stamp();
    const result = { created: 0, updated: 0, phones: 0, errors: [] };
    let code = null;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || {};
        const line = i + 1;
        try {
            const first = str(row.first_name, 60);
            if (!first) throw new Error('חסר שם פרטי');
            let phones = [];
            try { phones = cleanPhones(row.phones); } catch (e) { throw new Error(e.message); }
            const classId = await classIdByName(env, ctx.tenantId, row.class_name, classCache);
            let c = str(row.code, 8);
            if (c && !validCode(c)) throw new Error('קוד תלמיד חייב להכיל ספרות בלבד');
            let existing = c ? await env.DB.prepare('SELECT id FROM students WHERE tenant_id = ? AND code = ?').bind(ctx.tenantId, c).first() : null;
            let id;
            if (existing) {
                id = existing.id;
                await env.DB.prepare(`UPDATE students SET first_name = ?, last_name = ?, father_name = COALESCE(?, father_name),
                    class_id = COALESCE(?, class_id), active = 1 WHERE id = ?`)
                    .bind(first, str(row.last_name, 60), str(row.father_name, 60) || null, classId, id).run();
                result.updated++;
            } else {
                if (!c) {
                    code = code ? String(+code + 1) : await nextCode(env, ctx.tenantId);
                    c = code;
                }
                const r = await env.DB.prepare(`INSERT INTO students (tenant_id, class_id, code, first_name, last_name, father_name, active, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 1, ?)`).bind(ctx.tenantId, classId, c, first, str(row.last_name, 60), str(row.father_name, 60) || null, now).run();
                id = r.meta.last_row_id;
                result.created++;
            }
            const stmts = [];
            if (body.replace_phones) stmts.push(env.DB.prepare('DELETE FROM student_phones WHERE student_id = ?').bind(id));
            for (const p of phones) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO student_phones (tenant_id, student_id, phone, source, created_at) VALUES (?, ?, ?, ?, ?)')
                .bind(ctx.tenantId, id, p, 'import', now));
            if (stmts.length) await env.DB.batch(stmts);
            result.phones += phones.length;
        } catch (e) {
            result.errors.push({ line, message: e.message });
        }
    }
    return result;
}

// ---------- לשימוש הקו הטלפוני ----------
export async function familyByPhone(env, tenantId, phone) {
    const { results } = await env.DB.prepare(`SELECT DISTINCT s.*, c.name class_name, c.teacher_name
        FROM student_phones p JOIN students s ON s.id = p.student_id LEFT JOIN classes c ON c.id = s.class_id
        WHERE p.tenant_id = ? AND p.phone = ? AND s.active = 1 ORDER BY c.sort_order, s.first_name`).bind(tenantId, phone).all();
    return results;
}

export async function studentByCode(env, tenantId, code) {
    return env.DB.prepare(`SELECT s.*, c.name class_name, c.teacher_name FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.tenant_id = ? AND s.code = ? AND s.active = 1`).bind(tenantId, String(code)).first();
}

export async function studentById(env, tenantId, id) {
    return env.DB.prepare(`SELECT s.*, c.name class_name, c.teacher_name FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.tenant_id = ? AND s.id = ? AND s.active = 1`).bind(tenantId, id).first();
}

export async function linkPhone(env, tenantId, studentId, phone) {
    await env.DB.prepare('INSERT OR IGNORE INTO student_phones (tenant_id, student_id, phone, source, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(tenantId, studentId, phone, 'phone', stamp()).run();
}
