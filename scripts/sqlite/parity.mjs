#!/usr/bin/env node
// Spec section 5: run the corpus under both backends in two processes and fail on the first difference.
//   node scripts/sqlite/parity.mjs   (working directory: a release or the dev checkout, with dvns.sqlite)
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mulberry32 } from './lib.mjs';
import { PARITY_MODULES } from './parity/index.mjs';

const SEED = 20261004;
const db = new Database('dvns.sqlite', { readonly: true, fileMustExist: true });
const corpus = PARITY_MODULES.map((m) => ({
  name: m.name, modulePath: m.modulePath, cases: m.buildCases(db, mulberry32(SEED)),
}));
db.close();
const total = corpus.reduce((sum, group) => sum + group.cases.length, 0);
const corpusPath = join(tmpdir(), `dvns-parity-corpus-${process.pid}.json`);
writeFileSync(corpusPath, JSON.stringify(corpus));

function run(backend) {
  const out = join(tmpdir(), `dvns-parity-${backend}-${process.pid}.json`);
  const child = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/sqlite/parity-worker.mjs', corpusPath, out], {
    env: { ...process.env, DVNS_DATA_BACKEND: backend }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (child.status !== 0) {
    console.error(`parity worker (${backend}) failed:\n${child.stderr}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(out, 'utf8'));
}

const filesRun = run('files');
const sqliteRun = run('sqlite');
if (filesRun.sqliteOpened) {
  console.error('parity: the files run opened dvns.sqlite, so its reads are not upstream\'s');
  process.exit(1);
}
if (total > 0 && !sqliteRun.sqliteOpened) {
  console.error('parity: the sqlite run never opened dvns.sqlite, so no read is switched to SQLite');
  process.exit(1);
}
const files = filesRun.results;
const sqlite = sqliteRun.results;
if (files.length !== total || sqlite.length !== total) {
  console.error(`parity: expected ${total} results, got files=${files.length} sqlite=${sqlite.length}`);
  process.exit(1);
}
for (let i = 0; i < total; i += 1) {
  if (files[i].outcome !== sqlite[i].outcome) {
    console.error(`parity FAILED at ${files[i].id}\n  files:  ${files[i].outcome.slice(0, 600)}\n  sqlite: ${sqlite[i].outcome.slice(0, 600)}`);
    process.exit(1);
  }
}
console.log(`parity ok: ${total} cases (${corpus.map((g) => `${g.name} ${g.cases.length}`).join(', ') || 'no modules'})`);
