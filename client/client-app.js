// ============================================================
//  client-app.js — שלד האתר: קריאות לשרת, תפריט, ניווט, הודעות וחלונות
//  כל מסך הוא מודול עם render(el, params). הניווט לפי # בכתובת.
// ============================================================
import { setupLogin, clearSession } from './client-login.js';
import { DashboardView } from './client-dashboard.js';
import { StudentsView } from './client-students.js';
import { ClassesView } from './client-classes.js';
import { MeetingsView } from './client-meetings.js';
import { AdminView } from './client-admin.js';

const API_BASE = '/asifa/api';
const TOKEN_KEY = 'asifa_token';
const TENANT_KEY = 'asifa_tenant';

const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
};

export const state = { user: null, tenantOverride: null };

// ---------- עזרים ----------
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fullName = s => `${s.first_name || ''} ${s.last_name || ''}`.trim();
export function phoneFmt(p) {
    const d = String(p || '');
    if (/^0[5-9]\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (/^0\d{8}$/.test(d)) return `${d.slice(0, 2)}-${d.slice(2)}`;
    return d;
}
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const emptyState = (icon, title, text = '', actions = '') =>
    `<div class="empty-state"><i class="fas ${icon}"></i><h4>${esc(title)}</h4>${text ? `<p>${text}</p>` : ''}${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
export const loading = () => '<div class="loading"><i class="fas fa-spinner fa-spin"></i> טוען...</div>';

// ---------- שרת ----------
export async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = store.get(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
    if (state.tenantOverride) headers['X-Tenant'] = String(state.tenantOverride);
    let res;
    try {
        res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
        throw new Error('אין חיבור לשרת. בדקו את החיבור לאינטרנט');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 401 && path !== '/auth/login') {
        clearSession();
        location.reload();
        throw new Error('נדרשת כניסה מחדש');
    }
    if (!data || !data.ok) {
        const err = new Error(data && data.error ? data.error.message : `שגיאה (${res.status})`);
        err.code = data && data.error ? data.error.code : null;
        throw err;
    }
    return data.data;
}
export const get = p => api('GET', p);
export const post = (p, b) => api('POST', p, b || {});
export const put = (p, b) => api('PUT', p, b || {});
export const del = (p, b) => api('DELETE', p, b);
export const setToken = t => store.set(TOKEN_KEY, t);
export const getToken = () => store.get(TOKEN_KEY);

// ---------- הודעות ----------
const NTF_ICONS = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
export function notify(message, type = 'info') {
    let stack = document.getElementById('ntfStack');
    if (!stack) { stack = document.createElement('div'); stack.id = 'ntfStack'; document.body.appendChild(stack); }
    const el = document.createElement('div');
    el.className = `ntf ${type}`;
    el.innerHTML = `<i class="fas ${NTF_ICONS[type] || NTF_ICONS.info}"></i><span></span>`;
    el.querySelector('span').textContent = message;
    stack.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, type === 'error' ? 6000 : 3500);
}
export const ok = m => notify(m, 'success');
export const fail = e => notify(e && e.message ? e.message : String(e), 'error');

// ---------- חלון ----------
// buttons: [{ label, cls, icon, action: async (modalEl) => false כדי להשאיר פתוח }]
export function modal({ title, icon = '', body, buttons = [], wide = false, onOpen }) {
    const back = document.createElement('div');
    back.className = 'modal';
    back.innerHTML = `<div class="modal-content ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-header"><h3>${icon ? `<i class="fas ${icon}"></i>` : ''}${esc(title)}</h3><button class="close-modal-btn" aria-label="סגירה">&times;</button></div>
        <div class="modal-body">${body}</div>
        ${buttons.length ? `<div class="modal-footer">${buttons.map((b, i) => `<button class="btn ${b.cls || 'btn-outline'}" data-i="${i}">${b.icon ? `<i class="fas ${b.icon}"></i>` : ''}${esc(b.label)}</button>`).join('')}</div>` : ''}
    </div>`;
    // נסגר רק בכפתור X (או בכפתורי החלון) — לא בלחיצה על הרקע ולא ב-Esc
    const close = () => back.remove();
    back.querySelector('.close-modal-btn').onclick = close;
    back.querySelectorAll('.modal-footer .btn').forEach(btn => {
        btn.onclick = async () => {
            const b = buttons[+btn.dataset.i];
            if (!b.action) return close();
            btn.disabled = true;
            try {
                if (await b.action(back) !== false) close();
            } catch (e) {
                fail(e);
            } finally {
                btn.disabled = false;
            }
        };
    });
    const form = back.querySelector('form');
    if (form) form.addEventListener('submit', e => { e.preventDefault(); const p = back.querySelector('.modal-footer .btn-primary'); if (p) p.click(); });
    document.body.appendChild(back);
    const first = back.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=file]), select, textarea');
    if (first) first.focus();
    if (onOpen) onOpen(back);
    return { el: back, close };
}

export function confirmDialog(title, text, { okLabel = 'אישור', danger = false } = {}) {
    return new Promise(resolve => {
        let answered = false;
        const done = v => { if (!answered) { answered = true; resolve(v); } };
        const m = modal({
            title, icon: danger ? 'fa-exclamation-triangle' : 'fa-question-circle', body: `<p>${text}</p>`,
            buttons: [{ label: okLabel, cls: danger ? 'btn-danger-solid' : 'btn-primary', action: () => done(true) }, { label: 'ביטול', action: () => done(false) }]
        });
        new MutationObserver((_, obs) => { if (!document.body.contains(m.el)) { obs.disconnect(); done(false); } }).observe(document.body, { childList: true });
    });
}

export function formData(form) {
    const out = {};
    for (const el of form.elements) {
        if (!el.name) continue;
        out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return out;
}

// ---------- ניווט ----------
const VIEWS = {
    dashboard: { title: 'לוח בקרה', icon: 'fa-chart-pie', view: DashboardView, scope: 'tenant' },
    students: { title: 'תלמידים', icon: 'fa-user-graduate', view: StudentsView, scope: 'tenant' },
    classes: { title: 'כיתות ומלמדים', icon: 'fa-chalkboard-teacher', view: ClassesView, scope: 'tenant' },
    meetings: { title: 'אסיפות', icon: 'fa-calendar-alt', view: MeetingsView, scope: 'tenant' },
    admin: { title: 'מוסדות והרשאות', icon: 'fa-user-shield', view: AdminView, scope: 'super' }
};

function route() {
    const [page, query] = location.hash.replace(/^#\/?/, '').split('?');
    return { page, params: Object.fromEntries(new URLSearchParams(query || '')) };
}

export function go(page, params) {
    const target = `#${page}${params ? '?' + new URLSearchParams(params) : ''}`;
    if (location.hash === target) render(); else location.hash = target;
}

