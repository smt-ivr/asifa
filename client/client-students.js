// ============================================================
//  client-students.js — תלמידים: רשימה, הוספה/עריכה, טלפונים עם תיאור,
//  ייבוא מקובץ אקסל (עם התאמת עמודות) וייצוא לאקסל
// ============================================================
import { get, post, put, del, esc, fullName, phoneFmt, $, $$, modal, confirmDialog, ok, fail, notify, emptyState, go, formData } from './client-app.js';

const PHONE_LABELS = ['אב', 'אם', 'בית', 'סבא', 'סבתא', 'אפוטרופוס'];
const FIELDS = { ignore: 'לא לייבא', first_name: 'שם פרטי', last_name: 'שם משפחה', full_name: 'שם מלא (פרטי + משפחה)', class_name: 'כיתה', id_number: 'מספר זהות', father_name: 'שם האב', phone: 'טלפון' };

let classesCache = [];

// ---------- טופס תלמיד ----------
function phoneRow(p = {}) {
    return `<div class="phone-edit">
        <input class="input" name="ph_label" list="phoneLabels" placeholder="תיאור (אב / אם / בית)" value="${esc(p.label || '')}">
        <input class="input ltr-input" name="ph_phone" inputmode="tel" placeholder="050-0000000" value="${esc(p.phone || '')}">
        <button type="button" class="icon-btn danger" data-remove-phone title="הסרה"><i class="fas fa-times"></i></button></div>`;
}

