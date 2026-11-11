// ============================================================
//  tenant_schema.js — הטבלאות הפרטיות של כל מוסד
//  לכל מוסד סט טבלאות משלו שמתחילות במזהה שלו:  t{מזהה}_students, t{מזהה}_classes ...
//  שם הטבלה נבנה רק ממספר המזהה (לא מטקסט של משתמש) — אין אפשרות להזרקה.
//
//  שינוי מבנה בעתיד: מוסיפים גרסה חדשה ל-VERSIONS. כל מוסד מתעדכן אוטומטית
//  בבקשה הראשונה שלו (tenants.schema_version שומר איפה הוא עומד).
// ============================================================

export const prefix = tenantId => {
    const id = Number(tenantId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('bad tenant id');
    return `t${id}_`;
};

// שמות הטבלאות של מוסד
export const tables = tenantId => {
    const p = prefix(tenantId);
    return {
        classes: `${p}classes`,
        students: `${p}students`,
        phones: `${p}student_phones`,
        meetings: `${p}meetings`,
        meetingClasses: `${p}meeting_classes`,
        bookings: `${p}bookings`,
        slots: `${p}booking_slots`,
        absences: `${p}absences`,
        calls: `${p}call_log`
    };
};

const VERSIONS = [
    // גרסה 1 — כיתות, תלמידים, טלפונים, אסיפות, הגדרות כיתה באסיפה
    t => [
        `CREATE TABLE IF NOT EXISTS ${t.classes} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            teacher_name TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS ${t.students} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL DEFAULT '',
            class_id INTEGER REFERENCES ${t.classes}(id) ON DELETE SET NULL,
            id_number TEXT,
            father_name TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS ${t.students}_class ON ${t.students}(class_id)`,
        `CREATE TABLE IF NOT EXISTS ${t.phones} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL REFERENCES ${t.students}(id) ON DELETE CASCADE,
            phone TEXT NOT NULL,
            label TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0
        )`,
        `CREATE INDEX IF NOT EXISTS ${t.phones}_student ON ${t.phones}(student_id)`,
        `CREATE INDEX IF NOT EXISTS ${t.phones}_phone ON ${t.phones}(phone)`,
        `CREATE TABLE IF NOT EXISTS ${t.meetings} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            meeting_date TEXT,
            durations TEXT NOT NULL DEFAULT '[5,10]',
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS ${t.meetingClasses} (
            meeting_id INTEGER NOT NULL REFERENCES ${t.meetings}(id) ON DELETE CASCADE,
            class_id INTEGER NOT NULL REFERENCES ${t.classes}(id) ON DELETE CASCADE,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            durations TEXT NOT NULL,
            PRIMARY KEY (meeting_id, class_id)
        )`
    ]
    ,
    // גרסה 2 — קו טלפוני: מצב הרשמה לאסיפה, תורים, פרקי זמן תפוסים, "לא נוכל להגיע", יומן שיחות
    t => [
        `ALTER TABLE ${t.meetings} ADD COLUMN phone_status TEXT NOT NULL DEFAULT 'closed'`,
        `ALTER TABLE ${t.meetings} ADD COLUMN booking_closes_at TEXT`,
        `CREATE TABLE IF NOT EXISTS ${t.bookings} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id INTEGER NOT NULL,
            class_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            start_min INTEGER NOT NULL,
            duration INTEGER NOT NULL,
            source TEXT NOT NULL,
            phone TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (meeting_id, student_id)
        )`,
        `CREATE TABLE IF NOT EXISTS ${t.slots} (
            meeting_id INTEGER NOT NULL,
            class_id INTEGER NOT NULL,
            slot_min INTEGER NOT NULL,
            booking_id INTEGER NOT NULL,
            PRIMARY KEY (meeting_id, class_id, slot_min)
        )`,
        `CREATE INDEX IF NOT EXISTS ${t.slots}_booking ON ${t.slots}(booking_id)`,
        `CREATE TABLE IF NOT EXISTS ${t.absences} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            phone TEXT,
            source TEXT NOT NULL,
            handled INTEGER NOT NULL DEFAULT 0,
            note TEXT,
            created_at TEXT NOT NULL,
            UNIQUE (meeting_id, student_id)
        )`,
        `CREATE TABLE IF NOT EXISTS ${t.calls} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT,
            call_id TEXT,
            action TEXT NOT NULL,
            student_id INTEGER,
            details TEXT,
            created_at TEXT NOT NULL
        )`
    ]
];

export const LATEST = VERSIONS.length;

// יוצר / מעדכן את טבלאות המוסד עד הגרסה האחרונה
export async function ensureTenantSchema(env, tenant) {
    if (tenant.schema_version >= LATEST) return;
    const t = tables(tenant.id);
    for (let v = tenant.schema_version; v < LATEST; v++) {
        const stmts = VERSIONS[v](t).map(sql => env.DB.prepare(sql));
        stmts.push(env.DB.prepare('UPDATE tenants SET schema_version = ? WHERE id = ?').bind(v + 1, tenant.id));
        await env.DB.batch(stmts);
    }
    tenant.schema_version = LATEST;
}

// מחיקת כל הטבלאות של מוסד (במחיקת מוסד)
export async function dropTenantTables(env, tenantId) {
    const p = prefix(tenantId);
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?").bind(`${p}%`).all();
    const names = results.map(r => r.name).filter(n => n.startsWith(p) && /^t\d+_[a-z_]+$/.test(n));
    // סדר: קודם טבלאות שתלויות באחרות
    const order = ['booking_slots', 'bookings', 'absences', 'call_log', 'meeting_classes', 'meetings', 'student_phones', 'students', 'classes'];
    names.sort((a, b) => order.indexOf(a.slice(p.length)) - order.indexOf(b.slice(p.length)));
    if (names.length) await env.DB.batch(names.map(n => env.DB.prepare(`DROP TABLE IF EXISTS ${n}`)));
}
