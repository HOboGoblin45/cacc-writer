import Database from 'better-sqlite3';
const db = new Database('data/cacc-writer.db');
console.log('USERS:', JSON.stringify(db.prepare('SELECT id,username,email FROM users').all()));
console.log('SUBS:', JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()));
try { console.log('SUB_ROWS:', JSON.stringify(db.prepare('SELECT * FROM subscriptions').all())); } catch(e) { console.log('NO SUB TABLE:', e.message); }
