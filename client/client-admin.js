// ============================================================
//  client-admin.js — ניהול-על: מוסדות (לקוחות), מספרי חיוג, משתמש מנהל ראשון
// ============================================================
(function () {
    const esc = App.esc;

    const form = (t = {}) => `<form class="form-grid">
        <label class="field full"><span>שם המוסד</span><input class="input" name="name" required value="${esc(t.name || '')}"></label>
        <label class="field"><span>מספרי חיוג (ApiDID)</span><textarea class="input ltr-input" name="dids" rows="2" placeholder="0771234567">${esc((t.dids || []).join('\n'))}</textarea><small>המספרים שההורים מחייגים אליהם. מזהים את המוסד בשיחה</small></label>
        <label class="field"><span>מספר הקו להדפסה ולצינתוק</span><input class="input ltr-input" name="line_number" value="${esc(t.line_number || '')}" placeholder="ברירת מחדל: מספר החיוג הראשון"></label>
        <label class="field full"><span>טוקן ימות המשיח</span><input class="input ltr-input" type="password" name="yemot_token" autocomplete="off" placeholder="${t.has_yemot_token ? '•••••••• (מוגדר)' : 'מספר:סיסמה'}"></label>
        ${t.id ? `<label class="check full"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}><span>פעיל<small>מוסד לא פעיל: הקו מושבת והמשתמשים לא נכנסים</small></span></label>` : `
        <div class="full"><h3 style="margin-top:6px">משתמש מנהל למוסד</h3></div>
        <label class="field"><span>שם משתמש (באנגלית)</span><input class="input ltr-input" name="admin_username"></label>
        <label class="field"><span>סיסמה</span><input class="input ltr-input" name="admin_password" type="text" autocomplete="off"><small>לפחות 8 תווים</small></label>`}
    </form>`;

    const read = m => {
        const d = App.formData(m.querySelector('form'));
        d.dids = (d.dids || '').split(/[\s,;]+/).filter(Boolean);
        if (!d.yemot_token) delete d.yemot_token;
        return d;
    };

    async function render(el) {
        const list = await App.get('/tenants');
        el.innerHTML = `<div class="page-head"><div><h1>מוסדות</h1><p>כל מוסד הוא לקוח נפרד: נתונים, קו טלפוני ומשתמשים משלו</p></div>
            <div class="actions"><button class="btn btn-primary" id="add">+ מוסד חדש</button></div></div>
            <div class="card">${list.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>מוסד</th><th>מספרי חיוג</th><th>תלמידים</th><th>כיתות</th><th>אסיפות</th><th>ימות</th><th></th></tr></thead>
                <tbody>${list.map(t => `<tr ${t.active ? '' : 'style="opacity:.55"'}><td><b>${esc(t.name)}</b><div class="small faint">מזהה ${t.id}</div></td>
                    <td class="ltr small">${t.dids.map(App.phoneFmt).join('<br>') || '—'}</td><td class="num">${t.stats.students}</td><td class="num">${t.stats.classes}</td><td class="num">${t.stats.meetings}</td>
                    <td>${t.has_yemot_token ? '<span class="badge badge-success">מוגדר</span>' : '<span class="badge badge-warning">חסר טוקן</span>'}</td>
                    <td class="actions-cell"><button class="btn btn-sm btn-primary" data-enter="${t.id}">כניסה</button> <button class="btn btn-sm" data-edit="${t.id}">עריכה</button></td></tr>`).join('')}</tbody></table></div>`
                : App.empty('אין מוסדות', 'הוסיפו את המוסד הראשון שקנה את המערכת.')}</div>`;

        App.$('#add').onclick = () => App.modal({ title: 'מוסד חדש', body: form(), wide: true,
            buttons: [{ label: 'יצירה', cls: 'btn-primary', action: async m => { await App.post('/tenants', read(m)); App.ok('המוסד נוצר'); render(el); } }, { label: 'ביטול' }] });
        App.$$('[data-edit]', el).forEach(b => b.onclick = () => {
            const t = list.find(x => x.id === +b.dataset.edit);
            App.modal({ title: t.name, body: form(t), wide: true,
                buttons: [{ label: 'שמירה', cls: 'btn-primary', action: async m => { await App.put(`/tenants/${t.id}`, read(m)); App.ok('נשמר'); render(el); } }, { label: 'ביטול' }] });
        });
        App.$$('[data-enter]', el).forEach(b => b.onclick = () => {
            const t = list.find(x => x.id === +b.dataset.enter);
            App.setTenantOverride(t.id);
            App.cache.tenantName = t.name;
            App.renderShell();
            App.go('dashboard');
        });
    }

    App.pages.admin = { title: 'מוסדות', roles: ['super'], render };
})();
