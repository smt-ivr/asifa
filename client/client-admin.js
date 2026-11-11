// ============================================================
//  client-admin.js — ניהול-על: מוסדות, הרשאות כניסה (משתמשים / IP) והיסטוריית כניסות
//  #admin                 רשימת מוסדות
//  #admin?tenant=:id      הרשאות של מוסד
//  #admin?tab=super       הרשאות מנהל-על      #admin?tab=log   היסטוריית כניסות
// ============================================================
import { get, post, put, del, esc, $, $$, modal, confirmDialog, ok, fail, emptyState, go, enterTenant, formData } from './client-app.js';

const tabs = active => `<div class="toolbar" style="margin-bottom:12px">
    <a class="btn ${active === 'tenants' ? 'btn-primary' : 'btn-outline'}" href="#admin"><i class="fas fa-school"></i> מוסדות</a>
    <a class="btn ${active === 'super' ? 'btn-primary' : 'btn-outline'}" href="#admin?tab=super"><i class="fas fa-user-shield"></i> הרשאות מנהל-על</a>
    <a class="btn ${active === 'log' ? 'btn-primary' : 'btn-outline'}" href="#admin?tab=log"><i class="fas fa-history"></i> היסטוריית כניסות</a>
    <a class="btn ${active === 'settings' ? 'btn-primary' : 'btn-outline'}" href="#admin?tab=settings"><i class="fas fa-cog"></i> הגדרות ומיילים</a></div>`;

function tenantForm(t = {}) {
    return `<form class="form-grid">
        <label class="field full"><span>שם המוסד</span><input class="input" name="name" required value="${esc(t.name || '')}" placeholder="חיידר בת עין"></label>
        <label class="check full"><input type="checkbox" name="active" ${t.active === false ? '' : 'checked'}> פעיל</label>
        <label class="field full"><span>הגדרות הקו הטלפוני</span><select class="input" name="phone_managed_by">
            <option value="super" ${t.phone_managed_by !== 'tenant' ? 'selected' : ''}>אני מגדיר להם את הטלפון (המוסד לא רואה את ההגדרות)</option>
            <option value="tenant" ${t.phone_managed_by === 'tenant' ? 'selected' : ''}>למוסד יש גישה להגדרות הטלפון</option></select></label>
    </form>`;
}

