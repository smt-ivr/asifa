// ============================================================
//  client-students.js — תלמידים וטלפוני הורים, ייבוא מאקסל וייצוא
// ============================================================
(function () {
    const esc = App.esc;
    const IMPORT_COLS = ['קוד תלמיד', 'שם פרטי', 'שם משפחה', 'שם האב', 'כיתה', 'טלפון 1', 'טלפון 2', 'טלפון 3'];

    function studentForm(s, classes) {
        return `<form class="form-grid">
            <label class="field"><span>שם פרטי</span><input class="input" name="first_name" required value="${esc(s.first_name || '')}"></label>
            <label class="field"><span>שם משפחה</span><input class="input" name="last_name" value="${esc(s.last_name || '')}"></label>
            <label class="field"><span>שם האב</span><input class="input" name="father_name" value="${esc(s.father_name || '')}"></label>
            <label class="field"><span>כיתה</span><select class="input" name="class_id"><option value="">ללא</option>${classes.map(c => `<option value="${c.id}" ${s.class_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
            <label class="field"><span>קוד תלמיד</span><input class="input ltr-input" name="code" inputmode="numeric" value="${esc(s.code || '')}" placeholder="אוטומטי"><small>ההורה מקיש אותו בטלפון אם המספר שלו לא רשום</small></label>
            <label class="field"><span>טלפוני הורים</span><textarea class="input ltr-input" name="phones" rows="3" placeholder="0501234567&#10;0527654321">${esc((s.phones || []).join('\n'))}</textarea><small>מספר בכל שורה. כל הילדים עם אותו מספר = משפחה אחת</small></label>
            ${s.id ? `<label class="check full"><input type="checkbox" name="active" ${s.active !== 0 ? 'checked' : ''}><span>פעיל</span></label>` : ''}
        </form>`;
    }

    function readForm(modal) {
        const d = App.formData(modal.querySelector('form'));
        return { ...d, class_id: d.class_id ? +d.class_id : null, phones: d.phones.split(/[\s,;]+/).filter(Boolean) };
    }

    function parsePaste(text) {
        const lines = text.split(/\r?\n/).map(l => l.split('\t').map(c => c.trim())).filter(r => r.some(Boolean));
        if (lines.length && /קוד|שם|כיתה/.test(lines[0].join(' '))) lines.shift();
        return lines.map(c => ({ code: c[0] || '', first_name: c[1] || '', last_name: c[2] || '', father_name: c[3] || '', class_name: c[4] || '', phones: c.slice(5).filter(Boolean) }));
    }

    function csv(rows) {
        const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
    }

    async function render(el, params) {
        const classes = await App.classes(true);
        const classId = params.class || '';
        const list = await App.get(`/students${classId ? `?class_id=${classId}` : ''}`);
        const noPhone = list.filter(s => !s.phones.length).length;

        el.innerHTML = `
            <div class="page-head"><div><h1>תלמידים והורים</h1><p>${list.length} תלמידים${noPhone ? ` · <span style="color:var(--warning)">${noPhone} ללא טלפון הורה</span>` : ''}</p></div>
                <div class="actions"><button class="btn" id="export">ייצוא לאקסל</button><button class="btn" id="import">ייבוא מאקסל</button><button class="btn btn-primary" id="add">+ תלמיד</button></div></div>
            <div class="card">
                <div class="card-head"><div class="toolbar">
                    <select class="input" id="f-class"><option value="">כל הכיתות</option>${classes.map(c => `<option value="${c.id}" ${+classId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
                    <input class="input" id="f-search" placeholder="חיפוש שם, קוד או טלפון">
                </div></div>
                ${list.length ? `<div class="table-wrap"><table class="table">
                    <thead><tr><th>קוד</th><th>שם</th><th>שם האב</th><th>כיתה</th><th>טלפוני הורים</th><th></th></tr></thead>
                    <tbody id="rows">${list.map(s => `<tr data-id="${s.id}" data-q="${esc(`${s.code} ${s.first_name} ${s.last_name} ${s.father_name || ''} ${s.phones.join(' ')}`)}" ${s.active ? '' : 'style="opacity:.55"'}>
                        <td class="num">${esc(s.code)}</td><td><b>${esc(App.fullName(s))}</b>${s.active ? '' : ' <span class="badge">לא פעיל</span>'}</td>
                        <td>${esc(s.father_name || '')}</td><td>${esc(s.class_name || '—')}</td>
                        <td>${s.phones.map(p => `<span class="ltr">${App.phoneFmt(p)}</span>`).join('<br>') || '<span class="badge badge-warning">חסר</span>'}</td>
                        <td class="actions-cell"><button class="btn btn-sm" data-edit="${s.id}">עריכה</button></td></tr>`).join('')}</tbody></table></div>`
                : App.empty('אין תלמידים', 'הוסיפו תלמידים אחד-אחד או ייבאו מאקסל בהדבקה.')}
            </div>`;

        App.$('#f-class').onchange = e => App.go('students', e.target.value ? { class: e.target.value } : undefined);
        App.$('#f-search').oninput = e => {
            const q = e.target.value.trim();
            App.$$('#rows tr', el).forEach(tr => tr.classList.toggle('hidden', !!q && !tr.dataset.q.includes(q)));
        };
        const reload = () => render(el, params);

        App.$('#add').onclick = () => App.modal({
            title: 'תלמיד חדש', body: studentForm({ class_id: +classId || null }, classes), wide: true,
            buttons: [{ label: 'שמירה', cls: 'btn-primary', action: async m => { await App.post('/students', readForm(m)); App.ok('התלמיד נוסף'); reload(); } }, { label: 'ביטול' }]
        });

        App.$$('[data-edit]', el).forEach(b => b.onclick = () => {
            const s = list.find(x => x.id === +b.dataset.edit);
            App.modal({
                title: App.fullName(s), body: studentForm(s, classes), wide: true,
                buttons: [
                    { label: 'שמירה', cls: 'btn-primary', action: async m => { await App.put(`/students/${s.id}`, readForm(m)); App.ok('נשמר'); reload(); } },
                    { label: 'מחיקה', cls: 'btn-danger', action: async () => {
                        if (!await App.confirm('מחיקת תלמיד', `למחוק את ${esc(App.fullName(s))} כולל התורים שלו? אפשר במקום זה לסמן "לא פעיל".`, { okLabel: 'מחיקה', danger: true })) return false;
                        await App.del(`/students/${s.id}`); App.ok('נמחק'); reload();
                    } },
                    { label: 'ביטול' }
                ]
            });
        });

        App.$('#export').onclick = () => {
            const rows = [IMPORT_COLS, ...list.map(s => [s.code, s.first_name, s.last_name, s.father_name || '', s.class_name || '', ...s.phones])];
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }));
            a.download = 'תלמידים.csv';
            a.click();
        };

        App.$('#import').onclick = () => App.modal({
            title: 'ייבוא תלמידים מאקסל', wide: true,
            body: `<p style="margin-top:0">העתיקו מאקסל את העמודות לפי הסדר הזה והדביקו כאן (שורת כותרת תדלג אוטומטית):</p>
                <div class="table-wrap" style="margin-bottom:12px"><table class="table"><thead><tr>${IMPORT_COLS.map(c => `<th>${c}</th>`).join('')}</tr></thead></table></div>
                <form><textarea class="input" name="paste" rows="10" placeholder="הדביקו כאן…" style="direction:rtl"></textarea>
                <div id="import-preview" class="small muted" style="margin:8px 0"></div>
                <label class="check"><input type="checkbox" name="replace_phones"><span>להחליף טלפונים קיימים<small>אחרת הטלפונים מתווספים לקיימים</small></span></label></form>
                <ul class="small muted"><li>קוד קיים — התלמיד יעודכן. קוד ריק — ייווצר קוד חדש.</li><li>כיתה שלא קיימת תיווצר אוטומטית.</li></ul>`,
            onOpen: m => { m.querySelector('textarea').oninput = e => { m.querySelector('#import-preview').textContent = `${parsePaste(e.target.value).length} שורות לייבוא`; }; },
            buttons: [{ label: 'ייבוא', cls: 'btn-primary', action: async m => {
                const rows = parsePaste(m.querySelector('textarea').value);
                if (!rows.length) throw new Error('לא הודבקו שורות');
                const r = await App.post('/students/import', { rows, replace_phones: m.querySelector('[name=replace_phones]').checked });
                App.cache.classes = null;
                App.ok(`נוספו ${r.created}, עודכנו ${r.updated}`);
                if (r.errors.length) App.modal({ title: 'שורות שלא יובאו', body: `<ul>${r.errors.map(e => `<li>שורה ${e.line}: ${esc(e.message)}</li>`).join('')}</ul>` });
                reload();
            } }, { label: 'ביטול' }]
        });
    }

    App.pages.students = { title: 'תלמידים', roles: ['admin', 'super'], render };
})();
