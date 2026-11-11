// ============================================================
//  yemot_parents.js — הקו הטלפוני להורים (שלוחת API בימות המשיח)
//
//  זיהוי המוסד: פרמטר tenant בכתובת השלוחה, ואם אין — לפי המספר שחויג (ApiDID).
//  זיהוי ההורה: לפי המספר המזוהה (ApiPhone) -> כל הילדים שהמספר רשום אצלם.
//  מספר לא מוכר: מקישים קוד תלמיד, ונשאלים אם לשמור את המספר לפעם הבאה.
//
//  כל שאלה נשמרת בפרמטר ששמו מכיל את השלב וההקשר:  a{מספר}_{שלב}_{תלמיד}_{משך}_{נוסף}_{קוד}
//  ימות המשיח מחזיר את כל הפרמטרים שנאספו; קוראים רק את האחרון (המספר הגבוה).
//  שלבים:
//    cd  הקשת קוד תלמיד (מספר לא מוכר)          sv  לשמור את המספר? 1 כן 2 לא
//    mm  תפריט ראשי                                ch  בחירת ילד (x = הפעולה: 1 תור, 3 אי-הגעה, 4 ביטול)
//    du  תור של 5 או 10 דקות                       of  הצעת שעה (x = השעה המוצעת בדקות)
//    tm  הקשת שעה מבוקשת                           ab  אישור אי-הגעה       cx  אישור ביטול תור
//    nx  אחרי קביעה: ילד נוסף / תפריט / סיום      ad  הוספת ילד נוסף לפי קוד
// ============================================================
import { nowIL, stamp, speakTime, speakDate, minToHHMM } from './time.js';
import { normalizePhone, hiddenPhone } from './phones.js';
import { tenantByDid, tenantById } from './tenants.js';
import { tenantSettings } from './settings.js';
import { activeMeeting, markAbsent } from './meetings.js';
import { familyByPhone, studentByCode, studentById, linkPhone } from './students.js';
import { meetingClassFor, bookingOf, availableStarts, preferredOrder, book, cancelBooking, familyBusy } from './bookings.js';

const text = body => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

