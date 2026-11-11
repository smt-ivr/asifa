// ============================================================
//  migrate.js — עדכון מבנה המסד אוטומטית בהפעלה הראשונה של כל מופע
//  כל קובץ ב-migrations נכלל כאן לפי הסדר; גרסה שכבר הורצה לא תרוץ שוב.
//  להוספת שינוי: קובץ חדש migrations/000X_name.sql + שורה ברשימה.
// ============================================================
import m0001 from './migrations/0001_init.sql';

const MIGRATIONS = [
    { version: 1, name: '0001_init', sql: m0001 }
];

let ready = null;

function statements(sql) {
    return sql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .split(/;\s*(?:\n|$)/)
        .map(s => s.trim())
        .filter(Boolean);
}

async function run(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`).run();
    const { results } = await env.DB.prepare('SELECT version FROM schema_migrations').all();
    const done = new Set(results.map(r => r.version));
    for (const m of MIGRATIONS) {
        if (done.has(m.version)) continue;
        const stmts = statements(m.sql).map(s => env.DB.prepare(s));
        stmts.push(env.DB.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
            .bind(m.version, m.name, new Date().toISOString()));
        await env.DB.batch(stmts);
    }
}

export function ensureSchema(env) {
    if (!ready) ready = run(env).catch(e => { ready = null; throw e; });
    return ready;
}
