// ============================================================
//  client-login.js — מסך הכניסה
//  הטופס פתוח מיד. ברקע: טוקן שמור (/auth/me), ואם אין — בדיקת IP מורשית.
//  כניסה אוטומטית לפי IP קורית רק אם המשתמש עוד לא התחיל להקליד.
// ============================================================

const API = '/asifa/api';
const TOKEN_KEY = 'asifa_token';

export function clearSession() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
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
    enableForm('הזינו שם משתמש וסיסמה');

    // ברקע: טוקן שמור, ואם אין — בדיקת כתובת IP מורשית (נכנסים אוטומטית רק אם עוד לא התחילו להקליד)
    const typing = () => user.value.trim() || pass.value || !btn.querySelector('.fa-arrow-left');
    (async () => {
        let token = null;
        try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { /* ignore */ }
        if (token) {
            msg.innerHTML = '<i class="fas fa-spinner fa-spin"></i>מתחבר...';
            try {
                return finish(await call('GET', '/auth/me', null, token, 8000));
            } catch (e) {
                if (e.status === 401) clearSession();
                msg.innerHTML = '<i class="fas fa-lock"></i>הזינו שם משתמש וסיסמה';
            }
        }
        try {
            const r = await call('POST', '/auth/login', {}, null, 8000);
            if (r.authorized && !typing()) {
                localStorage.setItem(TOKEN_KEY, r.token);
                finish(r.user);
            }
        } catch (e) { /* הבדיקה האוטומטית לא חוסמת את הטופס */ }
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
            localStorage.setItem(TOKEN_KEY, r.token);
            finish(r.user);
        } catch (er) {
            showError(er.message);
            btn.disabled = false;
            btn.innerHTML = '<span>כניסה</span><i class="fas fa-arrow-left"></i>';
            pass.select();
        }
    };
}
