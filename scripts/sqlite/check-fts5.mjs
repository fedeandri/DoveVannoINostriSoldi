// Confirms better-sqlite3 loads and its SQLite supports FTS5 trigram substring matching.
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.exec("create virtual table t using fts5(k, tokenize='trigram case_sensitive 1')");
db.prepare('insert into t values (?)').run('ABCDEF');
const hits = db.prepare('select count(*) n from t where t match ?').get('"CDE"').n;
console.log(hits, db.prepare('select sqlite_version() v').get().v);
process.exit(hits === 1 ? 0 : 1);
