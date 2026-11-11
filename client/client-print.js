// ============================================================
//  client-print.js — הדפסות
//   announce  פתקי פרסום: מספר הקו + קוד התלמיד (לפני פתיחת ההרשמה)
//   slips     פתקי תור להורים (למקרר)
//   teacher   לוח מלמד: כל התורים לפי שעה עם מקום להערות
//   lists     רשימת "לא קבעו" ו"ביקשו שיחזרו" לכל כיתה
// ============================================================
(function () {
    const esc = App.esc;
    const TYPES = {
        announce: { label: 'פתקי פרסום הקו', desc: 'לכל תלמיד: מספר הטלפון לקביעת תור וקוד התלמיד. מחלקים לפני פתיחת ההרשמה.' },
        slips: { label: 'פתקי תור להורים', desc: 'לכל תלמיד שקבע: יום, שעה, מלמד ומיקום. להדבקה על המקרר.' },
        teacher: { label: 'לוח מלמד', desc: 'דף לכל כיתה: כל השעות לפי הסדר, שמות, טלפונים ומקום להערות.' },
        lists: { label: 'רשימות מעקב', desc: 'לכל כיתה: מי לא קבע תור ומי ביקש שהמלמד יחזור אליו, עם טלפונים.' }
    };
    const fmtLine = p => App.phoneFmt(p || '');

    function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

    function announceNotes(rep, settings) {
        const m = rep.meeting;
        const notes = rep.rows.map(r => `<div class="p-note">
            <div class="p-inst"><span>${esc(rep.tenant.name)}</span><span>${esc(r.class_name)}</span></div>
            <div><div class="p-title">${esc(m.title)} — ${esc(m.date_label)}</div>
                <div class="p-name">להורי ${esc(App.fullName(r))}</div>
                <div>לקביעת תור אצל ${esc(r.teacher_name || 'המלמד')} חייגו:</div></div>
            <div class="p-big">${esc(fmtLine(rep.tenant.line_number))}</div>
            <div class="p-code">קוד תלמיד: <b class="num">${esc(r.code)}</b> · ניתן לבחור תור של 5${m.allow_long ? ' או 10' : ''} דקות, לשמוע ולשנות</div>
            <div class="p-foot">${m.booking_closes_at ? `ההרשמה פתוחה עד ${esc(m.booking_closes_at.slice(8, 10))}/${esc(m.booking_closes_at.slice(5, 7))} בשעה ${esc(m.booking_closes_at.slice(11))}. ` : ''}${esc(settings.print_footer || '')}</div>
        </div>`);
        return chunk(notes, 8).map(p => `<div class="p-sheet p-notes">${p.join('')}</div>`).join('');
    }

    function slips(rep, settings) {
        const m = rep.meeting;
        const notes = rep.rows.filter(r => r.status === 'booked').map(r => `<div class="p-note">
            <div class="p-inst"><span>${esc(rep.tenant.name)}</span><span>${esc(r.class_name)}</span></div>
            <div><div class="p-title">${esc(m.title)}</div><div class="p-name">להורי ${esc(App.fullName(r))}</div></div>
            <div><div>${esc(m.date_label)}</div><div class="p-time num">בשעה ${esc(r.time)}</div>
                <div>אצל ${esc(r.teacher_name || 'המלמד')}${r.location ? ` · ${esc(r.location)}` : ''} · ${r.duration} דקות</div></div>
            <div class="p-foot">לשינוי או ביטול: ${esc(fmtLine(rep.tenant.line_number))}. נא להקפיד להגיע בזמן. ${esc(settings.print_footer || '')}</div>
        </div>`);
        if (!notes.length) return '';
        return chunk(notes, 8).map(p => `<div class="p-sheet p-notes">${p.join('')}</div>`).join('');
    }

    async function teacherSheets(meetingId, classes, rep) {
        const out = [];
        for (const c of classes) {
            const b = await App.get(`/meetings/${meetingId}/board?class_id=${c.class_id}`);
            const byId = new Map(b.bookings.map(x => [x.id, x]));
            const rows = [];
            let lastBreak = false;
            for (const s of b.slots) {
                if (s.state === 'break') { if (!lastBreak) rows.push(`<tr class="p-break"><td colspan="4">הפסקה</td></tr>`); lastBreak = true; continue; }
                lastBreak = false;
                if (s.state === 'booked' && !s.first) continue;
                if (s.state === 'free') { rows.push(`<tr class="p-free"><td class="num">${s.time}</td><td>—</td><td></td><td></td></tr>`); continue; }
                const bk = byId.get(s.booking_id);
                rows.push(`<tr><td class="num"><b>${bk.time}</b>${bk.duration === 10 ? '<div class="p-small">10 דק\'</div>' : ''}</td>
                    <td><b>${esc(App.fullName(bk))}</b>${bk.father_name ? `<div class="p-small">בן ${esc(bk.father_name)}</div>` : ''}</td>
                    <td class="num">${bk.phones.map(fmtLine).join('<br>')}</td><td class="p-notes-col"></td></tr>`);
            }
            const cr = rep.rows.filter(r => r.class_id === c.class_id);
            const missing = cr.filter(r => r.status === 'missing'), absent = cr.filter(r => r.status === 'absent');
            out.push(`<div class="p-sheet">
                <div class="p-head"><div><h1>${esc(b.class.name)} — ${esc(b.class.teacher_name || '')}</h1><div class="p-sub">${esc(rep.meeting.title)} · ${esc(rep.meeting.date_label)}${b.class.location ? ` · ${esc(b.class.location)}` : ''}</div></div>
                    <div class="p-sub">${b.bookings.length} תורים · ${missing.length} לא קבעו · ${absent.length} ביקשו קשר</div></div>
                <table class="p-table"><thead><tr><th style="width:14mm">שעה</th><th>תלמיד</th><th style="width:30mm">טלפון</th><th class="p-notes-col">הערות</th></tr></thead><tbody>${rows.join('')}</tbody></table>
                ${absent.length ? `<h3>ביקשו שתחזור אליהם</h3><table class="p-table"><tbody>${absent.map(r => `<tr><td><b>${esc(App.fullName(r))}</b></td><td class="num">${(r.absence_phone ? [r.absence_phone] : r.phones).map(fmtLine).join(', ')}</td><td class="p-notes-col"></td></tr>`).join('')}</tbody></table>` : ''}
                ${missing.length ? `<h3>לא קבעו תור</h3><table class="p-table"><tbody>${missing.map(r => `<tr><td><b>${esc(App.fullName(r))}</b></td><td class="num">${r.phones.map(fmtLine).join(', ')}</td><td class="p-notes-col"></td></tr>`).join('')}</tbody></table>` : ''}
            </div>`);
        }
        return out.join('');
    }

    function lists(rep, classes) {
        return classes.map(c => {
            const cr = rep.rows.filter(r => r.class_id === c.class_id && r.status !== 'booked');
            if (!cr.length) return '';
            return `<div class="p-sheet"><div class="p-head"><div><h1>${esc(c.class_name)} — מעקב</h1><div class="p-sub">${esc(rep.meeting.title)} · ${esc(rep.meeting.date_label)}</div></div></div>
                <table class="p-table"><thead><tr><th>תלמיד</th><th>מצב</th><th>טלפונים</th><th class="p-notes-col">הערות</th></tr></thead>
                <tbody>${cr.map(r => `<tr><td><b>${esc(App.fullName(r))}</b></td><td>${r.status === 'absent' ? `ביקש שיחזרו${r.handled ? ' (טופל)' : ''}` : 'לא קבע'}</td>
                    <td class="num">${r.phones.map(fmtLine).join('<br>') || '—'}</td><td class="p-notes-col">${esc(r.note || '')}</td></tr>`).join('')}</tbody></table></div>`;
        }).join('');
    }

    async function render(el, params) {
        const meetings = await App.meetings();
        if (!meetings.length) {
            el.innerHTML = `<div class="page-head"><h1>הדפסות</h1></div><div class="card">${App.empty('אין אסיפות', 'צרו אסיפה כדי להדפיס פתקים ולוחות.')}</div>`;
            return;
        }
        const isTeacher = App.user.role === 'teacher';
        const types = isTeacher ? ['teacher', 'lists'] : Object.keys(TYPES);
        const meetingId = +params.meeting || (await App.currentMeeting()).id;
        const type = types.includes(params.type) ? params.type : types[0];
        const details = await App.get(`/meetings/${meetingId}`);

        el.innerHTML = `<div class="page-head"><div><h1>הדפסות</h1><p>בחרו סוג הדפסה, כיתה, ולחצו "הדפסה". מומלץ להדפיס על A4.</p></div></div>
            <div class="card"><div class="card-body">
                <div class="toolbar" style="margin-bottom:18px">
                    <select class="input" id="p-meeting">${App.meetingOptions(meetings, meetingId)}</select>
                    <select class="input" id="p-class"><option value="">כל הכיתות</option>${details.classes.map(c => `<option value="${c.class_id}" ${+params.class === c.class_id ? 'selected' : ''}>${esc(c.class_name)}</option>`).join('')}</select>
                </div>
                <div class="grid grid-2">${types.map(t => `<label class="card" style="padding:14px 16px;cursor:pointer;${t === type ? 'border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft)' : ''}">
                    <div class="check"><input type="radio" name="ptype" value="${t}" ${t === type ? 'checked' : ''}><span><b>${TYPES[t].label}</b><small>${TYPES[t].desc}</small></span></div></label>`).join('')}</div>
                <div class="actions" style="margin-top:18px"><button class="btn btn-primary" id="do-print">הדפסה</button><span class="muted small" id="p-info"></span></div>
                ${type === 'announce' && !isTeacher ? '<div class="alert" style="margin-top:16px">מספר הקו שמודפס נלקח מ"הגדרות". ודאו שהוא נכון לפני ההדפסה.</div>' : ''}
            </div></div>`;

        const state = () => ({ meeting: App.$('#p-meeting').value, type: App.$('input[name=ptype]:checked').value, class: App.$('#p-class').value });
        App.$('#p-meeting').onchange = () => App.go('print', { meeting: App.$('#p-meeting').value, type });
        App.$$('input[name=ptype]', el).forEach(r => r.onchange = () => App.go('print', Object.fromEntries(Object.entries(state()).filter(([, v]) => v))));

        App.$('#do-print').onclick = async () => {
            const s = state();
            const btn = App.$('#do-print');
            btn.disabled = true;
            App.$('#p-info').textContent = 'מכין…';
            try {
                const rep = await App.get(`/meetings/${s.meeting}/report`);
                const settings = isTeacher ? {} : (await App.get('/settings')).settings;
                const d = s.meeting === String(meetingId) ? details : await App.get(`/meetings/${s.meeting}`);
                const classes = d.classes.filter(c => !s.class || c.class_id === +s.class);
                if (s.class) rep.rows = rep.rows.filter(r => r.class_id === +s.class);
                let html = '';
                if (s.type === 'announce') html = announceNotes(rep, settings);
                else if (s.type === 'slips') html = slips(rep, settings);
                else if (s.type === 'teacher') html = await teacherSheets(s.meeting, classes, rep);
                else html = lists(rep, classes);
                if (!html) { App.toast('אין מה להדפיס בבחירה הזו'); return; }
                App.$('#print-area').innerHTML = html;
                App.$('#p-info').textContent = '';
                setTimeout(() => window.print(), 150);
            } catch (e) { App.fail(e); App.$('#p-info').textContent = ''; }
            finally { btn.disabled = false; }
        };
    }

    App.pages.print = { title: 'הדפסות', roles: ['admin', 'teacher', 'super'], render };
})();
