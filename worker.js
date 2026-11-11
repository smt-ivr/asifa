// ============================================================
//  worker.js — נקודת הכניסה: אתר הניהול (client/), ה-API והקו הטלפוני
//    /asifa/               אתר הניהול
//    /asifa/api/...        API (JSON, Authorization: Bearer)
//    /asifa/api/yemot      שלוחת API לימות המשיח (טקסט)
// ============================================================
import indexHtml from './client/index.html';
import stylesCss from './client/styles.css';
import printCss from './client/print.css';
import clientAppJs from './client/client-app.js';
import clientLoginJs from './client/client-login.js';
import clientDashboardJs from './client/client-dashboard.js';
import clientMeetingsJs from './client/client-meetings.js';
import clientBoardJs from './client/client-board.js';
import clientStudentsJs from './client/client-students.js';
import clientClassesJs from './client/client-classes.js';
import clientPrintJs from './client/client-print.js';
import clientSettingsJs from './client/client-settings.js';
import clientAdminJs from './client/client-admin.js';

import { CORS, json, errorResponse, notFound, ApiError } from './http.js';
import { ensureSchema } from './migrate.js';
import { login, logout, authenticate, me, changePassword } from './auth.js';
import { listTenants, createTenant, updateTenant } from './tenants.js';
import { getSettings, updateSettings } from './settings.js';
import { listUsers, createUser, updateUser, deleteUser } from './users.js';
import { listClasses, createClass, updateClass, deleteClass } from './classes.js';
import { listStudents, createStudent, updateStudent, deleteStudent, importStudents } from './students.js';
import {
    listMeetings, meetingDetails, createMeeting, updateMeeting, deleteMeeting, setStatus, runAutoAssign, sendMeetingTzintuk,
    board, report, available, webBook, webCancel, webAbsence, updateAbsence, deleteAbsence, callLog
} from './meetings.js';
import { tzintukLog } from './tzintuk.js';
import { handleYemotParents } from './yemot_parents.js';
import { runScheduled } from './scheduled.js';

const API_VERSION = '1.0.0';
const BASE = '/asifa';
const BACKGROUND_EVERY_MS = 2 * 60 * 1000;
let lastBackground = 0;

// משימות אוטומטיות "על הדרך" — גיבוי למתזמן החיצוני
function backgroundJobs(env, ctx) {
    const now = Date.now();
    if (now - lastBackground < BACKGROUND_EVERY_MS) return;
    lastBackground = now;
    ctx.waitUntil(runScheduled(env).catch(e => console.error('background jobs', e && e.stack || e)));
}

const STATIC = {
    '/': [indexHtml, 'text/html'],
    '/index.html': [indexHtml, 'text/html'],
    '/styles.css': [stylesCss, 'text/css'],
    '/print.css': [printCss, 'text/css'],
    '/client-app.js': [clientAppJs, 'application/javascript'],
    '/client-login.js': [clientLoginJs, 'application/javascript'],
    '/client-dashboard.js': [clientDashboardJs, 'application/javascript'],
    '/client-meetings.js': [clientMeetingsJs, 'application/javascript'],
    '/client-board.js': [clientBoardJs, 'application/javascript'],
    '/client-students.js': [clientStudentsJs, 'application/javascript'],
    '/client-classes.js': [clientClassesJs, 'application/javascript'],
    '/client-print.js': [clientPrintJs, 'application/javascript'],
    '/client-settings.js': [clientSettingsJs, 'application/javascript'],
    '/client-admin.js': [clientAdminJs, 'application/javascript']
};

