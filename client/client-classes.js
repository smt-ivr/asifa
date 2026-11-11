// ============================================================
//  client-classes.js — כיתות ומלמדים
//  שם המלמד ניתן לעדכון ישירות בטבלה (נשמר ביציאה מהשדה)
// ============================================================
import { get, post, put, del, esc, $, $$, modal, confirmDialog, ok, fail, emptyState, formData } from './client-app.js';

const form = (c = {}) => `<form class="form-grid">
    <label class="field"><span>שם הכיתה *</span><input class="input" name="name" required value="${esc(c.name || '')}" placeholder="כיתה א׳"></label>
    <label class="field"><span>שם מלא של המלמד</span><input class="input" name="teacher_name" value="${esc(c.teacher_name || '')}" placeholder="הרב משה כהן"></label>
    <label class="field"><span>סדר הצגה</span><input class="input" type="number" name="sort_order" value="${esc(c.sort_order ?? 0)}"><small>מספר קטן מוצג ראשון</small></label>
</form>`;

export const ClassesView = {
    async render(el) {
        const list = await get('/classes');
        const reload = () => ClassesView.render(el);
        el.innerHTML = `
            <div class="page-head">
                <div><h2><i class="fas fa-chalkboard-teacher"></i> כיתות ומלמדים</h2><p>כיתות נוצרות אוטומטית בייבוא תלמידים. לכל כיתה מכניסים את שם המלמד.</p></div>
                <div class="actions"><button class="btn btn-primary" id="btnAdd"><i class="fas fa-plus"></i> כיתה חדשה</button></div>
            </div>
            <div class="card flush">${list.length ? `<div class="table-container"><table class="modern-table">
                <thead><tr><th>כיתה</th><th style="width:40%">שם מלא של המלמד</th><th>תלמידים</th><th>סדר</th><th></th></tr></thead>
                <tbody>${list.map(c => `<tr data-id="${c.id}">
                    <td><b style="color:var(--text-strong)">${esc(c.name)}</b></td>
                    <td><input class="input teacher-inline" value="${esc(c.teacher_name || '')}" placeholder="הקלידו את שם המלמד"></td>
                    <td><a href="#students?class=${c.id}">${c.students}</a></td>
                    <td class="num">${c.sort_order}</td>
                    <td class="td-actions"><button class="icon-btn" data-edit title="עריכה"><i class="fas fa-pen"></i></button><button class="icon-btn danger" data-del title="מחיקה"><i class="fas fa-trash"></i></button></td>
                </tr>`).join('')}</tbody></table></div>`
                : emptyState('fa-chalkboard-teacher', 'אין עדיין כיתות', 'ייבוא תלמידים יוצר את הכיתות אוטומטית, או הוסיפו כיתה ידנית.',
                    '<a class="btn btn-secondary" href="#students?import=1"><i class="fas fa-file-excel"></i> ייבוא תלמידים</a>')}</div>`;

        $('#btnAdd', el).onclick = () => modal({
            title: 'כיתה חדשה', icon: 'fa-chalkboard-teacher', body: form(),
            buttons: [{ label: 'שמירה', cls: 'btn-primary', icon: 'fa-save', action: async m => { await post('/classes', formData($('form', m))); ok('הכיתה נוספה'); reload(); } }, { label: 'ביטול' }]
        });

        $$('.teacher-inline', el).forEach(inp => {
            const original = inp.value;
            inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
            inp.onblur = async () => {
                if (inp.value.trim() === original) return;
                try { await put(`/classes/${inp.closest('tr').dataset.id}`, { teacher_name: inp.value }); ok('שם המלמד נשמר'); reload(); }
                catch (e) { fail(e); }
            };
        });

        el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
            const c = list.find(x => x.id === +b.closest('tr').dataset.id);
            modal({ title: c.name, icon: 'fa-chalkboard-teacher', body: form(c),
                buttons: [{ label: 'שמירה', cls: 'btn-primary', icon: 'fa-save', action: async m => { await put(`/classes/${c.id}`, formData($('form', m))); ok('נשמר'); reload(); } }, { label: 'ביטול' }] });
        });
        el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
            const c = list.find(x => x.id === +b.closest('tr').dataset.id);
            if (!await confirmDialog('מחיקת כיתה', `למחוק את ${esc(c.name)}?`, { okLabel: 'מחיקה', danger: true })) return;
            try { await del(`/classes/${c.id}`); ok('הכיתה נמחקה'); reload(); } catch (e) { fail(e); }
        });
    }
};
