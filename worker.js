// ============================================================
//  worker.js — נקודת הכניסה
//    /asifa/            אתר הניהול (קבצי client/)
//    /asifa/api/...     API (JSON, Authorization: Bearer <token>)
// ============================================================
import indexHtml from './client/index.html';
import stylesCss from './client/styles.css';
import loginCss from './client/login.css';
import mobileCss from './client/mobile.css';
import clientAppJs from './client/client-app.js';
import clientLoginJs from './client/client-login.js';
import clientHebdateJs from './client/client-hebdate.js';
import clientDashboardJs from './client/client-dashboard.js';
import clientStudentsJs from './client/client-students.js';
import clientClassesJs from './client/client-classes.js';
import clientMeetingsJs from './client/client-meetings.js';
import clientAdminJs from './client/client-admin.js';

import { CORS, json, errorResponse, notFound } from './http.js';
import { ensureSchema } from './migrate.js';
import { login, loginGoogle, loginOptions, logout, authenticate, requireSuper } from './auth.js';
import { listTenants, createTenant, updateTenant, deleteTenant, listAccess, createAccess, updateAccess, deleteAccess, loginLog, welcomeEmail, previewTemplate, testMail } from './admin.js';
import { getSettings, updateSettings } from './settings.js';
import { listClasses, createClass, updateClass, deleteClass } from './classes.js';
import { listStudents, createStudent, updateStudent, deleteStudent, deleteStudents, importStudents } from './students.js';
import { listMeetings, createMeeting, meetingDetails, updateMeeting, deleteMeeting } from './meetings.js';
import { dashboard } from './dashboard.js';

const API_VERSION = '2.0.0';
const BASE = '/asifa';

const JS = 'application/javascript', CSS = 'text/css';
const FILES = {
    '/styles.css': [stylesCss, CSS],
    '/login.css': [loginCss, CSS],
    '/mobile.css': [mobileCss, CSS],
    '/client-app.js': [clientAppJs, JS],
    '/client-login.js': [clientLoginJs, JS],
    '/client-hebdate.js': [clientHebdateJs, JS],
    '/client-dashboard.js': [clientDashboardJs, JS],
    '/client-students.js': [clientStudentsJs, JS],
    '/client-classes.js': [clientClassesJs, JS],
    '/client-meetings.js': [clientMeetingsJs, JS],
    '/client-admin.js': [clientAdminJs, JS]
};

// [שיטה, נתיב, פעולה(request, env, ctx, params, url)] — כולם דורשים כניסה
const ROUTES = [
    ['GET', /^\/auth\/me$/, (r, e, c) => c.user],
    ['POST', /^\/auth\/logout$/, (r, e) => logout(r, e)],

    ['GET', /^\/admin\/tenants$/, (r, e, c) => listTenants(e, c)],
    ['POST', /^\/admin\/tenants$/, (r, e, c) => createTenant(r, e, c)],
    ['PUT', /^\/admin\/tenants\/(\d+)$/, (r, e, c, p) => updateTenant(r, e, c, +p[1])],
    ['DELETE', /^\/admin\/tenants\/(\d+)$/, (r, e, c, p) => deleteTenant(r, e, c, +p[1])],
    ['GET', /^\/admin\/access$/, (r, e, c, p, u) => listAccess(e, c, u)],
    ['POST', /^\/admin\/access$/, (r, e, c) => createAccess(r, e, c)],
    ['PUT', /^\/admin\/access\/(\d+)$/, (r, e, c, p) => updateAccess(r, e, c, +p[1])],
    ['DELETE', /^\/admin\/access\/(\d+)$/, (r, e, c, p) => deleteAccess(e, c, +p[1])],
    ['POST', /^\/admin\/access\/(\d+)\/welcome$/, (r, e, c, p) => welcomeEmail(r, e, c, +p[1])],
    ['GET', /^\/admin\/settings$/, (r, e, c) => getSettings(e, c)],
    ['PUT', /^\/admin\/settings$/, (r, e, c) => updateSettings(r, e, c)],
    ['POST', /^\/admin\/settings\/preview$/, (r, e, c) => previewTemplate(r, e, c)],
    ['POST', /^\/admin\/settings\/test-mail$/, (r, e, c) => testMail(r, e, c)],
    ['GET', /^\/admin\/login-log$/, (r, e, c) => loginLog(e, c)],
    ['GET', /^\/admin\/my-ip$/, (r, e, c) => { requireSuper(c); return { ip: r.headers.get('cf-connecting-ip') || '' }; }],

    ['GET', /^\/dashboard$/, (r, e, c) => dashboard(e, c)],

    ['GET', /^\/classes$/, (r, e, c) => listClasses(e, c)],
    ['POST', /^\/classes$/, (r, e, c) => createClass(r, e, c)],
    ['PUT', /^\/classes\/(\d+)$/, (r, e, c, p) => updateClass(r, e, c, +p[1])],
    ['DELETE', /^\/classes\/(\d+)$/, (r, e, c, p) => deleteClass(e, c, +p[1])],

    ['GET', /^\/students$/, (r, e, c, p, u) => listStudents(e, c, u)],
    ['POST', /^\/students$/, (r, e, c) => createStudent(r, e, c)],
    ['POST', /^\/students\/import$/, (r, e, c) => importStudents(r, e, c)],
    ['POST', /^\/students\/delete$/, (r, e, c) => deleteStudents(r, e, c)],
    ['PUT', /^\/students\/(\d+)$/, (r, e, c, p) => updateStudent(r, e, c, +p[1])],
    ['DELETE', /^\/students\/(\d+)$/, (r, e, c, p) => deleteStudent(e, c, +p[1])],

    ['GET', /^\/meetings$/, (r, e, c) => listMeetings(e, c)],
    ['POST', /^\/meetings$/, (r, e, c) => createMeeting(r, e, c)],
    ['GET', /^\/meetings\/(\d+)$/, (r, e, c, p) => meetingDetails(e, c, +p[1])],
    ['PUT', /^\/meetings\/(\d+)$/, (r, e, c, p) => updateMeeting(r, e, c, +p[1])],
    ['DELETE', /^\/meetings\/(\d+)$/, (r, e, c, p) => deleteMeeting(e, c, +p[1])]
];

async function handleApi(request, env, path, url) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    await ensureSchema(env);
    if (path === '' || path === '/') return json({ name: 'asifa', version: API_VERSION });
    if (path === '/auth/login' && request.method === 'POST') return json(await login(request, env));
    if (path === '/auth/google' && request.method === 'POST') return json(await loginGoogle(request, env));
    if (path === '/auth/options' && request.method === 'GET') return json(await loginOptions(env));
    for (const [method, re, handler] of ROUTES) {
        if (method !== request.method) continue;
        const p = re.exec(path);
        if (!p) continue;
        const ctx = await authenticate(request, env);
        return json(await handler(request, env, ctx, p, url));
    }
    throw notFound('הנתיב לא נמצא');
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        let path = url.pathname;
        if (path === BASE) return Response.redirect(`${url.origin}${BASE}/`, 301);
        if (!path.startsWith(`${BASE}/`)) return new Response('Not found', { status: 404 });
        path = path.slice(BASE.length);

        if (path === '/api' || path.startsWith('/api/')) {
            try {
                return await handleApi(request, env, path.slice(4), url);
            } catch (e) {
                return errorResponse(e);
            }
        }
        const file = FILES[path];
        if (file) return new Response(file[0], { headers: { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' } });
        return new Response(indexHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }
};
