// ============================================================
//  phone.js — הגדרות הקו הטלפוני של מוסד, ותורים באתר
//  מי עורך את הגדרות הטלפון: tenants.phone_managed_by
//    'super'  — רק מנהל-על (המוסד לא רואה את המסך)
//    'tenant' — גם המוסד עצמו
//  GET/PUT  /phone-settings
//  GET      /meetings/:id/bookings                   תורים לפי כיתה + חסרים + "לא נוכל להגיע"
//  DELETE   /meetings/:id/bookings/:studentId
//  PUT      /meetings/:id/absences/:studentId        { handled, note }
// ============================================================
import { readJson, str, int, badRequest, notFound, forbidden, conflict } from './http.js';
import { requireTenant } from './auth.js';
import { getLocalTime } from './time.js';
import { tables } from './tenant_schema.js';
import { cancelBooking } from './bookings.js';
import { getConfig } from './settings.js';

export const PHONE_DEFAULTS = {
    enabled: true,
    welcome_text: 'שלום וברוכים הבאים למערכת קביעת התורים לאסיפת ההורים של {מוסד}',
    closed_text: 'כרגע אין אסיפת הורים פתוחה להרשמה',
    locked_text: 'ההרשמה לאסיפה נסגרה',
    locked_note: '',
    unknown_text: 'המספר שלכם אינו רשום במערכת',
    allow_id_login: true,
    allow_save_phone: true,
    allow_absence: true,
    allow_cancel: true
};

const TEXTS = ['welcome_text', 'closed_text', 'locked_text', 'locked_note', 'unknown_text'];
const FLAGS = ['enabled', 'allow_id_login', 'allow_save_phone', 'allow_absence', 'allow_cancel'];

export function phoneSettings(tenant) {
    let s = {};
    try { s = JSON.parse(tenant.phone_settings || '{}'); } catch (e) { /* ignore */ }
    return { ...PHONE_DEFAULTS, ...s };
}

export const normalizeDid = d => {
    let x = String(d || '').replace(/\D/g, '');
    if (x.startsWith('972')) x = '0' + x.slice(3);
    return x;
};

function canEdit(ctx) {
    requireTenant(ctx);
    if (ctx.role !== 'super' && ctx.tenant.phone_managed_by !== 'tenant') throw forbidden('הגדרות הטלפון של המוסד מנוהלות ע"י מנהל המערכת');
}

async function phoneUrl(env, tenantId) {
    const site = (await getConfig(env)).site_url || 'https://smti.uk/asifa/';
    return `${site.replace(/\/$/, '')}/api/yemot/${tenantId}`;
}

export async function getPhoneSettings(env, ctx) {
    canEdit(ctx);
    const { results } = await env.DB.prepare('SELECT did FROM tenant_dids WHERE tenant_id = ? ORDER BY did').bind(ctx.tenant.id).all();
    const url = await phoneUrl(env, ctx.tenant.id);
    return { settings: phoneSettings(ctx.tenant), defaults: PHONE_DEFAULTS, dids: results.map(r => r.did), api_url: url,
        ext_ini: `type=api\napi_link=${url}`, managed_by: ctx.tenant.phone_managed_by, can_change_manager: ctx.role === 'super' };
}

