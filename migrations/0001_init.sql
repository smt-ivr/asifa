-- ============================================================
--  0001_init.sql — מבנה בסיסי: מוסדות, משתמשים, כיתות, תלמידים,
--  אסיפות, תורים, ביטולי השתתפות, צינתוקים ויומן שיחות.
--  כל טבלה של מוסד מכילה tenant_id — מסד אחד לכל המוסדות.
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    line_number TEXT,                 -- מספר הקו שמודפס בפתקים ומוצג כמזוהה בצינתוק
    yemot_token TEXT,                 -- טוקן API של ימות המשיח (לצינתוקים)
    settings TEXT NOT NULL DEFAULT '{}',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

-- מספרי חיוג (ApiDID) שמזהים את המוסד בשיחה נכנסת
CREATE TABLE IF NOT EXISTS tenant_dids (
    did TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = מנהל-על
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT,
    role TEXT NOT NULL CHECK (role IN ('super', 'admin', 'teacher')),
    class_id INTEGER,                 -- למלמד: הכיתה שלו
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    ip TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    ip TEXT,
    success INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts(ip, created_at);

CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    teacher_name TEXT,
    teacher_phone TEXT,
    location TEXT,                    -- מיקום ברירת מחדל לאסיפה
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
    code TEXT NOT NULL,               -- קוד תלמיד להקשה בטלפון
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL DEFAULT '',
    father_name TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS students_class ON students(tenant_id, class_id);

-- טלפונים של הורים. משפחה = כל התלמידים שחולקים מספר טלפון
CREATE TABLE IF NOT EXISTS student_phones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'web', -- web / phone / import
    created_at TEXT NOT NULL,
    UNIQUE (student_id, phone)
);
CREATE INDEX IF NOT EXISTS student_phones_phone ON student_phones(tenant_id, phone);

CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    meeting_date TEXT NOT NULL,         -- YYYY-MM-DD
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'locked', 'done')),
    booking_closes_at TEXT,             -- YYYY-MM-DD HH:MM שעון ישראל; נעילה אוטומטית
    allow_long INTEGER NOT NULL DEFAULT 1,   -- לאפשר תור של 10 דקות
    max_long_per_class INTEGER,         -- הגבלת תורים ארוכים לכיתה (NULL = ללא)
    family_gap INTEGER NOT NULL DEFAULT 0,   -- דקות מינימום בין תורים של אחים
    auto_missing_tzintuk INTEGER NOT NULL DEFAULT 1, -- צינתוק אוטומטי ל"לא קבעו" בנעילה
    auto_assign INTEGER NOT NULL DEFAULT 0,  -- שיבוץ אוטומטי בנעילה
    reminder_time TEXT,                 -- HH:MM ביום האסיפה: צינתוק תזכורת (NULL = ללא)
    notes TEXT,
    opened_at TEXT,
    locked_at TEXT,
    reminder_sent_at TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meetings_tenant ON meetings(tenant_id, status, meeting_date);

-- שעות האסיפה לכל כיתה
CREATE TABLE IF NOT EXISTS meeting_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    start_min INTEGER NOT NULL,         -- דקות מחצות
    end_min INTEGER NOT NULL,
    breaks TEXT NOT NULL DEFAULT '[]',  -- [[from_min,to_min],...]
    location TEXT,
    UNIQUE (meeting_id, class_id)
);

CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    meeting_class_id INTEGER NOT NULL REFERENCES meeting_classes(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    start_min INTEGER NOT NULL,
    duration INTEGER NOT NULL CHECK (duration IN (5, 10)),
    source TEXT NOT NULL,               -- phone / web / auto
    phone TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (meeting_id, student_id)
);
CREATE INDEX IF NOT EXISTS bookings_mc ON bookings(meeting_class_id, start_min);

-- כל פרק של 5 דקות שתפוס. המפתח הראשי מונע שני תורים חופפים ברמת המסד
CREATE TABLE IF NOT EXISTS booking_slots (
    meeting_class_id INTEGER NOT NULL,
    slot_min INTEGER NOT NULL,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    PRIMARY KEY (meeting_class_id, slot_min)
);
CREATE INDEX IF NOT EXISTS booking_slots_booking ON booking_slots(booking_id);

-- הורה שעדכן שלא יוכל להשתתף ומבקש שהמלמד יחזור אליו
CREATE TABLE IF NOT EXISTS absences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    phone TEXT,
    source TEXT NOT NULL,
    handled INTEGER NOT NULL DEFAULT 0,
    handled_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (meeting_id, student_id)
);

CREATE TABLE IF NOT EXISTS tzintuk_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    meeting_id INTEGER,
    kind TEXT NOT NULL,                 -- open / missing / reminder / manual_*
    phones_count INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    response TEXT,
    triggered_by TEXT,                  -- auto / שם משתמש
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS call_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    phone TEXT,
    call_id TEXT,
    action TEXT NOT NULL,
    student_id INTEGER,
    details TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS call_log_tenant ON call_log(tenant_id, created_at);
