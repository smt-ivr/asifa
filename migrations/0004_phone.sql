-- ============================================================
--  0004_phone.sql — הקו הטלפוני: מי מנהל את הגדרות הטלפון של המוסד, ההגדרות, ומספרי חיוג
-- ============================================================
ALTER TABLE tenants ADD COLUMN phone_managed_by TEXT NOT NULL DEFAULT 'super';
ALTER TABLE tenants ADD COLUMN phone_settings TEXT NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS tenant_dids (
    did TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);
