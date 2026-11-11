// ============================================================
//  client-bookings.js — הפגישות שנקבעו: לפי כיתה ושעה, מי לא קבע, ומי ביקש שהמלמד יחזור
// ============================================================
import { get, put, del, esc, $, $$, ok, fail, phoneFmt, emptyState, confirmDialog, go } from './client-app.js';
import { hebrewDate } from './client-hebdate.js';

const SOURCE = { phone: 'טלפון', web: 'אתר', auto: 'אוטומטי' };
const STATUS = { closed: ['סגורה בטלפון', ''], open: ['פתוחה להרשמה בטלפון', 'badge-success'], locked: ['ההרשמה נסגרה (שמיעה בלבד)', 'badge-warning'] };

export const BookingsView = {
    async render(el, params) {
        const meetings = await get('/meetings');
        if (!meetings.length) { el.innerHTML = `<div class="card">${emptyState('fa-calendar-plus', 'אין אסיפות', '', '<a class="btn btn-primary" href="#meetings?new=1">אסיפה חדשה</a>')}</div>`; return; }
        const m = meetings.find(x => x.id === +params.meeting) || meetings.find(x => x.phone_status !== 'closed') || meetings[0];
        const [data] = await Promise.all([get(`/meetings/${m.id}/bookings`)]);
        const byClass = new Map();
        for (const r of data.rows) {
            if (!byClass.has(r.class_id)) byClass.set(r.class_id, { name: r.class_name, teacher: r.teacher_name, rows: [] });
            byClass.get(r.class_id).rows.push(r);
        }
        const classFilter = params.class ? +params.class : null;
        const absents = data.rows.filter(r => r.status === 'absent');
        const st = STATUS[m.phone_status] || STATUS.closed;
        const phones = r => (r.status === 'absent' && r.absence_phone ? [r.absence_phone] : r.phones).map(p => `<span class="ltr">${phoneFmt(p)}</span>`).join('<br>');

        el.innerHTML = `
            <div class="page-head">
                <div><h2><i class="fas fa-clock"></i> פגישות שנקבעו</h2><p>${esc(m.name)}${m.meeting_date ? ` · ${esc(hebrewDate(m.meeting_date))}` : ''} · <span class="badge ${st[1]}">${st[0]}</span></p></div>
                <div class="toolbar">
                    <select class="input" id="bMeeting" style="width:auto">${meetings.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
                    <select class="input" id="bClass" style="width:auto"><option value="">כל הכיתות</option>${[...byClass].map(([id, c]) => `<option value="${id}" ${classFilter === id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
                    <a class="btn btn-outline" href="#meetings?id=${m.id}"><i class="fas fa-cog"></i> הגדרות האסיפה</a>
                </div>
            </div>
            <div class="stats-row">
                <div class="stat-card"><div class="stat-ico"><i class="fas fa-user-graduate"></i></div><div><div class="stat-label">תלמידים באסיפה</div><div class="stat-value num">${data.totals.students}</div></div></div>
                <div class="stat-card"><div class="stat-ico green"><i class="fas fa-check"></i></div><div><div class="stat-label">קבעו פגישה</div><div class="stat-value num">${data.totals.booked}</div></div></div>
                <div class="stat-card"><div class="stat-ico amber"><i class="fas fa-hourglass-half"></i></div><div><div class="stat-label">עדיין לא קבעו</div><div class="stat-value num">${data.totals.missing}</div></div></div>
                <div class="stat-card"><div class="stat-ico violet"><i class="fas fa-phone-volume"></i></div><div><div class="stat-label">ביקשו שהמלמד יחזור</div><div class="stat-value num">${data.totals.absent}</div></div></div>
            </div>
            ${absents.length ? `<div class="card flush"><div class="card-head" style="padding-bottom:10px"><h3><i class="fas fa-phone-volume"></i> ביקשו שהמלמד יחזור אליהם</h3></div>
                <div class="table-container"><table class="modern-table"><thead><tr><th>תלמיד</th><th>כיתה</th><th>טלפון</th><th>מתי</th><th>טופל</th></tr></thead>
                <tbody>${absents.filter(r => !classFilter || r.class_id === classFilter).map(r => `<tr><td><b>${esc(r.first_name)} ${esc(r.last_name)}</b></td><td>${esc(r.class_name)}</td><td>${phones(r)}</td>
                    <td class="num text-muted">${esc(r.absent_at || '')}</td><td><label class="check"><input type="checkbox" data-handled="${r.student_id}" ${r.handled ? 'checked' : ''}> טופל</label></td></tr>`).join('')}</tbody></table></div></div>` : ''}
            ${[...byClass].filter(([id]) => !classFilter || id === classFilter).map(([id, c]) => {
                const booked = c.rows.filter(r => r.status === 'booked'), missing = c.rows.filter(r => r.status === 'missing');
                return `<div class="card flush">
                    <div class="card-head" style="padding-bottom:10px"><h3><i class="fas fa-chalkboard-teacher"></i> ${esc(c.name)}${c.teacher ? ` <span class="text-muted" style="font-weight:400">· ${esc(c.teacher)}</span>` : ''}</h3>
                        <span class="text-muted">${booked.length} קבעו · ${missing.length} לא קבעו</span></div>
                    ${booked.length ? `<div class="table-container"><table class="modern-table"><thead><tr><th style="width:110px">שעה</th><th>תלמיד</th><th>שם האב</th><th>טלפונים</th><th>נקבע דרך</th><th></th></tr></thead>
                        <tbody>${booked.map(r => `<tr><td class="num"><b>${r.time}</b>–${r.end_time}</td><td><b>${esc(r.first_name)} ${esc(r.last_name)}</b></td><td>${esc(r.father_name || '')}</td>
                            <td>${phones(r)}</td><td><span class="badge">${SOURCE[r.source] || esc(r.source)}</span></td>
                            <td class="td-actions"><button class="icon-btn danger" data-cancel="${r.student_id}" data-name="${esc(r.first_name)}" title="ביטול הפגישה"><i class="fas fa-times"></i></button></td></tr>`).join('')}</tbody></table></div>`
                        : '<p class="text-muted" style="padding:0 16px 12px">עדיין לא נקבעו פגישות בכיתה</p>'}
                    ${missing.length ? `<div style="padding:8px 16px 14px;border-top:1px solid var(--border-color)"><span class="text-muted">לא קבעו:</span> ${missing.map(r => esc(`${r.first_name} ${r.last_name}`)).join(' · ')}</div>` : ''}
                </div>`;
            }).join('') || `<div class="card">${emptyState('fa-chalkboard', 'לא הוגדרו כיתות באסיפה', '', `<a class="btn btn-primary" href="#meetings?id=${m.id}">להגדרת האסיפה</a>`)}</div>`}`;

        $('#bMeeting', el).onchange = e => go('bookings', { meeting: e.target.value });
        $('#bClass', el).onchange = e => go('bookings', e.target.value ? { meeting: m.id, class: e.target.value } : { meeting: m.id });
        $$('[data-handled]', el).forEach(cb => cb.onchange = async () => {
            try { await put(`/meetings/${m.id}/absences/${cb.dataset.handled}`, { handled: cb.checked }); ok('עודכן'); } catch (e) { cb.checked = !cb.checked; fail(e); }
        });
        $$('[data-cancel]', el).forEach(b => b.onclick = async () => {
            if (!await confirmDialog('ביטול פגישה', `לבטל את הפגישה של ${esc(b.dataset.name)}?`, { okLabel: 'ביטול הפגישה', danger: true })) return;
            try { await del(`/meetings/${m.id}/bookings/${b.dataset.cancel}`); ok('הפגישה בוטלה'); BookingsView.render(el, params); } catch (e) { fail(e); }
        });
    }
};
