// ============================================================
//  bookings.js — מנוע התורים (בטבלאות של המוסד)
//  משמש גם את האתר וגם את הקו הטלפוני — אותם כללים בדיוק.
//
//  שעות כל כיתה מחולקות לפרקים לפי המחלק המשותף של אורכי הפגישה בכיתה
//  (5 ו-10 -> פרקים של 5 דקות; 15 -> פרקים של 15). תור תופס כמה פרקים צמודים.
//  כל פרק תפוס נרשם ב-booking_slots עם מפתח (אסיפה, כיתה, פרק) — שני הורים
//  לא יכולים לקבל אותה שעה גם בלחיצה בו-זמנית.
//  הורה לכמה ילדים: אין תורים חופפים, וההצעה הראשונה קרובה לתורים של האחים.
// ============================================================
import { ApiError } from './http.js';
import { getLocalTime, toMinutes } from './time.js';
import { tables } from './tenant_schema.js';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const parse = s => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (e) { return []; } };

// הגדרת כיתה באסיפה: { class_id, start, end, durations, step, class_name, teacher_name }
export async function classSetup(env, tenantId, meetingId, classId) {
    const t = tables(tenantId);
    const r = await env.DB.prepare(`SELECT mc.*, c.name class_name, c.teacher_name FROM ${t.meetingClasses} mc JOIN ${t.classes} c ON c.id = mc.class_id
        WHERE mc.meeting_id = ? AND mc.class_id = ?`).bind(meetingId, classId).first();
    if (!r) return null;
    const durations = parse(r.durations).filter(d => d > 0).sort((a, b) => a - b);
    return { class_id: r.class_id, class_name: r.class_name, teacher_name: r.teacher_name, start: toMinutes(r.start_time), end: toMinutes(r.end_time),
        durations, step: durations.reduce(gcd, durations[0] || 5) };
}

export async function bookingOf(env, tenantId, meetingId, studentId) {
    return env.DB.prepare(`SELECT * FROM ${tables(tenantId).bookings} WHERE meeting_id = ? AND student_id = ?`).bind(meetingId, studentId).first();
}

// תורים של אחים באותה אסיפה: [[מ, עד], ...]
export async function familyBusy(env, tenantId, meetingId, familyIds, exceptStudentId) {
    const ids = familyIds.filter(id => id !== exceptStudentId);
    if (!ids.length) return [];
    const { results } = await env.DB.prepare(`SELECT start_min, duration FROM ${tables(tenantId).bookings}
        WHERE meeting_id = ? AND student_id IN (${ids.map(() => '?').join(',')})`).bind(meetingId, ...ids).all();
    return results.map(b => [b.start_min, b.start_min + b.duration]);
}

// כל שעות ההתחלה הפנויות לתור באורך duration, כרונולוגי
export async function availableStarts(env, tenantId, meetingId, setup, duration, studentId, busy = []) {
    const t = tables(tenantId);
    const own = await bookingOf(env, tenantId, meetingId, studentId);
    const { results } = await env.DB.prepare(`SELECT slot_min, booking_id FROM ${t.slots} WHERE meeting_id = ? AND class_id = ?`).bind(meetingId, setup.class_id).all();
    const taken = new Set(results.filter(r => !own || r.booking_id !== own.id).map(r => r.slot_min));
    const out = [];
    for (let s = setup.start; s + duration <= setup.end; s += setup.step) {
        let ok = true;
        for (let x = s; x < s + duration; x += setup.step) if (taken.has(x)) { ok = false; break; }
        if (ok && busy.some(([a, b]) => s < b && s + duration > a)) ok = false;
        if (ok) out.push(s);
    }
    return out;
}

// סדר הצעה: קרוב לתורי האחים קודם; אחרת כרונולוגי
export function preferredOrder(starts, busy, duration) {
    if (!busy.length) return starts;
    const dist = s => Math.min(...busy.map(([a, b]) => (s >= b ? s - b : s + duration <= a ? a - (s + duration) : 0)));
    return [...starts].sort((x, y) => dist(x) - dist(y) || x - y);
}

export async function book(env, tenantId, { meetingId, setup, studentId, start, duration, source, phone = null, busy = [] }) {
    if (!setup.durations.includes(duration)) throw new ApiError(400, 'bad_duration', 'אורך הפגישה אינו מותר בכיתה זו');
    const starts = await availableStarts(env, tenantId, meetingId, setup, duration, studentId, busy);
    if (!starts.includes(start)) throw new ApiError(409, 'slot_taken', 'השעה שנבחרה כבר אינה פנויה');
    const t = tables(tenantId);
    const now = getLocalTime();
    const old = await bookingOf(env, tenantId, meetingId, studentId);
    const sub = `(SELECT id FROM ${t.bookings} WHERE meeting_id = ? AND student_id = ?)`;
    const stmts = [
        env.DB.prepare(`DELETE FROM ${t.slots} WHERE booking_id IN ${sub}`).bind(meetingId, studentId),
        env.DB.prepare(`DELETE FROM ${t.bookings} WHERE meeting_id = ? AND student_id = ?`).bind(meetingId, studentId),
        env.DB.prepare(`INSERT INTO ${t.bookings} (meeting_id, class_id, student_id, start_min, duration, source, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(meetingId, setup.class_id, studentId, start, duration, source, phone, old ? old.created_at : now, now)
    ];
    for (let x = start; x < start + duration; x += setup.step) {
        stmts.push(env.DB.prepare(`INSERT INTO ${t.slots} (meeting_id, class_id, slot_min, booking_id) VALUES (?, ?, ?, ${sub})`).bind(meetingId, setup.class_id, x, meetingId, studentId));
    }
    stmts.push(env.DB.prepare(`DELETE FROM ${t.absences} WHERE meeting_id = ? AND student_id = ?`).bind(meetingId, studentId));
    try {
        await env.DB.batch(stmts);
    } catch (e) {
        if (/UNIQUE|PRIMARY KEY|constraint/i.test(e.message)) throw new ApiError(409, 'slot_taken', 'השעה נתפסה הרגע על ידי הורה אחר');
        throw e;
    }
    return bookingOf(env, tenantId, meetingId, studentId);
}

export async function cancelBooking(env, tenantId, meetingId, studentId) {
    const t = tables(tenantId);
    const b = await bookingOf(env, tenantId, meetingId, studentId);
    if (!b) return false;
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM ${t.slots} WHERE booking_id = ?`).bind(b.id),
        env.DB.prepare(`DELETE FROM ${t.bookings} WHERE id = ?`).bind(b.id)
    ]);
    return true;
}

export async function markAbsent(env, tenantId, meetingId, studentId, { phone = null, source, note = null }) {
    await cancelBooking(env, tenantId, meetingId, studentId);
    await env.DB.prepare(`INSERT INTO ${tables(tenantId).absences} (meeting_id, student_id, phone, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (meeting_id, student_id) DO UPDATE SET phone = excluded.phone, source = excluded.source, handled = 0, created_at = excluded.created_at`)
        .bind(meetingId, studentId, phone, source, note, getLocalTime()).run();
}

// משפחה = כל התלמידים שחולקים טלפון עם התלמיד
export async function familyOf(env, tenantId, studentId) {
    const t = tables(tenantId);
    const { results } = await env.DB.prepare(`SELECT DISTINCT p2.student_id id FROM ${t.phones} p1 JOIN ${t.phones} p2 ON p2.phone = p1.phone WHERE p1.student_id = ?`).bind(studentId).all();
    const ids = results.map(r => r.id);
    if (!ids.includes(studentId)) ids.push(studentId);
    return ids;
}
