// ============================================================
//  time.js — זמן ישראל
// ============================================================

export function getLocalTime(d = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(d).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s));
export const validTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
export const toMinutes = s => +s.slice(0, 2) * 60 + +s.slice(3, 5);
