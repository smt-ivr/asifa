// ============================================================
//  client-meetings.js — אסיפות
//  רשימה · אסיפה חדשה (שם בלבד) · הגדרות אסיפה:
//    תאריך האסיפה (מוצג גם בתאריך עברי) · אורכי פגישה שההורה יוכל לבחור ·
//    לכל כיתה: משתתפת או לא, שעות, ואילו אורכי פגישה מותרים בה
// ============================================================
import { get, post, put, del, esc, $, $$, modal, confirmDialog, ok, fail, emptyState, go } from './client-app.js';
import { hebrewDate, gregorian } from './client-hebdate.js';

const PRESET = [5, 10, 15, 20, 30];
const toMin = t => (/^\d{2}:\d{2}$/.test(t || '') ? +t.slice(0, 2) * 60 + +t.slice(3) : null);

function openNew() {
    modal({
        title: 'אסיפה חדשה', icon: 'fa-calendar-plus',
        body: `<form><label class="field"><span>שם האסיפה</span><input class="input" name="name" required placeholder="אסיפת הורים — חורף תשפ״ז"></label></form>`,
        buttons: [{ label: 'יצירה', cls: 'btn-primary', icon: 'fa-check', action: async m => {
            const name = $('[name=name]', m).value.trim();
            if (!name) throw new Error('יש להזין שם לאסיפה');
            const r = await post('/meetings', { name });
            ok('האסיפה נוצרה — עכשיו מגדירים אותה');
            go('meetings', { id: r.id });
        } }, { label: 'ביטול' }]
    });
}

async function renderList(el, params) {
    const list = await get('/meetings');
    el.innerHTML = `
        <div class="page-head">
            <div><h2><i class="fas fa-calendar-alt"></i> אסיפות</h2><p>יוצרים אסיפה, ובתוכה קובעים תאריך, שעות לכל כיתה ואורכי פגישה</p></div>
            <div class="actions"><button class="btn btn-primary" id="btnNew"><i class="fas fa-plus"></i> אסיפה חדשה</button></div>
        </div>
        <div class="card flush">${list.length ? `<div class="table-container"><table class="modern-table">
            <thead><tr><th>אסיפה</th><th>תאריך</th><th>אורכי פגישה</th><th>כיתות משתתפות</th><th></th></tr></thead>
            <tbody>${list.map(m => `<tr>
                <td><a href="#meetings?id=${m.id}"><b>${esc(m.name)}</b></a></td>
                <td>${m.meeting_date ? `${esc(hebrewDate(m.meeting_date))} <span class="text-muted">(${gregorian(m.meeting_date)})</span>` : '<span class="badge badge-warning">לא נקבע</span>'}</td>
                <td>${m.durations.map(d => `<span class="badge badge-primary">${d} דק׳</span>`).join(' ')}</td>
                <td>${m.classes_count || '<span class="badge badge-warning">לא הוגדרו</span>'}</td>
                <td class="td-actions"><a class="btn btn-sm btn-outline" href="#meetings?id=${m.id}"><i class="fas fa-cog"></i> הגדרות</a></td></tr>`).join('')}</tbody></table></div>`
            : emptyState('fa-calendar-plus', 'עדיין אין אסיפות', 'יוצרים אסיפה עם שם בלבד, ואת כל השאר מגדירים בתוכה.', '<button class="btn btn-primary" data-new><i class="fas fa-plus"></i> אסיפה חדשה</button>')}</div>`;
    $('#btnNew', el).onclick = openNew;
    const n = $('[data-new]', el);
    if (n) n.onclick = openNew;
    if (params.new) { history.replaceState(null, '', '#meetings'); openNew(); }
}

function chips(name, options, selected) {
    return `<div class="chips">${options.map(d => `<label class="chip ${selected.includes(d) ? 'on' : ''}"><input type="checkbox" name="${name}" value="${d}" ${selected.includes(d) ? 'checked' : ''}>${d} דק׳</label>`).join('')}</div>`;
}

