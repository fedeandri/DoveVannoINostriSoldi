#!/usr/bin/env node
// Build dvns.sqlite in the working directory (a release) from upstream's generated files.
//   node scripts/sqlite/build-db.mjs            # every converter
//   node scripts/sqlite/build-db.mjs --only=a,b  # the named converters only (--only= runs none)
// Exit 0: written and checked. 1: an input failed verification or the integrity check failed.
// 2: setup error (no .release-commit, unknown converter name).
import { spawnSync } from 'node:child_process';
// Converters import upstream's TypeScript (validators, comparators): re-run under the type-stripping flag
// so every caller can keep invoking `node scripts/sqlite/build-db.mjs`.
if (!process.execArgv.includes('--experimental-strip-types')) {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(child.status ?? 2);
}
await import('../ci/register-source-alias.mjs');
const { default: Database } = await import('better-sqlite3');
const { existsSync, readFileSync, renameSync, rmSync, writeFileSync } = await import('node:fs');
const { InputError, sha256 } = await import('./lib.mjs');
const { CONVERTERS } = await import('./converters/index.mjs');

const CONVERTER_VERSION = '1';
const OUT = 'dvns.sqlite';
const TMP = 'dvns.sqlite.tmp';

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

if (!existsSync('.release-commit')) fail(2, 'build-db: .release-commit missing in the working directory');
const commit = readFileSync('.release-commit', 'utf8').trim();
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = onlyArg === undefined ? null : onlyArg.slice('--only='.length).split(',').filter(Boolean);
if (only) {
  const unknown = only.filter((name) => !CONVERTERS.some((c) => c.name === name));
  if (unknown.length) fail(2, `build-db: unknown converter ${unknown.join(', ')}`);
}
const selected = only === null ? CONVERTERS : CONVERTERS.filter((c) => only.includes(c.name));

rmSync(TMP, { force: true });
const db = new Database(TMP);
db.pragma('journal_mode = OFF');
db.pragma('synchronous = OFF');
db.exec('create table build_info(key text primary key, value text not null)');
const info = db.prepare('insert into build_info values (?, ?)');
info.run('app_commit', commit);
info.run('converter_version', CONVERTER_VERSION);
info.run('built_at', new Date().toISOString());

try {
  for (const converter of selected) {
    const started = Date.now();
    converter.convert(db, { recordInput: (path, digest) => info.run(`input:${path}`, digest) });
    console.log(`converter ${converter.name}: ${Date.now() - started} ms`);
  }
  db.exec('ANALYZE');
  db.exec('VACUUM');
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`integrity_check: ${integrity}`);
} catch (error) {
  db.close();
  rmSync(TMP, { force: true });
  fail(1, `build-db: ${error instanceof InputError ? '' : 'error: '}${error.message}`);
}
db.close();
renameSync(TMP, OUT);
writeFileSync(`${OUT}.sha256`, `${sha256(readFileSync(OUT))}\n`);
console.log(`dvns.sqlite ok (${(readFileSync(OUT).length / 1e6).toFixed(1)} MB)`);
