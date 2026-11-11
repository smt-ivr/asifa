// ============================================================
//  client-dashboard.js — לוח בקרה: מצב האסיפה הנוכחית לפי כיתות ובקשות "חזרו אליי"
// ============================================================
App.pages.dashboard = {
    title: 'לוח בקרה',
    async render(el) {
        const meeting = await App.currentMeeting();
        const isAdmin = App.user.role !== 'teacher';
        if (!meeting) {
            el.innerHTML = `<div class="page-head"><div><h1>לוח בקרה</h1></div></div>
                <div class="card">${App.empty('עדיין אין אסיפות', isAdmin ? 'כדי להתחיל: הגדירו כיתות, הוסיפו תלמידים עם טלפוני ההורים, ופתחו אסיפה.' : 'המנהל עדיין לא פתח אסיפה.',
                    isAdmin ? '<div class="actions" style="justify-content:center;margin-top:14px"><a class="btn" href="#/classes">כיתות</a><a class="btn" href="#/students">תלמידים</a><a class="btn btn-primary" href="#/meetings?new=1">אסיפה חדשה</a></div>' : '')}</div>`;
            return;
        }
        const [details, rep] = await Promise.all([App.get(`/meetings/${meeting.id}`), App.get(`/meetings/${meeting.id}/report`)]);
        const t = details.stats.total;
        const pct = n => t.students ? Math.round(n / t.students * 100) : 0;
        const absences = rep.rows.filter(r => r.status === 'absent');

        el.innerHTML = `
            <div class="page-head">
                <div><h1>${App.esc(details.title)}</h1><p>${App.esc(details.date_label)} · ${App.statusBadge(details)}
                    ${details.booking_closes_at ? ` · ההרשמה ${details.status === 'open' ? 'תיסגר' : 'נסגרה'} ב-<span class="num">${App.esc(App.fmtStamp(details.booking_closes_at))}</span>` : ''}</p></div>
                <div class="actions">
                    <a class="btn" href="#/board?meeting=${details.id}">לוח תורים</a>
                    ${isAdmin ? `<a class="btn btn-primary" href="#/meetings?id=${details.id}">ניהול האסיפה</a>` : ''}
                </div>
            </div>
            ${details.status === 'draft' && isAdmin ? `<div class="alert alert-warning">האסיפה עדיין בטיוטה וההורים לא יכולים לקבוע תורים. <a href="#/meetings?id=${details.id}">לפתיחת ההרשמה</a></div>` : ''}
            <div class="grid grid-4 stats">
                <div class="card stat"><div class="stat-label">תלמידים באסיפה</div><div class="stat-value">${t.students}</div></div>
                <div class="card stat good"><div class="stat-label">קבעו תור</div><div class="stat-value">${t.booked}</div><div class="stat-note">${pct(t.booked)}%</div></div>
                <div class="card stat ${t.missing ? 'warn' : ''}"><div class="stat-label">עדיין לא קבעו</div><div class="stat-value">${t.missing}</div><div class="stat-note">${pct(t.missing)}%</div></div>
                <div class="card stat ${t.absent_open ? 'bad' : ''}"><div class="stat-label">ביקשו שהמלמד יחזור</div><div class="stat-value">${t.absent}</div><div class="stat-note">${t.absent_open} ממתינים לטיפול</div></div>
            </div>
            <div class="card">
                <div class="card-head"><h2>לפי כיתות</h2></div>
                <div class="table-wrap"><table class="table">
                    <thead><tr><th>כיתה</th><th>מלמד</th><th>שעות</th><th>קבעו</th><th>לא קבעו</th><th>חזרו אליי</th><th style="width:30%">התקדמות</th><th></th></tr></thead>
                    <tbody>${details.stats.classes.map(c => {
                        const p = c.students ? c.booked / c.students * 100 : 0, a = c.students ? c.absent / c.students * 100 : 0;
                        const mc = details.classes.find(x => x.class_id === c.class_id) || {};
                        return `<tr><td><b>${App.esc(c.class_name)}</b></td><td>${App.esc(c.teacher_name || '')}</td>
                            <td class="num">${App.esc(mc.start || '')}–${App.esc(mc.end || '')}</td>
                            <td class="num">${c.booked}/${c.students}</td><td class="num">${c.missing ? `<span class="badge badge-warning">${c.missing}</span>` : '0'}</td>
                            <td class="num">${c.absent_open ? `<span class="badge badge-danger">${c.absent_open}</span>` : c.absent}</td>
                            <td><div class="progress"><span class="p-booked" style="width:${p}%"></span><span class="p-absent" style="width:${a}%"></span></div></td>
                            <td class="actions-cell"><a class="btn btn-sm" href="#/board?meeting=${details.id}&class=${c.class_id}">לוח</a></td></tr>`;
                    }).join('') || `<tr><td colspan="8">${App.empty('לא הוגדרו כיתות באסיפה')}</td></tr>`}</tbody>
                </table></div>
            </div>
            <div class="card">
                <div class="card-head"><h2>הורים שביקשו שהמלמד יחזור אליהם</h2><span class="muted small">${absences.filter(a => !a.handled).length} ממתינים</span></div>
                ${absences.length ? `<div class="table-wrap"><table class="table">
                    <thead><tr><th>תלמיד</th><th>כיתה</th><th>טלפון</th><th>מתי</th><th>הערה</th><th>טופל</th></tr></thead>
                    <tbody>${absences.map(r => `<tr>
                        <td><b>${App.esc(App.fullName(r))}</b></td><td>${App.esc(r.class_name)}</td>
                        <td>${(r.absence_phone ? [r.absence_phone] : r.phones).map(p => `<a class="ltr" href="tel:${p}">${App.phoneFmt(p)}</a>`).join('<br>')}</td>
                        <td class="small muted num">${App.esc(r.absent_at || '')}</td><td class="small">${App.esc(r.note || '')}</td>
                        <td><label class="check"><input type="checkbox" data-handle="${r.student_id}" ${r.handled ? 'checked' : ''}> טופל</label></td></tr>`).join('')}</tbody>
                </table></div>` : App.empty('אין בקשות', 'הורים שיעדכנו בטלפון שלא יוכלו להגיע יופיעו כאן.')}
            </div>`;

        App.$$('[data-handle]', el).forEach(cb => cb.onchange = async () => {
            try {
                await App.put(`/meetings/${details.id}/absences/${cb.dataset.handle}`, { handled: cb.checked });
                App.ok(cb.checked ? 'סומן כטופל' : 'סומן כממתין');
            } catch (e) { cb.checked = !cb.checked; App.fail(e); }
        });
    }
};