function studentForm(s = {}) {
    const phones = s.phones && s.phones.length ? s.phones : [{ label: 'אב' }, { label: 'אם' }];
    return `<form class="form-grid">
        <label class="field"><span>שם פרטי *</span><input class="input" name="first_name" required value="${esc(s.first_name || '')}"></label>
        <label class="field"><span>שם משפחה</span><input class="input" name="last_name" value="${esc(s.last_name || '')}"></label>
        <label class="field"><span>כיתה</span><select class="input" name="class_id"><option value="">ללא כיתה</option>${classesCache.map(c => `<option value="${c.id}" ${s.class_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>שם האב</span><input class="input" name="father_name" value="${esc(s.father_name || '')}"></label>
        <label class="field"><span>מספר זהות</span><input class="input ltr-input" name="id_number" inputmode="numeric" value="${esc(s.id_number || '')}"><small>לא חובה</small></label>
        <div class="field full"><span>טלפונים</span>
            <div id="phonesBox">${phones.map(phoneRow).join('')}</div>
            <button type="button" class="btn btn-sm btn-outline" id="addPhone" style="align-self:flex-start"><i class="fas fa-plus"></i> טלפון נוסף</button>
        </div>
        <datalist id="phoneLabels">${PHONE_LABELS.map(l => `<option value="${l}">`).join('')}</datalist>
    </form>`;
}

function bindPhoneRows(m) {
    const box = $('#phonesBox', m);
    $('#addPhone', m).onclick = () => { box.insertAdjacentHTML('beforeend', phoneRow()); box.lastElementChild.querySelector('input').focus(); };
    box.addEventListener('click', e => { if (e.target.closest('[data-remove-phone]')) e.target.closest('.phone-edit').remove(); });
}

function readStudent(m) {
    const f = formData($('form', m));
    const phones = $$('.phone-edit', m).map(r => ({ label: r.querySelector('[name=ph_label]').value.trim(), phone: r.querySelector('[name=ph_phone]').value.trim() })).filter(p => p.phone);
    return { first_name: f.first_name, last_name: f.last_name, class_id: f.class_id ? +f.class_id : null, father_name: f.father_name, id_number: f.id_number, phones };
}

function openStudent(s, onDone) {
    modal({
        title: s ? fullName(s) : 'תלמיד חדש', icon: 'fa-user-graduate', body: studentForm(s || {}), wide: true, onOpen: bindPhoneRows,
        buttons: [
            { label: 'שמירה', cls: 'btn-primary', icon: 'fa-save', action: async m => {
                const body = readStudent(m);
                s ? await put(`/students/${s.id}`, body) : await post('/students', body);
                ok(s ? 'התלמיד עודכן' : 'התלמיד נוסף');
                onDone();
            } },
            ...(s ? [{ label: 'מחיקה', cls: 'btn-danger', icon: 'fa-trash', action: async () => {
                if (!await confirmDialog('מחיקת תלמיד', `למחוק את ${esc(fullName(s))}?`, { okLabel: 'מחיקה', danger: true })) return false;
                await del(`/students/${s.id}`); ok('התלמיד נמחק'); onDone();
            } }] : []),
            { label: 'ביטול' }
        ]
    });
}

// ---------- ייבוא ----------
function guessField(header) {
    const h = String(header || '').replace(/["'״׳.]/g, '').trim();
    if (/טל|נייד|פלאפון|סלולר|phone|מספר טלפון/i.test(h)) return 'phone';
    if (/זהות|^תז$|^ת ?ז$|id/i.test(h)) return 'id_number';
    if (/שם מלא/.test(h)) return 'full_name';
    if (/פרטי|^שם$|^שם התלמיד$|^שם תלמיד$/.test(h)) return 'first_name';
    if (/משפחה/.test(h)) return 'last_name';
    if (/כיתה|כתה|שיעור/.test(h)) return 'class_name';
    if (/אב|אבא/.test(h)) return 'father_name';
    return 'ignore';
}
const phoneLabelFrom = header => String(header || '').replace(/טלפון|טל'|טל|נייד|פלאפון|סלולרי|מספר|:/g, '').replace(/\s+/g, ' ').trim();

function sheetToRows(file) {
    return new Promise((resolve, reject) => {
        if (!window.XLSX) return reject(new Error('רכיב האקסל עדיין נטען, נסו שוב בעוד רגע'));
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                resolve(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).filter(r => r.some(c => String(c).trim())));
            } catch (er) { reject(new Error('לא ניתן לקרוא את הקובץ. ודאו שזה קובץ אקסל תקין')); }
        };
        reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
        reader.readAsArrayBuffer(file);
    });
}

function pasteToRows(text) {
    return text.split(/\r?\n/).map(l => l.split('\t')).filter(r => r.some(c => c.trim()));
}

function mappingStep(m, table, onImported) {
    if (table.length < 2) return fail(new Error('בקובץ צריכה להיות שורת כותרות ולפחות שורת תלמיד אחת'));
    const headers = table[0].map((h, i) => String(h || '').trim() || `עמודה ${i + 1}`);
    const data = table.slice(1);
    const body = $('.modal-body', m);
    body.innerHTML = `
        <div class="notice"><i class="fas fa-info-circle"></i><span>נמצאו <b>${data.length}</b> שורות. בדקו לכל עמודה מה היא מכילה. בעמודות טלפון — התיאור (אב / אם / בית) נלקח מהכותרת וניתן לשנות.</span></div>
        <div class="table-container"><table class="modern-table map-table">
            <thead><tr><th>עמודה בקובץ</th><th>מה זה</th><th>תיאור הטלפון</th><th>דוגמה</th></tr></thead>
            <tbody>${headers.map((h, i) => {
                const g = guessField(h);
                return `<tr data-col="${i}"><td><b style="color:var(--text-strong)">${esc(h)}</b></td>
                    <td><select class="input map-field">${Object.entries(FIELDS).map(([k, v]) => `<option value="${k}" ${k === g ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
                    <td><input class="input map-label" value="${esc(g === 'phone' ? phoneLabelFrom(h) : '')}" ${g === 'phone' ? '' : 'disabled'} placeholder="אב / אם / בית"></td>
                    <td>${esc(data.slice(0, 3).map(r => r[i]).filter(Boolean).join(' · '))}</td></tr>`;
            }).join('')}</tbody></table></div>
        <p class="text-muted" style="margin-top:10px">תלמיד שכבר קיים (לפי מספר זהות, או שם + משפחה + כיתה) יתעדכן ולא יוכפל. כיתה שלא קיימת תיווצר.</p>`;
    $$('.map-field', body).forEach(sel => sel.onchange = () => {
        const lbl = sel.closest('tr').querySelector('.map-label');
        lbl.disabled = sel.value !== 'phone';
        if (sel.value === 'phone' && !lbl.value) lbl.value = phoneLabelFrom(headers[+sel.closest('tr').dataset.col]);
    });

    const footer = $('.modal-footer', m);
    footer.innerHTML = '<button class="btn btn-primary" id="doImport"><i class="fas fa-file-import"></i> ייבוא</button><button class="btn btn-outline" id="cancelImport">ביטול</button>';
    $('#cancelImport', m).onclick = () => m.remove();
    $('#doImport', m).onclick = async () => {
        const map = $$('tr[data-col]', body).map(tr => ({ col: +tr.dataset.col, field: tr.querySelector('.map-field').value, label: tr.querySelector('.map-label').value.trim() }));
        const has = f => map.some(x => x.field === f);
        if (!has('first_name') && !has('full_name')) return fail(new Error('יש לסמן איזו עמודה היא "שם פרטי" (או "שם מלא")'));
        const rows = data.map(r => {
            const o = { phones: [] };
            for (const x of map) {
                const v = String(r[x.col] ?? '').trim();
                if (!v || x.field === 'ignore') continue;
                if (x.field === 'phone') o.phones.push({ label: x.label, phone: v });
                else if (x.field === 'full_name') { const [first, ...rest] = v.split(/\s+/); o.first_name = o.first_name || first; o.last_name = o.last_name || rest.join(' '); }
                else o[x.field] = v;
            }
            return o;
        });
        const btn = $('#doImport', m);
        btn.disabled = true;
        const total = { created: 0, updated: 0, classes_created: 0, errors: [] };
        try {
            for (let i = 0; i < rows.length; i += 400) {
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> מייבא ${Math.min(i + 400, rows.length)}/${rows.length}`;
                const r = await post('/students/import', { rows: rows.slice(i, i + 400) });
                total.created += r.created; total.updated += r.updated; total.classes_created += r.classes_created;
                total.errors.push(...r.errors.map(e => ({ ...e, row: e.row + i + 1 })));
            }
            m.remove();
            ok(`נוספו ${total.created} תלמידים, עודכנו ${total.updated}${total.classes_created ? `, נוצרו ${total.classes_created} כיתות` : ''}`);
            if (total.errors.length) modal({ title: 'שורות שלא יובאו', icon: 'fa-exclamation-triangle',
                body: `<ul style="margin-right:18px">${total.errors.slice(0, 100).map(e => `<li>שורה ${e.row}: ${esc(e.message)}</li>`).join('')}</ul>`, buttons: [{ label: 'סגירה' }] });
            onImported();
        } catch (e) {
            fail(e);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-file-import"></i> ייבוא';
        }
    };
}

function openImport(onImported) {
    const { el: m } = modal({
        title: 'ייבוא תלמידים מאקסל', icon: 'fa-file-excel', wide: true,
        body: `<label class="import-drop" id="dropZone"><i class="fas fa-cloud-upload-alt"></i><b>בחרו קובץ אקסל</b> או גררו אותו לכאן
                <div class="text-muted" style="margin-top:6px">xlsx · xls · csv — השורה הראשונה היא שורת הכותרות</div>
                <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" hidden></label>
            <details style="margin-top:14px"><summary style="cursor:pointer;color:var(--primary-color)">או הדביקו ישירות מאקסל</summary>
                <textarea class="input" id="pasteBox" rows="6" style="margin-top:8px" placeholder="העתיקו מאקסל כולל שורת הכותרות והדביקו כאן"></textarea>
                <button class="btn btn-sm btn-secondary" id="pasteGo" style="margin-top:6px">המשך</button></details>
            <div class="notice" style="margin-top:14px"><i class="fas fa-lightbulb"></i><span>עמודות מומלצות: שם פרטי · שם משפחה · כיתה · מספר זהות · שם האב · ועמודת טלפון לכל מספר (למשל "טלפון אב", "טלפון אם", "טלפון בית").</span></div>`,
        buttons: [{ label: 'ביטול' }]
    });
    const handle = async file => {
        try { mappingStep(m, await sheetToRows(file), onImported); } catch (e) { fail(e); }
    };
    $('#fileInput', m).onchange = e => e.target.files[0] && handle(e.target.files[0]);
    const zone = $('#dropZone', m);
    zone.ondragover = e => { e.preventDefault(); zone.classList.add('over'); };
    zone.ondragleave = () => zone.classList.remove('over');
    zone.ondrop = e => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); };
    $('#pasteGo', m).onclick = () => mappingStep(m, pasteToRows($('#pasteBox', m).value), onImported);
}

function exportExcel(list) {
    if (!window.XLSX) return fail(new Error('רכיב האקסל עדיין נטען'));
    const labels = [];
    for (const s of list) s.phones.forEach((p, i) => { const l = p.label || `טלפון ${i + 1}`; if (!labels.includes(l)) labels.push(l); });
    const head = ['שם פרטי', 'שם משפחה', 'כיתה', 'מספר זהות', 'שם האב', ...labels.map(l => l.startsWith('טלפון') ? l : `טלפון ${l}`)];
    const rows = list.map(s => [s.first_name, s.last_name, s.class_name || '', s.id_number || '', s.father_name || '',
        ...labels.map((l, i) => { const p = s.phones.find((x, j) => (x.label || `טלפון ${j + 1}`) === l); return p ? p.phone : ''; })]);
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = head.map(() => ({ wch: 14 }));
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, 'תלמידים');
    XLSX.writeFile(wb, 'תלמידים.xlsx');
}

// ---------- מסך ----------
export const StudentsView = {
    async render(el, params) {
        const [list, classes] = await Promise.all([get('/students'), get('/classes')]);
        classesCache = classes;
        const reload = () => StudentsView.render(el, { class: $('#fClass', el) ? $('#fClass', el).value : params.class });

        el.innerHTML = `
            <div class="page-head">
                <div><h2><i class="fas fa-user-graduate"></i> תלמידים</h2><p>${list.length} תלמידים ב-${classes.length} כיתות</p></div>
                <div class="actions">
                    <button class="btn btn-outline" id="btnExport" ${list.length ? '' : 'disabled'}><i class="fas fa-file-download"></i> ייצוא לאקסל</button>
                    <button class="btn btn-secondary" id="btnImport"><i class="fas fa-file-excel"></i> ייבוא מאקסל</button>
                    <button class="btn btn-primary" id="btnAdd"><i class="fas fa-plus"></i> תלמיד חדש</button>
                </div>
            </div>
            <div class="card">
                <div class="toolbar">
                    <div class="search-box"><i class="fas fa-search"></i><input class="input" id="fSearch" placeholder="חיפוש שם, ת.ז או טלפון"></div>
                    <select class="input" id="fClass" style="width:auto"><option value="">כל הכיתות</option>${classes.map(c => `<option value="${c.id}" ${+params.class === c.id ? 'selected' : ''}>${esc(c.name)} (${c.students})</option>`).join('')}</select>
                    <label class="check"><input type="checkbox" id="fNoPhone" ${params.filter === 'no_phone' ? 'checked' : ''}> ללא טלפון בלבד</label>
                    <div style="flex:1"></div>
                    <span class="text-muted" id="countLabel"></span>
                    <button class="btn btn-danger hidden" id="btnDeleteSel"><i class="fas fa-trash"></i> מחיקת המסומנים</button>
                </div>
            </div>
            <div class="card flush">${list.length ? `<div class="table-container"><table class="modern-table">
                <thead><tr><th style="width:30px"><input type="checkbox" id="selAll"></th><th>שם פרטי</th><th>שם משפחה</th><th>כיתה</th><th>שם האב</th><th>ת.ז</th><th>טלפונים</th><th></th></tr></thead>
                <tbody id="rows">${list.map(s => `<tr data-id="${s.id}" data-class="${s.class_id || ''}" data-nophone="${s.phones.length ? 0 : 1}"
                        data-q="${esc(`${s.first_name} ${s.last_name} ${s.id_number || ''} ${s.father_name || ''} ${s.phones.map(p => p.phone).join(' ')}`)}">
                    <td><input type="checkbox" class="sel"></td>
                    <td><b style="color:var(--text-strong)">${esc(s.first_name)}</b></td><td>${esc(s.last_name)}</td>
                    <td>${s.class_name ? esc(s.class_name) : '<span class="badge badge-warning">ללא</span>'}</td>
                    <td>${esc(s.father_name || '')}</td><td class="num">${esc(s.id_number || '')}</td>
                    <td>${s.phones.map(p => `<div class="phone-line"><span class="ltr num">${phoneFmt(p.phone)}</span>${p.label ? `<span class="lbl">${esc(p.label)}</span>` : ''}</div>`).join('') || '<span class="badge badge-warning">חסר</span>'}</td>
                    <td class="td-actions"><button class="icon-btn" data-edit title="עריכה"><i class="fas fa-pen"></i></button></td></tr>`).join('')}</tbody>
            </table></div>` : emptyState('fa-user-graduate', 'אין עדיין תלמידים', 'מייבאים מקובץ אקסל או מוסיפים ידנית. הכיתות נוצרות אוטומטית.',
                '<button class="btn btn-primary" data-act="import"><i class="fas fa-file-excel"></i> ייבוא מאקסל</button>')}</div>`;

        const applyFilter = () => {
            const q = $('#fSearch', el).value.trim(), cls = $('#fClass', el).value, np = $('#fNoPhone', el).checked;
            let n = 0;
            $$('#rows tr', el).forEach(tr => {
                const show = (!q || tr.dataset.q.includes(q)) && (!cls || tr.dataset.class === cls) && (!np || tr.dataset.nophone === '1');
                tr.classList.toggle('hidden', !show);
                if (show) n++;
            });
            $('#countLabel', el).textContent = list.length ? `מוצגים ${n}` : '';
        };
        const updateSel = () => {
            const sel = $$('#rows tr:not(.hidden) .sel:checked', el);
            $$('#rows tr', el).forEach(tr => tr.classList.toggle('selected', tr.querySelector('.sel').checked));
            $('#btnDeleteSel', el).classList.toggle('hidden', !sel.length);
            $('#btnDeleteSel', el).innerHTML = `<i class="fas fa-trash"></i> מחיקת ${sel.length} מסומנים`;
        };
        $('#fSearch', el).oninput = applyFilter;
        $('#fClass', el).onchange = applyFilter;
        $('#fNoPhone', el).onchange = applyFilter;
        applyFilter();

        if (list.length) {
            $('#selAll', el).onchange = e => { $$('#rows tr:not(.hidden) .sel', el).forEach(c => { c.checked = e.target.checked; }); updateSel(); };
            $('#rows', el).addEventListener('change', e => { if (e.target.classList.contains('sel')) updateSel(); });
            $('#rows', el).addEventListener('click', e => {
                if (!e.target.closest('[data-edit]')) return;
                openStudent(list.find(s => s.id === +e.target.closest('tr').dataset.id), reload);
            });
        }
        $('#btnDeleteSel', el).onclick = async () => {
            const ids = $$('#rows tr:not(.hidden) .sel:checked', el).map(c => +c.closest('tr').dataset.id);
            if (!await confirmDialog('מחיקת תלמידים', `למחוק ${ids.length} תלמידים? לא ניתן לשחזר.`, { okLabel: 'מחיקה', danger: true })) return;
            try { await post('/students/delete', { ids }); ok(`נמחקו ${ids.length} תלמידים`); reload(); } catch (e) { fail(e); }
        };
        $('#btnAdd', el).onclick = () => openStudent(null, reload);
        $('#btnImport', el).onclick = () => openImport(reload);
        const imp = $('[data-act=import]', el);
        if (imp) imp.onclick = () => openImport(reload);
        $('#btnExport', el).onclick = () => {
            const visible = new Set($$('#rows tr:not(.hidden)', el).map(tr => +tr.dataset.id));
            exportExcel(list.filter(s => visible.has(s.id)));
        };

        if (params.import) { history.replaceState(null, '', '#students'); openImport(reload); }
        if (params.new) { history.replaceState(null, '', '#students'); openStudent(null, reload); }
    }
};
