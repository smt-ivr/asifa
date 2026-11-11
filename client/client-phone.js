// ============================================================
//  client-phone.js — הגדרות הקו הטלפוני של המוסד + יומן שיחות
//  מוצג למנהל-על תמיד, ולמוסד רק אם הוגדר שהמוסד מנהל את הטלפון בעצמו
// ============================================================
import { get, put, esc, $, $$, ok, fail, phoneFmt, emptyState } from './client-app.js';

const ACTIONS = { call: 'שיחה נכנסת', book: 'קביעת פגישה', cancel: 'ביטול פגישה', absent: 'לא נוכל להגיע', link_phone: 'שמירת מספר', bad_id: 'ת״ז לא נמצאה' };

const TEXTS = [
    ['welcome_text', 'פתיחה', 'מוקרא בתחילת כל שיחה. {מוסד} = שם המוסד'],
    ['closed_text', 'כשאין אסיפה פעילה בטלפון', ''],
    ['locked_text', 'כשההרשמה נסגרה', 'ההורים עדיין יכולים לשמוע את הפגישות ולעדכן שלא יגיעו'],
    ['locked_note', 'משפט נוסף כשההרשמה נסגרה', 'לדוגמה: לשינויים נא לפנות למזכירות'],
    ['unknown_text', 'מספר לא מוכר', '']
];
const FLAGS = [
    ['enabled', 'הקו פעיל'],
    ['allow_id_login', 'מספר לא מוכר יכול להיכנס עם תעודת זהות של התלמיד'],
    ['allow_save_phone', 'אחרי כניסה עם תעודת זהות — להציע לשמור את המספר'],
    ['allow_absence', 'אפשרות "לא נוכל להגיע — המלמד יחזור אלינו"'],
    ['allow_cancel', 'אפשרות לבטל פגישה בטלפון']
];

export const PhoneView = {
    async render(el) {
        const [d, calls] = await Promise.all([get('/phone-settings'), get('/calls').catch(() => [])]);
        const s = d.settings;
        el.innerHTML = `
            <div class="page-head"><div><h2><i class="fas fa-phone-alt"></i> הגדרות הקו הטלפוני</h2><p>מה ההורים שומעים ומה מותר להם לעשות בטלפון</p></div>
                <div class="actions"><button class="btn btn-primary" id="pSave"><i class="fas fa-save"></i> שמירה</button></div></div>
            <div class="grid-2">
                <div class="card">
                    <h3><i class="fas fa-plug"></i> חיבור לימות המשיח</h3>
                    <p class="text-muted" style="margin:4px 0 8px">בשלוחה (ext.ini) — בלי פרמטרים בקישור, המזהה של המוסד בנתיב:</p>
                    <pre class="input ltr-input" style="white-space:pre-wrap;font-family:monospace;min-height:0;direction:ltr;text-align:left">${esc(d.ext_ini)}</pre>
                    <button class="btn btn-sm btn-outline" id="pCopy" style="margin-top:6px"><i class="fas fa-copy"></i> העתקת הקישור</button>
                    <label class="field" style="margin-top:14px"><span>מספרי חיוג של המוסד (לא חובה)</span>
                        <input class="input ltr-input" id="pDids" value="${esc(d.dids.join(', '))}" placeholder="0771234567">
                        <small>זיהוי נוסף של המוסד לפי המספר שחייגו אליו, אם אותה שלוחה משרתת כמה מספרים</small></label>
                    ${d.can_change_manager ? `<div class="field" style="margin-top:14px"><span>מי מנהל את הגדרות הטלפון של המוסד</span>
                        <label class="check"><input type="radio" name="pMgr" value="super" ${d.managed_by !== 'tenant' ? 'checked' : ''}> אני (מנהל המערכת) — המוסד לא רואה את המסך הזה</label>
                        <label class="check"><input type="radio" name="pMgr" value="tenant" ${d.managed_by === 'tenant' ? 'checked' : ''}> המוסד עצמו</label></div>` : ''}
                </div>
                <div class="card">
                    <h3><i class="fas fa-sliders-h"></i> אפשרויות</h3>
                    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
                        ${FLAGS.map(([k, label]) => `<label class="check"><input type="checkbox" data-flag="${k}" ${s[k] ? 'checked' : ''}> ${label}</label>`).join('')}
                    </div>
                </div>
            </div>
            <div class="card">
                <h3><i class="fas fa-volume-up"></i> הודעות שמוקראות להורים</h3>
                <div class="form-grid" style="margin-top:10px">
                    ${TEXTS.map(([k, label, hint]) => `<label class="field full"><span>${label}</span><input class="input" data-text="${k}" value="${esc(s[k])}" placeholder="${esc(d.defaults[k])}">${hint ? `<small>${hint}</small>` : ''}</label>`).join('')}
                </div>
                <p class="text-muted" style="margin-top:8px">ההודעות מוקראות בהקראה ממוחשבת. סימני פיסוק ומקפים מוסרים אוטומטית.</p>
            </div>
            <div class="card flush">
                <div class="card-head" style="padding-bottom:10px"><h3><i class="fas fa-history"></i> יומן שיחות</h3><span class="text-muted">300 האחרונות</span></div>
                ${calls.length ? `<div class="table-container"><table class="modern-table"><thead><tr><th>מתי</th><th>טלפון</th><th>פעולה</th><th>תלמיד</th><th>פרטים</th></tr></thead>
                <tbody>${calls.map(l => `<tr><td class="num">${esc(l.created_at)}</td><td><span class="ltr">${l.phone ? phoneFmt(l.phone) : 'חסוי'}</span></td>
                    <td>${esc(ACTIONS[l.action] || l.action)}</td><td>${l.first_name ? esc(`${l.first_name} ${l.last_name}`) : ''}</td><td class="text-muted">${esc(l.details || '')}</td></tr>`).join('')}</tbody></table></div>`
                    : emptyState('fa-phone-slash', 'עדיין לא היו שיחות')}
            </div>`;

        $('#pCopy', el).onclick = () => navigator.clipboard.writeText(d.api_url).then(() => ok('הקישור הועתק'));
        $('#pSave', el).onclick = async () => {
            const body = { dids: $('#pDids', el).value };
            $$('[data-flag]', el).forEach(i => { body[i.dataset.flag] = i.checked; });
            $$('[data-text]', el).forEach(i => { body[i.dataset.text] = i.value.trim() || d.defaults[i.dataset.text]; });
            const mgr = $('input[name=pMgr]:checked', el);
            if (mgr) body.managed_by = mgr.value;
            try { await put('/phone-settings', body); ok('הגדרות הטלפון נשמרו'); PhoneView.render(el); } catch (e) { fail(e); }
        };
    }
};