const inTenant = () => !!(state.user.tenant || state.tenantOverride);

export function enterTenant(tenant) {
    state.tenantOverride = tenant ? tenant.id : null;
    state.tenantName = tenant ? tenant.name : null;
    store.set(TENANT_KEY, tenant ? JSON.stringify(tenant) : null);
    buildShell();
    go(tenant ? 'dashboard' : 'admin');
}

function buildShell() {
    const u = state.user;
    const isSuper = u.role === 'super';
    const items = Object.entries(VIEWS).filter(([, v]) => v.scope === 'tenant' ? inTenant() : isSuper);
    $('#menu').innerHTML = items.map(([k, v]) => `<a href="#${k}" class="menu-item" data-page="${k}"><i class="fas ${v.icon}"></i> ${v.title}</a>`).join('')
        + `<div style="flex:1"></div>
        <div class="sidebar-footer"><div class="logo-wrapper"><img src="https://smt-tel-manager.netlify.app/smt.png" alt="SMT" class="smt-logo" draggable="false"></div>
            <div class="developer-credit">פותח ע"י שימי טרייטל</div></div>
        <a href="#" class="menu-item logout-btn" id="logoutBtn"><i class="fas fa-sign-out-alt"></i> התנתק</a>`;
    const tenantName = u.tenant ? u.tenant.name : state.tenantName;
    $('#tenantName').textContent = tenantName || (isSuper ? 'ניהול-על' : '');
    $('#topbar-info').innerHTML = (isSuper ? `<span class="topbar-badge admin-badge"><i class="fas fa-shield-alt"></i> מנהל-על</span>` : '')
        + (isSuper && state.tenantOverride ? `<span class="topbar-badge tenant-badge"><i class="fas fa-school"></i> ${esc(tenantName)} <button id="leaveTenant">יציאה מהמוסד</button></span>` : '')
        + `<span class="topbar-badge"><i class="fas fa-${u.method === 'ip' ? 'network-wired' : 'user'}"></i> ${esc(u.name)}</span>`;
    $('#logoutBtn').onclick = async e => {
        e.preventDefault();
        try { await post('/auth/logout'); } catch (er) { /* ignore */ }
        clearSession();
        store.set(TENANT_KEY, null);
        location.hash = '';
        location.reload();
    };
    const leave = $('#leaveTenant');
    if (leave) leave.onclick = () => enterTenant(null);
}

export async function render() {
    if (!state.user) return;
    let { page, params } = route();
    const allowed = k => VIEWS[k] && (VIEWS[k].scope === 'tenant' ? inTenant() : state.user.role === 'super');
    if (!allowed(page)) page = inTenant() ? 'dashboard' : 'admin';
    const def = VIEWS[page];
    $$('.menu-item[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === page));
    $('#pageTitle').textContent = def.title;
    document.title = `${def.title} · אסיפת הורים`;
    const el = $('#view');
    el.innerHTML = loading();
    try {
        await def.view.render(el, params);
    } catch (e) {
        el.innerHTML = `<div class="notice warning"><i class="fas fa-exclamation-triangle"></i><span>${esc(e.message)}</span></div>`;
    }
}

// ---------- הפעלה ----------
async function start(user) {
    state.user = user;
    if (user.role === 'super') {
        try {
            const t = JSON.parse(store.get(TENANT_KEY) || 'null');
            if (t && t.id) { state.tenantOverride = t.id; state.tenantName = t.name; }
        } catch (e) { /* ignore */ }
    }
    $('#auth-overlay').style.display = 'none';
    $('#mainContainer').classList.remove('hidden');
    buildShell();
    window.addEventListener('hashchange', render);
    render();
}

setupLogin(start);