async function renderTenants(el) {
    const list = await get('/admin/tenants');
    const reload = () => renderTenants(el);
    el.innerHTML = `${tabs('tenants')}
        <div class="page-head">
            <div><h2><i class="fas fa-school"></i> מוסדות</h2><p>כל מוסד מקבל טבלאות נפרדות משלו במסד (מתחילות במזהה שלו)</p></div>
            <div class="actions"><button class="btn btn-primary" id="btnNew"><i class="fas fa-plus"></i> מוסד חדש</button></div>
        </div>
        <div class="card flush">${list.length ? `<div class="table-container"><table class="modern-table">
            <thead><tr><th>מוסד</th><th>מצב</th><th>טבלאות</th><th>תלמידים</th><th>כיתות</th><th>אסיפות</th><th>הרשאות כניסה</th><th></th></tr></thead>
            <tbody>${list.map(t => `<tr data-id="${t.id}">
                <td><b style="color:var(--text-strong)">${esc(t.name)}</b></td>
                <td>${t.active ? '<span class="badge badge-success">פעיל</span>' : '<span class="badge badge-danger">לא פעיל</span>'}
                    <div class="text-muted" style="margin-top:3px"><i class="fas fa-phone-alt"></i> ${t.phone_managed_by === 'tenant' ? 'המוסד מנהל' : 'אני מנהל'}</div></td>
                <td><code class="ltr">${esc(t.tables_prefix)}*</code></td>
                <td class="num">${t.stats.students}</td><td class="num">${t.stats.classes}</td><td class="num">${t.stats.meetings}</td>
                <td>${t.access.users + t.access.ips ? `${t.access.users} משתמשים · ${t.access.ips} IP` : '<span class="badge badge-warning">אין — לא ניתן להיכנס</span>'}</td>
                <td class="td-actions">
                    <a class="btn btn-sm btn-secondary" href="#admin?tenant=${t.id}"><i class="fas fa-key"></i> הרשאות</a>
                    <button class="btn btn-sm btn-outline" data-enter><i class="fas fa-sign-in-alt"></i> כניסה</button>
                    <button class="icon-btn" data-edit title="עריכה"><i class="fas fa-pen"></i></button>
                    <button class="icon-btn danger" data-del title="מחיקה"><i class="fas fa-trash"></i></button></td></tr>`).join('')}</tbody></table></div>`
            : emptyState('fa-school', 'אין עדיין מוסדות', 'מוסיפים מוסד (שם בלבד), ואחר כך מגדירים לו שם משתמש או כתובת IP לכניסה.', '<button class="btn btn-primary" data-new><i class="fas fa-plus"></i> מוסד חדש</button>')}</div>`;

    const openNew = () => modal({
        title: 'מוסד חדש', icon: 'fa-school', body: tenantForm(),
        buttons: [{ label: 'יצירה', cls: 'btn-primary', icon: 'fa-check', action: async m => {
            const f = formData($('form', m));
            const t = await post('/admin/tenants', f);
            ok(`המוסד נוצר (טבלאות ${t.tables_prefix}). עכשיו מוסיפים לו הרשאת כניסה`);
            go('admin', { tenant: t.id });
        } }, { label: 'ביטול' }]
    });
    $('#btnNew', el).onclick = openNew;
    const n = $('[data-new]', el);
    if (n) n.onclick = openNew;

    const row = b => list.find(t => t.id === +b.closest('tr').dataset.id);
    $$('[data-enter]', el).forEach(b => b.onclick = () => enterTenant({ id: row(b).id, name: row(b).name }));
    $$('[data-edit]', el).forEach(b => b.onclick = () => {
        const t = row(b);
        modal({ title: t.name, icon: 'fa-school', body: tenantForm(t),
            buttons: [{ label: 'שמירה', cls: 'btn-primary', icon: 'fa-save', action: async m => { await put(`/admin/tenants/${t.id}`, formData($('form', m))); ok('נשמר'); reload(); } }, { label: 'ביטול' }] });
    });
    $$('[data-del]', el).forEach(b => b.onclick = () => {
        const t = row(b);
        modal({
            title: `מחיקת ${t.name}`, icon: 'fa-exclamation-triangle',
            body: `<p>המחיקה תמחק את המוסד, את כל ההרשאות שלו ואת <b>כל הטבלאות שלו</b> (${t.stats.students} תלמידים, ${t.stats.classes} כיתות, ${t.stats.meetings} אסיפות). לא ניתן לשחזר.</p>
                <label class="field" style="margin-top:12px"><span>לאישור הקלידו את שם המוסד: <b>${esc(t.name)}</b></span><input class="input" id="confirmName"></label>`,
            buttons: [{ label: 'מחיקה לצמיתות', cls: 'btn-danger-solid', icon: 'fa-trash', action: async m => {
                await del(`/admin/tenants/${t.id}`, { confirm_name: $('#confirmName', m).value.trim() }); ok('המוסד נמחק'); reload();
            } }, { label: 'ביטול' }]
        });
    });
}

