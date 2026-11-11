// ============================================================
//  mail.js — שליחת מיילים דרך Resend
//  המפתח והשולח: מההגדרות באתר (settings.js), ואם לא הוגדרו — RESEND_API_KEY / MAIL_FROM של הוורקר
//  התבנית בנויה מטבלאות וסגנונות פנימיים כדי שתיראה אותו דבר ב-Gmail, Outlook ובטלפון.
// ============================================================
import { ApiError, badRequest } from './http.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FONT = `system-ui,-apple-system,'Segoe UI',Arial,sans-serif`;
const C = { bg: '#f1f5f9', card: '#ffffff', border: '#e2e8f0', text: '#0f172a', body: '#334155', muted: '#64748b', primary: '#2563eb', dark: '#1e3a8a', soft: '#eff6ff' };

export const validEmail = e => /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(String(e || ''));
export const normalizeEmail = e => String(e || '').trim().toLowerCase();

// cfg = getConfig(env) מתוך settings.js
export const mailReady = cfg => !!(cfg.resend_api_key && cfg.mail_from);

// מעטפת אחידה: פס עליון, כרטיס, שורות פרטים, כפתור והערה
export function renderMail({ title, preheader = '', paragraphs = [], details = [], button, note }) {
    const p = t => `<p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:${C.body};white-space:pre-line">${esc(t)}</p>`;
    const rows = details.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;background:${C.soft};border:1px solid #dbeafe;border-radius:12px">
        ${details.map(([k, v, ltr]) => `<tr><td style="padding:11px 16px;font-size:14px;color:${C.muted};white-space:nowrap;width:1%">${esc(k)}</td>
            <td style="padding:11px 16px;font-size:16px;font-weight:700;color:${C.text}"${ltr ? ' dir="ltr" align="right"' : ''}>${esc(v)}</td></tr>`).join('')}
        </table>` : '';
    const cta = button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 10px"><tr>
        <td style="border-radius:10px;background:${C.primary}" bgcolor="${C.primary}">
        <a href="${esc(button.url)}" style="display:inline-block;padding:13px 30px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;font-family:${FONT}">${esc(button.label)}</a></td></tr></table>` : '';
    const noteBox = note ? `<div style="margin-top:18px;padding:12px 16px;border-radius:10px;background:#f8fafc;border:1px solid ${C.border};font-size:13px;color:${C.muted};line-height:1.6">${esc(note)}</div>` : '';
    return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT}" dir="rtl">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="background:${C.dark};background-image:linear-gradient(160deg,${C.dark},#172554);border-radius:16px 16px 0 0;padding:22px 28px" bgcolor="${C.dark}">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:42px;height:42px;border-radius:10px;background:#ffffff;text-align:center;vertical-align:middle"><img src="https://smt-tel-manager.netlify.app/smt.png" alt="" width="32" style="width:32px;height:auto;border:0;vertical-align:middle"></td>
        <td style="padding-right:12px;font-family:${FONT}"><div style="font-size:19px;font-weight:800;color:#ffffff">אסיפת הורים</div>
          <div style="font-size:13px;color:#93c5fd">מערכת לניהול אסיפות הורים במוסדות</div></td>
      </tr></table></td></tr>
    <tr><td style="background:${C.card};border:1px solid ${C.border};border-top:0;border-radius:0 0 16px 16px;padding:28px" dir="rtl">
      <h1 style="margin:0 0 18px;font-size:22px;line-height:1.4;color:${C.text};font-family:${FONT}">${esc(title)}</h1>
      ${paragraphs.filter(Boolean).map(p).join('')}${rows}${cta}${noteBox}
    </td></tr>
    <tr><td style="padding:18px 8px;text-align:center;font-size:12px;color:${C.muted};line-height:1.8">
      מייל זה נשלח אוטומטית ממערכת אסיפת הורים · פותח ע״י שימי טרייטל</td></tr>
  </table>
</td></tr></table></body></html>`;
}

// מייל פתיחת חשבון — הטקסטים נערכים באתר (הגדרות). password רק אם הוזנה ברגע השליחה (סיסמאות לא נשמרות)
export function welcomeMail(cfg, { tenantName, displayName, username, password, email, google }, fill) {
    const site = cfg.site_url || 'https://smti.uk/asifa/';
    const vars = { 'שם': displayName || '', 'מוסד': tenantName || 'המערכת', 'שם_משתמש': username, 'מייל': email || '' };
    const t = text => fill(text, vars).replace(/ ,/g, ',').replace(/  +/g, ' ');
    const details = [['המוסד', tenantName || 'ניהול-על'], ['שם משתמש', username]];
    if (password) details.push(['סיסמה', password, true]);
    details.push(['כתובת האתר', site.replace(/^https?:\/\//, '').replace(/\/$/, ''), true]);
    return {
        to: email,
        subject: t(cfg.welcome_subject),
        title: t(cfg.welcome_title),
        preheader: `פרטי הכניסה שלכם ל${tenantName || 'מערכת'}`,
        paragraphs: t(cfg.welcome_body).split(/\n\s*\n/).map(x => x.trim()).filter(Boolean),
        details,
        button: { label: t(cfg.welcome_button) || 'כניסה למערכת', url: site },
        note: [
            google ? `אפשר גם להיכנס בלחיצה על "המשך עם Google" עם החשבון ${email}, בלי סיסמה.` : '',
            password ? t(cfg.welcome_note) : 'את הסיסמה תקבלו בנפרד ממנהל המערכת.'
        ].filter(Boolean).join(' ')
    };
}

function textVersion(m) {
    return [m.title, ...(m.paragraphs || []), ...(m.details || []).map(([k, v]) => `${k}: ${v}`),
        m.button ? `${m.button.label}: ${m.button.url}` : '', m.note || ''].filter(Boolean).join('\n\n');
}

export const preview = m => ({ to: m.to, from: null, subject: m.subject, html: renderMail(m) });

export async function sendMail(cfg, m) {
    if (!mailReady(cfg)) throw new ApiError(409, 'mail_off', 'שליחת מיילים עדיין לא הוגדרה — הזינו מפתח Resend בהגדרות');
    const to = normalizeEmail(m.to);
    if (!validEmail(to)) throw badRequest('כתובת המייל של הנמען אינה תקינה');
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.resend_api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: cfg.mail_from, to: [to], subject: m.subject, html: renderMail(m), text: textVersion(m) })
    });
    if (!res.ok) {
        let reason = '';
        try { reason = (await res.json()).message || ''; } catch (e) { /* ignore */ }
        console.error('[mail]', res.status, reason);
        throw new ApiError(502, 'mail_failed', `שליחת המייל נכשלה${reason ? `: ${reason}` : ''}`);
    }
    return { sent: true, to };
}
