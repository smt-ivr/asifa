// ============================================================
//  http.js — תגובות JSON אחידות, שגיאות API וקריאת גוף בקשה
//  הצלחה:  { ok: true, data }
//  כישלון: { ok: false, error: { code, message } }  + קוד HTTP מתאים
// ============================================================

export const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant',
    'Access-Control-Max-Age': '86400'
};

export class ApiError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export const badRequest = (message, code = 'bad_request') => new ApiError(400, code, message);
export const notFound = (message = 'הפריט לא נמצא') => new ApiError(404, 'not_found', message);
export const forbidden = (message = 'אין הרשאה לפעולה זו') => new ApiError(403, 'forbidden', message);
export const conflict = (message, code = 'conflict') => new ApiError(409, code, message);
export const unauthorized = (message = 'נדרשת כניסה למערכת') => new ApiError(401, 'unauthorized', message);

export function json(data, status = 200, extra = {}) {
    return new Response(JSON.stringify({ ok: true, data }), {
        status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
    });
}

export function errorResponse(err) {
    const status = err instanceof ApiError ? err.status : 500;
    const code = err instanceof ApiError ? err.code : 'server_error';
    const message = err instanceof ApiError ? err.message : 'אירעה תקלה בשרת';
    if (!(err instanceof ApiError)) console.error(err && err.stack || err);
    return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
        status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
}

export async function readJson(request) {
    try {
        const body = await request.json();
        if (!body || typeof body !== 'object') throw new Error();
        return body;
    } catch (e) {
        throw badRequest('גוף הבקשה אינו JSON תקין');
    }
}

// עזרי ולידציה
export const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const int = v => {
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
};
export const bool = v => (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;

export function required(value, label) {
    if (value === null || value === undefined || value === '') throw badRequest(`חסר ${label}`, 'missing_field');
    return value;
}