// ---------- הרשאות (למוסד או למנהל-על) ----------
async function renderAccess(el, tenantId) {
    const isSuper = tenantId === 'super';
    const [rules, tenants, me] = await Promise.all([
        get(`/admin/access?tenant_id=${tenantId}`),
        isSuper ? Promise.resolve([]) : get('/admin/tenants'),
        get('/admin/my-ip').catch(() => ({ ip: '' }))
    ]);
    const tenant = isSuper ? null : tenants.find(t => t.id === +tenantId);
    if (!isSuper && !tenant) throw new Error('המוסד לא נמצא');
    const reload = () => renderAccess(el, tenantId);
    const users = rules.filter(r => r.rule_type === 'user'), ips = rules.filter(r => r.rule_type === 'ip');

    const table = (items, kind) => items.length ? `<div class="table-container"><table class="modern-table">
        <thead><tr><th>${kind === 'user' ? 'שם משתמש' : 'כתובת IP'}</th>${kind === 'user' ? '<th>מייל</th>' : ''}<th>תיאור</th><th>מצב</th><th>שימוש אחרון</th><th></th></tr></thead>
        <tbody>${items.map(r => `<tr data-id="${r.id}">
            <td><b style="color:var(--text-strong)" dir="auto">${esc(kind === 'user' ? r.username : r.ip)}</b></td>
            ${kind === 'user' ? `<td>${r.email ? `<span class="ltr">${esc(r.email)}</span> <span class="badge badge-primary" title="אפשר להיכנס עם Google">G</span>` : '<span class="text-muted">—</span>'}</td>` : ''}
            <td>${esc(r.description || '')}</td>
            <td>${r.active ? '<span class="badge badge-success">פעיל</span>' : '<span class="badge badge-danger">מושבת</span>'}</td>
            <td class="num text-muted">${esc(r.last_used_at || '—')}</td>
            <td class="td-actions">${kind === 'user' && r.email ? '<button class="icon-btn" data-mail title="מייל פתיחת חשבון"><i class="fas fa-envelope"></i></button>' : ''}<button class="icon-btn" data-edit title="עריכה"><i class="fas fa-pen"></i></button><button class="icon-btn danger" data-del title="מחיקה"><i class="fas fa-trash"></i></button></td></tr>`).join('')}</tbody></table></div>`
        : `<p class="text-muted" style="padding:6px 16px 14px">${kind === 'user' ? 'אין משתמשים' : 'אין כתובות IP מורשות'}</p>`;

    el.innerHTML = `${isSuper ? tabs('super') : '<a class="back-link" href="#admin"><i class="fas fa-arrow-right"></i> כל המוסדות</a>'}
        <div class="page-head">
            <div><h2><i class="fas fa-key"></i> ${isSuper ? 'הרשאות מנהל-על' : `הרשאות כניסה — ${esc(tenant.name)}`}</h2>
                <p>${isSuper ? 'מי שנכנס כאן רואה את כל המוסדות' : 'כל משתמש או IP כאן נכנס רק למוסד הזה'}</p></div>
            ${!isSuper ? `<div class="actions"><button class="btn btn-outline" id="btnEnter"><i class="fas fa-sign-in-alt"></i> כניסה למוסד</button></div>` : ''}
        </div>
        ${!isSuper && !tenant.active ? '<div class="notice warning"><i class="fas fa-exclamation-triangle"></i><span>המוסד לא פעיל — אף אחד לא יוכל להיכנס עד שיופעל.</span></div>' : ''}
        <div class="card flush"><div class="card-head" style="padding-bottom:10px"><h3><i class="fas fa-user"></i> משתמשים (שם משתמש + סיסמה)</h3>
            <button class="btn btn-sm btn-primary" id="addUser"><i class="fas fa-plus"></i> משתמש</button></div>${table(users, 'user')}</div>
        <div class="card flush"><div class="card-head" style="padding-bottom:10px"><h3><i class="fas fa-network-wired"></i> כתובות IP מורשות (כניסה אוטומטית בלי סיסמה)</h3>
            <button class="btn btn-sm btn-primary" id="addIp"><i class="fas fa-plus"></i> כתובת IP</button></div>${table(ips, 'ip')}</div>`;

    const scope = isSuper ? null : +tenantId;
    $('#addUser', el).onclick = () => modal({
        title: 'משתמש חדש', icon: 'fa-user',
        body: `<form class="form-grid">
            <label class="field"><span>שם משתמש</span><input class="input" name="username" required autocomplete="off" dir="auto"><small>בעברית או באנגלית</small></label>
            <label class="field"><span>סיסמה</span><input class="input ltr-input" name="password" required autocomplete="new-password"><small>לפחות 6 תווים</small></label>
            <label class="field"><span>מייל</span><input class="input ltr-input" name="email" type="email" placeholder="name@gmail.com"><small>לא חובה · לשליחת פרטי הכניסה ולכניסה עם Google</small></label>
            <label class="field"><span>שם / תיאור</span><input class="input" name="description" placeholder="ר׳ משה כהן — מזכירות"></label></form>`,
        buttons: [{ label: 'שמירה', cls: 'btn-primary', icon: 'fa-save', action: async m => {
            const f = formData($('form', m));
            const r = await post('/admin/access', { ...f, rule_type: 'user', tenant_id: scope });
            ok('המשתמש נוסף');
            reload();
            if (r.email) setTimeout(() => welcomeDialog(r, f.password), 50);
        } }, { label: 'ביטול' }]
    });
    $('#addIp', el).onclick = () => modal({
        title: 'כתובת IP מורשית', icon: 'fa-network-wired',
        body: `<form class="form-grid">
            <label class="field full"><span>כתובת IP</span><input class="input ltr-input" name="ip" required placeholder="1.2.3.4">
                ${me.ip ? `<small>הכתובת שלכם כרגע: <button type="button" class="btn btn-sm btn-outline ltr" id="useMyIp" style="height:22px">${esc(me.ip)}</button></small>` : ''}</label>
            <label class="field full"><span>תיאור</span><input class="input" name="description" placeholder="מחשב המזכירות"></label></form>`,
        onOpen: m => { const b = $('#useMyIp', m); if (b) b.onclick = () => { $('[name=ip]', m).value = me.ip; }; },
        buttons: [{ label: 'שמירה', cls: 'btn-primary', icon: 'fa-save', action: async m => {
            await post('/admin/access', { ...formData($('form', m)), rule_type: 'ip', tenant_id: scope }); ok('הכתובת נוספה'); reload();
        } }, { label: 'ביטול' }]
    });
    $$('[data-edit]', el).forEach(b => b.onclick = () => {
        const r = rules.find(x => x.id === +b.closest('tr').dataset.id);
        modal({
            title: r.rule_type === 'user' ? r.username : r.ip, icon: 'fa-key',
            body: `<form class="form-grid">
                ${r.rule_type === 'user'
                    ? `<label class="field"><span>שם משתמש</span><input class="input" name="username" dir="auto" value="${esc(r.username)}"></label>
                       <label class="field"><span>סיסמה חדשה</span><input class="input ltr-input" name="password" autocomplete="new-password" placeholder="ריק = ללא שינוי"></label>
                       <label class="field full"><span>מייל</span><input class="input ltr-input" name="email" type="email" value="${esc(r.email || '')}"><small>לשליחת פרטי הכניסה ולכניסה עם Google</small></label>`
                    : `<label class="field full"><span>כתובת IP</span><input class="input ltr-input" name="ip" value="${esc(r.ip)}"></label>`}
                <label class="field full"><span>תיאור</span><input class="input" name="description" value="${esc(r.description || '')}"></label>
                <label class="check full"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}> פעיל</label></form>`,
            buttons: [{ label: 'שמירה', cls: 'btn-primary', icon: 'fa-save', action: async m => {
                const f = formData($('form', m));
                if (!f.password) delete f.password;
                await put(`/admin/access/${r.id}`, f); ok('נשמר'); reload();
            } }, { label: 'ביטול' }]
        });
    });
    $$('[data-mail]', el).forEach(b => b.onclick = () => welcomeDialog(rules.find(x => x.id === +b.closest('tr').dataset.id), ''));
    $$('[data-del]', el).forEach(b => b.onclick = async () => {
        const r = rules.find(x => x.id === +b.closest('tr').dataset.id);
        if (!await confirmDialog('מחיקת הרשאה', `למחוק את ${esc(r.username || r.ip)}?`, { okLabel: 'מחיקה', danger: true })) return;
        try { await del(`/admin/access/${r.id}`); ok('נמחק'); reload(); } catch (e) { fail(e); }
    });
    const enter = $('#btnEnter', el);
    if (enter) enter.onclick = () => enterTenant({ id: tenant.id, name: tenant.name });
}

