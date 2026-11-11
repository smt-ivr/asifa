-- ============================================================
--  0002_access_email.sql — כתובת מייל למשתמש: מייל פתיחה וכניסה עם Google
-- ============================================================
ALTER TABLE access_rules ADD COLUMN email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS access_rules_email ON access_rules(email) WHERE email IS NOT NULL;
