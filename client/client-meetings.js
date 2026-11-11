// ============================================================
//  client-meetings.js — אסיפות: רשימה, הקמה, שעות לכל כיתה, פתיחה/נעילה וצינתוקים
// ============================================================
(function () {
    const esc = App.esc;
    const TZ_TARGETS = { all: 'כל ההורים', missing: 'הורים שלא קבעו תור', booked: 'הורים שקבעו תור (תזכורת)', absent: 'הורים שהודיעו שלא יגיעו' };
    const TZ_KIND = { open: 'פתיחת הרשמה', missing: 'לא קבעו (אוטומטי)', reminder: 'תזכורת (אוטומטי)', manual_all: 'כל ההורים', manual_missing: 'לא קבעו', manual_booked: 'קבעו תור', manual_absent: 'הודיעו שלא יגיעו' };

    function meetingForm(m = {}) {
        const today = new Date().toISOString().slice(0, 10);
        return `<form class="form-grid">
            <label class="field full"><span>כותרת</span><input class="input" name="title" required value="${esc(m.title || 'אסיפת הורים')}"></label>
            <label class="field"><span>תאריך האסיפה</span><input class="input" type="date" name="meeting_date" required value="${esc(m.meeting_date || today)}"></label>
            <label class="field"><span>נעילת ההרשמה (אוטומטית)</span><input class="input" type="datetime-local" name="booking_closes_at" value="${esc((m.booking_closes_at || '').replace(' ', 'T'))}">
                <small>ריק = נעילה ידנית בלבד</small></label>
            <label class="check full"><input type="checkbox" name="allow_long" ${m.allow_long !== false ? 'checked' : ''}><span>לאפשר תור של 10 דקות<small>ההורה בוחר בטלפון 5 או 10 דקות</small></span></label>
            <label class="field"><span>מקסימום תורים של 10 דקות לכיתה</span><input class="input" type="number" min="0" name="max_long_per_class" value="${esc(m.max_long_per_class || '')}" placeholder="ללא הגבלה"></label>
            <label class="field"><span>מרווח בין תורים של אחים (דקות)</span><input class="input" type="number" min="0" max="30" name="family_gap" value="${esc(m.family_gap ?? 0)}">
                <small>זמן מעבר בין כיתות להורה עם כמה ילדים</small></label>
            <label class="check full"><input type="checkbox" name="auto_missing_tzintuk" ${m.auto_missing_tzintuk !== false ? 'checked' : ''}><span>בנעילה: צינתוק מיוחד להורים שלא קבעו<small>יוצא אוטומטית כשההרשמה ננעלת</small></span></label>
            <label class="check full"><input type="checkbox" name="auto_assign" ${m.auto_assign ? 'checked' : ''}><span>בנעילה: לשבץ אוטומטית את מי שלא קבע<small>בשעות שנשארו פנויות, ליד התורים של האחים. הצינתוק יוצא אחרי השיבוץ ויודיע להם לשמוע את התור</small></span></label>
            <label class="field"><span>צינתוק תזכורת ביום האסיפה בשעה</span><input class="input" type="time" name="reminder_time" value="${esc(m.reminder_time || '')}"><small>ריק = ללא תזכורת. נשלח למי שקבע תור</small></label>
            <label class="field full"><span>הערות פנימיות</span><textarea class="input" name="notes" rows="2">${esc(m.notes || '')}</textarea></label>
        </form>`;
    }

    function readMeetingForm(modal) {
        const d = App.formData(modal.querySelector('form'));
        return { ...d, booking_closes_at: d.booking_closes_at ? d.booking_closes_at.replace('T', ' ') : '', max_long_per_class: d.max_long_per_class || null };
    }

    function openEditor(m) {
        App.modal({
            title: m ? 'עריכת אסיפה' : 'אסיפה חדשה', body: meetingForm(m || {}), wide: true,
            buttons: [{
                label: m ? 'שמירה' : 'יצירה', cls: 'btn-primary', action: async modal => {
                    const body = readMeetingForm(modal);
                    if (!m) {
                        const classes = await App.classes();
                        body.classes = classes.filter(c => c.active).map(c => ({ class_id: c.id, start: '19:00', end: '21:00', location: c.location || '' }));
                    }
                    const r = m ? await App.put(`/meetings/${m.id}`, body) : await App.post('/meetings', body);
                    App.cache.meetings = null;
                    App.ok(m ? 'האסיפה נשמרה' : 'האסיפה נוצרה — עכשיו קבעו את השעות לכל כיתה');
                    App.go('meetings', { id: r.id });
                }
            }, { label: 'ביטול' }]
        });
    }

    async function renderList(el, params) {
        const list = await App.meetings(true);
        el.innerHTML = `<div class="page-head"><div><h1>אסיפות</h1><p>כל אסיפה: שעות לכל כיתה, פתיחת הרשמה בטלפון, נעילה והדפסות</p></div>
            <div class="actions"><button class="btn btn-primary" id="new-meeting">+ אסיפה חדשה</button></div></div>
            <div class="card">${list.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>אסיפה</th><th>תאריך</th><th>מצב</th><th>קבעו</th><th>לא קבעו</th><th>חזרו אליי</th><th></th></tr></thead>
                <tbody>${list.map(m => `<tr><td><a href="#/meetings?id=${m.id}"><b>${esc(m.title)}</b></a></td><td>${esc(m.date_label)}</td><td>${App.statusBadge(m)}</td>
                    <td class="num">${m.stats.booked}/${m.stats.students}</td><td class="num">${m.stats.missing}</td><td class="num">${m.stats.absent}</td>
                    <td class="actions-cell"><a class="btn btn-sm" href="#/meetings?id=${m.id}">ניהול</a></td></tr>`).join('')}</tbody></table></div>`
                : App.empty('עדיין אין אסיפות', 'צרו אסיפה ראשונה, קבעו שעות לכל כיתה ופתחו את ההרשמה.')}</div>`;
        App.$('#new-meeting').onclick = () => openEditor(null);
        if (params.new) openEditor(null);
    }

    function classTimesTable(classes, times) {
        const byClass = new Map(times.map(t => [t.class_id, t]));
        return `<div class="toolbar" style="margin-bottom:12px">
                <span class="muted small">החלה מהירה על כל הכיתות המסומנות:</span>
                <input class="input ltr-input" type="time" id="all-start" value="19:00" style="min-width:110px">
                <span>עד</span><input class="input ltr-input" type="time" id="all-end" value="21:00" style="min-width:110px">
                <button class="btn btn-sm" id="apply-all" type="button">החל</button>
            </div>
            <div class="table-wrap"><table class="table class-times">
            <thead><tr><th></th><th>כיתה</th><th>משעה</th><th>עד שעה</th><th>הפסקות</th><th>מיקום</th></tr></thead>
            <tbody>${classes.map(c => {
                const t = byClass.get(c.id);
                return `<tr data-class="${c.id}">
                    <td><input type="checkbox" class="ct-on" ${t ? 'checked' : ''}></td>
                    <td><b>${esc(c.name)}</b><div class="small muted">${esc(c.teacher_name || '')}</div></td>
                    <td><input class="input ltr-input ct-start" type="time" step="300" value="${esc(t ? t.start : '19:00')}"></td>
                    <td><input class="input ltr-input ct-end" type="time" step="300" value="${esc(t ? t.end : '21:00')}"></td>
                    <td><input class="input ltr-input ct-breaks" placeholder="20:00-20:15" value="${esc(t ? t.breaks.map(b => `${b.from}-${b.to}`).join(', ') : '')}"></td>
                    <td><input class="input ct-loc" value="${esc(t ? (t.location || '') : (c.location || ''))}" placeholder="חדר / כיתה"></td></tr>`;
            }).join('')}</tbody></table></div>`;
    }

    function readClassTimes(el) {
        return App.$$('tr[data-class]', el).filter(tr => tr.querySelector('.ct-on').checked).map(tr => ({
            class_id: +tr.dataset.class,
            start: tr.querySelector('.ct-start').value,
            end: tr.querySelector('.ct-end').value,
            location: tr.querySelector('.ct-loc').value,
            breaks: tr.querySelector('.ct-breaks').value.split(/[,;]+/).map(s => s.trim()).filter(Boolean).map(s => {
                const [from, to] = s.split('-').map(x => x.trim());
                return { from, to };
            })
        }));
    }

    async function renderDetail(el, id) {
        const [m, classes, log] = await Promise.all([App.get(`/meetings/${id}`), App.classes(true), App.get(`/meetings/${id}/tzintuk`).catch(() => [])]);
        const t = m.stats.total;
        const hasTimes = m.classes.length > 0;
        const statusActions = {
            draft: `<button class="btn btn-success" data-status="open">פתיחת ההרשמה</button>`,
            open: `<button class="btn btn-primary" data-status="locked">נעילת ההרשמה</button><button class="btn" data-status="draft">החזרה לטיוטה</button>`,
            locked: `<button class="btn" data-status="open">פתיחה מחדש</button><button class="btn" data-status="done">סימון כהסתיימה</button>`,
            done: `<button class="btn" data-status="locked">החזרה למצב נעול</button>`
        }[m.status];

        el.innerHTML = `
            <div class="page-head">
                <div><a href="#/meetings" class="small">→ כל האסיפות</a><h1>${esc(m.title)}</h1>
                    <p>${esc(m.date_label)} · ${App.statusBadge(m)} · ${t.booked} מתוך ${t.students} קבעו תור</p></div>
                <div class="actions"><button class="btn" id="edit">עריכת פרטים</button><a class="btn" href="#/board?meeting=${m.id}">לוח תורים</a>
                    <a class="btn" href="#/print?meeting=${m.id}">הדפסות</a><button class="btn btn-danger" id="delete">מחיקה</button></div>
            </div>

            <div class="grid grid-2">
                <div class="card"><div class="card-head"><h2>שלבים</h2></div><div class="card-body">
                    <ol class="steps">
                        <li class="${hasTimes ? 'done' : ''}"><div><b>שעות לכל כיתה</b><div class="small muted">בטבלה למטה — כולל הפסקות ומיקום</div></div></li>
                        <li><div><b>פתקי פרסום הקו להורים</b><div class="small muted">מספר הטלפון וקוד התלמיד — <a href="#/print?meeting=${m.id}&type=announce">להדפסה</a></div></div></li>
                        <li class="${m.status !== 'draft' ? 'done' : ''}"><div><b>פתיחת ההרשמה</b><div class="small muted">אפשר לשלוח צינתוק לכל ההורים באותו רגע</div></div></li>
                        <li class="${m.status === 'locked' || m.status === 'done' ? 'done' : ''}"><div><b>נעילת ההרשמה</b><div class="small muted">${m.booking_closes_at ? `אוטומטית ב-<span class="num">${esc(App.fmtStamp(m.booking_closes_at))}</span>` : 'ידנית'}${m.auto_missing_tzintuk ? ' · צינתוק ל"לא קבעו"' : ''}${m.auto_assign ? ' · שיבוץ אוטומטי' : ''}</div></div></li>
                        <li><div><b>פתקי תור ולוחות למלמדים</b><div class="small muted"><a href="#/print?meeting=${m.id}&type=slips">פתקי תור</a> · <a href="#/print?meeting=${m.id}&type=teacher">לוח מלמד</a></div></div></li>
                    </ol>
                </div></div>
                <div class="card"><div class="card-head"><h2>מצב ההרשמה</h2>${App.statusBadge(m)}</div><div class="card-body">
                    <p class="muted" style="margin-top:0">${{
                        draft: 'האסיפה בטיוטה: ההורים עדיין לא יכולים לקבוע תורים בטלפון.',
                        open: 'ההרשמה פתוחה: הורים יכולים לקבוע, לשנות ולבטל תורים בטלפון.',
                        locked: 'ההרשמה נעולה: הורים יכולים רק לשמוע את התורים ולעדכן שלא יגיעו. המזכירות יכולה עדיין לשנות תורים בלוח.',
                        done: 'האסיפה הסתיימה.'
                    }[m.status]}</p>
                    <div class="actions">${statusActions}${m.status !== 'draft' && m.status !== 'done' ? '<button class="btn" id="auto-assign">שיבוץ אוטומטי עכשיו</button>' : ''}</div>
                    <hr style="border:0;border-top:1px solid var(--border);margin:18px 0">
                    <h3 style="margin-bottom:10px">שליחת צינתוק</h3>
                    <div class="toolbar"><select class="input" id="tz-target">${Object.entries(TZ_TARGETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
                        <button class="btn" id="tz-send">שליחה…</button></div>
                    <p class="small faint" style="margin-bottom:0">הצינתוק יוצא ממספר הקו של המוסד, כדי שההורים יחזרו אליו.</p>
                </div></div>
            </div>

            <div class="card">
                <div class="card-head"><h2>שעות האסיפה לכל כיתה</h2><button class="btn btn-primary" id="save-times">שמירת השעות</button></div>
                <div class="card-body">${classes.length ? classTimesTable(classes.filter(c => c.active || m.classes.some(x => x.class_id === c.id)), m.classes)
                    : App.empty('אין כיתות', 'הוסיפו כיתות לפני הגדרת השעות.', '<a class="btn" href="#/classes">לכיתות</a>')}</div>
            </div>

            <div class="card">
                <div class="card-head"><h2>צינתוקים שנשלחו</h2></div>
                ${log.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>מתי</th><th>סוג</th><th>מספרים</th><th>תוצאה</th><th>נשלח ע"י</th></tr></thead>
                <tbody>${log.map(l => `<tr><td class="num small">${esc(l.created_at)}</td><td>${esc(TZ_KIND[l.kind] || l.kind)}</td><td class="num">${l.phones_count}</td>
                    <td>${l.ok ? '<span class="badge badge-success">נשלח</span>' : `<span class="badge badge-danger" title="${esc(l.response || '')}">נכשל</span>`}</td><td>${esc(l.triggered_by === 'auto' ? 'אוטומטי' : l.triggered_by)}</td></tr>`).join('')}</tbody></table></div>`
                : App.empty('עדיין לא נשלחו צינתוקים')}
            </div>`;

        App.$('#edit').onclick = () => openEditor(m);
        App.$('#delete').onclick = async () => {
            if (!await App.confirm('מחיקת אסיפה', `למחוק את "${esc(m.title)}" כולל ${t.booked} תורים שנקבעו? לא ניתן לשחזר.`, { okLabel: 'מחיקה', danger: true })) return;
            try { await App.del(`/meetings/${m.id}`); App.cache.meetings = null; App.ok('האסיפה נמחקה'); App.go('meetings'); } catch (e) { App.fail(e); }
        };

        const applyAll = App.$('#apply-all');
        if (applyAll) applyAll.onclick = () => {
            App.$$('tr[data-class]', el).forEach(tr => {
                if (!tr.querySelector('.ct-on').checked) return;
                tr.querySelector('.ct-start').value = App.$('#all-start').value;
                tr.querySelector('.ct-end').value = App.$('#all-end').value;
            });
        };
        App.$('#save-times').onclick = async () => {
            try {
                await App.put(`/meetings/${m.id}`, { classes: readClassTimes(el) });
                App.cache.meetings = null;
                App.ok('השעות נשמרו');
                renderDetail(el, id);
            } catch (e) { App.fail(e); }
        };

        App.$$('[data-status]', el).forEach(b => b.onclick = () => changeStatus(el, m, b.dataset.status));
        const aa = App.$('#auto-assign');
        if (aa) aa.onclick = async () => {
            if (!await App.confirm('שיבוץ אוטומטי', `לשבץ עכשיו ${t.missing} תלמידים שלא קבעו ולא הודיעו שלא יגיעו, בשעות הפנויות?`)) return;
            try {
                const r = await App.post(`/meetings/${m.id}/auto-assign`);
                App.ok(`שובצו ${r.assigned} תלמידים${r.failed ? `, ${r.failed} לא שובצו (אין מקום)` : ''}`);
                renderDetail(el, id);
            } catch (e) { App.fail(e); }
        };
        App.$('#tz-send').onclick = async () => {
            const target = App.$('#tz-target').value;
            try {
                const preview = await App.post(`/meetings/${m.id}/tzintuk`, { target, dry_run: true });
                if (!preview.would_send) return App.toast('אין מספרים לשליחה בקבוצה זו');
                if (!await App.confirm('שליחת צינתוק', `לשלוח צינתוק ל-${preview.would_send} מספרים (${TZ_TARGETS[target]})?`, { okLabel: 'שליחה' })) return;
                const r = await App.post(`/meetings/${m.id}/tzintuk`, { target });
                r.ok ? App.ok(`נשלח צינתוק ל-${r.sent} מספרים`) : App.fail(new Error('השליחה נכשלה — בדקו את הטוקן של ימות בהגדרות'));
                renderDetail(el, id);
            } catch (e) { App.fail(e); }
        };
    }

    function changeStatus(el, m, status) {
        const t = m.stats.total;
        if (status === 'open' && m.status === 'draft') {
            App.modal({
                title: 'פתיחת ההרשמה',
                body: `<p style="margin-top:0">מרגע הפתיחה הורים יוכלו להתקשר ולקבוע תורים.</p>
                    <label class="check"><input type="checkbox" id="open-tz" checked><span>לשלוח עכשיו צינתוק לכל ההורים (${t.students} תלמידים)<small>ההורים יראו שיחה שלא נענתה ממספר הקו ויחזרו אליו</small></span></label>`,
                buttons: [{ label: 'פתיחה', cls: 'btn-success', action: async modal => {
                    const r = await App.post(`/meetings/${m.id}/status`, { status: 'open', tzintuk: modal.querySelector('#open-tz').checked });
                    App.cache.meetings = null;
                    App.ok('ההרשמה נפתחה' + (r.tzintuk ? ` · צינתוק נשלח ל-${r.tzintuk.sent} מספרים` : ''));
                    renderDetail(el, m.id);
                } }, { label: 'ביטול' }]
            });
            return;
        }
        if (status === 'locked' && m.status === 'open') {
            App.modal({
                title: 'נעילת ההרשמה',
                body: `<p style="margin-top:0">אחרי הנעילה הורים לא יוכלו לשנות תורים בטלפון. ${t.missing} תלמידים עדיין ללא תור.</p>
                    <label class="check"><input type="checkbox" id="lock-assign" ${m.auto_assign ? 'checked' : ''}><span>לשבץ אוטומטית את מי שלא קבע</span></label><br>
                    <label class="check"><input type="checkbox" id="lock-tz" ${m.auto_missing_tzintuk ? 'checked' : ''}><span>צינתוק מיוחד להורים שלא קבעו</span></label>`,
                buttons: [{ label: 'נעילה', cls: 'btn-primary', action: async modal => {
                    const r = await App.post(`/meetings/${m.id}/status`, { status: 'locked', auto_assign: modal.querySelector('#lock-assign').checked, tzintuk: modal.querySelector('#lock-tz').checked });
                    App.cache.meetings = null;
                    const a = r.actions || {};
                    App.ok('ההרשמה ננעלה' + (a.auto_assign ? ` · שובצו ${a.auto_assign.assigned}` : '') + (a.tzintuk ? ` · צינתוק ל-${a.tzintuk.sent}` : ''));
                    renderDetail(el, m.id);
                } }, { label: 'ביטול' }]
            });
            return;
        }
        (async () => {
            try {
                await App.post(`/meetings/${m.id}/status`, { status });
                App.cache.meetings = null;
                App.ok('המצב עודכן');
                renderDetail(el, m.id);
            } catch (e) { App.fail(e); }
        })();
    }

    App.pages.meetings = {
        title: 'אסיפות',
        roles: ['admin', 'super'],
        render(el, params) {
            return params.id ? renderDetail(el, +params.id) : renderList(el, params);
        }
    };
})();
