// ============================================================
//  tzintuk.js — שליחת צינתוקים דרך ה-API של ימות המשיח
//  ברירת מחדל: RunTzintuk עם token, phones (מופרדים בנקודתיים), callerId, TzintukTimeOut.
//  הכתובת, המזוהה וזמן הצלצול ניתנים לשינוי בהגדרות המוסד.
//  יעדים:
//    all      כל ההורים של הכיתות באסיפה
//    missing  הורים שלפחות לילד אחד שלהם אין תור ואין הודעת אי-הגעה
//    booked   הורים שקבעו תור (תזכורת)
//    absent   הורים שהודיעו שלא יגיעו
// ============================================================
import { badRequest } from './http.js';
import { stamp } from './time.js';
import { tenantSettings } from './settings.js';
import { validPhone } from './phones.js';

const CHUNK = 400;

export const TARGETS = { all: 'כל ההורים', missing: 'הורים שלא קבעו תור', booked: 'הורים שקבעו תור', absent: 'הורים שהודיעו שלא יגיעו' };

export async function phonesFor(env, meeting, target) {
    const base = `FROM students s JOIN meeting_classes mc ON mc.class_id = s.class_id AND mc.meeting_id = ?1
        JOIN student_phones p ON p.student_id = s.id WHERE s.tenant_id = ?2 AND s.active = 1`;
    const cond = {
        all: '',
        missing: 'AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.meeting_id = ?1 AND b.student_id = s.id) AND NOT EXISTS (SELECT 1 FROM absences a WHERE a.meeting_id = ?1 AND a.student_id = s.id)',
        booked: 'AND EXISTS (SELECT 1 FROM bookings b WHERE b.meeting_id = ?1 AND b.student_id = s.id)',
        absent: 'AND EXISTS (SELECT 1 FROM absences a WHERE a.meeting_id = ?1 AND a.student_id = s.id)'
    }[target];
    if (cond === undefined) throw badRequest('יעד צינתוק לא מוכר');
    const { results } = await env.DB.prepare(`SELECT DISTINCT p.phone ${base} ${cond}`).bind(meeting.id, meeting.tenant_id).all();
    return results.map(r => r.phone).filter(validPhone);
}

async function post(url, params) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* ignore */ }
    const ok = res.ok && (!data || data.responseStatus === undefined || data.responseStatus === 'OK');
    return { ok, text: text.slice(0, 500) };
}

// מחזיר { sent, ok, chunks }
export async function sendTzintuk(env, tenant, phones, { kind, meetingId = null, by = 'auto' }) {
    if (!tenant.yemot_token) throw badRequest('לא הוגדר טוקן ימות המשיח בהגדרות המוסד', 'no_token');
    const s = tenantSettings(tenant);
    const callerId = s.tzintuk_caller_id || tenant.line_number || '';
    const list = [...new Set(phones)];
    let allOk = true;
    const responses = [];
    for (let i = 0; i < list.length; i += CHUNK) {
        const part = list.slice(i, i + CHUNK);
        let r;
        try {
            r = await post(s.tzintuk_url, { token: tenant.yemot_token, phones: part.join(':'), callerId, TzintukTimeOut: String(s.tzintuk_timeout) });
        } catch (e) {
            r = { ok: false, text: String(e.message || e) };
        }
        allOk = allOk && r.ok;
        responses.push(r.text);
    }
    await env.DB.prepare('INSERT INTO tzintuk_log (tenant_id, meeting_id, kind, phones_count, ok, response, triggered_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(tenant.id, meetingId, kind, list.length, allOk ? 1 : 0, responses.join('\n').slice(0, 2000), by, stamp()).run();
    return { sent: list.length, ok: allOk, chunks: responses.length };
}

export async function tzintukLog(env, ctx, meetingId) {
    const { results } = await env.DB.prepare(`SELECT id, meeting_id, kind, phones_count, ok, response, triggered_by, created_at FROM tzintuk_log
        WHERE tenant_id = ? ${meetingId ? 'AND meeting_id = ?' : ''} ORDER BY id DESC LIMIT 100`)
        .bind(...(meetingId ? [ctx.tenantId, meetingId] : [ctx.tenantId])).all();
    return results;
}
