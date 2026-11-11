// ============================================================
//  client-board.js — לוח תורים לכיתה: צפייה, קביעה/הזזה/ביטול ע"י המזכירות
// ============================================================
(function () {
    const esc = App.esc;
    const SOURCE = { phone: 'טלפון', web: 'מזכירות', auto: 'שיבוץ אוטומטי' };

    async function bookModal(meetingId, classStudents, { studentId = null, time = null, onDone }) {
        const options = classStudents.map(s => `<option value="${s.student_id}" ${s.student_id === studentId ? 'selected' : ''}>${esc(App.fullName(s))}${s.status === 'booked' ? ` (כרגע ${s.time})` : s.status === 'absent' ? ' (הודיע שלא יגיע)' : ''}</option>`).join('');
        App.modal({
            title: studentId ? 'שינוי תור' : 'קביעת תור',
            body: `<form class="form-grid">
                <label class="field full"><span>תלמיד</span><select class="input" name="student_id">${options}</select></label>
                <label class="field"><span>אורך התור</span><select class="input" name="duration"><option value="5">5 דקות</option><option value="10">10 דקות</option></select></label>
                <label class="field"><span>שעה</span><select class="input ltr-input" name="start"></select></label>
                <div class="full small muted" id="suggest"></div>
                <label class="check full"><input type="checkbox" name="force"><span>להתעלם מחפיפה עם תורים של אחים</span></label>
            </form>`,
            buttons: [{
                label: 'שמירה', cls: 'btn-primary', action: async modal => {
                    const d = App.formData(modal.querySelector('form'));
                    if (!d.start) throw new Error('אין שעה פנויה');
                    await App.post(`/meetings/${meetingId}/bookings`, { student_id: +d.student_id, start: d.start, duration: +d.duration, force: d.force });
                    App.ok('התור נשמר');
                    onDone();
                }
            }, { label: 'ביטול' }],
            onOpen: modal => {
                const form = modal.querySelector('form');
                const load = async () => {
                    const sel = form.start;
                    sel.innerHTML = '<option>טוען…</option>';
                    try {
                        const r = await App.get(`/meetings/${meetingId}/available?student_id=${form.student_id.value}&duration=${form.duration.value}`);
                        sel.innerHTML = r.starts.length ? r.starts.map(s => `<option ${s === time ? 'selected' : ''}>${s}</option>`).join('') : '<option value="">אין שעות פנויות</option>';
                        if (time && !r.starts.includes(time) && r.suggested[0]) sel.value = r.suggested[0];
                        if (!time && r.suggested[0]) sel.value = r.suggested[0];
                        modal.querySelector('#suggest').textContent = r.suggested.length ? `מומלץ (ליד תורי האחים / הקרוב): ${r.suggested.join(', ')}` : '';
                    } catch (e) { sel.innerHTML = '<option value="">שגיאה</option>'; App.fail(e); }
                };
                form.student_id.onchange = load;
                form.duration.onchange = load;
                load();
            }
        });
    }

    async function render(el, params) {
        const meetings = await App.meetings();
        if (!meetings.length) {
            el.innerHTML = `<div class="page-head"><h1>לוח תורים</h1></div><div class="card">${App.empty('אין אסיפות', '', App.user.role !== 'teacher' ? '<a class="btn btn-primary" href="#/meetings?new=1">אסיפה חדשה</a>' : '')}</div>`;
            return;
        }
        const meetingId = +params.meeting || (await App.currentMeeting()).id;
        const details = await App.get(`/meetings/${meetingId}`);
        if (!details.classes.length) {
            el.innerHTML = `<div class="page-head"><h1>לוח תורים</h1></div><div class="card">${App.empty('לא הוגדרו שעות לכיתות באסיפה זו', '', `<a class="btn" href="#/meetings?id=${meetingId}">להגדרת השעות</a>`)}</div>`;
            return;
        }
        const classId = +params.class || details.classes[0].class_id;
        const [b, rep] = await Promise.all([App.get(`/meetings/${meetingId}/board?class_id=${classId}`), App.get(`/meetings/${meetingId}/report`)]);
        const canEdit = App.user.role !== 'teacher' && details.status !== 'done';
        const classRows = rep.rows.filter(r => r.class_id === classId);
        const missing = classRows.filter(r => r.status === 'missing');
        const absent = classRows.filter(r => r.status === 'absent');
        const byId = new Map(b.bookings.map(x => [x.id, x]));

        el.innerHTML = `
            <div class="page-head">
                <div><h1>לוח תורים</h1><p>${esc(b.class.name)}${b.class.teacher_name ? ` · ${esc(b.class.teacher_name)}` : ''}${b.class.location ? ` · ${esc(b.class.location)}` : ''} · <span class="num">${b.class.start}–${b.class.end}</span></p></div>
                <div class="toolbar">
                    <select class="input" id="sel-meeting">${App.meetingOptions(meetings, meetingId)}</select>
                    <select class="input" id="sel-class">${details.classes.map(c => `<option value="${c.class_id}" ${c.class_id === classId ? 'selected' : ''}>${esc(c.class_name)}</option>`).join('')}</select>
                    <a class="btn" href="#/print?meeting=${meetingId}&type=teacher&class=${classId}">הדפסת לוח</a>
                </div>
            </div>
            <div class="board">
                <div class="card"><div class="slots">${b.slots.map(s => {
                    if (s.state === 'break') return `<div class="slot break"><div class="slot-time">${s.time}</div><div class="slot-body">הפסקה</div></div>`;
                    if (s.state === 'free') return `<div class="slot free" data-time="${s.time}"><div class="slot-time">${s.time}</div><div class="slot-body">${canEdit ? '+ פנוי' : 'פנוי'}</div></div>`;
                    const bk = byId.get(s.booking_id);
                    if (!s.first) return `<div class="slot cont"><div class="slot-time">${s.time}</div><div class="slot-body"></div></div>`;
                    return `<div class="slot"><div class="slot-time">${s.time}</div><div class="slot-body">
                        <div class="booking-chip ${bk.duration === 10 ? 'long' : ''}" data-booking="${bk.id}">
                            <span><span class="who">${esc(App.fullName(bk))}</span>${bk.father_name ? ` <span class="muted small">בן ${esc(bk.father_name)}</span>` : ''}</span>
                            <span class="small muted">${bk.duration} דק' · ${SOURCE[bk.source] || ''}</span></div></div></div>`;
                }).join('')}</div></div>
                <div>
                    <div class="card"><div class="card-head"><h3>לא קבעו תור</h3><span class="badge ${missing.length ? 'badge-warning' : 'badge-success'}">${missing.length}</span></div>
                        <div class="side-list">${missing.map(r => `<div class="side-item"><div><b>${esc(App.fullName(r))}</b><div class="small muted">${r.phones.map(p => `<a class="ltr" href="tel:${p}">${App.phoneFmt(p)}</a>`).join(' · ') || 'אין טלפון'}</div></div>
                            ${canEdit ? `<button class="btn btn-sm" data-book="${r.student_id}">קביעה</button>` : ''}</div>`).join('') || '<div class="empty small">כולם קבעו 🎉</div>'}</div></div>
                    <div class="card"><div class="card-head"><h3>ביקשו שהמלמד יחזור</h3><span class="badge ${absent.filter(a => !a.handled).length ? 'badge-danger' : ''}">${absent.length}</span></div>
                        <div class="side-list">${absent.map(r => `<div class="side-item"><div><b>${esc(App.fullName(r))}</b><div class="small muted">${(r.absence_phone ? [r.absence_phone] : r.phones).map(p => `<a class="ltr" href="tel:${p}">${App.phoneFmt(p)}</a>`).join(' · ')}</div></div>
                            <label class="check small"><input type="checkbox" data-handle="${r.student_id}" ${r.handled ? 'checked' : ''}>טופל</label></div>`).join('') || '<div class="empty small">אין</div>'}</div></div>
                </div>
            </div>`;

        const reload = () => render(el, { meeting: meetingId, class: classId });
        App.$('#sel-meeting').onchange = e => App.go('board', { meeting: e.target.value });
        App.$('#sel-class').onchange = e => App.go('board', { meeting: meetingId, class: e.target.value });
        App.$$('[data-handle]', el).forEach(cb => cb.onchange = async () => {
            try { await App.put(`/meetings/${meetingId}/absences/${cb.dataset.handle}`, { handled: cb.checked }); App.ok('עודכן'); }
            catch (e) { cb.checked = !cb.checked; App.fail(e); }
        });
        if (!canEdit) return;

        App.$$('.slot.free', el).forEach(s => s.onclick = () => {
            const pool = missing.length ? [...missing, ...classRows.filter(r => r.status !== 'missing')] : classRows;
            bookModal(meetingId, pool, { time: s.dataset.time, onDone: reload });
        });
        App.$$('[data-book]', el).forEach(btn => btn.onclick = () => bookModal(meetingId, classRows, { studentId: +btn.dataset.book, onDone: reload }));
        App.$$('[data-booking]', el).forEach(chip => chip.onclick = () => {
            const bk = byId.get(+chip.dataset.booking);
            App.modal({
                title: App.fullName(bk),
                body: `<div class="grid grid-2">
                    <div><div class="muted small">שעה</div><b class="num">${bk.time}–${bk.end_time}</b> (${bk.duration} דקות)</div>
                    <div><div class="muted small">נקבע דרך</div>${SOURCE[bk.source] || ''}<div class="small faint num">${esc(bk.updated_at)}</div></div>
                    <div><div class="muted small">קוד תלמיד</div><span class="num">${esc(bk.code)}</span></div>
                    <div><div class="muted small">טלפונים</div>${bk.phones.map(p => `<a class="ltr" href="tel:${p}">${App.phoneFmt(p)}</a>`).join('<br>') || '—'}</div></div>`,
                buttons: [
                    { label: 'שינוי שעה', cls: 'btn-primary', action: () => { bookModal(meetingId, classRows, { studentId: bk.student_id, onDone: reload }); } },
                    { label: 'ביטול התור', cls: 'btn-danger', action: async () => {
                        if (!await App.confirm('ביטול תור', `לבטל את התור של ${esc(App.fullName(bk))}?`, { okLabel: 'ביטול התור', danger: true })) return false;
                        await App.del(`/meetings/${meetingId}/bookings/${bk.student_id}`); App.ok('התור בוטל'); reload();
                    } },
                    { label: 'לא יגיע — המלמד יחזור', action: async () => {
                        await App.post(`/meetings/${meetingId}/absences`, { student_id: bk.student_id }); App.ok('עודכן'); reload();
                    } }
                ]
            });
        });
    }

    App.pages.board = { title: 'לוח תורים', roles: ['admin', 'teacher', 'super'], render };
})();
