// ============================================================
//  bookings.js — מנוע התורים: חישוב שעות פנויות, קביעה, ביטול ושיבוץ אוטומטי
//  משמש גם את ממשק הניהול וגם את הקו הטלפוני — אותם כללים בדיוק.
//
//  השעות של כל כיתה מחולקות לפרקים של 5 דקות. תור של 10 דקות תופס שני פרקים.
//  כל פרק תפוס נרשם ב-booking_slots שהמפתח שלו (כיתה, פרק) — כך שגם אם שני הורים
//  לוחצים יחד, המסד עצמו מאפשר רק לאחד מהם לקבל את השעה.
//  הורה לכמה ילדים: לא ייקבעו לו שני תורים חופפים (בתוספת מרווח family_gap),
//  וההצעה הראשונה היא השעה הקרובה ביותר לתורים של האחים.
// ============================================================
import { conflict, badRequest } from './http.js';
import { stamp } from './time.js';

export const SLOT = 5;

export function parseBreaks(mc) {
    try {
        const b = JSON.parse(mc.breaks || '[]');
        return Array.isArray(b) ? b.filter(x => Array.isArray(x) && x.length === 2 && x[1] > x[0]) : [];
    } catch (e) {
        return [];
    }
}

export async function meetingClassFor(env, meetingId, classId) {
    if (!classId) return null;
    return env.DB.prepare(`SELECT mc.*, c.name class_name, c.teacher_name FROM meeting_classes mc JOIN classes c ON c.id = mc.class_id
        WHERE mc.meeting_id = ? AND mc.class_id = ?`).bind(meetingId, classId).first();
}

export async function bookingOf(env, meetingId, studentId) {
    return env.DB.prepare('SELECT * FROM bookings WHERE meeting_id = ? AND student_id = ?').bind(meetingId, studentId).first();
}

// תורים של אחים (כל הכיתות באסיפה), למניעת חפיפה
export async function familyBusy(env, meetingId, familyIds, excludeStudentId) {
    const ids = familyIds.filter(id => id !== excludeStudentId);
    if (!ids.length) return [];
    const { results } = await env.DB.prepare(`SELECT student_id, start_min, duration FROM bookings
        WHERE meeting_id = ? AND student_id IN (${ids.map(() => '?').join(',')})`).bind(meetingId, ...ids).all();
    return results.map(b => [b.start_min, b.start_min + b.duration]);
}

// כל שעות ההתחלה האפשריות לתור באורך duration, בסדר כרונולוגי
export async function availableStarts(env, { meeting, mc, duration, studentId, busy = [] }) {
    const own = studentId ? await bookingOf(env, meeting.id, studentId) : null;
    const { results } = await env.DB.prepare('SELECT slot_min, booking_id FROM booking_slots WHERE meeting_class_id = ?').bind(mc.id).all();
    const taken = new Set(results.filter(r => !own || r.booking_id !== own.id).map(r => r.slot_min));

    if (duration === 10 && meeting.max_long_per_class) {
        const n = await env.DB.prepare('SELECT COUNT(*) n FROM bookings WHERE meeting_class_id = ? AND duration = 10 AND student_id != ?')
            .bind(mc.id, studentId || 0).first();
        if (n.n >= meeting.max_long_per_class) return [];
    }

    const breaks = parseBreaks(mc);
    const gap = meeting.family_gap || 0;
    const out = [];
    for (let s = mc.start_min; s + duration <= mc.end_min; s += SLOT) {
        let ok = true;
        for (let t = s; t < s + duration; t += SLOT) {
            if (taken.has(t) || breaks.some(([a, b]) => t < b && t + SLOT > a)) { ok = false; break; }
        }
        if (ok && busy.some(([a, b]) => s < b + gap && s + duration > a - gap)) ok = false;
        if (ok) out.push(s);
    }
    return out;
}

// סדר הצעה: אם לאחים יש תורים — הקרוב אליהם קודם; אחרת כרונולוגי
export function preferredOrder(starts, busy, duration) {
    if (!busy.length) return starts;
    const dist = s => Math.min(...busy.map(([a, b]) => s >= b ? s - b : (s + duration <= a ? a - (s + duration) : 0)));
    return [...starts].sort((x, y) => dist(x) - dist(y) || x - y);
}

