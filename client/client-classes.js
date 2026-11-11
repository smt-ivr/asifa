// ============================================================
//  client-classes.js — כיתות ומלמדים
// ============================================================
(function () {
    const esc = App.esc;

    const form = (c = {}) => `<form class="form-grid">
        <label class="field"><span>שם הכיתה</span><input class="input" name="name" required value="${esc(c.name || '')}" placeholder="כיתה א'"></label>
        <label class="field"><span>שם המלמד</span><input class="input" name="teacher_name" value="${esc(c.teacher_name || '')}" placeholder="ר' משה כהן"><small>מוקרא להורים בטלפון</small></label>
        <label class="field"><span>טלפון המלמד</span><input class="input ltr-input" name="teacher_phone" value="${esc(c.teacher_phone || '')}"></label>
        <label class="field"><span>מיקום האסיפה</span><input class="input" name="location" value="${esc(c.location || '')}" placeholder="חדר 4, קומה ב"></label>
        <label class="field"><span>סדר תצוגה</span><input class="input" type="number" name="sort_order" value="${esc(c.sort_order ?? 0)}"></label>
        ${c.id ? `<label class="check" style="align-self:end"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}><span>פעילה</span></label>` : ''}
    </form>`;

    async function render(el) {
        const list = await App.classes(true);
        el.innerHTML = `<div class="page-head"><div><h1>כיתות ומלמדים</h1><p>שם המלמד מוקרא להורים בטלפון ומודפס בפתקים</p></div>
            <div class="actions"><button class="btn btn-primary" id="add">+ כיתה</button></div></div>
            <div class="card">${list.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>כיתה</th><th>מלמד</th><th>טלפון</th><th>מיקום</th><th>תלמידים</th><th></th></tr></thead>
                <tbody>${list.map(c => `<tr ${c.active ? '' : 'style="opacity:.55"'}><td><b>${esc(c.name)}</b>${c.active ? '' : ' <span class="badge">לא פעילה</span>'}</td><td>${esc(c.teacher_name || '')}</td>
                    <td><span class="ltr">${App.phoneFmt(c.teacher_phone)}</span></td><td>${esc(c.location || '')}</td>
                    <td><a href="#/students?class=${c.id}">${c.students}</a></td>
                    <td class="actions-cell"><button class="btn btn-sm" data-edit="${c.id}">עריכה</button></td></tr>`).join('')}</tbody></table></div>`
                : App.empty('אין כיתות', 'הוסיפו את כיתות המוסד והמלמדים, או ייבאו תלמידים מאקסל והכיתות ייווצרו אוטומטית.')}</div>`;

        const done = msg => { App.cache.classes = null; App.ok(msg); render(el); };
        App.$('#add').onclick = () => App.modal({
            title: 'כיתה חדשה', body: form(), wide: true,
            buttons: [{ label: 'שמירה', cls: 'btn-primary', action: async m => { await App.post('/classes', App.formData(m.querySelector('form'))); done('הכיתה נוספה'); } }, { label: 'ביטול' }]
        });
        App.$$('[data-edit]', el).forEach(b => b.onclick = () => {
            const c = list.find(x => x.id === +b.dataset.edit);
            App.modal({
                title: c.name, body: form(c), wide: true,
                buttons: [
                    { label: 'שמירה', cls: 'btn-primary', action: async m => { await App.put(`/classes/${c.id}`, App.formData(m.querySelector('form'))); done('נשמר'); } },
                    { label: 'מחיקה', cls: 'btn-danger', action: async () => {
                        if (!await App.confirm('מחיקת כיתה', `למחוק את ${esc(c.name)}?`, { okLabel: 'מחיקה', danger: true })) return false;
                        await App.del(`/classes/${c.id}`); done('הכיתה נמחקה');
                    } },
                    { label: 'ביטול' }
                ]
            });
        });
    }

    App.pages.classes = { title: 'כיתות', roles: ['admin', 'super'], render };
})();