// טקסט להקראה: בלי תווים שיש להם משמעות בתחביר של ימות
const clean = s => String(s || '').replace(/[.,=&"'\-_:;()\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
const say = (...parts) => parts.flat().filter(Boolean).map(clean).filter(Boolean).join('.t-');

function ask(n, stage, ctx, parts, { max = 1, allowed = '' } = {}) {
    const name = `a${n}_${stage}_${ctx.s || 0}_${ctx.d || 0}_${ctx.x || 0}_${ctx.u || 0}`;
    return text(`read=t-${say(parts)}=${name},,${max || ''},,,NO,,,,${allowed},,,,,no`);
}
const bye = (...parts) => text(`id_list_message=t-${say(...parts)}&go_to_folder=hangup`);

function lastStep(url) {
    let best = null;
    for (const [key, value] of url.searchParams.entries()) {
        const m = /^a(\d+)_([a-z]{2})_(\d+)_(\d+)_(\d+)_(\d+)$/.exec(key);
        if (m && (!best || +m[1] > best.n)) best = { n: +m[1], stage: m[2], s: +m[3], d: +m[4], x: +m[5], u: +m[6], value: String(value || '').trim() };
    }
    return best;
}

const childName = s => s.first_name;
const teacherOf = mc => mc.teacher_name ? `אצל המלמד ${mc.teacher_name}` : `בכיתה ${mc.class_name}`;

async function log(env, c, action, studentId = null, details = null) {
    try {
        await env.DB.prepare('INSERT INTO call_log (tenant_id, phone, call_id, action, student_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(c.tenant ? c.tenant.id : null, c.phone || null, c.callId, action, studentId, details, stamp()).run();
    } catch (e) { /* היומן לא יפיל שיחה */ }
}

// ילדי המשפחה שמשתתפים באסיפה, כל אחד עם הכיתה והתור שלו
async function loadFamily(env, c, u) {
    let kids = c.phone ? await familyByPhone(env, c.tenant.id, c.phone) : [];
    if (u && !kids.some(k => k.id === u)) {
        const s = await studentById(env, c.tenant.id, u);
        if (s) kids.push(s);
    }
    const out = [];
    for (const k of kids) {
        const mc = await meetingClassFor(env, c.meeting.id, k.class_id);
        if (!mc) continue;
        const b = await bookingOf(env, c.meeting.id, k.id);
        const a = await env.DB.prepare('SELECT id FROM absences WHERE meeting_id = ? AND student_id = ?').bind(c.meeting.id, k.id).first();
        out.push({ ...k, mc, booking: b, absent: !!a });
    }
    return out;
}

function summary(c, kids) {
    const date = speakDate(c.meeting.meeting_date);
    return kids.map(k => {
        if (k.booking) return `ל${childName(k)} נקבע תור ${teacherOf(k.mc)} ${date} בשעה ${speakTime(k.booking.start_min)}${k.booking.duration === 10 ? ' למשך עשר דקות' : ''}`;
        if (k.absent) return `לגבי ${childName(k)} עדכנתם שלא תוכלו להגיע והמלמד ייצור עמכם קשר`;
        return `ל${childName(k)} עדיין לא נקבע תור`;
    });
}

function mainMenu(n, c, kids, { withSummary = false, prefix = [] } = {}) {
    const ctx = { u: c.u };
    const head = [...prefix, ...(withSummary ? summary(c, kids) : [])];
    if (c.meeting.status === 'locked') {
        const note = tenantSettings(c.tenant).office_note;
        return ask(n, 'mm', ctx, [...head, 'ההרשמה לאסיפה נסגרה', note,
            'לשמיעת התורים הקישו 2', 'להודעה שלא תוכלו להגיע והמלמד ייצור עמכם קשר הקישו 3', 'לסיום הקישו 9'], { allowed: '239' });
    }
    const anyBooked = kids.some(k => k.booking);
    return ask(n, 'mm', ctx, [...head,
        'לקביעת תור או לשינוי תור הקישו 1', 'לשמיעת התורים שנקבעו הקישו 2', 'להודעה שלא תוכלו להגיע והמלמד ייצור עמכם קשר הקישו 3',
        anyBooked ? 'לביטול תור הקישו 4' : '', 'להוספת ילד נוסף לפי קוד תלמיד הקישו 5', 'לסיום הקישו 9'], { allowed: anyBooked ? '123459' : '12359' });
}

function chooseChild(n, c, kids, action, intro) {
    const list = kids.map((k, i) => `ל${childName(k)} הקישו ${i + 1}`);
    return ask(n, 'ch', { u: c.u, x: action }, [intro, ...list, 'לחזרה הקישו 0'], { allowed: '0' + kids.map((_, i) => i + 1).join('') });
}

async function startBooking(env, n, c, kid, prefix = []) {
    const pre = [...prefix];
    if (kid.booking) pre.push(`ל${childName(kid)} כבר נקבע תור בשעה ${speakTime(kid.booking.start_min)} תור חדש יחליף אותו`);
    if (c.meeting.allow_long) {
        return ask(n, 'du', { u: c.u, s: kid.id }, [...pre, `לקביעת תור ל${childName(kid)}`, 'לתור של חמש דקות הקישו 1', 'לתור של עשר דקות הקישו 2', 'לחזרה הקישו 0'], { allowed: '120' });
    }
    return offer(env, n, c, kid, 5, null, pre);
}

// מציע שעה. after = null: ההצעה הטובה ביותר; מספר: השעה הפנויה הראשונה אחרי/מ-after
async function offer(env, n, c, kid, duration, after, prefix = [], { from = false } = {}) {
    const fam = (await loadFamily(env, c, c.u)).map(k => k.id);
    const busy = await familyBusy(env, c.meeting.id, fam, kid.id);
    const starts = await availableStarts(env, { meeting: c.meeting, mc: kid.mc, duration, studentId: kid.id, busy });
    const kids = await loadFamily(env, c, c.u);
    if (!starts.length) {
        const msg = duration === 10 ? `אין יותר תורים פנויים של עשר דקות ${teacherOf(kid.mc)} נסו לקבוע תור של חמש דקות` : `אין יותר תורים פנויים ${teacherOf(kid.mc)} ניתן לעדכן שלא תוכלו להגיע והמלמד ייצור עמכם קשר`;
        return mainMenu(n, c, kids, { prefix: [...prefix, msg] });
    }
    let pick, pre = [...prefix];
    if (after === null) pick = preferredOrder(starts, busy, duration)[0];
    else {
        pick = starts.find(s => from ? s >= after : s > after);
        if (pick === undefined) {
            pick = starts[0];
            pre.push(from ? 'אין תור פנוי בשעה הזו או אחריה' : 'אין שעות פנויות נוספות חוזרים לשעה הפנויה הראשונה');
        } else if (from && pick !== after) pre.push('השעה שביקשתם תפוסה');
    }
    return ask(n, 'of', { u: c.u, s: kid.id, d: duration, x: pick }, [...pre,
        `השעה הפנויה ${after === null ? 'המומלצת' : ''} ל${childName(kid)} ${teacherOf(kid.mc)} היא ${speakDate(c.meeting.meeting_date)} בשעה ${speakTime(pick)}`,
        'לאישור השעה הקישו 1', 'לשעה פנויה אחרת הקישו 2', 'להקשת שעה מבוקשת הקישו 3', 'לחזרה לתפריט הקישו 0'], { allowed: '1230' });
}

function afterBooking(n, c, kids, prefix) {
    const pending = kids.filter(k => !k.booking && !k.absent);
    const parts = [...prefix];
    let allowed = '29';
    if (pending.length) { parts.push('לקביעת תור לילד נוסף הקישו 1'); allowed = '129'; }
    parts.push('לתפריט הראשי הקישו 2', 'לסיום ושמיעת כל התורים הקישו 9');
    return ask(n, 'nx', { u: c.u }, parts, { allowed });
}

const finish = (c, kids) => bye(summary(c, kids), 'תודה ולהתראות');

export async function handleYemotParents(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('ApiHangup')) return text('');

    const c = {
        phone: normalizePhone(url.searchParams.get('ApiPhone')),
        callId: url.searchParams.get('ApiCallId') || null,
        tenant: null, meeting: null, u: 0
    };
    c.tenant = (url.searchParams.get('tenant') && await tenantById(env, url.searchParams.get('tenant')))
        || await tenantByDid(env, url.searchParams.get('ApiDID'));
    if (!c.tenant) return bye('המערכת אינה מוגדרת למספר זה');
    if (hiddenPhone(c.phone)) c.phone = '';

    c.meeting = await activeMeeting(env, c.tenant.id);
    const step = lastStep(url);
    const n = step ? step.n + 1 : 1;
    if (!c.meeting) {
        if (!step) await log(env, c, 'call', null, 'no_meeting');
        return bye('כרגע אין אסיפת הורים פתוחה להרשמה', 'להתראות');
    }
    c.u = step ? step.u : 0;
    const v = step ? step.value : '';

    // ---------- כניסה ראשונה ----------
    if (!step) {
        await log(env, c, 'call');
        const kids = await loadFamily(env, c, 0);
        if (!kids.length) {
            return ask(n, 'cd', {}, [`שלום וברוכים הבאים למערכת קביעת התורים לאסיפת ההורים של ${c.tenant.name}`,
                c.phone ? 'המספר שלכם אינו רשום במערכת' : '', 'נא הקישו את קוד התלמיד ובסיומו סולמית'], { max: 0 });
        }
        return mainMenu(n, c, kids, { withSummary: true, prefix: [`שלום וברוכים הבאים למערכת קביעת התורים לאסיפת ההורים של ${c.tenant.name}`] });
    }

    if (v === '*' && step.stage !== 'cd') return finish(c, await loadFamily(env, c, c.u));

    switch (step.stage) {
        case 'cd':
        case 'ad': {
            const s = /^\d{1,8}$/.test(v) ? await studentByCode(env, c.tenant.id, v) : null;
            if (!s) {
                await log(env, c, 'bad_code', null, v);
                if (step.x >= 2) return bye('קוד התלמיד שגוי', 'נא פנו למזכירות המוסד', 'להתראות');
                return ask(n, step.stage, { u: c.u, x: step.x + 1 }, ['קוד התלמיד שגוי', 'נא הקישו שוב את קוד התלמיד ובסיומו סולמית'], { max: 0 });
            }
            const mc = await meetingClassFor(env, c.meeting.id, s.class_id);
            if (!mc) return bye(`הכיתה של ${s.first_name} אינה משתתפת באסיפה הנוכחית`, 'להתראות');
            if (c.phone) {
                if (step.stage === 'ad') {
                    await linkPhone(env, c.tenant.id, s.id, c.phone);
                    await log(env, c, 'link_phone', s.id);
                    c.u = 0;
                    return mainMenu(n, c, await loadFamily(env, c, 0), { withSummary: true, prefix: [`${s.first_name} נוסף בהצלחה`] });
                }
                return ask(n, 'sv', { u: s.id }, [`זוהה התלמיד ${s.first_name} ${s.last_name}`, 'לשמירת מספר הטלפון שלכם כדי שתזוהו אוטומטית בפעם הבאה הקישו 1', 'להמשך בלי לשמור הקישו 2'], { allowed: '12' });
            }
            c.u = s.id;
            return mainMenu(n, c, await loadFamily(env, c, s.id), { withSummary: true, prefix: [`זוהה התלמיד ${s.first_name} ${s.last_name}`] });
        }

        case 'sv': {
            if (v === '1' && c.phone) {
                await linkPhone(env, c.tenant.id, step.u, c.phone);
                await log(env, c, 'link_phone', step.u);
                c.u = 0;
                return mainMenu(n, c, await loadFamily(env, c, 0), { withSummary: true, prefix: ['המספר נשמר'] });
            }
            return mainMenu(n, c, await loadFamily(env, c, c.u), { withSummary: true });
        }

        case 'mm': {
            const kids = await loadFamily(env, c, c.u);
            if (!kids.length) return bye('לא נמצאו ילדים המשתתפים באסיפה', 'להתראות');
            const locked = c.meeting.status === 'locked';
            if (v === '9') return finish(c, kids);
            if (v === '2') return mainMenu(n, c, kids, { withSummary: true });
            if (v === '1' && !locked) {
                if (kids.length === 1) return startBooking(env, n, c, kids[0]);
                return chooseChild(n, c, kids, 1, 'לאיזה ילד לקבוע תור');
            }
            if (v === '3') {
                const eligible = kids.filter(k => !k.absent);
                if (!eligible.length) return mainMenu(n, c, kids, { prefix: ['כבר עדכנתם לגבי כל הילדים'] });
                if (eligible.length === 1) return confirmAbsence(n, c, eligible[0]);
                return chooseChild(n, c, eligible, 3, 'לגבי איזה ילד לעדכן שלא תוכלו להגיע');
            }
            if (v === '4' && !locked) {
                const booked = kids.filter(k => k.booking);
                if (!booked.length) return mainMenu(n, c, kids, { prefix: ['אין תורים לביטול'] });
                if (booked.length === 1) return confirmCancel(n, c, booked[0]);
                return chooseChild(n, c, booked, 4, 'איזה תור לבטל');
            }
            if (v === '5' && !locked) return ask(n, 'ad', { u: c.u }, ['נא הקישו את קוד התלמיד ובסיומו סולמית'], { max: 0 });
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
            if (v !== '1' && v !== '2') return startBooking(env, n, c, kid, ['בחירה לא תקינה']);
            return offer(env, n, c, kid, v === '2' ? 10 : 5, null);
        }

        case 'of': {
            const kids = await loadFamily(env, c, c.u);
            const kid = kids.find(k => k.id === step.s);
            if (!kid || v === '0') return mainMenu(n, c, kids);
            const duration = step.d === 10 ? 10 : 5;
            if (v === '2') return offer(env, n, c, kid, duration, step.x);
            if (v === '3') return ask(n, 'tm', { u: c.u, s: kid.id, d: duration }, ['הקישו את השעה המבוקשת בארבע ספרות', 'לדוגמה לשעה שבע וחצי הקישו אחת תשע שלוש אפס'], { max: 4 });
            if (v !== '1') return offer(env, n, c, kid, duration, step.x - 1, ['בחירה לא תקינה'], { from: true });
            if (c.meeting.status !== 'open') return mainMenu(n, c, kids, { prefix: ['ההרשמה נסגרה'] });
            const busy = await familyBusy(env, c.meeting.id, kids.map(k => k.id), kid.id);
            try {
                await book(env, { meeting: c.meeting, mc: kid.mc, student: kid, start: step.x, duration, source: 'phone', phone: c.phone || null, busy });
            } catch (e) {
                if (e.code === 'slot_taken' || e.code === 'family_overlap') return offer(env, n, c, kid, duration, step.x, ['השעה נתפסה הרגע'], { from: true });
                throw e;
            }
            await log(env, c, 'book', kid.id, `${minToHHMM(step.x)} ${duration}`);
            const fresh = await loadFamily(env, c, c.u);
            return afterBooking(n, c, fresh, [`התור נקבע בהצלחה`, `ל${childName(kid)} ${teacherOf(kid.mc)} ${speakDate(c.meeting.meeting_date)} בשעה ${speakTime(step.x)}`]);
        }

        case 'tm': {
            const kids = await loadFamily(env, c, c.u);
            const kid = kids.find(k => k.id === step.s);
            if (!kid) return mainMenu(n, c, kids);
            const duration = step.d === 10 ? 10 : 5;
            const m = /^(\d{1,2})(\d{2})$/.exec(v);
            let t = m && +m[2] < 60 && +m[1] < 24 ? +m[1] * 60 + +m[2] : null;
            if (t === null) return ask(n, 'tm', { u: c.u, s: kid.id, d: duration }, ['השעה שהוקשה אינה תקינה', 'הקישו את השעה המבוקשת בארבע ספרות'], { max: 4 });
            if (t < kid.mc.start_min && t + 720 <= kid.mc.end_min) t += 720;   // 735 -> 19:35
            t = Math.ceil(t / 5) * 5;
            return offer(env, n, c, kid, duration, t, [], { from: true });
        }

        case 'nx': {
            const kids = await loadFamily(env, c, c.u);
            if (v === '9') return finish(c, kids);
            if (v === '1') {
                const pending = kids.filter(k => !k.booking && !k.absent);
                if (pending.length === 1) return startBooking(env, n, c, pending[0]);
                if (pending.length > 1) return chooseChild(n, c, pending, 1, 'לאיזה ילד לקבוע תור');
            }
            return mainMenu(n, c, kids);
        }

        case 'ab': {
            const kids = await loadFamily(env, c, c.u);
            const kid = kids.find(k => k.id === step.s);
            if (!kid || v !== '1') return mainMenu(n, c, kids);
            await markAbsent(env, c.meeting, kid.id, { phone: c.phone || null, source: 'phone' });
            await log(env, c, 'absent', kid.id);
            return mainMenu(n, c, await loadFamily(env, c, c.u), {
                prefix: ['העדכון נקלט', 'המלמד ייצור עמכם קשר', c.phone ? '' : 'שימו לב המספר שלכם חסוי ולכן המלמד לא יוכל לחזור אליכם יש לפנות למזכירות']
            });
        }

        case 'cx': {
            const kids = await loadFamily(env, c, c.u);
            const kid = kids.find(k => k.id === step.s);
            if (!kid || v !== '1' || c.meeting.status !== 'open') return mainMenu(n, c, kids);
            await cancelBooking(env, c.meeting.id, kid.id);
            await log(env, c, 'cancel', kid.id);
            return mainMenu(n, c, await loadFamily(env, c, c.u), { prefix: [`התור של ${childName(kid)} בוטל`] });
        }
    }
    return mainMenu(n, c, await loadFamily(env, c, c.u));
}

function confirmAbsence(n, c, kid) {
    return ask(n, 'ab', { u: c.u, s: kid.id }, [
        kid.booking ? `שימו לב התור של ${childName(kid)} יבוטל` : '',
        `לאישור שלא תוכלו להגיע לאסיפה לגבי ${childName(kid)} והמלמד ייצור עמכם קשר הקישו 1`, 'לחזרה הקישו 0'], { allowed: '10' });
}

function confirmCancel(n, c, kid) {
    return ask(n, 'cx', { u: c.u, s: kid.id }, [
        `לביטול התור של ${childName(kid)} בשעה ${speakTime(kid.booking.start_min)} הקישו 1`, 'לחזרה הקישו 0'], { allowed: '10' });
}
