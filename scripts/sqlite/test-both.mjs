#!/usr/bin/env node
// Spec section 6: upstream's node tests under both backends. Under sqlite, every test file that calls
// process.chdir( or mkdtempSync( is excluded (its fixture data would not be in dvns.sqlite) and reported.
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const all = readdirSync('tests').filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `tests/${f}`);
const excluded = all.filter((f) => /process\.chdir\(|mkdtempSync\(/.test(readFileSync(f, 'utf8')));
// The two integrity tests the spec names run under files only, whatever the pattern finds.
for (const f of ['tests/anac-operator-integrity.test.mjs', 'tests/medical-device-spending-index.test.mjs']) {
  if (all.includes(f) && !excluded.includes(f)) excluded.push(f);
}

function run(backend, files) {
  console.log(`\n=== npm test with DVNS_DATA_BACKEND=${backend}: ${files.length} files ===`);
  const child = spawnSync(process.execPath,
    ['--experimental-strip-types', '--import', './scripts/ci/node-test-setup.mjs', '--test', ...files],
    { stdio: 'inherit', env: { ...process.env, DVNS_DATA_BACKEND: backend } });
  return child.status === 0;
}

const filesOk = run('files', all);
const sqliteOk = run('sqlite', all.filter((f) => !excluded.includes(f)));
for (const f of excluded) console.log(`not run under sqlite: ${f}`);
console.log(`\ntest-both: files ${filesOk ? 'pass' : 'FAIL'}, sqlite ${sqliteOk ? 'pass' : 'FAIL'}, ${excluded.length} files not run under sqlite`);
process.exit(filesOk && sqliteOk ? 0 : 1);
