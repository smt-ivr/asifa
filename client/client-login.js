// ============================================================
//  client-login.js — מסך הכניסה
//  1. יש טוקן שמור -> בודק אותו (/auth/me)
//  2. אין -> בודק אם כתובת ה-IP מורשית (כניסה אוטומטית)
//  3. אחרת -> שם משתמש וסיסמה
// ============================================================

const API = '/asifa/api';
const TOKEN_KEY = 'asifa_token';

export function clearSession() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
}

async function call(method, path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
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

    // 1. טוקן שמור
    let token = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    if (token) {
        try {
            return onSuccess(await call('GET', '/auth/me', null, token));
        } catch (e) {
            if (e.status !== 401) return enableForm('אין חיבור לשרת. נסו לרענן את הדף');
            clearSession();
        }
    }

    // 2. כניסה אוטומטית לפי IP
    try {
        const r = await call('POST', '/auth/login', {});
        if (r.authorized) {
            localStorage.setItem(TOKEN_KEY, r.token);
            return onSuccess(r.user);
        }
        enableForm('הזינו שם משתמש וסיסמה');
    } catch (e) {
        enableForm(e.message);
    }

    // 3. שם משתמש וסיסמה
    $('loginForm').onsubmit = async e => {
        e.preventDefault();
        $('loginError').classList.add('hidden');
        if (!user.value.trim() || !pass.value) return showError('יש להזין שם משתמש וסיסמה');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>מאמת...</span>';
        try {
            const r = await call('POST', '/auth/login', { username: user.value.trim(), password: pass.value });
            localStorage.setItem(TOKEN_KEY, r.token);
            onSuccess(r.user);
        } catch (er) {
            showError(er.message);
            btn.disabled = false;
            btn.innerHTML = '<span>כניסה</span><i class="fas fa-arrow-left"></i>';
            pass.select();
        }
    };
}
