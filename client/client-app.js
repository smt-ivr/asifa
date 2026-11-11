// ============================================================
//  client-app.js — שלד האתר: קריאות API, ניווט, חלונות, הודעות ועזרים
//  כל עמוד נרשם ב-App.pages[name] = { title, roles, render(el, params) }
// ============================================================
(function () {
    const API = '/asifa/api';
    const TOKEN_KEY = 'asifa_token';
    const TENANT_KEY = 'asifa_tenant';

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    };

    const ICONS = {
        home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
        calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
        board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
        users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.8 2.8 2.6 3 5.2"/>',
        school: '<path d="m12 3 10 5-10 5L2 8z"/><path d="M6 10.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5"/>',
        print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
        building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
        phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>'
    };
    const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

    const NAV = [
        { page: 'dashboard', label: 'לוח בקרה', icon: 'home', roles: ['admin', 'teacher', 'super'] },
        { page: 'meetings', label: 'אסיפות', icon: 'calendar', roles: ['admin', 'super'] },
        { page: 'board', label: 'לוח תורים', icon: 'board', roles: ['admin', 'teacher', 'super'] },
        { page: 'students', label: 'תלמידים והורים', icon: 'users', roles: ['admin', 'super'] },
        { page: 'classes', label: 'כיתות ומלמדים', icon: 'school', roles: ['admin', 'super'] },
        { page: 'print', label: 'הדפסות', icon: 'print', roles: ['admin', 'teacher', 'super'] },
        { page: 'settings', label: 'הגדרות', icon: 'settings', roles: ['admin', 'super'] }
    ];

    const App = {
        pages: {},
        user: null,
        cache: {},

        // ---------- API ----------
        async api(method, path, body) {
            const headers = { 'Content-Type': 'application/json' };
            const token = store.get(TOKEN_KEY);
            if (token) headers.Authorization = `Bearer ${token}`;
            const tenant = store.get(TENANT_KEY);
            if (tenant) headers['X-Tenant'] = tenant;
            let res;
            try {
                res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
            } catch (e) {
                throw new Error('אין חיבור לשרת. בדקו את החיבור לאינטרנט');
            }
            let data = null;
            try { data = await res.json(); } catch (e) { /* ignore */ }
            if (res.status === 401 && path !== '/auth/login') {
                store.set(TOKEN_KEY, null);
                App.user = null;
                App.renderLogin(data && data.error ? data.error.message : null);
                throw new Error('נדרשת כניסה מחדש');
            }
            if (!res.ok || !data || !data.ok) {
                const err = new Error(data && data.error ? data.error.message : `שגיאה (${res.status})`);
                err.code = data && data.error ? data.error.code : 'http_' + res.status;
                throw err;
            }
            return data.data;
        },
        get: (p) => App.api('GET', p),
        post: (p, b) => App.api('POST', p, b || {}),
        put: (p, b) => App.api('PUT', p, b || {}),
        del: (p) => App.api('DELETE', p),

        setToken(t) { store.set(TOKEN_KEY, t); },
        tenantOverride: () => store.get(TENANT_KEY),
        setTenantOverride(id) { store.set(TENANT_KEY, id ? String(id) : null); App.cache = {}; },

        // ---------- עזרים ----------
        esc(s) {
            return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        },
        icon,
        fullName: s => `${s.first_name || ''} ${s.last_name || ''}`.trim(),
        phoneFmt(p) {
            const d = String(p || '');
            if (/^05\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3)}`;
            if (/^0\d{8}$/.test(d)) return `${d.slice(0, 2)}-${d.slice(2)}`;
            if (/^07\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3)}`;
            return d;
        },
        // 'YYYY-MM-DD HH:MM' -> '13/11 בשעה 20:00'
        fmtStamp(s) {
            const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(String(s || ''));
            return m ? `${+m[3]}/${+m[2]} בשעה ${m[4]}` : String(s || '');
        },
        $(sel, el = document) { return el.querySelector(sel); },
        $$(sel, el = document) { return [...el.querySelectorAll(sel)]; },
        formData(form) {
            const out = {};
            for (const el of form.elements) {
                if (!el.name) continue;
                if (el.type === 'checkbox') out[el.name] = el.checked;
                else out[el.name] = el.value;
            }
            return out;
        },
        statusBadge(m) {
            const cls = { draft: '', open: 'badge-success', locked: 'badge-warning', done: 'badge-primary' }[m.status] || '';
            return `<span class="badge ${cls}">${App.esc(m.status_label)}</span>`;
        },
        empty(title, text = '', action = '') {
            return `<div class="empty"><h3>${App.esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`;
        },
        loading: () => '<div class="loading"><span class="spinner"></span></div>',

        // ---------- הודעות ----------
        toast(msg, type = '') {
            const el = document.createElement('div');
            el.className = `toast ${type}`;
            el.textContent = msg;
            document.getElementById('toasts').appendChild(el);
            setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, type === 'error' ? 5000 : 3000);
        },
        ok: msg => App.toast(msg, 'success'),
        fail: err => App.toast(err && err.message ? err.message : String(err), 'error'),

        // ---------- חלון ----------
        // buttons: [{ label, cls, action: async (modalEl) => (false = לא לסגור) }]
        modal({ title, body, buttons = [], wide = false, onOpen }) {
            const back = document.createElement('div');
            back.className = 'modal-back';
            back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
                <div class="modal-head"><h2>${App.esc(title)}</h2><button class="modal-close" aria-label="סגירה">×</button></div>
                <div class="modal-body">${body}</div>
                ${buttons.length ? `<div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${App.esc(b.label)}</button>`).join('')}</div>` : ''}
            </div>`;
            const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
            const onKey = e => { if (e.key === 'Escape') close(); };
            document.addEventListener('keydown', onKey);
            back.addEventListener('mousedown', e => { if (e.target === back) close(); });
            back.querySelector('.modal-close').onclick = close;
            back.querySelectorAll('.modal-foot .btn').forEach(btn => {
                btn.onclick = async () => {
                    const b = buttons[+btn.dataset.i];
                    if (!b.action) return close();
                    btn.disabled = true;
                    try {
                        const r = await b.action(back);
                        if (r !== false) close();
                    } catch (e) {
                        App.fail(e);
                    } finally {
                        btn.disabled = false;
                    }
                };
            });
            const form = back.querySelector('form');
            if (form) form.addEventListener('submit', e => { e.preventDefault(); const p = back.querySelector('.modal-foot .btn-primary'); if (p) p.click(); });
            document.body.appendChild(back);
            const first = back.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea');
            if (first) first.focus();
            if (onOpen) onOpen(back);
            return { el: back, close };
        },
        confirm(title, text, { okLabel = 'אישור', danger = false } = {}) {
            return new Promise(resolve => {
                const m = App.modal({
                    title, body: `<p style="margin:0">${text}</p>`,
                    buttons: [
                        { label: okLabel, cls: danger ? 'btn-danger' : 'btn-primary', action: () => { resolve(true); } },
                        { label: 'ביטול', action: () => { resolve(false); } }
                    ]
                });
                m.el.querySelector('.modal-close').addEventListener('click', () => resolve(false));
            });
        },

        // ---------- נתונים משותפים ----------
        async classes(force) {
            if (!App.cache.classes || force) App.cache.classes = await App.get('/classes');
            return App.cache.classes;
        },
        async meetings(force) {
            if (!App.cache.meetings || force) App.cache.meetings = await App.get('/meetings');
            return App.cache.meetings;
        },
        // האסיפה "הנוכחית": פתוחה/נעולה, אחרת הקרובה, אחרת האחרונה
        async currentMeeting() {
            const list = await App.meetings();
            return list.find(m => m.status === 'open') || list.find(m => m.status === 'locked')
                || list.find(m => m.status === 'draft') || list[0] || null;
        },
        meetingOptions(list, selected) {
            return list.map(m => `<option value="${m.id}" ${+selected === m.id ? 'selected' : ''}>${App.esc(m.title)} — ${App.esc(m.date_label)}</option>`).join('');
        },

        // ---------- ניווט ----------
        route() {
            const hash = location.hash.replace(/^#\/?/, '');
            const [page, query] = hash.split('?');
            const params = Object.fromEntries(new URLSearchParams(query || ''));
            return { page: page || 'dashboard', params };
        },
        go(page, params) {
            const q = params ? '?' + new URLSearchParams(params).toString() : '';
            const target = `#/${page}${q}`;
            if (location.hash === target) App.render(); else location.hash = target;
        },

        renderLogin(message) {
            document.getElementById('root').innerHTML = '';
            App.pages.login.render(document.getElementById('root'), { message });
        },

        renderShell() {
            const u = App.user;
            const override = App.tenantOverride();
            const role = u.role;
            const showTenantNav = role !== 'super' || override;
            const nav = NAV.filter(n => n.roles.includes(role) && showTenantNav)
                .map(n => `<a href="#/${n.page}" data-page="${n.page}">${icon(n.icon)}<span>${n.label}</span></a>`).join('');
            const superNav = role === 'super' ? `${showTenantNav ? '<div class="nav-sep"></div>' : ''}<a href="#/admin" data-page="admin">${icon('building')}<span>מוסדות (ניהול-על)</span></a>` : '';
            document.getElementById('root').innerHTML = `
                <div class="app" id="app">
                    <aside class="sidebar">
                        <div class="brand"><div class="brand-name">אסיפה</div><div class="brand-sub">${App.esc(u.tenant_name || (override ? App.cache.tenantName || 'מוסד' : 'ניהול-על'))}</div></div>
                        ${role === 'super' && override ? `<div class="tenant-pill">צופה במוסד: <b>${App.esc(App.cache.tenantName || override)}</b><br><button id="leave-tenant">חזרה לניהול-על</button></div>` : ''}
                        <nav class="nav">${nav}${superNav}</nav>
                        <div class="sidebar-foot"><div class="who">${App.esc(u.display_name || u.username)}</div>
                            <div class="faint small">${{ super: 'מנהל-על', admin: 'מנהל', teacher: 'מלמד' }[role]}</div>
                            <button id="logout">יציאה</button></div>
                    </aside>
                    <div class="main">
                        <div class="topbar"><b>אסיפה</b><button id="nav-toggle" aria-label="תפריט">☰</button></div>
                        <div class="page" id="page"></div>
                    </div>
                </div>`;
            App.$('#logout').onclick = async () => {
                try { await App.post('/auth/logout'); } catch (e) { /* ignore */ }
                App.setToken(null); App.setTenantOverride(null); App.user = null; App.renderLogin();
            };
            App.$('#nav-toggle').onclick = () => App.$('#app').classList.toggle('nav-open');
            const leave = App.$('#leave-tenant');
            if (leave) leave.onclick = () => { App.setTenantOverride(null); App.renderShell(); App.go('admin'); };
        },

        async render() {
            if (!App.user) return;
            if (!App.$('#page')) App.renderShell();
            let { page, params } = App.route();
            const role = App.user.role;
            if (role === 'super' && !App.tenantOverride() && page !== 'admin') page = 'admin';
            const def = App.pages[page] && (!App.pages[page].roles || App.pages[page].roles.includes(role)) ? App.pages[page] : App.pages.dashboard;
            App.$$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
            const app = App.$('#app');
            if (app) app.classList.remove('nav-open');
            const el = App.$('#page');
            el.innerHTML = App.loading();
            document.title = `${def.title} — אסיפה`;
            try {
                await def.render(el, params);
            } catch (e) {
                if (e.message !== 'נדרשת כניסה מחדש') el.innerHTML = `<div class="alert alert-danger">${App.esc(e.message)}</div>`;
            }
        },

        async start() {
            window.addEventListener('hashchange', () => App.render());
            if (!store.get(TOKEN_KEY)) return App.renderLogin();
            try {
                App.user = await App.get('/auth/me');
                if (App.user.role === 'super' && App.tenantOverride()) {
                    try {
                        const s = await App.get('/settings');
                        App.cache.tenantName = s.name;
                    } catch (e) { App.setTenantOverride(null); }
                }
                App.renderShell();
                App.render();
            } catch (e) {
                if (!App.user) App.renderLogin();
            }
        }
    };

    window.App = App;
})();
