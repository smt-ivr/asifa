-- ============================================================
--  0003_settings.sql — הגדרות המערכת (נערכות באתר ע"י מנהל-על)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL
);
