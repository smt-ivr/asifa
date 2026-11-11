// ============================================================
//  time.js — זמן ישראל, המרות שעות ודקות, והקראת זמנים ותאריכים בעברית
// ============================================================

const TZ = 'Asia/Jerusalem';
const pad = n => String(n).padStart(2, '0');

// { date: 'YYYY-MM-DD', time: 'HH:MM', min: דקות מחצות, stamp: 'YYYY-MM-DD HH:MM:SS' }
export function nowIL(d = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(d).map(p => [p.type, p.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const time = `${parts.hour}:${parts.minute}`;
    return { date, time, min: +parts.hour * 60 + +parts.minute, stamp: `${date} ${time}:${parts.second}` };
}

export const stamp = () => nowIL().stamp;

export const minToHHMM = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export function hhmmToMin(s) {
    const m = /^(\d{1,2}):?(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
}

export const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s));

// ---------- הקראה ----------
const HOURS = ['שתים עשרה', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע', 'עשר', 'אחת עשרה'];
const UNITS = ['', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'];
const TEENS = ['עשר', 'אחת עשרה', 'שתים עשרה', 'שלוש עשרה', 'ארבע עשרה', 'חמש עשרה', 'שש עשרה', 'שבע עשרה', 'שמונה עשרה', 'תשע עשרה'];
const TENS = ['', '', 'עשרים', 'שלושים', 'ארבעים', 'חמישים'];

function minutesWords(n) {
    if (n < 10) return UNITS[n];
    if (n < 20) return TEENS[n - 10];
    const t = TENS[Math.floor(n / 10)], u = n % 10;
    return u ? `${t} ו${UNITS[u]}` : t;
}

// 1935 -> "שבע ושלושים וחמש דקות"
export function speakTime(min) {
    const h = Math.floor(min / 60) % 12, m = min % 60;
    const hour = HOURS[h];
    if (m === 0) return hour;
    if (m === 15) return `${hour} ורבע`;
    if (m === 30) return `${hour} וחצי`;
    if (m === 45) return `רבע ל${HOURS[(h + 1) % 12]}`;
    return `${hour} ו${minutesWords(m)} דקות`;
}

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function weekday(dateStr) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    return DAYS[d.getUTCDay()];
}

// תאריך עברי ללא גרשיים ושנה: "יב כסלו"
export function hebrewDate(dateStr, { withYear = false } = {}) {
    try {
        const d = new Date(`${dateStr}T12:00:00Z`);
        const f = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { timeZone: 'UTC', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) });
        return f.format(d).replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim();
    } catch (e) {
        return '';
    }
}

// "ביום שלישי יב כסלו"
export function speakDate(dateStr) {
    const h = hebrewDate(dateStr);
    return `ביום ${weekday(dateStr)}${h ? ` ${h}` : ''}`;
}

// 1-30 באותיות: 3 -> ג׳, 15 -> ט״ו, 22 -> כ״ב
function gematria(n) {
    const special = { 15: 'טו', 16: 'טז' };
    const tens = ['', 'י', 'כ', 'ל'], ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    const s = special[n] || tens[Math.floor(n / 10)] + ones[n % 10];
    return s.length === 1 ? `${s}׳` : `${s.slice(0, -1)}״${s.slice(-1)}`;
}

// "יום שלישי, י״ב בכסלו (12/11)" לתצוגה ולהדפסה
export function displayDate(dateStr) {
    const [, m, d] = dateStr.split('-');
    let heb = '';
    try {
        heb = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(`${dateStr}T12:00:00Z`))
            .replace(/^(\d{1,2})/, (_, n) => gematria(+n));
    } catch (e) { /* ignore */ }
    return `יום ${weekday(dateStr)}${heb ? `, ${heb}` : ''} (${+d}/${+m})`;
}
