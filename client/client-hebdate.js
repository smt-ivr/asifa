// ============================================================
//  client-hebdate.js — תאריך עברי מלא: "יום שלישי, י״ב בכסלו תשפ״ז"
// ============================================================

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];

// 12 -> י״ב · 15 -> ט״ו · 787 -> תשפ״ז
export function gematria(n) {
    n = n % 1000;
    let s = HUNDREDS[Math.floor(n / 100)];
    const rest = n % 100;
    if (rest === 15) s += 'טו';
    else if (rest === 16) s += 'טז';
    else s += TENS[Math.floor(rest / 10)] + ONES[rest % 10];
    return s.length === 1 ? `${s}׳` : `${s.slice(0, -1)}״${s.slice(-1)}`;
}

export function weekday(dateStr) {
    return DAYS[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
}

export function hebrewDate(dateStr, { withDay = true, withYear = true } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return '';
    try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
            .formatToParts(new Date(`${dateStr}T12:00:00Z`)).map(p => [p.type, p.value]));
        const day = gematria(parseInt(parts.day, 10));
        const year = withYear ? ` ${gematria(parseInt(parts.year, 10))}` : '';
        return `${withDay ? `יום ${weekday(dateStr)}, ` : ''}${day} ב${parts.month}${year}`;
    } catch (e) {
        return '';
    }
}

// "12/11/2026"
export const gregorian = dateStr => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    return m ? `${+m[3]}/${+m[2]}/${m[1]}` : '';
};