// ---------- מייל פתיחת חשבון: תצוגה מקדימה ואז שליחה ----------
function welcomeDialog(rule, password) {
    if (!rule.email) return fail(new Error('למשתמש אין כתובת מייל. הוסיפו אותה בעריכת המשתמש'));
    const { el: m } = modal({
        title: 'מייל פתיחת חשבון', icon: 'fa-envelope', wide: true,
        body: `<div class="form-grid" style="margin-bottom:12px">
                <label class="field"><span>נשלח אל</span><input class="input ltr-input" id="wTo" value="${esc(rule.email)}"></label>
                <label class="field"><span>סיסמה לכלול במייל</span><input class="input ltr-input" id="wPass" value="${esc(password || '')}" placeholder="ריק = בלי סיסמה במייל">
                    <small>הסיסמאות לא נשמרות במערכת — אם לא תוזן, המייל יגיד שהסיסמה תימסר בנפרד</small></label></div>
            <div class="mail-meta" id="wMeta"></div>
            <iframe id="wFrame" class="mail-frame" title="תצוגה מקדימה"></iframe>
            <div id="wWarn"></div>`,
        buttons: [
            { label: 'שליחת המייל', cls: 'btn-primary', icon: 'fa-paper-plane', action: async mm => {
                const r = await post(`/admin/access/${rule.id}/welcome`, { send: true, to: $('#wTo', mm).value.trim(), password: $('#wPass', mm).value });
                ok(`המייל נשלח ל-${r.to}`);
            } },
            { label: 'סגירה בלי לשלוח' }
        ]
    });
    let timer = null;
    const load = async () => {
        try {
            const p = await post(`/admin/access/${rule.id}/welcome`, { send: false, to: $('#wTo', m).value.trim(), password: $('#wPass', m).value });
            $('#wMeta', m).innerHTML = `<div><span>מאת:</span> <b class="ltr">${esc(p.from || '')}</b></div><div><span>אל:</span> <b class="ltr">${esc(p.to)}</b></div><div><span>נושא:</span> <b>${esc(p.subject)}</b></div>`;
            $('#wFrame', m).srcdoc = p.html;
            $('#wWarn', m).innerHTML = p.mail_ready ? '' : '<div class="notice warning" style="margin:10px 0 0"><i class="fas fa-exclamation-triangle"></i><span>שליחת מיילים עדיין לא הוגדרה (חסר מפתח Resend בהגדרות הוורקר) — אפשר לראות את המייל, אבל לא לשלוח.</span></div>';
        } catch (e) { fail(e); }
    };
    ['#wTo', '#wPass'].forEach(id => { $(id, m).oninput = () => { clearTimeout(timer); timer = setTimeout(load, 400); }; });
    load();
}

