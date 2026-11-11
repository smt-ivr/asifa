// ============================================================
//  client-dashboard.js — לוח בקרה של מוסד
// ============================================================
import { get, esc, emptyState } from './client-app.js';
import { hebrewDate } from './client-hebdate.js';

export const DashboardView = {
    async render(el) {
        const d = await get('/dashboard');
        const t = d.totals;

        if (!t.students) {
            el.innerHTML = `<div class="card">${emptyState('fa-user-graduate', 'מתחילים: מכניסים את התלמידים',
                'לפני הכול יש להכניס את רשימת התלמידים — אפשר בייבוא מקובץ אקסל. הכיתות נוצרות אוטומטית מתוך הרשימה.',
                '<a class="btn btn-primary" href="#students?import=1"><i class="fas fa-file-excel"></i> ייבוא מאקסל</a><a class="btn btn-outline" href="#students?new=1"><i class="fas fa-plus"></i> הוספת תלמיד</a>')}</div>`;
            return;
        }

        const tasks = [
            t.no_class ? `<a href="#students">${t.no_class} תלמידים ללא כיתה</a>` : '',
            t.no_phone ? `<a href="#students?filter=no_phone">${t.no_phone} תלמידים ללא טלפון</a>` : '',
            t.no_teacher ? `<a href="#classes">${t.no_teacher} כיתות ללא שם מלמד</a>` : ''
        ].filter(Boolean);

        el.innerHTML = `
            <div class="stats-row">
                <div class="stat-card"><div class="stat-ico"><i class="fas fa-user-graduate"></i></div><div><div class="stat-label">תלמידים</div><div class="stat-value num">${t.students}</div></div></div>
                <div class="stat-card"><div class="stat-ico violet"><i class="fas fa-chalkboard-teacher"></i></div><div><div class="stat-label">כיתות</div><div class="stat-value num">${t.classes}</div></div></div>
                <div class="stat-card"><div class="stat-ico green"><i class="fas fa-calendar-alt"></i></div><div><div class="stat-label">אסיפות</div><div class="stat-value num">${t.meetings}</div></div></div>
                <div class="stat-card"><div class="stat-ico amber"><i class="fas fa-phone-slash"></i></div><div><div class="stat-label">ללא טלפון</div><div class="stat-value num">${t.no_phone}</div></div></div>
            </div>
            ${tasks.length ? `<div class="notice warning"><i class="fas fa-exclamation-triangle"></i><span>להשלמה: ${tasks.join(' · ')}</span></div>` : ''}
            <div class="grid-2">
                <div class="card flush">
                    <div class="card-head"><h3><i class="fas fa-chalkboard-teacher"></i> כיתות</h3><a class="btn btn-sm btn-outline" href="#classes">ניהול</a></div>
                    <div class="table-container"><table class="modern-table">
                        <thead><tr><th>כיתה</th><th>מלמד</th><th>תלמידים</th></tr></thead>
                        <tbody>${d.classes.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${c.teacher_name ? esc(c.teacher_name) : '<span class="badge badge-warning">חסר</span>'}</td>
                            <td><a href="#students?class=${c.id}">${c.students}</a></td></tr>`).join('')}</tbody>
                    </table></div>
                </div>
                <div class="card">
                    <div class="card-head"><h3><i class="fas fa-calendar-alt"></i> אסיפה אחרונה</h3><a class="btn btn-sm btn-outline" href="#meetings">כל האסיפות</a></div>
                    ${d.latest_meeting ? `<div style="font-size:1.05rem;font-weight:600;color:var(--text-strong)">${esc(d.latest_meeting.name)}</div>
                        <div class="text-muted" style="margin:4px 0 12px">${d.latest_meeting.meeting_date ? esc(hebrewDate(d.latest_meeting.meeting_date)) : 'לא נקבע תאריך'}</div>
                        <a class="btn btn-primary" href="#meetings?id=${d.latest_meeting.id}"><i class="fas fa-cog"></i> הגדרות האסיפה</a>`
                        : emptyState('fa-calendar-plus', 'עדיין אין אסיפות', '', '<a class="btn btn-primary" href="#meetings?new=1"><i class="fas fa-plus"></i> אסיפה חדשה</a>')}
                </div>
            </div>`;
    }
};
