// ============================================================
//  client-login.js — מסך כניסה
// ============================================================
App.pages.login = {
    title: 'כניסה',
    render(root, { message } = {}) {
        root.innerHTML = `
            <div class="login-wrap">
                <div class="login-card">
                    <h1>אסיפה</h1>
                    <p>מערכת קביעת תורים לאסיפות הורים</p>
                    ${message ? `<div class="alert alert-warning">${App.esc(message)}</div>` : ''}
                    <form id="login-form" autocomplete="on">
                        <label class="field"><span>שם משתמש</span><input class="input ltr-input" name="username" autocomplete="username" required></label>
                        <label class="field"><span>סיסמה</span><input class="input ltr-input" type="password" name="password" autocomplete="current-password" required></label>
                        <div id="login-error" class="alert alert-danger hidden"></div>
                        <button class="btn btn-primary" type="submit">כניסה</button>
                    </form>
                </div>
            </div>`;
        const form = App.$('#login-form');
        form.username.focus();
        form.onsubmit = async e => {
            e.preventDefault();
            const btn = form.querySelector('button');
            const err = App.$('#login-error');
            btn.disabled = true;
            err.classList.add('hidden');
            try {
                const r = await App.post('/auth/login', { username: form.username.value.trim(), password: form.password.value });
                App.setToken(r.token);
                App.setTenantOverride(null);
                App.user = r.user;
                App.cache = {};
                App.renderShell();
                if (location.hash && location.hash !== '#/') App.render(); else App.go(r.user.role === 'super' ? 'admin' : 'dashboard');
            } catch (ex) {
                err.textContent = ex.message;
                err.classList.remove('hidden');
                btn.disabled = false;
            }
        };
    }
};
