#!/usr/bin/env node
// Spec section 5: run the corpus under both backends in two processes and fail on the first difference.
//   node scripts/sqlite/parity.mjs   (working directory: a release or the dev checkout, with dvns.sqlite)
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mulberry32 } from './lib.mjs';
import { PARITY_MODULES } from './parity/index.mjs';

// Spec 1: `--sample <n>` keeps the first n cases of each module's group, in the corpus's fixed order.
const sampleAt = process.argv.indexOf('--sample');
const SAMPLE = sampleAt === -1 ? null : Number(process.argv[sampleAt + 1]);
if (SAMPLE !== null && !(Number.isSafeInteger(SAMPLE) && SAMPLE > 0)) {
  console.error('usage: parity.mjs [--sample <n>], n a positive integer');
  process.exit(2);
}

const SEED = 20261004;
const db = new Database('dvns.sqlite', { readonly: true, fileMustExist: true });
const corpus = PARITY_MODULES.map((m) => {
  const cases = m.buildCases(db, mulberry32(SEED));
  return { name: m.name, modulePath: m.modulePath, cases: SAMPLE === null ? cases : cases.slice(0, SAMPLE) };
});
db.close();
const total = corpus.reduce((sum, group) => sum + group.cases.length, 0);
// A private directory (mode 0700), not predictable names in the shared /tmp; removed on exit.
const work = mkdtempSync(join(tmpdir(), 'dvns-parity-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const corpusPath = join(work, 'corpus.json');
writeFileSync(corpusPath, JSON.stringify(corpus));

function run(backend) {
  const out = join(work, `${backend}.json`);
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/sqlite/parity-worker.mjs', corpusPath, out], {
      env: { ...process.env, DVNS_DATA_BACKEND: backend }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.on('error', (error) => {   // a worker that could not start: exit 2 like any worker failure
      console.error(`parity worker (${backend}) did not start: ${error.message}`);
      process.exit(2);
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { if (stderr.length < 64 * 1024 * 1024) stderr += chunk; });
    child.on('close', (status) => {
      if (status !== 0) {
        console.error(`parity worker (${backend}) failed:\n${stderr}`);
        process.exit(2);
      }
      resolveRun(JSON.parse(readFileSync(out, 'utf8')));
    });
  });
}

// Spec 2: both workers at once; their measured peak memory fits the capped unit (2,330 MB together,
// 2026-10-05, against a 4,096 MB budget).
const [filesRun, sqliteRun] = await Promise.all([run('files'), run('sqlite')]);
console.log(`parity memory: files ${filesRun.maxRssMb} sqlite ${sqliteRun.maxRssMb} parent ${Math.round(process.resourceUsage().maxRSS / 1024)} (concurrent)`);
console.log(`parity time: files ${filesRun.elapsedS} s, sqlite ${sqliteRun.elapsedS} s`);
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
// A sample must never read as a full pass: deploy-remote.sh writes its marker only on `parity ok:`.
console.log(`parity ok${SAMPLE === null ? '' : ' (sample)'}: ${total} cases (${corpus.map((g) => `${g.name} ${g.cases.length}`).join(', ') || 'no modules'})`);
