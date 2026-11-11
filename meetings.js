// ============================================================
//  meetings.js — אסיפות: הקמה, שעות לכל כיתה, פתיחה/נעילה, לוח תורים,
//  דוח מלא (להדפסות ולוח בקרה), קביעת תורים מהממשק והודעות אי-הגעה
// ============================================================
import { readJson, str, int, bool, badRequest, notFound, conflict, forbidden } from './http.js';
import { requireAdmin, requireTenant, classScope } from './auth.js';
import { stamp, nowIL, hhmmToMin, minToHHMM, validDate, displayDate } from './time.js';
import { meetingClassFor, availableStarts, preferredOrder, book, cancelBooking, familyIdsOf, familyBusy, autoAssign, parseBreaks } from './bookings.js';
import { phonesFor, sendTzintuk, TARGETS } from './tzintuk.js';

const STATUS = { draft: 'טיוטה', open: 'פתוחה להרשמה', locked: 'ההרשמה נעולה', done: 'הסתיימה' };

function shape(m) {
    return {
        ...m, allow_long: !!m.allow_long, auto_missing_tzintuk: !!m.auto_missing_tzintuk, auto_assign: !!m.auto_assign,
        status_label: STATUS[m.status], date_label: displayDate(m.meeting_date)
    };
}

export async function getMeeting(env, ctx, id) {
    const m = await env.DB.prepare('SELECT * FROM meetings WHERE id = ? AND tenant_id = ?').bind(id, ctx.tenantId).first();
    if (!m) throw notFound('האסיפה לא נמצאה');
    return m;
}

async function classTimes(env, meetingId) {
    const { results } = await env.DB.prepare(`SELECT mc.*, c.name class_name, c.teacher_name FROM meeting_classes mc JOIN classes c ON c.id = mc.class_id
        WHERE mc.meeting_id = ? ORDER BY c.sort_order, c.name`).bind(meetingId).all();
    return results.map(r => ({ ...r, start: minToHHMM(r.start_min), end: minToHHMM(r.end_min),
        breaks: parseBreaks(r).map(([a, b]) => ({ from: minToHHMM(a), to: minToHHMM(b) })) }));
}

async function stats(env, meetingId, tenantId, scope) {
    const { results } = await env.DB.prepare(`SELECT c.id class_id, c.name class_name, c.teacher_name,
            COUNT(s.id) students,
            SUM(CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END) booked,
            SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END) absent,
            SUM(CASE WHEN a.id IS NOT NULL AND a.handled = 0 THEN 1 ELSE 0 END) absent_open,
            SUM(CASE WHEN b.id IS NULL AND a.id IS NULL THEN 1 ELSE 0 END) missing,
            SUM(CASE WHEN b.duration = 10 THEN 1 ELSE 0 END) long_count,
            mc.start_min, mc.end_min
        FROM meeting_classes mc JOIN classes c ON c.id = mc.class_id
        LEFT JOIN students s ON s.class_id = c.id AND s.active = 1 AND s.tenant_id = ?2
        LEFT JOIN bookings b ON b.meeting_id = mc.meeting_id AND b.student_id = s.id
        LEFT JOIN absences a ON a.meeting_id = mc.meeting_id AND a.student_id = s.id
        WHERE mc.meeting_id = ?1 ${scope ? 'AND c.id = ?3' : ''}
        GROUP BY c.id ORDER BY c.sort_order, c.name`).bind(...(scope ? [meetingId, tenantId, scope] : [meetingId, tenantId])).all();
    const total = results.reduce((t, r) => ({
        students: t.students + r.students, booked: t.booked + r.booked, absent: t.absent + r.absent,
        absent_open: t.absent_open + r.absent_open, missing: t.missing + r.missing
    }), { students: 0, booked: 0, absent: 0, absent_open: 0, missing: 0 });
    return { classes: results, total };
}

export async function listMeetings(env, ctx) {
    requireTenant(ctx);
    const { results } = await env.DB.prepare('SELECT * FROM meetings WHERE tenant_id = ? ORDER BY meeting_date DESC, id DESC').bind(ctx.tenantId).all();
    const scope = classScope(ctx);
    return Promise.all(results.map(async m => ({ ...shape(m), stats: (await stats(env, m.id, ctx.tenantId, scope)).total })));
}

