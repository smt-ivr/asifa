// ============================================================
//  client-settings.js — הגדרות המוסד, משתמשים, יומן שיחות וסיסמה
// ============================================================
(function () {
    const esc = App.esc;
    const ACTIONS = { call: 'שיחה נכנסת', book: 'קביעת תור', cancel: 'ביטול תור', absent: 'לא יגיע', link_phone: 'שמירת טלפון', bad_code: 'קוד שגוי' };

    async function general(el) {
        const s = await App.get('/settings');
        const apiUrl = `${location.origin}/asifa/api/yemot?tenant=${s.id}`;
        el.innerHTML = `<div class="grid grid-2">
            <div class="card"><div class="card-head"><h2>פרטי המוסד</h2></div><div class="card-body">
                <form id="f-settings" class="form-grid">
                    <label class="field full"><span>שם המוסד</span><input class="input" name="name" value="${esc(s.name)}"><small>מוקרא בפתיחת השיחה ומודפס בפתקים</small></label>
                    <label class="field full"><span>מספר הקו לקביעת תורים</span><input class="input ltr-input" name="line_number" value="${esc(s.line_number || '')}"><small>מודפס בפתקים ומשמש כמזוהה בצינתוק</small></label>
                    <label class="field full"><span>טוקן API של ימות המשיח</span><input class="input ltr-input" name="yemot_token" type="password" autocomplete="off" placeholder="${s.has_yemot_token ? '•••••••• (מוגדר — השאירו ריק כדי לא לשנות)' : 'מספר:סיסמה או טוקן'}"><small>נדרש לשליחת צינתוקים</small></label>
                    <label class="field"><span>מזוהה לצינתוק</span><input class="input ltr-input" name="tzintuk_caller_id" value="${esc(s.settings.tzintuk_caller_id || '')}" placeholder="ברירת מחדל: מספר הקו"></label>
                    <label class="field"><span>זמן צלצול (שניות)</span><input class="input" type="number" min="3" max="30" name="tzintuk_timeout" value="${esc(s.settings.tzintuk_timeout)}"></label>
                    <label class="field full"><span>כתובת API לצינתוק</span><input class="input ltr-input" name="tzintuk_url" value="${esc(s.settings.tzintuk_url)}"></label>
                    <label class="field full"><span>הודעה כשההרשמה נעולה</span><input class="input" name="office_note" value="${esc(s.settings.office_note || '')}" placeholder="לשינויים נא לפנות למזכירות"></label>
                    <label class="field full"><span>שורה בתחתית הפתקים</span><input class="input" name="print_footer" value="${esc(s.settings.print_footer || '')}"></label>
                    <div class="full"><button class="btn btn-primary" type="submit">שמירה</button></div>
                </form></div></div>
            <div class="card"><div class="card-head"><h2>הגדרת השלוחה בימות המשיח</h2></div><div class="card-body">
                <p style="margin-top:0">בשלוחה של הקו (ext.ini):</p>
                <pre class="input ltr-input" style="white-space:pre-wrap;font-family:monospace;font-size:.85rem;min-height:0;direction:ltr;text-align:left">type=api
api_link=${esc(apiUrl)}</pre>
                <button class="btn btn-sm" id="copy-api">העתקת הכתובת</button>
                <ul class="small muted"><li>ההורים מזוהים לפי המספר המזוהה. מספר לא מוכר מתבקש להקיש קוד תלמיד.</li>
                    <li>הצינתוקים יוצאים מ"מזוהה לצינתוק" (או ממספר הקו), כך שההורה רואה שיחה שלא נענתה ממספר הקו וחוזר אליו.</li></ul>
            </div></div></div>`;
        App.$('#copy-api').onclick = () => navigator.clipboard.writeText(apiUrl).then(() => App.ok('הועתק'));
        App.$('#f-settings').onsubmit = async e => {
            e.preventDefault();
            const d = App.formData(e.target);
            const body = { name: d.name, line_number: d.line_number, settings: { tzintuk_caller_id: d.tzintuk_caller_id, tzintuk_timeout: d.tzintuk_timeout, tzintuk_url: d.tzintuk_url, office_note: d.office_note, print_footer: d.print_footer } };
            if (d.yemot_token) body.yemot_token = d.yemot_token;
            try { await App.put('/settings', body); App.ok('ההגדרות נשמרו'); general(el); } catch (ex) { App.fail(ex); }
        };
    }

    async function users(el) {
        const [list, classes] = await Promise.all([App.get('/users'), App.classes()]);
        const form = (u = {}) => `<form class="form-grid">
            ${u.id ? '' : '<label class="field"><span>שם משתמש (באנגלית)</span><input class="input ltr-input" name="username" required></label>'}
            <label class="field"><span>שם לתצוגה</span><input class="input" name="display_name" value="${esc(u.display_name || '')}"></label>
            <label class="field"><span>תפקיד</span><select class="input" name="role"><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>מנהל / מזכירות</option><option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>מלמד (רואה רק את הכיתה שלו)</option></select></label>
            <label class="field"><span>כיתה (למלמד)</span><select class="input" name="class_id"><option value="">—</option>${classes.map(c => `<option value="${c.id}" ${u.class_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
            <label class="field"><span>${u.id ? 'סיסמה חדשה (ריק = ללא שינוי)' : 'סיסמה'}</span><input class="input ltr-input" type="password" name="password" autocomplete="new-password" ${u.id ? '' : 'required'}><small>לפחות 8 תווים</small></label>
            ${u.id ? `<label class="check" style="align-self:end"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}><span>פעיל</span></label>` : ''}
        </form>`;
        const read = m => { const d = App.formData(m.querySelector('form')); if (!d.password) delete d.password; d.class_id = d.class_id ? +d.class_id : null; return d; };
        el.innerHTML = `<div class="card"><div class="card-head"><h2>משתמשים</h2><button class="btn btn-primary" id="add-user">+ משתמש</button></div>
            <div class="table-wrap"><table class="table"><thead><tr><th>שם משתמש</th><th>שם</th><th>תפקיד</th><th>כניסה אחרונה</th><th></th></tr></thead>
            <tbody>${list.map(u => `<tr ${u.active ? '' : 'style="opacity:.55"'}><td class="ltr">${esc(u.username)}</td><td>${esc(u.display_name || '')}</td>
                <td>${u.role === 'teacher' ? `מלמד · ${esc((classes.find(c => c.id === u.class_id) || {}).name || '')}` : 'מנהל'}</td><td class="num small">${esc(u.last_login_at || '—')}</td>
                <td class="actions-cell"><button class="btn btn-sm" data-u="${u.id}">עריכה</button></td></tr>`).join('')}</tbody></table></div></div>`;
        App.$('#add-user').onclick = () => App.modal({ title: 'משתמש חדש', body: form(), wide: true,
            buttons: [{ label: 'שמירה', cls: 'btn-primary', action: async m => { await App.post('/users', read(m)); App.ok('המשתמש נוסף'); users(el); } }, { label: 'ביטול' }] });
        App.$$('[data-u]', el).forEach(b => b.onclick = () => {
            const u = list.find(x => x.id === +b.dataset.u);
            App.modal({ title: u.username, body: form(u), wide: true, buttons: [
                { label: 'שמירה', cls: 'btn-primary', action: async m => { await App.put(`/users/${u.id}`, read(m)); App.ok('נשמר'); users(el); } },
                { label: 'מחיקה', cls: 'btn-danger', action: async () => { if (!await App.confirm('מחיקת משתמש', `למחוק את ${esc(u.username)}?`, { danger: true, okLabel: 'מחיקה' })) return false; await App.del(`/users/${u.id}`); App.ok('נמחק'); users(el); } },
                { label: 'ביטול' }] });
        });
    }

    async function calls(el) {
        const list = await App.get('/calls');
        el.innerHTML = `<div class="card"><div class="card-head"><h2>יומן הקו הטלפוני</h2><span class="muted small">300 האחרונים</span></div>
            ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>מתי</th><th>טלפון</th><th>פעולה</th><th>תלמיד</th><th>פרטים</th></tr></thead>
            <tbody>${list.map(l => `<tr><td class="num small">${esc(l.created_at)}</td><td class="ltr">${App.phoneFmt(l.phone) || 'חסוי'}</td><td>${esc(ACTIONS[l.action] || l.action)}</td>
                <td>${l.first_name ? esc(App.fullName(l)) : ''}</td><td class="small muted">${esc(l.details || '')}</td></tr>`).join('')}</tbody></table></div>` : App.empty('עדיין אין שיחות')}</div>`;
    }

    function password(el) {
        el.innerHTML = `<div class="card" style="max-width:460px"><div class="card-head"><h2>שינוי סיסמה</h2></div><div class="card-body">
            <form id="f-pass" class="form-grid">
                <label class="field full"><span>סיסמה נוכחית</span><input class="input ltr-input" type="password" name="current" autocomplete="current-password" required></label>
                <label class="field full"><span>סיסמה חדשה</span><input class="input ltr-input" type="password" name="next" autocomplete="new-password" required><small>לפחות 8 תווים</small></label>
                <div class="full"><button class="btn btn-primary">שינוי</button></div></form></div></div>`;
        App.$('#f-pass').onsubmit = async e => {
            e.preventDefault();
            try { await App.post('/auth/password', App.formData(e.target)); App.ok('הסיסמה שונתה'); e.target.reset(); } catch (ex) { App.fail(ex); }
        };
    }

    const TABS = { general: ['כללי וקו טלפוני', general], users: ['משתמשים', users], calls: ['יומן שיחות', calls], password: ['הסיסמה שלי', password] };

    App.pages.settings = {
        title: 'הגדרות',
        roles: ['admin', 'super'],
        async render(el, params) {
            const tab = TABS[params.tab] ? params.tab : 'general';
            el.innerHTML = `<div class="page-head"><div><h1>הגדרות</h1></div></div>
                <div class="tabs">${Object.entries(TABS).map(([k, [label]]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${label}</button>`).join('')}</div>
                <div id="tab-body">${App.loading()}</div>`;
            App.$$('[data-tab]', el).forEach(b => b.onclick = () => App.go('settings', { tab: b.dataset.tab }));
            await TABS[tab][1](App.$('#tab-body'));
        }
    };
})();