// קביעה/שינוי תור. זורק conflict אם השעה נתפסה
export async function book(env, { meeting, mc, student, start, duration, source, phone = null, busy = [] }) {
    if (duration !== 5 && duration !== 10) throw badRequest('אורך תור לא תקין');
    if (duration === 10 && !meeting.allow_long) throw badRequest('באסיפה זו אפשר לקבוע רק תורים של 5 דקות');
    const starts = await availableStarts(env, { meeting, mc, duration, studentId: student.id, busy });
    if (!starts.includes(start)) {
        if (busy.length && (await availableStarts(env, { meeting, mc, duration, studentId: student.id })).includes(start)) {
            throw conflict('השעה חופפת לתור של אח באותה אסיפה', 'family_overlap');
        }
        throw conflict('השעה שנבחרה כבר אינה פנויה', 'slot_taken');
    }

    const now = stamp();
    const existing = await bookingOf(env, meeting.id, student.id);
    const sub = '(SELECT id FROM bookings WHERE meeting_id = ? AND student_id = ?)';
    const stmts = [
        env.DB.prepare(`DELETE FROM booking_slots WHERE booking_id IN ${sub}`).bind(meeting.id, student.id),
        env.DB.prepare('DELETE FROM bookings WHERE meeting_id = ? AND student_id = ?').bind(meeting.id, student.id),
        env.DB.prepare(`INSERT INTO bookings (tenant_id, meeting_id, meeting_class_id, student_id, start_min, duration, source, phone, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(meeting.tenant_id, meeting.id, mc.id, student.id, start, duration, source, phone,
            existing ? existing.created_at : now, now)
    ];
    for (let t = start; t < start + duration; t += SLOT) {
        stmts.push(env.DB.prepare(`INSERT INTO booking_slots (meeting_class_id, slot_min, booking_id) VALUES (?, ?, ${sub})`)
            .bind(mc.id, t, meeting.id, student.id));
    }
    stmts.push(env.DB.prepare('DELETE FROM absences WHERE meeting_id = ? AND student_id = ?').bind(meeting.id, student.id));
    try {
        await env.DB.batch(stmts);
    } catch (e) {
        if (/UNIQUE|PRIMARY KEY|constraint/i.test(e.message)) throw conflict('השעה נתפסה הרגע על ידי הורה אחר', 'slot_taken');
        throw e;
    }
    return bookingOf(env, meeting.id, student.id);
}

export async function cancelBooking(env, meetingId, studentId) {
    const b = await bookingOf(env, meetingId, studentId);
    if (!b) return false;
    await env.DB.batch([
        env.DB.prepare('DELETE FROM booking_slots WHERE booking_id = ?').bind(b.id),
        env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(b.id)
    ]);
    return true;
}

// משפחה של תלמיד = כל התלמידים שחולקים איתו טלפון
export async function familyIdsOf(env, tenantId, studentId) {
    const { results } = await env.DB.prepare(`SELECT DISTINCT p2.student_id id FROM student_phones p1
        JOIN student_phones p2 ON p2.phone = p1.phone AND p2.tenant_id = p1.tenant_id
        WHERE p1.tenant_id = ? AND p1.student_id = ?`).bind(tenantId, studentId).all();
    const ids = results.map(r => r.id);
    if (!ids.includes(studentId)) ids.push(studentId);
    return ids;
}

// שיבוץ אוטומטי של מי שלא קבע ולא הודיע שלא יגיע. משפחות גדולות קודם (הכי קשה לשבץ)
export async function autoAssign(env, meeting) {
    const { results: students } = await env.DB.prepare(`SELECT s.id, s.class_id,
            (SELECT COUNT(DISTINCT p2.student_id) FROM student_phones p1 JOIN student_phones p2 ON p2.phone = p1.phone AND p2.tenant_id = p1.tenant_id
             WHERE p1.student_id = s.id) family_size
        FROM students s JOIN meeting_classes mc ON mc.class_id = s.class_id AND mc.meeting_id = ?
        WHERE s.tenant_id = ? AND s.active = 1
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.meeting_id = ? AND b.student_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM absences a WHERE a.meeting_id = ? AND a.student_id = s.id)
        ORDER BY family_size DESC, s.id`).bind(meeting.id, meeting.tenant_id, meeting.id, meeting.id).all();
    const mcs = new Map();
    let assigned = 0;
    const failed = [];
    for (const s of students) {
        if (!mcs.has(s.class_id)) mcs.set(s.class_id, await meetingClassFor(env, meeting.id, s.class_id));
        const mc = mcs.get(s.class_id);
        const fam = await familyIdsOf(env, meeting.tenant_id, s.id);
        const busy = await familyBusy(env, meeting.id, fam, s.id);
        const starts = preferredOrder(await availableStarts(env, { meeting, mc, duration: 5, studentId: s.id, busy }), busy, 5);
        let done = false;
        for (const start of starts.slice(0, 3)) {
            try {
                await book(env, { meeting, mc, student: s, start, duration: 5, source: 'auto', busy });
                done = true;
                break;
            } catch (e) {
                if (e.code !== 'slot_taken' && e.code !== 'family_overlap') throw e;
            }
        }
        if (done) assigned++; else failed.push(s.id);
    }
    return { assigned, failed: failed.length, failed_ids: failed };
}
