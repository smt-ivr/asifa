// ============================================================
//  http.js — תגובות JSON אחידות ושגיאות
//  הצלחה:  { ok: true, data }
//  כישלון: { ok: false, error: { code, message } }  + קוד HTTP מתאים
// ============================================================

export const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant'
};

export class ApiError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export const badRequest = (message, code = 'bad_request') => new ApiError(400, code, message);
export const unauthorized = (message = 'נדרשת כניסה למערכת') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'אין הרשאה לפעולה זו') => new ApiError(403, 'forbidden', message);
export const notFound = (message = 'הפריט לא נמצא') => new ApiError(404, 'not_found', message);
export const conflict = (message, code = 'conflict') => new ApiError(409, code, message);

const headers = { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export const json = (data, status = 200) => new Response(JSON.stringify({ ok: true, data }), { status, headers });

export function errorResponse(err) {
    const known = err instanceof ApiError;
    if (!known) console.error(err && err.stack || err);
    return new Response(JSON.stringify({
        ok: false,
        error: { code: known ? err.code : 'server_error', message: known ? err.message : 'אירעה תקלה בשרת, נסו שוב' }
    }), { status: known ? err.status : 500, headers });
}

export async function readJson(request) {
    try {
        const body = await request.json();
        if (body && typeof body === 'object') return body;
    } catch (e) { /* נופל לשגיאה */ }
    throw badRequest('גוף הבקשה אינו JSON תקין');
}

export const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const int = v => {
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
};
