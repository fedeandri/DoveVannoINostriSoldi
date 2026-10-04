import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const INDEX = 'src/data/generated/anac-operator-awards-index';

function release() {
  const dir = mkdtempSync(join(tmpdir(), 'dvns-operators-convert-'));
  mkdirSync(join(dir, INDEX), { recursive: true });
  for (const file of ['meta.json', 'search.jsonl.gz']) cpSync(join(root, INDEX, file), join(dir, INDEX, file));
  writeFileSync(join(dir, '.release-commit'), 'test\n');
  return dir;
}

function convert(dir) {
  return spawnSync(process.execPath, [join(root, 'scripts/sqlite/build-db.mjs'), '--only=operators'], { cwd: dir, encoding: 'utf8' });
}

test('operators converter accepts the published index', () => {
  const dir = release();
  const run = convert(dir);
  assert.equal(run.status, 0, run.stderr);
  rmSync(dir, { recursive: true });
});

test('operators converter refuses a corrupted search.jsonl.gz', () => {
  const dir = release();
  const path = join(dir, INDEX, 'search.jsonl.gz');
  const bytes = readFileSync(path);
  bytes[200] ^= 0xff;
  writeFileSync(path, bytes);
  const run = convert(dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /input file failed verification: src\/data\/generated\/anac-operator-awards-index\/search\.jsonl\.gz/);
  rmSync(dir, { recursive: true });
});