function bindChips(root) {
    root.addEventListener('change', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        if (e.target.type === 'radio') root.querySelectorAll(`input[name="${e.target.name}"]`).forEach(r => r.closest('.chip').classList.toggle('on', r.checked));
        else chip.classList.toggle('on', e.target.checked);
    });
}

async function renderDetail(el, id) {
    const m = await get(`/meetings/${id}`);
    let options = [...new Set([...PRESET, ...m.durations])].sort((a, b) => a - b);
    const dirty = { v: false };

    const classRow = c => {
        const on = c.included;
        const durs = on ? c.durations : m.durations;
        return `<div class="class-row ${on ? '' : 'off'}" data-class="${c.class_id}" data-students="${c.students}">
            <input type="checkbox" class="cr-on" ${on ? 'checked' : ''} title="משתתפת באסיפה">
            <div><div class="class-name">${esc(c.class_name)}</div>
                <div class="class-teacher">${c.teacher_name ? esc(c.teacher_name) : '<a href="#classes" style="color:#b45309">חסר שם מלמד</a>'} · ${c.students} תלמידים</div></div>
            <input class="input ltr-input cr-start" type="time" step="300" value="${esc(c.start_time || '19:00')}">
            <input class="input ltr-input cr-end" type="time" step="300" value="${esc(c.end_time || '21:00')}">
            <div class="cr-durs">${chips('cd', m.durations, durs)}</div>
            <div class="capacity"></div>
        </div>`;
    };

    el.innerHTML = `<div id="mRoot">
        <a class="back-link" href="#meetings"><i class="fas fa-arrow-right"></i> כל האסיפות</a>
        <div class="page-head">
            <div><h2><i class="fas fa-calendar-alt"></i> ${esc(m.name)}</h2><p id="headDate">${m.meeting_date ? esc(hebrewDate(m.meeting_date)) : 'תאריך האסיפה עוד לא נקבע'}</p></div>
            <div class="actions"><button class="btn btn-danger" id="btnDelete"><i class="fas fa-trash"></i> מחיקה</button><button class="btn btn-primary" id="btnSaveTop"><i class="fas fa-save"></i> שמירה</button></div>
        </div>

        <div class="grid-2">
            <div class="card">
                <h3><i class="fas fa-info-circle"></i> פרטי האסיפה</h3>
                <div class="form-grid" style="margin-top:10px">
                    <label class="field full"><span>שם האסיפה</span><input class="input" id="mName" value="${esc(m.name)}"></label>
                    <label class="field full"><span>תאריך האסיפה הכללית</span><input class="input" type="date" id="mDate" value="${esc(m.meeting_date || '')}">
                        <div class="hebdate" id="mHeb">${m.meeting_date ? esc(hebrewDate(m.meeting_date)) : ''}</div></label>
                    <label class="field full"><span>הערות</span><textarea class="input" id="mNotes" rows="2">${esc(m.notes || '')}</textarea></label>
                </div>
            </div>
            <div class="card">
                <h3><i class="fas fa-stopwatch"></i> אורכי פגישה שההורה יוכל לבחור</h3>
                <p class="text-muted" style="margin:4px 0 10px">ההורה יבחר אחד מהאורכים המסומנים. בכל כיתה אפשר לצמצם את הבחירה בהמשך.</p>
                <div id="mDurs">${chips('md', options, m.durations)}</div>
                <div class="toolbar" style="margin-top:10px"><input class="input" type="number" min="1" max="120" id="customDur" placeholder="אורך אחר (דקות)" style="width:170px"><button class="btn btn-sm btn-outline" id="addDur"><i class="fas fa-plus"></i> הוספה</button></div>
            </div>
        </div>

        <div class="card">
            <div class="card-head"><h3><i class="fas fa-phone-alt"></i> הרשמה בטלפון</h3><a class="btn btn-sm btn-outline" href="#bookings?meeting=${m.id}"><i class="fas fa-clock"></i> פגישות שנקבעו (${m.bookings_count || 0})</a></div>
            <div class="form-grid">
                <div class="field"><span>מצב</span><div class="chips" id="mPhone">
                    ${[['closed', 'סגורה'], ['open', 'פתוחה להרשמה'], ['locked', 'נסגרה — שמיעה בלבד']].map(([k, l]) => `<label class="chip ${m.phone_status === k ? 'on' : ''}"><input type="radio" name="mPhone" value="${k}" ${m.phone_status === k ? 'checked' : ''}>${l}</label>`).join('')}</div>
                    <small>רק אסיפה אחת יכולה להיות פעילה בטלפון בכל זמן</small></div>
                <label class="field"><span>סגירת ההרשמה אוטומטית</span><input class="input" type="datetime-local" id="mCloses" value="${esc((m.booking_closes_at || '').replace(' ', 'T'))}"><small>ריק = רק ידנית. אחרי המועד ההורים יוכלו רק לשמוע</small></label>
            </div>
        </div>

        <div class="card flush">
            <div class="card-head" style="padding-bottom:10px"><h3><i class="fas fa-chalkboard-teacher"></i> כיתות, שעות ואורכי פגישה</h3>
                <div class="toolbar"><span class="text-muted">לכל המסומנות:</span>
                    <input class="input ltr-input" type="time" step="300" id="allStart" value="19:00" style="width:115px"><span class="text-muted">עד</span>
                    <input class="input ltr-input" type="time" step="300" id="allEnd" value="21:00" style="width:115px">
                    <button class="btn btn-sm btn-secondary" id="applyAll">החלה</button></div></div>
            ${m.classes.length ? `<div class="class-row head"><span></span><span>כיתה</span><span>משעה</span><span>עד שעה</span><span>אורכי פגישה בכיתה</span><span>מקום</span></div>
                <div id="classRows">${m.classes.map(classRow).join('')}</div>`
                : emptyState('fa-chalkboard', 'אין כיתות במוסד', 'קודם מכניסים תלמידים — הכיתות נוצרות אוטומטית.', '<a class="btn btn-secondary" href="#students?import=1"><i class="fas fa-file-excel"></i> ייבוא תלמידים</a>')}
        </div>
        <div class="actions" style="justify-content:flex-end"><button class="btn btn-primary" id="btnSave"><i class="fas fa-save"></i> שמירת האסיפה</button></div></div>`;

    // המאזינים על עוטף חדש בכל ציור — לא מצטברים
    const root = $('#mRoot', el);
    bindChips(root);
    root.addEventListener('input', () => { dirty.v = true; });
    root.addEventListener('change', () => { dirty.v = true; capacity(); });

    const meetingDurs = () => $$('#mDurs input:checked', el).map(i => +i.value);

    // חישוב מקום: כמה פגישות נכנסות בשעות לפי האורך הקצר, מול מספר התלמידים
    function capacity() {
        $$('.class-row[data-class]', el).forEach(row => {
            const out = row.querySelector('.capacity');
            const on = row.querySelector('.cr-on').checked;
            row.classList.toggle('off', !on);
            if (!on) { out.textContent = 'לא משתתפת'; out.className = 'capacity'; return; }
            const s = toMin(row.querySelector('.cr-start').value), e = toMin(row.querySelector('.cr-end').value);
            const durs = $$('.cr-durs input:checked', row).map(i => +i.value);
            const students = +row.dataset.students;
            if (s === null || e === null || e <= s) { out.textContent = 'שעות לא תקינות'; out.className = 'capacity bad'; return; }
            if (!durs.length) { out.textContent = 'לא נבחר אורך'; out.className = 'capacity bad'; return; }
            const total = e - s, slots = Math.floor(total / Math.min(...durs));
            out.innerHTML = `${Math.floor(total / 60) ? `${Math.floor(total / 60)} ש׳ ` : ''}${total % 60 ? `${total % 60} ד׳` : ''} · עד ${slots} פגישות`;
            out.className = `capacity ${slots < students ? 'bad' : 'good'}`;
            out.title = slots < students ? `אין מספיק מקום ל-${students} תלמידים` : '';
        });
    }

    // שינוי אורכי האסיפה מעדכן את האפשרויות בכל כיתה
    function refreshClassChips() {
        const md = meetingDurs();
        $$('.class-row[data-class]', el).forEach(row => {
            const cur = $$('.cr-durs input:checked', row).map(i => +i.value);
            const keep = cur.filter(d => md.includes(d));
            row.querySelector('.cr-durs').innerHTML = chips('cd', md, keep.length ? keep : md);
        });
        capacity();
    }
    $('#mDurs', el).addEventListener('change', refreshClassChips);
    $('#addDur', el).onclick = () => {
        const v = parseInt($('#customDur', el).value, 10);
        if (!(v >= 1 && v <= 120)) return fail(new Error('אורך פגישה בין 1 ל-120 דקות'));
        const sel = meetingDurs();
        if (!options.includes(v)) options = [...options, v].sort((a, b) => a - b);
        $('#mDurs', el).innerHTML = chips('md', options, [...new Set([...sel, v])]);
        $('#customDur', el).value = '';
        refreshClassChips();
    };
    $('#mDate', el).oninput = e => {
        const h = hebrewDate(e.target.value);
        $('#mHeb', el).textContent = h;
        $('#headDate', el).textContent = h || 'תאריך האסיפה עוד לא נקבע';
    };
    const apply = $('#applyAll', el);
    if (apply) apply.onclick = () => {
        $$('.class-row[data-class]', el).forEach(row => {
            if (!row.querySelector('.cr-on').checked) return;
            row.querySelector('.cr-start').value = $('#allStart', el).value;
            row.querySelector('.cr-end').value = $('#allEnd', el).value;
        });
        dirty.v = true;
        capacity();
    };

    const save = async () => {
        const durations = meetingDurs();
        if (!durations.length) return fail(new Error('יש לבחור לפחות אורך פגישה אחד'));
        const classes = $$('.class-row[data-class]', el).filter(r => r.querySelector('.cr-on').checked).map(r => ({
            class_id: +r.dataset.class,
            start_time: r.querySelector('.cr-start').value,
            end_time: r.querySelector('.cr-end').value,
            durations: $$('.cr-durs input:checked', r).map(i => +i.value)
        }));
        try {
            const phoneStatus = ($('input[name=mPhone]:checked', el) || {}).value;
            await put(`/meetings/${id}`, { name: $('#mName', el).value, meeting_date: $('#mDate', el).value, notes: $('#mNotes', el).value, durations, classes,
                phone_status: phoneStatus, booking_closes_at: $('#mCloses', el).value });
            dirty.v = false;
            ok('האסיפה נשמרה');
            renderDetail(el, id);
        } catch (e) { fail(e); }
    };
    $('#btnSave', el).onclick = save;
    $('#btnSaveTop', el).onclick = save;
    $('#btnDelete', el).onclick = async () => {
        if (!await confirmDialog('מחיקת אסיפה', `למחוק את "${esc(m.name)}" עם כל ההגדרות שלה?`, { okLabel: 'מחיקה', danger: true })) return;
        try { await del(`/meetings/${id}`); ok('האסיפה נמחקה'); go('meetings'); } catch (e) { fail(e); }
    };

    // אזהרה ביציאה בלי שמירה
    const leave = e => {
        if (!dirty.v || !el.isConnected || !location.hash.startsWith('#meetings')) return;
        e.preventDefault();
        e.returnValue = '';
    };
    window.onbeforeunload = leave;
    capacity();
}

export const MeetingsView = {
    render(el, params) {
        window.onbeforeunload = null;
        return params.id ? renderDetail(el, +params.id) : renderList(el, params);
    }
};