export async function meetingDetails(env, ctx, id) {
    requireTenant(ctx);
    const m = await getMeeting(env, ctx, id);
    const scope = classScope(ctx);
    let classes = await classTimes(env, id);
    if (scope) classes = classes.filter(c => c.class_id === scope);
    return { ...shape(m), classes, stats: await stats(env, id, ctx.tenantId, scope) };
}

function meetingFields(body, cur = {}) {
    const title = body.title !== undefined ? str(body.title, 100) : cur.title;
    if (!title) throw badRequest('חסרה כותרת לאסיפה');
    const date = body.meeting_date !== undefined ? str(body.meeting_date, 10) : cur.meeting_date;
    if (!validDate(date)) throw badRequest('תאריך האסיפה לא תקין');
    let closes = body.booking_closes_at !== undefined ? str(body.booking_closes_at, 16).replace('T', ' ') : cur.booking_closes_at;
    if (closes && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(closes)) throw badRequest('מועד נעילת ההרשמה לא תקין');
    let reminder = body.reminder_time !== undefined ? str(body.reminder_time, 5) : cur.reminder_time;
    if (reminder && hhmmToMin(reminder) === null) throw badRequest('שעת התזכורת לא תקינה');
    const maxLong = body.max_long_per_class !== undefined ? int(body.max_long_per_class) : cur.max_long_per_class;
    return {
        title, meeting_date: date, booking_closes_at: closes || null, reminder_time: reminder || null,
        allow_long: body.allow_long !== undefined ? bool(body.allow_long) : (cur.allow_long ?? 1),
        max_long_per_class: maxLong && maxLong > 0 ? maxLong : null,
        family_gap: body.family_gap !== undefined ? Math.min(30, Math.max(0, int(body.family_gap) || 0)) : (cur.family_gap ?? 0),
        auto_missing_tzintuk: body.auto_missing_tzintuk !== undefined ? bool(body.auto_missing_tzintuk) : (cur.auto_missing_tzintuk ?? 1),
        auto_assign: body.auto_assign !== undefined ? bool(body.auto_assign) : (cur.auto_assign ?? 0),
        notes: body.notes !== undefined ? str(body.notes, 500) : (cur.notes ?? null)
    };
}