// [method, regex, handler(request, env, ctx, params, url)] — כל הנתיבים כאן דורשים כניסה
const ROUTES = [
    ['GET', /^\/auth\/me$/, (r, e, c) => me(c)],
    ['POST', /^\/auth\/logout$/, (r, e) => logout(r, e)],
    ['POST', /^\/auth\/password$/, (r, e, c) => changePassword(r, e, c)],

    ['GET', /^\/tenants$/, (r, e, c) => listTenants(e, c)],
    ['POST', /^\/tenants$/, (r, e, c) => createTenant(r, e, c)],
    ['PUT', /^\/tenants\/(\d+)$/, (r, e, c, p) => updateTenant(r, e, c, +p[1])],

    ['GET', /^\/settings$/, (r, e, c) => getSettings(e, c)],
    ['PUT', /^\/settings$/, (r, e, c) => updateSettings(r, e, c)],

    ['GET', /^\/users$/, (r, e, c) => listUsers(e, c)],
    ['POST', /^\/users$/, (r, e, c) => createUser(r, e, c)],
    ['PUT', /^\/users\/(\d+)$/, (r, e, c, p) => updateUser(r, e, c, +p[1])],
    ['DELETE', /^\/users\/(\d+)$/, (r, e, c, p) => deleteUser(e, c, +p[1])],

    ['GET', /^\/classes$/, (r, e, c) => listClasses(e, c)],
    ['POST', /^\/classes$/, (r, e, c) => createClass(r, e, c)],
    ['PUT', /^\/classes\/(\d+)$/, (r, e, c, p) => updateClass(r, e, c, +p[1])],
    ['DELETE', /^\/classes\/(\d+)$/, (r, e, c, p) => deleteClass(e, c, +p[1])],

    ['GET', /^\/students$/, (r, e, c, p, u) => listStudents(e, c, u)],
    ['POST', /^\/students$/, (r, e, c) => createStudent(r, e, c)],
    ['POST', /^\/students\/import$/, (r, e, c) => importStudents(r, e, c)],
    ['PUT', /^\/students\/(\d+)$/, (r, e, c, p) => updateStudent(r, e, c, +p[1])],
    ['DELETE', /^\/students\/(\d+)$/, (r, e, c, p) => deleteStudent(e, c, +p[1])],

    ['GET', /^\/meetings$/, (r, e, c) => listMeetings(e, c)],
    ['POST', /^\/meetings$/, (r, e, c) => createMeeting(r, e, c)],
    ['GET', /^\/meetings\/(\d+)$/, (r, e, c, p) => meetingDetails(e, c, +p[1])],
    ['PUT', /^\/meetings\/(\d+)$/, (r, e, c, p) => updateMeeting(r, e, c, +p[1])],
    ['DELETE', /^\/meetings\/(\d+)$/, (r, e, c, p) => deleteMeeting(e, c, +p[1])],
    ['POST', /^\/meetings\/(\d+)\/status$/, (r, e, c, p) => setStatus(r, e, c, +p[1])],
    ['POST', /^\/meetings\/(\d+)\/auto-assign$/, (r, e, c, p) => runAutoAssign(e, c, +p[1])],
    ['POST', /^\/meetings\/(\d+)\/tzintuk$/, (r, e, c, p) => sendMeetingTzintuk(r, e, c, +p[1])],
    ['GET', /^\/meetings\/(\d+)\/tzintuk$/, (r, e, c, p) => tzintukLog(e, c, +p[1])],
    ['GET', /^\/meetings\/(\d+)\/board$/, (r, e, c, p, u) => board(e, c, +p[1], u)],
    ['GET', /^\/meetings\/(\d+)\/report$/, (r, e, c, p) => report(e, c, +p[1])],
    ['GET', /^\/meetings\/(\d+)\/available$/, (r, e, c, p, u) => available(e, c, +p[1], u)],
    ['POST', /^\/meetings\/(\d+)\/bookings$/, (r, e, c, p) => webBook(r, e, c, +p[1])],
    ['DELETE', /^\/meetings\/(\d+)\/bookings\/(\d+)$/, (r, e, c, p) => webCancel(e, c, +p[1], +p[2])],
    ['POST', /^\/meetings\/(\d+)\/absences$/, (r, e, c, p) => webAbsence(r, e, c, +p[1])],
    ['PUT', /^\/meetings\/(\d+)\/absences\/(\d+)$/, (r, e, c, p) => updateAbsence(r, e, c, +p[1], +p[2])],
    ['DELETE', /^\/meetings\/(\d+)\/absences\/(\d+)$/, (r, e, c, p) => deleteAbsence(e, c, +p[1], +p[2])],

    ['GET', /^\/calls$/, (r, e, c) => callLog(e, c)],
    ['GET', /^\/tzintuk$/, (r, e, c) => tzintukLog(e, c, null)]
];

// ימות המשיח יכול לשלוח POST — מאחדים את הפרמטרים לכתובת
async function yemotRequest(request) {
    if (request.method !== 'POST') return request;
    const url = new URL(request.url);
    try {
        const form = await request.formData();
        for (const [k, v] of form.entries()) if (!url.searchParams.has(k)) url.searchParams.append(k, String(v));
    } catch (e) { /* גוף ריק */ }
    return new Request(url.toString(), { method: 'GET', headers: request.headers });
}

async function handleApi(request, env, path, url) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (path === '' || path === '/') return json({ name: 'asifa', version: API_VERSION });
    if (path === '/auth/login' && request.method === 'POST') return json(await login(request, env));

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
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        let path = url.pathname;
        if (path === BASE) return Response.redirect(`${url.origin}${BASE}/`, 301);
        if (!path.startsWith(`${BASE}/`)) return new Response('Not found', { status: 404 });
        path = path.slice(BASE.length);

        if (path === '/api/cron') {
            try {
                const key = request.headers.get('X-Cron-Key') || url.searchParams.get('key') || '';
                if (!env.CRON_KEY || key !== env.CRON_KEY) return errorResponse(new ApiError(403, 'forbidden', 'מפתח שגוי'));
                await ensureSchema(env);
                await runScheduled(env);
                lastBackground = Date.now();
                return json({ ran: true });
            } catch (e) {
                return errorResponse(e);
            }
        }

        if (path === '/api/yemot' || path === '/api/yemot/') {
            try {
                await ensureSchema(env);
                backgroundJobs(env, ctx);
                return await handleYemotParents(await yemotRequest(request), env);
            } catch (e) {
                console.error('yemot error', e && e.stack || e);
                return new Response('id_list_message=t-אירעה תקלה זמנית במערכת נסו שוב מאוחר יותר&go_to_folder=hangup', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
        }

        if (path === '/api' || path.startsWith('/api/')) {
            try {
                await ensureSchema(env);
                backgroundJobs(env, ctx);
                return await handleApi(request, env, path.slice(4), url);
            } catch (e) {
                return errorResponse(e);
            }
        }

        const file = STATIC[path];
        if (file) {
            return new Response(file[0], {
                headers: { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': path === '/' || path === '/index.html' ? 'no-cache' : 'public, max-age=300' }
            });
        }
        // ניתוב צד-לקוח (#) — כל נתיב אחר מחזיר את האתר
        return new Response(indexHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil((async () => {
            await ensureSchema(env);
            await runScheduled(env);
        })());
    }
};