// ---------- הגדרות: מיילים, Google ותבנית מייל הפתיחה ----------
const VARS = ['שם', 'מוסד', 'שם_משתמש', 'מייל'];

async function renderSettings(el) {
    const s = await get('/admin/settings');
    el.innerHTML = `${tabs('settings')}
        <div class="page-head"><div><h2><i class="fas fa-cog"></i> הגדרות ומיילים</h2><p>מפתח המייל, כניסה עם Google, ונוסח מייל פתיחת החשבון</p></div>
            <div class="actions"><button class="btn btn-primary" id="sSave"><i class="fas fa-save"></i> שמירת ההגדרות</button></div></div>

        <div class="grid-2">
            <div class="card">
                <h3><i class="fas fa-paper-plane"></i> שליחת מיילים (Resend)</h3>
                <div class="form-grid" style="margin-top:10px">
                    <label class="field full"><span>מפתח Resend (RESEND_API_KEY)</span>
                        <input class="input ltr-input" id="sKey" type="password" autocomplete="off" placeholder="${s.resend_key_set ? `מוגדר ${esc(s.resend_key_hint)} — ריק = ללא שינוי` : 're_...'}">
                        <small>${s.resend_key_set ? '<span style="color:#059669"><i class="fas fa-check-circle"></i> מוגדר</span> · <button type="button" class="link-btn" id="sClearKey" style="background:none;border:0;color:#dc2626;cursor:pointer;padding:0">מחיקת המפתח</button>' : '<span style="color:#b45309">לא מוגדר — מיילים לא יישלחו</span>'}</small></label>
                    <label class="field full"><span>שולח (מאת)</span><input class="input" id="sFrom" dir="auto" value="${esc(s.mail_from)}"><small>בפורמט: שם &lt;כתובת@smti.uk&gt; — הדומיין צריך להיות מאומת ב-Resend</small></label>
                    <label class="field full"><span>כתובת האתר (לכפתור במייל)</span><input class="input ltr-input" id="sSite" value="${esc(s.site_url)}"></label>
                </div>
                <div class="toolbar" style="margin-top:12px"><input class="input ltr-input" id="sTestTo" type="email" placeholder="כתובת לבדיקה" style="max-width:240px">
                    <button class="btn btn-secondary" id="sTest"><i class="fas fa-vial"></i> שליחת מייל בדיקה</button></div>
                <small class="text-muted">מייל הבדיקה נשלח עם ההגדרות השמורות — שמרו קודם.</small>
            </div>
            <div class="card">
                <h3><i class="fab fa-google"></i> כניסה עם Google</h3>
                <div class="form-grid" style="margin-top:10px">
                    <label class="check full"><input type="checkbox" id="sGoogle" ${s.google_enabled ? 'checked' : ''}> להציג "המשך עם Google" במסך הכניסה</label>
                    <label class="field full"><span>Google Client ID</span><input class="input ltr-input" id="sGid" value="${esc(s.google_client_id)}"><small>נכנסים רק משתמשים שמוגדר להם מייל זהה לחשבון Google</small></label>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-head"><h3><i class="fas fa-envelope-open-text"></i> נוסח מייל פתיחת חשבון</h3>
                <button class="btn btn-sm btn-outline" id="sReset"><i class="fas fa-undo"></i> החזרה לנוסח המקורי</button></div>
            <div class="grid-2">
                <div class="form-grid" style="align-content:start">
                    <label class="field full"><span>נושא</span><input class="input tpl" id="tSubject" value="${esc(s.welcome_subject)}"></label>
                    <label class="field full"><span>כותרת</span><input class="input tpl" id="tTitle" value="${esc(s.welcome_title)}"></label>
                    <label class="field full"><span>תוכן</span><textarea class="input tpl" id="tBody" rows="9">${esc(s.welcome_body)}</textarea>
                        <small>שורה ריקה = פסקה חדשה. אחרי התוכן מופיעה אוטומטית טבלת פרטי הכניסה (מוסד, שם משתמש, סיסמה, כתובת האתר)</small></label>
                    <label class="field"><span>טקסט הכפתור</span><input class="input tpl" id="tButton" value="${esc(s.welcome_button)}"></label>
                    <label class="field"><span>הערה בתחתית</span><input class="input tpl" id="tNote" value="${esc(s.welcome_note)}"></label>
                    <div class="field full"><span>הוספת שדה משתנה (לחיצה מוסיפה בתוכן)</span>
                        <div class="chips">${VARS.map(v => `<button type="button" class="chip" data-var="${v}">{${v}}</button>`).join('')}</div></div>
                </div>
                <div><div class="mail-meta" id="pMeta"></div><iframe id="pFrame" class="mail-frame" title="תצוגה מקדימה"></iframe>
                    <small class="text-muted">תצוגה מקדימה עם נתונים לדוגמה · מתעדכנת תוך כדי הקלדה</small></div>
            </div>
        </div>`;

    const vals = () => ({
        welcome_subject: $('#tSubject', el).value, welcome_title: $('#tTitle', el).value, welcome_body: $('#tBody', el).value,
        welcome_button: $('#tButton', el).value, welcome_note: $('#tNote', el).value, mail_from: $('#sFrom', el).value, site_url: $('#sSite', el).value
    });
    let timer = null;
    const refresh = async () => {
        try {
            const p = await post('/admin/settings/preview', vals());
            $('#pMeta', el).innerHTML = `<div><span>מאת:</span> <b dir="auto">${esc(p.from || '—')}</b></div><div><span>נושא:</span> <b>${esc(p.subject)}</b></div>`;
            $('#pFrame', el).srcdoc = p.html;
        } catch (e) { fail(e); }
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 350); };
    $$('.tpl, #sFrom, #sSite', el).forEach(i => { i.oninput = later; });
    $$('[data-var]', el).forEach(b => b.onclick = () => {
        const ta = $('#tBody', el), v = `{${b.dataset.var}}`, a = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, a) + v + ta.value.slice(ta.selectionEnd ?? a);
        ta.focus(); ta.selectionStart = ta.selectionEnd = a + v.length;
        later();
    });
    $('#sReset', el).onclick = () => {
        const d = s.defaults;
        $('#tSubject', el).value = d.welcome_subject; $('#tTitle', el).value = d.welcome_title; $('#tBody', el).value = d.welcome_body;
        $('#tButton', el).value = d.welcome_button; $('#tNote', el).value = d.welcome_note;
        refresh();
    };
    $('#sSave', el).onclick = async () => {
        try {
            await put('/admin/settings', { ...vals(), resend_api_key: $('#sKey', el).value.trim(), google_enabled: $('#sGoogle', el).checked, google_client_id: $('#sGid', el).value });
            ok('ההגדרות נשמרו');
            renderSettings(el);
        } catch (e) { fail(e); }
    };
    const clr = $('#sClearKey', el);
    if (clr) clr.onclick = async () => {
        if (!await confirmDialog('מחיקת מפתח', 'למחוק את מפתח Resend? מיילים לא יישלחו עד שיוזן מפתח חדש.', { okLabel: 'מחיקה', danger: true })) return;
        try { await put('/admin/settings', { clear_resend_key: true }); ok('המפתח נמחק'); renderSettings(el); } catch (e) { fail(e); }
    };
    $('#sTest', el).onclick = async () => {
        try { const r = await post('/admin/settings/test-mail', { to: $('#sTestTo', el).value.trim() }); ok(`מייל בדיקה נשלח ל-${r.to}`); } catch (e) { fail(e); }
    };
    refresh();
}

