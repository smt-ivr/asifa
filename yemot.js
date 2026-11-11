// ============================================================
//  yemot.js — הקו הטלפוני להורים (שלוחת API של ימות המשיח)
//
//  כתובת השלוחה (api_link) — בלי פרמטרים בקישור; המזהה של המוסד בנתיב:
//      type=api
//      api_link=https://smti.uk/asifa/api/yemot/<מזהה מוסד>
//  חלופות לזיהוי המוסד: api_add_0=tenant=<מזהה>, או מספר החיוג (ApiRealDID / ApiDID) שמוגדר למוסד.
//
//  ימות שולח את כל מה שנאסף בשיחה בכל בקשה. כל שאלה נשמרת בפרמטר חדש וייחודי:
//      a{מספר}_{שלב}_{תלמיד}_{אורך}_{נוסף}_{תלמיד-לפי-ת"ז}
//  (שם פרמטר לא חוזר על עצמו — כך ימות דורש). קוראים רק את האחרון (המספר הגבוה).
//  ניתוק: ימות שולח hangup=yes — עונים ריק.
//
//  שלבים:  id  הקשת ת"ז (מספר לא מוכר)       sv  לשמור את המספר? 1/2
//          mm  תפריט ראשי                       ch  בחירת ילד (x = פעולה: 1 תור, 3 לא נגיע, 4 ביטול)
//          du  בחירת אורך פגישה                 of  הצעת שעה (x = השעה בדקות)
//          tm  הקשת שעה מבוקשת                  nx  אחרי קביעה
//          ab  אישור "לא נוכל להגיע"            cx  אישור ביטול           ad  הוספת ילד לפי ת"ז
// ============================================================
import { getLocalTime } from './time.js';
import { tables, ensureTenantSchema } from './tenant_schema.js';
import { phoneSettings, normalizeDid } from './phone.js';
import { normalizePhone } from './students.js';
import { classSetup, bookingOf, availableStarts, preferredOrder, book, cancelBooking, markAbsent, familyBusy } from './bookings.js';

const text = body => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const TIMEOUT = 10;