export async function updatePhoneSettings(request, env, ctx) {
    canEdit(ctx);
    const body = await readJson(request);
    const cur = phoneSettings(ctx.tenant);
    const s = { ...cur };
    for (const k of TEXTS) if (body[k] !== undefined) s[k] = str(body[k], 300);
    for (const k of FLAGS) if (body[k] !== undefined) s[k] = !!body[k];
    const stmts = [env.DB.prepare('UPDATE tenants SET phone_settings = ? WHERE id = ?').bind(JSON.stringify(s), ctx.tenant.id)];
    if (ctx.role === 'super' && (body.managed_by === 'tenant' || body.managed_by === 'super')) {
        stmts.push(env.DB.prepare('UPDATE tenants SET phone_managed_by = ? WHERE id = ?').bind(body.managed_by, ctx.tenant.id));
    }
    if (body.dids !== undefined) {
        const dids = [...new Set((Array.isArray(body.dids) ? body.dids : String(body.dids).split(/[\s,;]+/)).map(normalizeDid).filter(d => d.length >= 7))];
        for (const d of dids) {
            const other = await env.DB.prepare('SELECT tenant_id FROM tenant_dids WHERE did = ? AND tenant_id != ?').bind(d, ctx.tenant.id).first();
            if (other) throw conflict(`המספר ${d} כבר משויך למוסד אחר`);
        }
        stmts.push(env.DB.prepare('DELETE FROM tenant_dids WHERE tenant_id = ?').bind(ctx.tenant.id));
        for (const d of dids) stmts.push(env.DB.prepare('INSERT INTO tenant_dids (did, tenant_id) VALUES (?, ?)').bind(d, ctx.tenant.id));
    }
    await env.DB.batch(stmts);
    ctx.tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(ctx.tenant.id).first();
    return getPhoneSettings(env, ctx);
}

// ---------- תורים באתר ----------
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export async function meetingBookings(env, ctx, meetingId) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    if (!await env.DB.prepare(`SELECT id FROM ${t.meetings} WHERE id = ?`).bind(meetingId).first()) throw notFound('האסיפה לא נמצאה');
    const { results } = await env.DB.prepare(`SELECT s.id student_id, s.first_name, s.last_name, s.father_name, c.id class_id, c.name class_name, c.teacher_name,
            b.start_min, b.duration, b.source, b.phone booked_phone, b.updated_at booked_at,
            a.id absence_id, a.handled, a.phone absence_phone, a.created_at absent_at,
            (SELECT group_concat(phone, ',') FROM ${t.phones} p WHERE p.student_id = s.id) phones
        FROM ${t.meetingClasses} mc JOIN ${t.classes} c ON c.id = mc.class_id
        JOIN ${t.students} s ON s.class_id = c.id
        LEFT JOIN ${t.bookings} b ON b.meeting_id = mc.meeting_id AND b.student_id = s.id
        LEFT JOIN ${t.absences} a ON a.meeting_id = mc.meeting_id AND a.student_id = s.id
        WHERE mc.meeting_id = ? ORDER BY c.sort_order, c.name, COALESCE(b.start_min, 99999), s.last_name, s.first_name`).bind(meetingId).all();
    const rows = results.map(r => ({ ...r, phones: r.phones ? r.phones.split(',') : [], handled: !!r.handled,
        status: r.start_min !== null ? 'booked' : r.absence_id ? 'absent' : 'missing',
        time: r.start_min !== null ? hhmm(r.start_min) : null, end_time: r.start_min !== null ? hhmm(r.start_min + r.duration) : null }));
    const totals = { students: rows.length, booked: rows.filter(r => r.status === 'booked').length, absent: rows.filter(r => r.status === 'absent').length };
    totals.missing = totals.students - totals.booked - totals.absent;
    return { rows, totals };
}

export async function deleteBooking(env, ctx, meetingId, studentId) {
    requireTenant(ctx);
    if (!await cancelBooking(env, ctx.tenant.id, meetingId, studentId)) throw notFound('לתלמיד אין תור');
    return { cancelled: true };
}

export async function updateAbsence(request, env, ctx, meetingId, studentId) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const body = await readJson(request);
    const r = await env.DB.prepare(`UPDATE ${t.absences} SET handled = ?, note = COALESCE(?, note) WHERE meeting_id = ? AND student_id = ?`)
        .bind(body.handled ? 1 : 0, body.note !== undefined ? str(body.note, 300) : null, meetingId, studentId).run();
    if (!r.meta.changes) throw notFound('לא נמצאה הודעה');
    return { handled: !!body.handled };
}

export async function callLog(env, ctx) {
    requireTenant(ctx);
    const t = tables(ctx.tenant.id);
    const { results } = await env.DB.prepare(`SELECT l.*, s.first_name, s.last_name FROM ${t.calls} l LEFT JOIN ${t.students} s ON s.id = l.student_id
        ORDER BY l.id DESC LIMIT 300`).all();
    return results;
}

export { int, badRequest, getLocalTime };
