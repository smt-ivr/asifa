// ============================================================
//  scheduled.js — משימות אוטומטיות (Cron כל 5 דקות)
//   • נעילת הרשמה במועד שנקבע + שיבוץ אוטומטי + צינתוק ל"לא קבעו"
//   • צינתוק תזכורת ביום האסיפה בשעה שנקבעה, למי שקבע תור
//   • סימון אסיפות שעברו כ"הסתיימה"
// ============================================================
import { nowIL, stamp } from './time.js';
import { lockActions } from './meetings.js';
import { phonesFor, sendTzintuk } from './tzintuk.js';

export async function runScheduled(env) {
    const now = nowIL();
    const nowKey = `${now.date} ${now.time}`;

    await env.DB.prepare("UPDATE meetings SET status = 'done' WHERE status IN ('open','locked') AND meeting_date < ?").bind(now.date).run();

    const { results: toLock } = await env.DB.prepare(`SELECT m.* FROM meetings m JOIN tenants t ON t.id = m.tenant_id
        WHERE t.active = 1 AND m.status = 'open' AND m.booking_closes_at IS NOT NULL AND m.booking_closes_at <= ?`).bind(nowKey).all();
    for (const m of toLock) {
        try {
            const r = await env.DB.prepare("UPDATE meetings SET status = 'locked', locked_at = ? WHERE id = ? AND status = 'open'").bind(stamp(), m.id).run();
            if (!r.meta.changes) continue;
            const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(m.tenant_id).first();
            await lockActions(env, tenant, { ...m, status: 'locked' }, { assign: !!m.auto_assign, tzintuk: !!m.auto_missing_tzintuk, by: 'auto' });
        } catch (e) {
            console.error('lock failed', m.id, e && e.stack || e);
        }
    }

    const { results: toRemind } = await env.DB.prepare(`SELECT m.* FROM meetings m JOIN tenants t ON t.id = m.tenant_id
        WHERE t.active = 1 AND t.yemot_token IS NOT NULL AND m.status IN ('open','locked') AND m.meeting_date = ?
          AND m.reminder_time IS NOT NULL AND m.reminder_time <= ? AND m.reminder_sent_at IS NULL`).bind(now.date, now.time).all();
    for (const m of toRemind) {
        try {
            const r = await env.DB.prepare('UPDATE meetings SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL').bind(stamp(), m.id).run();
            if (!r.meta.changes) continue;
            const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(m.tenant_id).first();
            const phones = await phonesFor(env, m, 'booked');
            if (phones.length) await sendTzintuk(env, tenant, phones, { kind: 'reminder', meetingId: m.id, by: 'auto' });
        } catch (e) {
            console.error('reminder failed', m.id, e && e.stack || e);
        }
    }
}