// טקסט להקראה (t-): בלי נקודה, מקף ותווים שיש להם משמעות בתחביר
const clean = s => String(s || '').replace(/[.,\-=&"'`:;()\[\]{}\n\r_׳״|]/g, ' ').replace(/\s+/g, ' ').trim();
// parts: מחרוזות (t-) או { raw: 'dateH-13/12/2026' }
const prompt = parts => parts.flat().filter(Boolean)
    .map(p => (typeof p === 'object' ? p.raw : (clean(p) ? `t-${clean(p)}` : ''))).filter(Boolean).join('.');

function ask(n, stage, c, parts, { max = 1, allowed = '' } = {}) {
    const name = `a${n}_${stage}_${c.s || 0}_${c.d || 0}_${c.x || 0}_${c.u || 0}`;
    // שדות read: שם, ערך קיים, מקס ספרות, מינ, זמן המתנה, השמעה, חסימת *, חסימת 0, החלפה, מקשים מותרים, ניסיונות, פעולת ריק, ערך ריק, מקלדת, אישור
    return text(`read=${prompt(parts)}=${name},,${max || ''},,${TIMEOUT},NO,,,,${allowed},,,,,no`);
}
const bye = (...parts) => text(`id_list_message=${prompt(parts)}&go_to_folder=hangup`);

function lastStep(url) {
    let best = null;
    for (const [key, value] of url.searchParams.entries()) {
        const m = /^a(\d+)_([a-z]{2})_(\d+)_(\d+)_(\d+)_(\d+)$/.exec(key);
        if (m && (!best || +m[1] > best.n)) best = { n: +m[1], stage: m[2], s: +m[3], d: +m[4], x: +m[5], u: +m[6], value: String(value || '').trim() };
    }
    return best;
}

// ---------- הקראה ----------
const HOURS = ['שתים עשרה', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע', 'עשר', 'אחת עשרה'];
const UNITS = ['', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'];
const TEENS = ['עשר', 'אחת עשרה', 'שתים עשרה', 'שלוש עשרה', 'ארבע עשרה', 'חמש עשרה', 'שש עשרה', 'שבע עשרה', 'שמונה עשרה', 'תשע עשרה'];
const TENS = ['', '', 'עשרים', 'שלושים', 'ארבעים', 'חמישים'];
const minWords = n => (n < 10 ? UNITS[n] : n < 20 ? TEENS[n - 10] : (n % 10 ? `${TENS[Math.floor(n / 10)]} ו${UNITS[n % 10]}` : TENS[n / 10]));
export function speakTime(min) {
    const h = Math.floor(min / 60) % 12, m = min % 60, hour = HOURS[h];
    if (m === 0) return hour;
    if (m === 15) return `${hour} ורבע`;
    if (m === 30) return `${hour} וחצי`;
    if (m === 45) return `רבע ל${HOURS[(h + 1) % 12]}`;
    return `${hour} ו${minWords(m)} דקות`;
}
const speakMinutes = d => (d === 1 ? 'דקה אחת' : d === 2 ? 'שתי דקות' : `${d <= 10 ? ['', '', '', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע', 'עשר'][d] : minWords(d)} דקות`);
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function dateParts(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return [];
    const [y, mo, d] = dateStr.split('-');
    return [`ביום ${DAYS[new Date(`${dateStr}T12:00:00Z`).getUTCDay()]}`, { raw: `dateH-${d}/${mo}/${y}` }];
}

// ---------- נתונים ----------
async function findTenant(env, url, pathId) {
    const byId = async id => (id ? env.DB.prepare('SELECT * FROM tenants WHERE id = ? AND active = 1').bind(id).first() : null);
    let t = await byId(parseInt(pathId, 10)) || await byId(parseInt(url.searchParams.get('tenant') || '', 10));
    for (const k of ['ApiRealDID', 'ApiDID']) {
        if (t) break;
        const did = normalizeDid(url.searchParams.get(k));
        if (did) t = await env.DB.prepare('SELECT t.* FROM tenant_dids d JOIN tenants t ON t.id = d.tenant_id WHERE d.did = ? AND t.active = 1').bind(did).first();
    }
    return t;
}

async function activeMeeting(env, t) {
    const m = await env.DB.prepare(`SELECT * FROM ${t.meetings} WHERE phone_status != 'closed' ORDER BY id DESC LIMIT 1`).first();
    if (!m) return null;
    const now = getLocalTime().slice(0, 16);
    m.open = m.phone_status === 'open' && !(m.booking_closes_at && m.booking_closes_at <= now);
    return m;
}

async function log(env, c, action, studentId = null, details = null) {
    try {
        await env.DB.prepare(`INSERT INTO ${c.t.calls} (phone, call_id, action, student_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(c.phone || null, c.callId, action, studentId, details, getLocalTime()).run();
    } catch (e) { /* היומן לא מפיל שיחה */ }
}

// ילדי המשפחה שמשתתפים באסיפה, כל אחד עם הגדרות הכיתה, התור וההודעה שלו
async function loadFamily(env, c, extraId) {
    const t = c.t;
    const ids = new Set();
    if (c.phone) {
        const { results } = await env.DB.prepare(`SELECT DISTINCT student_id FROM ${t.phones} WHERE phone = ?`).bind(c.phone).all();
        results.forEach(r => ids.add(r.student_id));
    }
    if (extraId) ids.add(extraId);
    if (!ids.size) return [];
    const { results: kids } = await env.DB.prepare(`SELECT s.*, c.name class_name, c.teacher_name, c.sort_order FROM ${t.students} s
        LEFT JOIN ${t.classes} c ON c.id = s.class_id WHERE s.id IN (${[...ids].map(() => '?').join(',')}) ORDER BY c.sort_order, c.name, s.first_name`).bind(...ids).all();
    const out = [];
    for (const k of kids) {
        const setup = k.class_id ? await classSetup(env, c.tenant.id, c.meeting.id, k.class_id) : null;
        if (!setup) continue;
        const booking = await bookingOf(env, c.tenant.id, c.meeting.id, k.id);
        const absent = await env.DB.prepare(`SELECT id FROM ${t.absences} WHERE meeting_id = ? AND student_id = ?`).bind(c.meeting.id, k.id).first();
        out.push({ ...k, setup, booking, absent: !!absent });
    }
    return out;
}

// "כיתה ד׳" -> "כיתה דלת" (אות בודדת עם גרש נקראת כשם האות)
const LETTERS = { 'א': 'אלף', 'ב': 'בית', 'ג': 'גימל', 'ד': 'דלת', 'ה': 'הא', 'ו': 'וו', 'ז': 'זין', 'ח': 'חית', 'ט': 'טית', 'י': 'יוד', 'יא': 'יוד אלף', 'יב': 'יוד בית', 'יג': 'יוד גימל', 'יד': 'יוד דלת' };
const spokenClass = name => String(name || '').replace(/(^|\s)([א-ת]{1,2})(?:['׳"״])?(?=\s|$)/g, (m, sp, l) => (LETTERS[l] ? `${sp}${LETTERS[l]}` : m));
const teacherOf = k => (k.teacher_name ? `אצל המלמד ${k.teacher_name}` : '');
const kidLabel = k => `${k.first_name}${k.class_name ? ` מ${spokenClass(k.class_name)}` : ''}`;

// "שלום יעקב כהן" — לפי שם האב ושם המשפחה של הילד הראשון במשפחה
function greeting(kids) {
    const k = kids.find(x => x.father_name) || kids[0];
    if (!k) return '';
    return k.father_name ? `שלום ${k.father_name} ${k.last_name || ''}` : `שלום למשפחת ${k.last_name || ''}`;
}

function summary(c, kids) {
    const date = dateParts(c.meeting.meeting_date);
    return kids.flatMap(k => {
        if (k.booking) return [`ל${kidLabel(k)} נקבעה פגישה ${teacherOf(k)}`, ...date, `בשעה ${speakTime(k.booking.start_min)}`, `למשך ${speakMinutes(k.booking.duration)}`];
        if (k.absent) return [`לגבי ${kidLabel(k)} עדכנתם שלא תוכלו להגיע והמלמד ייצור עמכם קשר`];
        return [`ל${kidLabel(k)} עדיין לא נקבעה פגישה ${teacherOf(k)}`];
    });
}

function mainMenu(n, c, kids, { withSummary = false, prefix = [] } = {}) {
    const head = [...prefix, ...(withSummary ? summary(c, kids) : [])];
    const s = c.settings;
    if (!c.meeting.open) {
        const opts = ['לשמיעת הפגישות הקישו 2'], allowed = ['2'];
        if (s.allow_absence) { opts.push('להודעה שלא תוכלו להגיע והמלמד ייצור עמכם קשר הקישו 3'); allowed.push('3'); }
        opts.push('לסיום הקישו 9'); allowed.push('9');
        return ask(n, 'mm', { u: c.u }, [...head, s.locked_text, s.locked_note, ...opts], { allowed: allowed.join('') });
    }
    const opts = ['לקביעת פגישה או לשינוי הקישו 1', 'לשמיעת הפגישות שנקבעו הקישו 2'], allowed = ['1', '2'];
    if (s.allow_absence) { opts.push('להודעה שלא תוכלו להגיע והמלמד ייצור עמכם קשר הקישו 3'); allowed.push('3'); }
    if (s.allow_cancel && kids.some(k => k.booking)) { opts.push('לביטול פגישה הקישו 4'); allowed.push('4'); }
    if (s.allow_id_login) { opts.push('להוספת ילד נוסף לפי מספר תעודת זהות הקישו 5'); allowed.push('5'); }
    opts.push('לסיום הקישו 9'); allowed.push('9');
    return ask(n, 'mm', { u: c.u }, [...head, ...opts], { allowed: allowed.join('') });
}

function chooseChild(n, c, kids, action, intro) {
    return ask(n, 'ch', { u: c.u, x: action }, [intro, ...kids.map((k, i) => `ל${kidLabel(k)} הקישו ${i + 1}`), 'לחזרה הקישו 0'],
        { allowed: '0' + kids.map((_, i) => i + 1).join('') });
}

function startBooking(env, n, c, kid, prefix = []) {
    const pre = [...prefix];
    if (kid.booking) pre.push(`ל${kid.first_name} כבר נקבעה פגישה בשעה ${speakTime(kid.booking.start_min)} פגישה חדשה תחליף אותה`);
    const durs = kid.setup.durations;
    if (durs.length > 1) {
        return ask(n, 'du', { u: c.u, s: kid.id }, [...pre, `לקביעת פגישה ל${kid.first_name}`,
            ...durs.map((d, i) => `לפגישה של ${speakMinutes(d)} הקישו ${i + 1}`), 'לחזרה הקישו 0'], { allowed: '0' + durs.map((_, i) => i + 1).join('') });
    }
    return offer(env, n, c, kid, durs[0], null, pre);
}

// after = null: ההצעה המומלצת; אחרת השעה הפנויה הבאה אחרי after (from: כולל after)
async function offer(env, n, c, kid, duration, after, prefix = [], { from = false } = {}) {
    const kids = await loadFamily(env, c, c.u);
    const busy = await familyBusy(env, c.tenant.id, c.meeting.id, kids.map(k => k.id), kid.id);
    const starts = await availableStarts(env, c.tenant.id, c.meeting.id, kid.setup, duration, kid.id, busy);
    if (!starts.length) {
        const other = kid.setup.durations.length > 1 ? ' נסו אורך פגישה אחר' : ' אפשר לעדכן שלא תוכלו להגיע והמלמד ייצור עמכם קשר';
        return mainMenu(n, c, kids, { prefix: [...prefix, `אין יותר שעות פנויות ${teacherOf(kid)} לפגישה של ${speakMinutes(duration)}${other}`] });
    }
    let pick, pre = [...prefix];
    if (after === null) pick = preferredOrder(starts, busy, duration)[0];
    else {
        pick = starts.find(s => (from ? s >= after : s > after));
        if (pick === undefined) { pick = starts[0]; pre.push(from ? 'אין שעה פנויה בשעה שביקשתם או אחריה' : 'אין שעות פנויות נוספות חוזרים לשעה הפנויה הראשונה'); }
        else if (from && pick !== after) pre.push('השעה שביקשתם תפוסה');
    }
    return ask(n, 'of', { u: c.u, s: kid.id, d: duration, x: pick }, [...pre,
        `השעה הפנויה ${after === null ? 'המומלצת ' : ''}ל${kidLabel(kid)} ${teacherOf(kid)}`, ...dateParts(c.meeting.meeting_date), `בשעה ${speakTime(pick)}`,
        'לאישור הקישו 1', 'לשעה פנויה אחרת הקישו 2', 'להקשת שעה מבוקשת הקישו 3', 'לחזרה לתפריט הקישו 0'], { allowed: '1230' });
}

function afterBooking(n, c, kids, prefix) {
    const pending = kids.filter(k => !k.booking && !k.absent);
    const parts = [...prefix];
    let allowed = '29';
    if (pending.length) { parts.push('לקביעת פגישה לילד נוסף הקישו 1'); allowed = '129'; }
    parts.push('לתפריט הראשי הקישו 2', 'לסיום ושמיעת כל הפגישות הקישו 9');
    return ask(n, 'nx', { u: c.u }, parts, { allowed });
}

const finish = (c, kids) => bye(summary(c, kids), 'תודה ולהתראות');

async function studentByIdNumber(env, t, idNumber) {
    const v = String(idNumber || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!v) return null;
    return env.DB.prepare(`SELECT * FROM ${t.students} WHERE ltrim(id_number, '0') = ?`).bind(v).first();
}

async function linkPhone(env, t, studentId, phone) {
    const exists = await env.DB.prepare(`SELECT id FROM ${t.phones} WHERE student_id = ? AND phone = ?`).bind(studentId, phone).first();
    if (!exists) await env.DB.prepare(`INSERT INTO ${t.phones} (student_id, phone, label, sort_order) VALUES (?, ?, 'נשמר בטלפון', 99)`).bind(studentId, phone).run();
}

function confirmAbsence(n, c, kid) {
    return ask(n, 'ab', { u: c.u, s: kid.id }, [kid.booking ? `שימו לב הפגישה של ${kid.first_name} תבוטל` : '',
        `לאישור שלא תוכלו להגיע לגבי ${kid.first_name} והמלמד ייצור עמכם קשר הקישו 1`, 'לחזרה הקישו 0'], { allowed: '10' });
}
function confirmCancel(n, c, kid) {
    return ask(n, 'cx', { u: c.u, s: kid.id }, [`לביטול הפגישה של ${kid.first_name} בשעה ${speakTime(kid.booking.start_min)} הקישו 1`, 'לחזרה הקישו 0'], { allowed: '10' });
}

// ---------- השיחה ----------
export async function handleYemot(url, env, pathId) {
    if (url.searchParams.get('hangup') === 'yes') return text('');

    const tenant = await findTenant(env, url, pathId);
    if (!tenant) return bye('המערכת אינה מוגדרת עבור שלוחה זו');
    await ensureTenantSchema(env, tenant);
    const settings = phoneSettings(tenant);
    const t = tables(tenant.id);
    const phone = normalizePhone(url.searchParams.get('ApiPhone'));
    const c = { tenant, t, settings, phone: /^0\d{8,9}$/.test(phone) ? phone : '', callId: url.searchParams.get('ApiCallId') || null, meeting: null, u: 0 };
    const fillName = s => String(s || '').replace(/\{מוסד\}/g, tenant.name);

    if (!settings.enabled) return bye(settings.closed_text);
    c.meeting = await activeMeeting(env, t);
    const step = lastStep(url);
    const n = step ? step.n + 1 : 1;
    if (!c.meeting) {
        if (!step) await log(env, c, 'call', null, 'אין אסיפה פעילה');
        return bye(settings.closed_text, 'להתראות');
    }
    c.u = step ? step.u : 0;
    const v = step ? step.value : '';

    // ---------- כניסה ----------
    if (!step) {
        await log(env, c, 'call');
        const kids = await loadFamily(env, c, 0);
        const welcome = fillName(settings.welcome_text);
        if (!kids.length) {
            if (!settings.allow_id_login) return bye(welcome, settings.unknown_text, 'נא לפנות למזכירות המוסד');
            return ask(n, 'id', {}, [welcome, c.phone ? settings.unknown_text : '', 'נא הקישו את מספר תעודת הזהות של התלמיד ובסיומו סולמית'], { max: 0 });
        }
        return mainMenu(n, c, kids, { withSummary: true, prefix: [welcome, greeting(kids)] });
    }

    switch (step.stage) {
        case 'id':
        case 'ad': {
            const s = await studentByIdNumber(env, t, v);
            const setup = s && s.class_id ? await classSetup(env, tenant.id, c.meeting.id, s.class_id) : null;
            if (!s) {
                await log(env, c, 'bad_id', null, v);
                if (step.x >= 2) return bye('מספר תעודת הזהות לא נמצא', 'נא לפנות למזכירות המוסד', 'להתראות');
                return ask(n, step.stage, { u: c.u, x: step.x + 1 }, ['מספר תעודת הזהות לא נמצא', 'נא הקישו שוב את מספר תעודת הזהות ובסיומו סולמית'], { max: 0 });
            }
            if (!setup) return bye(`הכיתה של ${s.first_name} אינה משתתפת באסיפה הנוכחית`, 'להתראות');
            if (c.phone && settings.allow_save_phone) {
                if (step.stage === 'ad') {
                    await linkPhone(env, t, s.id, c.phone);
                    await log(env, c, 'link_phone', s.id);
                    c.u = 0;
                    return mainMenu(n, c, await loadFamily(env, c, 0), { withSummary: true, prefix: [`${s.first_name} נוסף בהצלחה`] });
                }
                return ask(n, 'sv', { u: s.id }, [`זוהה התלמיד ${s.first_name} ${s.last_name}`, 'לשמירת מספר הטלפון שלכם כדי שתזוהו אוטומטית בפעם הבאה הקישו 1', 'להמשך בלי לשמור הקישו 2'], { allowed: '12' });
            }
            c.u = s.id;
            const fam = await loadFamily(env, c, s.id);
            return mainMenu(n, c, fam, { withSummary: true, prefix: [`זוהה התלמיד ${s.first_name} ${s.last_name}`, greeting(fam)] });
        }

        case 'sv': {
            if (v === '1' && c.phone) {
                await linkPhone(env, t, step.u, c.phone);
                await log(env, c, 'link_phone', step.u);
                c.u = 0;
                const fam = await loadFamily(env, c, 0);
                return mainMenu(n, c, fam, { withSummary: true, prefix: ['המספר נשמר', greeting(fam)] });
            }
            const fam = await loadFamily(env, c, c.u);
            return mainMenu(n, c, fam, { withSummary: true, prefix: [greeting(fam)] });
        }

        case 'mm': {
            const kids = await loadFamily(env, c, c.u);
            if (!kids.length) return bye('לא נמצאו ילדים המשתתפים באסיפה', 'להתראות');
            if (v === '9') return finish(c, kids);
            if (v === '2') return mainMenu(n, c, kids, { withSummary: true });
            if (v === '1' && c.meeting.open) {
                if (kids.length === 1) return startBooking(env, n, c, kids[0]);
                return chooseChild(n, c, kids, 1, 'לאיזה ילד לקבוע פגישה');
            }
            if (v === '3' && settings.allow_absence) {
                const list = kids.filter(k => !k.absent);
                if (!list.length) return mainMenu(n, c, kids, { prefix: ['כבר עדכנתם לגבי כל הילדים'] });
                if (list.length === 1) return confirmAbsence(n, c, list[0]);
                return chooseChild(n, c, list, 3, 'לגבי איזה ילד לעדכן שלא תוכלו להגיע');
            }
            if (v === '4' && c.meeting.open && settings.allow_cancel) {
                const list = kids.filter(k => k.booking);
                if (!list.length) return mainMenu(n, c, kids, { prefix: ['אין פגישות לביטול'] });
                if (list.length === 1) return confirmCancel(n, c, list[0]);
                return chooseChild(n, c, list, 4, 'איזו פגישה לבטל');
            }
            if (v === '5' && c.meeting.open && settings.allow_id_login) return ask(n, 'ad', { u: c.u }, ['נא הקישו את מספר תעודת הזהות של הילד ובסיומו סולמית'], { max: 0 });
            return mainMenu(n, c, kids, { prefix: ['בחירה לא תקינה'] });
        }

        case 'ch': {
            const kids = await loadFamily(env, c, c.u);
            const list = step.x === 3 ? kids.filter(k => !k.absent) : step.x === 4 ? kids.filter(k => k.booking) : kids;
            if (v === '0') return mainMenu(n, c, kids);
            const kid = list[(parseInt(v, 10) || 0) - 1];
            if (!kid) return chooseChild(n, c, list, step.x, 'בחירה לא תקינה');
            if (step.x === 1) return startBooking(env, n, c, kid);
            if (step.x === 3) return confirmAbsence(n, c, kid);
            return confirmCancel(n, c, kid);
        }

        case 'du': {
            const kids = await loadFamily(env, c, c.u);
            const kid = kids.find(k => k.id === step.s);
            if (!kid || v === '0') return mainMenu(n, c, kids);
            const d = kid.setup.durations[(parseInt(v, 10) || 0) - 1];
            if (!d) return startBooking(env, n, c, kid, ['בחירה לא תקינה']);
            return offer(env, n, c, kid, d, null);
        }

        case 'of': {
            const kids = await loadFamily(env, c, c.u);
            const kid = kids.find(k => k.id === step.s);
            if (!kid || v === '0') return mainMenu(n, c, kids);
            const duration = step.d;
            if (v === '2') return offer(env, n, c, kid, duration, step.x);
            if (v === '3') return ask(n, 'tm', { u: c.u, s: kid.id, d: duration }, ['הקישו את השעה המבוקשת בארבע ספרות', 'לדוגמה לשעה שבע וחצי בערב הקישו אחת תשע שלוש אפס'], { max: 4 });
            if (v !== '1') return offer(env, n, c, kid, duration, step.x, ['בחירה לא תקינה'], { from: true });
            if (!c.meeting.open) return mainMenu(n, c, kids, { prefix: [settings.locked_text] });
            const busy = await familyBusy(env, tenant.id, c.meeting.id, kids.map(k => k.id), kid.id);
            try {
                await book(env, tenant.id, { meetingId: c.meeting.id, setup: kid.setup, studentId: kid.id, start: step.x, duration, source: 'phone', phone: c.phone || null, busy });
            } catch (e) {
                if (e.code === 'slot_taken') return offer(env, n, c, kid, duration, step.x, ['השעה נתפסה הרגע'], { from: true });
                throw e;
            }
            await log(env, c, 'book', kid.id, `${Math.floor(step.x / 60)}:${String(step.x % 60).padStart(2, '0')} · ${duration} דק׳`);
            const fresh = await loadFamily(env, c, c.u);
            return afterBooking(n, c, fresh, ['הפגישה נקבעה בהצלחה', `ל${kidLabel(kid)} ${teacherOf(kid)}`, ...dateParts(c.meeting.meeting_date), `בשעה ${speakTime(step.x)}`]);
        }

        case 'tm': {
            const kids = await loadFamily(env, c, c.u);
            const kid = kids.find(k => k.id === step.s);
            if (!kid) return mainMenu(n, c, kids);
            const m = /^(\d{1,2})(\d{2})$/.exec(v);
            let tm = m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
            if (tm === null) return ask(n, 'tm', { u: c.u, s: kid.id, d: step.d }, ['השעה שהוקשה אינה תקינה', 'הקישו את השעה המבוקשת בארבע ספרות'], { max: 4 });
            if (tm < kid.setup.start && tm + 720 <= kid.setup.end) tm += 720;   // 730 -> 19:30
            tm = kid.setup.start + Math.ceil(Math.max(0, tm - kid.setup.start) / kid.setup.step) * kid.setup.step;
            return offer(env, n, c, kid, step.d, tm, [], { from: true });
        }

        case 'nx': {
            const kids = await loadFamily(env, c, c.u);
            if (v === '9') return finish(c, kids);
            if (v === '1') {
                const pending = kids.filter(k => !k.booking && !k.absent);
                if (pending.length === 1) return startBooking(env, n, c, pending[0]);
                if (pending.length > 1) return chooseChild(n, c, pending, 1, 'לאיזה ילד לקבוע פגישה');
            }
            return mainMenu(n, c, kids);
        }

        case 'ab': {
            const kids = await loadFamily(env, c, c.u);
            const kid = kids.find(k => k.id === step.s);
            if (!kid || v !== '1') return mainMenu(n, c, kids);
            await markAbsent(env, tenant.id, c.meeting.id, kid.id, { phone: c.phone || null, source: 'phone' });
            await log(env, c, 'absent', kid.id);
            return mainMenu(n, c, await loadFamily(env, c, c.u), { prefix: ['העדכון נקלט', 'המלמד ייצור עמכם קשר', c.phone ? '' : 'שימו לב המספר שלכם חסוי ולכן המלמד לא יוכל לחזור אליכם נא לפנות למזכירות'] });
        }

        case 'cx': {
            const kids = await loadFamily(env, c, c.u);
            const kid = kids.find(k => k.id === step.s);
            if (!kid || v !== '1' || !c.meeting.open) return mainMenu(n, c, kids);
            await cancelBooking(env, tenant.id, c.meeting.id, kid.id);
            await log(env, c, 'cancel', kid.id);
            return mainMenu(n, c, await loadFamily(env, c, c.u), { prefix: [`הפגישה של ${kid.first_name} בוטלה`] });
        }
    }
    return mainMenu(n, c, await loadFamily(env, c, c.u));
}
