// ============================================================
//  migrate.js — טבלאות המערכת המשותפות נוצרות/מתעדכנות אוטומטית
//  (טבלאות של כל מוסד — ב-tenant_schema.js)
// ============================================================
import m0001 from './migrations/0001_platform.sql';
import m0002 from './migrations/0002_access_email.sql';
import m0003 from './migrations/0003_settings.sql';

const MIGRATIONS = [
    { version: 1, name: '0001_platform', sql: m0001 },
    { version: 2, name: '0002_access_email', sql: m0002 },
    { version: 3, name: '0003_settings', sql: m0003 }
];
let ready = null;

const statements = sql => sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);

async function run(env) {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)').run();
    const { results } = await env.DB.prepare('SELECT version FROM schema_migrations').all();
    const done = new Set(results.map(r => r.version));
    for (const m of MIGRATIONS) {
        if (done.has(m.version)) continue;
        await env.DB.batch([
            ...statements(m.sql).map(s => env.DB.prepare(s)),
            env.DB.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').bind(m.version, m.name, new Date().toISOString())
        ]);
    }
}

export function ensureSchema(env) {
    if (!ready) ready = run(env).catch(e => { ready = null; throw e; });
    return ready;
}
