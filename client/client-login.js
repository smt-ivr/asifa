// ============================================================
//  client-login.js — מסך הכניסה
//  כניסה שמורה -> האתר נפתח מיד (נבדק ברקע).
//  אחרת: הטופס פתוח מיד, ובמקביל בדיקת IP מורשית (כניסה אוטומטית רק אם עוד לא הקלידו).
// ============================================================

const API = '/asifa/api';
const TOKEN_KEY = 'asifa_token';
const USER_KEY = 'asifa_user';

export function clearSession() {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch (e) { /* ignore */ }
}

function saveSession(token, user) {
    try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch (e) { /* ignore */ }
}

// timeoutMs — הבדיקות ברקע לא נתקעות לעולם
async function call(method, path, body, token, timeoutMs = 15000) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    } catch (e) {
        throw new Error(e.name === 'AbortError' ? 'השרת לא ענה בזמן, נסו שוב' : 'אין חיבור לשרת');
    } finally {
        clearTimeout(timer);
    }
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) {
        const e = new Error(data && data.error ? data.error.message : 'אין חיבור לשרת');
        e.status = res.status;
        throw e;
    }
    return data.data;
}

export async function setupLogin(onSuccess) {
    const $ = id => document.getElementById(id);
    const user = $('usernameInput'), pass = $('passwordInput'), btn = $('loginBtn'), msg = $('authMessage');
    const showError = text => { $('loginErrorText').textContent = text; $('loginError').classList.remove('hidden'); };
    const enableForm = text => {
        msg.innerHTML = `<i class="fas fa-lock"></i>${text}`;
        user.disabled = pass.disabled = btn.disabled = false;
        btn.innerHTML = '<span>כניסה</span><i class="fas fa-arrow-left"></i>';
        user.focus();
    };

    // הצגת סיסמה + Caps Lock
    $('lgEye').onclick = () => {
        const show = pass.type === 'password';
        pass.type = show ? 'text' : 'password';
        $('lgEye').innerHTML = `<i class="fas ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
        pass.focus();
    };
    const caps = e => { if (e.getModifierState) $('lgCaps').classList.toggle('hidden', !e.getModifierState('CapsLock')); };
    pass.addEventListener('keydown', caps);
    pass.addEventListener('keyup', caps);

    // הטופס פתוח מיד — לא מחכים לשום בדיקה
    let done = false;
    const finish = u => { if (done) return; done = true; onSuccess(u); };

    // כניסה שמורה בזיכרון — האתר נפתח מיד (מסך הכניסה לא מוצג), והכניסה נבדקת מול השרת ברקע.
    // אם היא כבר לא תקפה, הקריאה הראשונה לשרת מחזירה 401 והאתר חוזר למסך הכניסה.
    let token = null, saved = null;
    try { token = localStorage.getItem(TOKEN_KEY); saved = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (token && saved) {
        finish(saved);
        call('GET', '/auth/me', null, token, 8000).then(u => { try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch (e) { /* ignore */ } }).catch(() => {});
        return;
    }

    // אין כניסה שמורה: הטופס פתוח מיד, ובדיקת ה-IP רצה במקביל.
    // כניסה אוטומטית לפי IP — רק אם עוד לא התחילו להקליד.
    enableForm('בודק הרשאת IP...');
    msg.innerHTML = '<i class="fas fa-spinner fa-spin"></i>בודק הרשאת IP...';
    const typing = () => user.value.trim() || pass.value || !btn.querySelector('.fa-arrow-left');
    (async () => {
        if (token) {
            try { return finish(await call('GET', '/auth/me', null, token, 8000)); }
            catch (e) { if (e.status === 401) clearSession(); }
        }
        try {
            const r = await call('POST', '/auth/login', {}, null, 8000);
            if (r.authorized && !typing()) {
                saveSession(r.token, r.user);
                return finish(r.user);
            }
            if (!done) msg.innerHTML = '<i class="fas fa-lock"></i>כתובת ה-IP אינה מורשית — הזינו שם משתמש וסיסמה';
        } catch (e) {
            if (!done) msg.innerHTML = '<i class="fas fa-lock"></i>הזינו שם משתמש וסיסמה';
        }
    })();

    // כניסה בשם משתמש וסיסמה
    $('loginForm').onsubmit = async e => {
        e.preventDefault();
        $('loginError').classList.add('hidden');
        if (!user.value.trim() || !pass.value) return showError('יש להזין שם משתמש וסיסמה');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>מאמת...</span>';
        try {
            const r = await call('POST', '/auth/login', { username: user.value.trim(), password: pass.value });
            saveSession(r.token, r.user);
            finish(r.user);
        } catch (er) {
            showError(er.message);
            btn.disabled = false;
            btn.innerHTML = '<span>כניסה</span><i class="fas fa-arrow-left"></i>';
            pass.select();
        }
    };
}