async function renderLog(el) {
    const list = await get('/admin/login-log');
    el.innerHTML = `${tabs('log')}
        <div class="card flush">${list.length ? `<div class="table-container"><table class="modern-table">
            <thead><tr><th>מתי (UTC)</th><th>תוצאה</th><th>שיטה</th><th>משתמש</th><th>מוסד</th><th>IP</th></tr></thead>
            <tbody>${list.map(l => `<tr><td class="num">${esc(l.created_at)}</td>
                <td>${l.success ? '<span class="badge badge-success">הצליח</span>' : '<span class="badge badge-danger">נכשל</span>'}</td>
                <td>${{ ip: 'IP', google: 'Google', user: 'סיסמה' }[l.method] || esc(l.method)}</td><td dir="auto">${esc(l.username || '')}</td><td>${esc(l.tenant_name || (l.success && !l.tenant_id ? 'מנהל-על' : ''))}</td>
                <td class="ltr num">${esc(l.ip || '')}</td></tr>`).join('')}</tbody></table></div>` : emptyState('fa-history', 'אין כניסות')}</div>`;
}

export const AdminView = {
    render(el, params) {
        if (params.tenant) return renderAccess(el, params.tenant);
        if (params.tab === 'super') return renderAccess(el, 'super');
        if (params.tab === 'log') return renderLog(el);
        if (params.tab === 'settings') return renderSettings(el);
        return renderTenants(el);
    }
};
