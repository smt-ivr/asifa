-- ============================================================
--  0001_platform.sql — טבלאות המערכת המשותפות בלבד
--  נתוני כל מוסד נשמרים בטבלאות נפרדות משלו: t{מזהה}_students, t{מזהה}_classes ...
--  (נוצרות אוטומטית בהוספת מוסד — ראו tenant_schema.js)
-- ============================================================

-- מוסדות (לקוחות)
CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    schema_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- הרשאות כניסה: שם משתמש + סיסמה, או כתובת IP. tenant_id ריק = מנהל-על
CREATE TABLE IF NOT EXISTS access_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('user', 'ip')),
    username TEXT COLLATE NOCASE,
    password_hash TEXT,
    password_salt TEXT,
    ip TEXT,
    description TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT,
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS access_rules_username ON access_rules(username) WHERE rule_type = 'user';
CREATE UNIQUE INDEX IF NOT EXISTS access_rules_ip ON access_rules(ip) WHERE rule_type = 'ip';

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES access_rules(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- היסטוריית כניסות
CREATE TABLE IF NOT EXISTS login_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    success INTEGER NOT NULL,
    method TEXT,
    username TEXT,
    tenant_id INTEGER,
    ip TEXT,
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS login_log_ip ON login_log(ip, created_at);
