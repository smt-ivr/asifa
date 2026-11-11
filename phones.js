// ============================================================
//  phones.js — נרמול מספרי טלפון ישראליים
// ============================================================

// "+972-52-123 4567" / "972521234567" / "0521234567" -> "0521234567"
export function normalizePhone(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.slice(3);
    if (d && !d.startsWith('0') && (d.length === 9 || d.length === 8)) d = '0' + d;
    return d;
}

export const validPhone = p => /^0\d{8,9}$/.test(p);

// מספר חסוי / לא מזוהה
export const hiddenPhone = p => !p || !validPhone(p);