export async function createMeeting(request, env, ctx) {
    requireAdmin(ctx);
    const body = await readJson(request);
    const f = meetingFields(body);
    const r = await env.DB.prepare(`INSERT INTO meetings (tenant_id, title, meeting_date, status, booking_closes_at, allow_long, max_long_per_class,
            family_gap, auto_missing_tzintuk, auto_assign, reminder_time, notes, created_at)
        VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(ctx.tenantId, f.title, f.meeting_date, f.booking_closes_at, f.allow_long,
        f.max_long_per_class, f.family_gap, f.auto_missing_tzintuk, f.auto_assign, f.reminder_time, f.notes, stamp()).run();
    const id = r.meta.last_row_id;
    if (Array.isArray(body.classes)) await saveClassTimes(env, ctx, id, body.classes);
    return meetingDetails(env, ctx, id);
}

export async function updateMeeting(request, env, ctx, id) {
    requireAdmin(ctx);
    const m = await getMeeting(env, ctx, id);
    const body = await readJson(request);
    const f = meetingFields(body, m);
    await env.DB.prepare(`UPDATE meetings SET title = ?, meeting_date = ?, booking_closes_at = ?, allow_long = ?, max_long_per_class = ?,
        family_gap = ?, auto_missing_tzintuk = ?, auto_assign = ?, reminder_time = ?, notes = ? WHERE id = ?`)
        .bind(f.title, f.meeting_date, f.booking_closes_at, f.allow_long, f.max_long_per_class, f.family_gap,
            f.auto_missing_tzintuk, f.auto_assign, f.reminder_time, f.notes, id).run();
    if (Array.isArray(body.classes)) await saveClassTimes(env, ctx, id, body.classes);
    return meetingDetails(env, ctx, id);
}

export async function deleteMeeting(env, ctx, id) {
    requireAdmin(ctx);
    await getMeeting(env, ctx, id);
    await env.DB.batch([
        env.DB.prepare('DELETE FROM booking_slots WHERE meeting_class_id IN (SELECT id FROM meeting_classes WHERE meeting_id = ?)').bind(id),
        env.DB.prepare('DELETE FROM bookings WHERE meeting_id = ?').bind(id),
        env.DB.prepare('DELETE FROM absences WHERE meeting_id = ?').bind(id),
        env.DB.prepare('DELETE FROM meeting_classes WHERE meeting_id = ?').bind(id),
        env.DB.prepare('DELETE FROM meetings WHERE id = ?').bind(id)
    ]);
    return { deleted: true };
}

// classes: [{ class_id, start:'HH:MM', end:'HH:MM', breaks:[{from,to}], location }]
// כיתה שהוסרה — נמחקת רק אם אין בה תורים
async function saveClassTimes(env, ctx, meetingId, list) {
    const { results: existing } = await env.DB.prepare('SELECT * FROM meeting_classes WHERE meeting_id = ?').bind(meetingId).all();
    const byClass = new Map(existing.map(r => [r.class_id, r]));
    const keep = new Set();
    const stmts = [];
    for (const item of list) {
        const classId = int(item.class_id);
        const c = classId && await env.DB.prepare('SELECT id, name, location FROM classes WHERE id = ? AND tenant_id = ?').bind(classId, ctx.tenantId).first();
        if (!c) throw badRequest('כיתה לא נמצאה');
        const start = hhmmToMin(item.start), end = hhmmToMin(item.end);
        if (start === null || end === null || end <= start) throw badRequest(`שעות לא תקינות לכיתה ${c.name}`);
        if (start % 5 || end % 5) throw badRequest(`שעות האסיפה של ${c.name} חייבות להיות בקפיצות של 5 דקות`);
        const breaks = (Array.isArray(item.breaks) ? item.breaks : []).map(b => [hhmmToMin(b.from), hhmmToMin(b.to)])
            .filter(([a, b]) => a !== null && b !== null && b > a);
        const location = item.location !== undefined ? str(item.location, 80) : c.location;
        keep.add(classId);
        const cur = byClass.get(classId);
        if (cur) {
            const outside = await env.DB.prepare('SELECT COUNT(*) n FROM bookings WHERE meeting_class_id = ? AND (start_min < ? OR start_min + duration > ?)')
                .bind(cur.id, start, end).first();
            if (outside.n) throw conflict(`בכיתה ${c.name} יש ${outside.n} תורים מחוץ לשעות החדשות. בטלו או הזיזו אותם קודם`, 'bookings_outside');
            stmts.push(env.DB.prepare('UPDATE meeting_classes SET start_min = ?, end_min = ?, breaks = ?, location = ? WHERE id = ?')
                .bind(start, end, JSON.stringify(breaks), location || null, cur.id));
        } else {
            stmts.push(env.DB.prepare('INSERT INTO meeting_classes (tenant_id, meeting_id, class_id, start_min, end_min, breaks, location) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .bind(ctx.tenantId, meetingId, classId, start, end, JSON.stringify(breaks), location || null));
        }
    }
    for (const r of existing) {
        if (keep.has(r.class_id)) continue;
        const n = await env.DB.prepare('SELECT COUNT(*) n FROM bookings WHERE meeting_class_id = ?').bind(r.id).first();
        if (n.n) throw conflict('אי אפשר להסיר כיתה שכבר נקבעו בה תורים', 'class_has_bookings');
        stmts.push(env.DB.prepare('DELETE FROM meeting_classes WHERE id = ?').bind(r.id));
    }
    if (stmts.length) await env.DB.batch(stmts);
}

// ---------- מצב האסיפה ----------
export async function setStatus(request, env, ctx, id) {
    requireAdmin(ctx);
    const m = await getMeeting(env, ctx, id);
    const body = await readJson(request);
    const status = body.status;
    if (!STATUS[status]) throw badRequest('מצב לא מוכר');
    const now = stamp();
    const result = { status };

    if (status === 'open') {
        const n = await env.DB.prepare('SELECT COUNT(*) n FROM meeting_classes WHERE meeting_id = ?').bind(id).first();
        if (!n.n) throw badRequest('יש להגדיר שעות לפחות לכיתה אחת לפני פתיחת ההרשמה');
        const other = await env.DB.prepare("SELECT id, title FROM meetings WHERE tenant_id = ? AND id != ? AND status IN ('open','locked')").bind(ctx.tenantId, id).first();
        if (other) throw conflict(`האסיפה "${other.title}" עדיין פעילה. סמנו אותה כ"הסתיימה" קודם`, 'other_active');
        await env.DB.prepare('UPDATE meetings SET status = ?, opened_at = COALESCE(opened_at, ?), locked_at = NULL WHERE id = ?').bind(status, now, id).run();
        if (body.tzintuk) result.tzintuk = await sendTzintuk(env, ctx.tenant, await phonesFor(env, m, 'all'), { kind: 'open', meetingId: id, by: ctx.user.username });
    } else if (status === 'locked') {
        await env.DB.prepare('UPDATE meetings SET status = ?, locked_at = ? WHERE id = ?').bind(status, now, id).run();
        const fresh = await getMeeting(env, ctx, id);
        result.actions = await lockActions(env, ctx.tenant, fresh, { assign: body.auto_assign ?? !!fresh.auto_assign, tzintuk: body.tzintuk ?? !!fresh.auto_missing_tzintuk, by: ctx.user.username });
    } else {
        await env.DB.prepare('UPDATE meetings SET status = ? WHERE id = ?').bind(status, id).run();
    }
    return { ...result, meeting: await meetingDetails(env, ctx, id) };
}

// בעת נעילה: שיבוץ אוטומטי (אם הוגדר) ואז צינתוק מיוחד למי שעדיין לא קבע
export async function lockActions(env, tenant, meeting, { assign, tzintuk, by }) {
    const out = {};
    if (assign) out.auto_assign = await autoAssign(env, meeting);
    if (tzintuk && tenant.yemot_token) {
        const phones = await phonesFor(env, meeting, 'missing');
        if (phones.length) out.tzintuk = await sendTzintuk(env, tenant, phones, { kind: 'missing', meetingId: meeting.id, by });
    }
    return out;
}

export async function runAutoAssign(env, ctx, id) {
    requireAdmin(ctx);
    return autoAssign(env, await getMeeting(env, ctx, id));
}

export async function sendMeetingTzintuk(request, env, ctx, id) {
    requireAdmin(ctx);
    const m = await getMeeting(env, ctx, id);
    const body = await readJson(request);
    if (!TARGETS[body.target]) throw badRequest('יעד צינתוק לא מוכר');
    const phones = await phonesFor(env, m, body.target);
    if (!phones.length) return { sent: 0, ok: true, message: 'אין מספרים לשליחה' };
    if (body.dry_run) return { sent: 0, would_send: phones.length };
    return sendTzintuk(env, ctx.tenant, phones, { kind: `manual_${body.target}`, meetingId: id, by: ctx.user.username });
}

// ---------- לוח תורים לכיתה ----------
export async function board(env, ctx, id, url) {
    requireTenant(ctx);
    const m = await getMeeting(env, ctx, id);
    const scope = classScope(ctx);
    const classId = scope || int(url.searchParams.get('class_id'));
    const mc = await meetingClassFor(env, id, classId);
    if (!mc) throw notFound('לכיתה זו לא הוגדרו שעות באסיפה');
    const { results: bookings } = await env.DB.prepare(`SELECT b.*, s.first_name, s.last_name, s.father_name, s.code,
            (SELECT group_concat(phone, ',') FROM student_phones p WHERE p.student_id = s.id) phones
        FROM bookings b JOIN students s ON s.id = b.student_id WHERE b.meeting_class_id = ? ORDER BY b.start_min`).bind(mc.id).all();
    const breaks = parseBreaks(mc);
    const slots = [];
    for (let t = mc.start_min; t < mc.end_min; t += 5) {
        const b = bookings.find(x => t >= x.start_min && t < x.start_min + x.duration);
        const inBreak = breaks.some(([a, z]) => t < z && t + 5 > a);
        slots.push({ min: t, time: minToHHMM(t), state: b ? 'booked' : inBreak ? 'break' : 'free', booking_id: b ? b.id : null, first: b ? b.start_min === t : false });
    }
    return {
        meeting: shape(m), class: { id: mc.class_id, name: mc.class_name, teacher_name: mc.teacher_name, location: mc.location, start: minToHHMM(mc.start_min), end: minToHHMM(mc.end_min) },
        slots, bookings: bookings.map(b => ({ ...b, time: minToHHMM(b.start_min), end_time: minToHHMM(b.start_min + b.duration), phones: b.phones ? b.phones.split(',') : [] }))
    };
}

// ---------- דוח מלא: כל תלמיד, תור / אי-הגעה / חסר ----------
export async function report(env, ctx, id) {
    requireTenant(ctx);
    const m = await getMeeting(env, ctx, id);
    const scope = classScope(ctx);
    const { results } = await env.DB.prepare(`SELECT s.id student_id, s.code, s.first_name, s.last_name, s.father_name,
            c.id class_id, c.name class_name, c.teacher_name, c.sort_order, COALESCE(mc.location, c.location) location,
            b.start_min, b.duration, b.source, b.updated_at booked_at,
            a.id absence_id, a.handled, a.note, a.created_at absent_at, a.phone absence_phone,
            (SELECT group_concat(phone, ',') FROM student_phones p WHERE p.student_id = s.id) phones
        FROM meeting_classes mc JOIN classes c ON c.id = mc.class_id
        JOIN students s ON s.class_id = c.id AND s.active = 1 AND s.tenant_id = ?2
        LEFT JOIN bookings b ON b.meeting_id = mc.meeting_id AND b.student_id = s.id
        LEFT JOIN absences a ON a.meeting_id = mc.meeting_id AND a.student_id = s.id
        WHERE mc.meeting_id = ?1 ${scope ? 'AND c.id = ?3' : ''}
        ORDER BY c.sort_order, c.name, COALESCE(b.start_min, 9999), s.last_name, s.first_name`)
        .bind(...(scope ? [id, ctx.tenantId, scope] : [id, ctx.tenantId])).all();
    return {
        meeting: shape(m),
        tenant: { name: ctx.tenant.name, line_number: ctx.tenant.line_number },
        rows: results.map(r => ({
            ...r, phones: r.phones ? r.phones.split(',') : [],
            status: r.start_min !== null ? 'booked' : r.absence_id ? 'absent' : 'missing',
            time: r.start_min !== null ? minToHHMM(r.start_min) : null,
            end_time: r.start_min !== null ? minToHHMM(r.start_min + r.duration) : null,
            handled: !!r.handled
        }))
    };
}

// ---------- קביעת תור מהממשק (מזכירות) ----------
async function studentInMeeting(env, ctx, m, studentId) {
    const s = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND tenant_id = ?').bind(studentId, ctx.tenantId).first();
    if (!s) throw notFound('התלמיד לא נמצא');
    const mc = await meetingClassFor(env, m.id, s.class_id);
    if (!mc) throw badRequest('לכיתה של התלמיד לא הוגדרו שעות באסיפה');
    return { s, mc };
}

export async function available(env, ctx, id, url) {
    requireAdmin(ctx);
    const m = await getMeeting(env, ctx, id);
    const { s, mc } = await studentInMeeting(env, ctx, m, int(url.searchParams.get('student_id')));
    const duration = int(url.searchParams.get('duration')) === 10 ? 10 : 5;
    const busy = await familyBusy(env, m.id, await familyIdsOf(env, ctx.tenantId, s.id), s.id);
    const starts = await availableStarts(env, { meeting: m, mc, duration, studentId: s.id, busy });
    return { starts: starts.map(minToHHMM), suggested: preferredOrder(starts, busy, duration).slice(0, 3).map(minToHHMM) };
}

export async function webBook(request, env, ctx, id) {
    requireAdmin(ctx);
    const m = await getMeeting(env, ctx, id);
    if (m.status === 'done') throw badRequest('האסיפה הסתיימה');
    const body = await readJson(request);
    const { s, mc } = await studentInMeeting(env, ctx, m, int(body.student_id));
    const start = typeof body.start === 'number' ? body.start : hhmmToMin(body.start);
    if (start === null) throw badRequest('שעה לא תקינה');
    const duration = int(body.duration) === 10 ? 10 : 5;
    const busy = body.force ? [] : await familyBusy(env, m.id, await familyIdsOf(env, ctx.tenantId, s.id), s.id);
    const b = await book(env, { meeting: m, mc, student: s, start, duration, source: 'web', busy });
    return { ...b, time: minToHHMM(b.start_min) };
}

export async function webCancel(env, ctx, id, studentId) {
    requireAdmin(ctx);
    const m = await getMeeting(env, ctx, id);
    if (!await cancelBooking(env, m.id, studentId)) throw notFound('לתלמיד אין תור');
    return { cancelled: true };
}

// ---------- אי-הגעה ----------
export async function webAbsence(request, env, ctx, id) {
    requireAdmin(ctx);
    const m = await getMeeting(env, ctx, id);
    const body = await readJson(request);
    const { s } = await studentInMeeting(env, ctx, m, int(body.student_id));
    await markAbsent(env, m, s.id, { phone: null, source: 'web', note: str(body.note, 300) || null });
    return { absent: true };
}

export async function markAbsent(env, m, studentId, { phone, source, note = null }) {
    await cancelBooking(env, m.id, studentId);
    await env.DB.prepare(`INSERT INTO absences (tenant_id, meeting_id, student_id, phone, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (meeting_id, student_id) DO UPDATE SET phone = excluded.phone, source = excluded.source, handled = 0, handled_at = NULL, created_at = excluded.created_at`)
        .bind(m.tenant_id, m.id, studentId, phone, source, note, stamp()).run();
}

export async function updateAbsence(request, env, ctx, id, studentId) {
    requireTenant(ctx);
    await getMeeting(env, ctx, id);
    const a = await env.DB.prepare(`SELECT a.*, s.class_id FROM absences a JOIN students s ON s.id = a.student_id
        WHERE a.meeting_id = ? AND a.student_id = ? AND a.tenant_id = ?`).bind(id, studentId, ctx.tenantId).first();
    if (!a) throw notFound('לא נמצאה הודעת אי-הגעה');
    const scope = classScope(ctx);
    if (scope && a.class_id !== scope) throw forbidden();
    const body = await readJson(request);
    const handled = body.handled !== undefined ? bool(body.handled) : a.handled;
    await env.DB.prepare('UPDATE absences SET handled = ?, handled_at = ?, note = ? WHERE id = ?')
        .bind(handled, handled ? (a.handled_at || stamp()) : null, body.note !== undefined ? (str(body.note, 300) || null) : a.note, a.id).run();
    return { handled: !!handled };
}

export async function deleteAbsence(env, ctx, id, studentId) {
    requireAdmin(ctx);
    await getMeeting(env, ctx, id);
    await env.DB.prepare('DELETE FROM absences WHERE meeting_id = ? AND student_id = ? AND tenant_id = ?').bind(id, studentId, ctx.tenantId).run();
    return { deleted: true };
}

export async function callLog(env, ctx) {
    requireAdmin(ctx);
    const { results } = await env.DB.prepare(`SELECT l.*, s.first_name, s.last_name FROM call_log l LEFT JOIN students s ON s.id = l.student_id
        WHERE l.tenant_id = ? ORDER BY l.id DESC LIMIT 300`).bind(ctx.tenantId).all();
    return results;
}

// האסיפה הפעילה של מוסד (לקו הטלפוני): פתוחה או נעולה, שעוד לא עברה
export async function activeMeeting(env, tenantId) {
    return env.DB.prepare(`SELECT * FROM meetings WHERE tenant_id = ? AND status IN ('open','locked') AND meeting_date >= ?
        ORDER BY meeting_date LIMIT 1`).bind(tenantId, nowIL().date).first();
}
