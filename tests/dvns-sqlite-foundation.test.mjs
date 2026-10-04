import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import './helpers/register-ts-alias.mjs';

const root = process.cwd();
const { dataBackend, ftsPhrase } = await import('../src/lib/data/sqlite.ts');
const { checkDatabaseAtStartup } = await import('../src/lib/data/sqlite-startup-check.ts');

function withBackend(value, run) {
  const before = process.env.DVNS_DATA_BACKEND;
  if (value === undefined) delete process.env.DVNS_DATA_BACKEND; else process.env.DVNS_DATA_BACKEND = value;
  try { return run(); } finally {
    if (before === undefined) delete process.env.DVNS_DATA_BACKEND; else process.env.DVNS_DATA_BACKEND = before;
  }
}

test('dataBackend defaults to files and rejects unknown values', () => {
  assert.equal(withBackend(undefined, dataBackend), 'files');
  assert.equal(withBackend('sqlite', dataBackend), 'sqlite');
  assert.throws(() => withBackend('postgres', dataBackend), /DVNS_DATA_BACKEND/);
});

test('ftsPhrase quotes a folded query and refuses anything else', () => {
  assert.equal(ftsPhrase('PROTESI'), '"PROTESI"');
  for (const bad of ['', 'protesi', 'A"B', 'A B', '!!!']) assert.throws(() => ftsPhrase(bad));
});

function release(commitInDb, commitFile, corruptHash = false) {
  const dir = mkdtempSync(join(tmpdir(), 'dvns-startup-'));
  const db = new Database(join(dir, 'dvns.sqlite'));
  db.exec('create table build_info(key text primary key, value text not null)');
  db.prepare('insert into build_info values (?, ?)').run('app_commit', commitInDb);
  db.close();
  const sha = createHash('sha256').update(readFileSync(join(dir, 'dvns.sqlite'))).digest('hex');
  writeFileSync(join(dir, 'dvns.sqlite.sha256'), corruptHash ? '0'.repeat(64) : sha);
  writeFileSync(join(dir, '.release-commit'), `${commitFile}\n`);
  return dir;
}

test('startup check accepts a matching release', () => {
  const dir = release('abc', 'abc');
  const result = checkDatabaseAtStartup(dir);
  assert.equal(result.ok, true);
  rmSync(dir, { recursive: true });
});

test('startup check names the failed check', () => {
  const missing = mkdtempSync(join(tmpdir(), 'dvns-startup-'));
  assert.deepEqual(
    { ok: checkDatabaseAtStartup(missing).ok, failed: checkDatabaseAtStartup(missing).failed },
    { ok: false, failed: 'missing' });
  const badHash = release('abc', 'abc', true);
  assert.equal(checkDatabaseAtStartup(badHash).failed, 'hash');
  const foreign = release('abc', 'def');
  assert.equal(checkDatabaseAtStartup(foreign).failed, 'commit');
  for (const dir of [missing, badHash, foreign]) rmSync(dir, { recursive: true });
});

test('converter core writes build_info, a passing integrity check and the hash file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dvns-convert-'));
  writeFileSync(join(dir, '.release-commit'), 'feedface\n');
  const run = spawnSync(process.execPath, [join(root, 'scripts/sqlite/build-db.mjs'), '--only='], { cwd: dir, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const db = new Database(join(dir, 'dvns.sqlite'), { readonly: true });
  assert.equal(db.prepare("select value from build_info where key = 'app_commit'").get().value, 'feedface');
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  db.close();
  const sha = createHash('sha256').update(readFileSync(join(dir, 'dvns.sqlite'))).digest('hex');
  assert.equal(readFileSync(join(dir, 'dvns.sqlite.sha256'), 'utf8').trim(), sha);
  assert.equal(checkDatabaseAtStartup(dir).ok, true);
  rmSync(dir, { recursive: true });
});

test('instrumentation exits with the failed check when the database is bad', async () => {
  const dir = release('abc', 'abc', true);
  const before = { cwd: process.cwd(), exit: process.exit, backend: process.env.DVNS_DATA_BACKEND, runtime: process.env.NEXT_RUNTIME };
  const errors = [];
  const originalError = console.error;
  let exitCode = null;
  process.env.DVNS_DATA_BACKEND = 'sqlite';
  process.env.NEXT_RUNTIME = 'nodejs';
  process.exit = (code) => { exitCode = code; throw new Error('exit called'); };
  console.error = (message) => errors.push(String(message));
  process.chdir(dir);
  try {
    const { register } = await import('../src/instrumentation.ts');
    await assert.rejects(register(), /exit called/);
  } finally {
    process.chdir(before.cwd);
    process.exit = before.exit;
    console.error = originalError;
    if (before.backend === undefined) delete process.env.DVNS_DATA_BACKEND; else process.env.DVNS_DATA_BACKEND = before.backend;
    if (before.runtime === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = before.runtime;
    rmSync(dir, { recursive: true });
  }
  assert.equal(exitCode, 1);
  assert.match(errors.join('\n'), /database check failed \(hash\)/);
});

test('converter refuses to run without .release-commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dvns-convert-'));
  const run = spawnSync(process.execPath, [join(root, 'scripts/sqlite/build-db.mjs'), '--only='], { cwd: dir, encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /\.release-commit/);
  rmSync(dir, { recursive: true });
});
