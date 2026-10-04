import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const INDEX = 'src/data/generated/medical-device-spending-index';

function release() {
  const dir = mkdtempSync(join(tmpdir(), 'dvns-medical-convert-'));
  mkdirSync(join(dir, 'src/data/generated'), { recursive: true });
  cpSync(join(root, INDEX), join(dir, INDEX), { recursive: true });
  writeFileSync(join(dir, '.release-commit'), 'test\n');
  return dir;
}

function convert(dir) {
  return spawnSync(process.execPath, [join(root, 'scripts/sqlite/build-db.mjs'), '--only=medical'], { cwd: dir, encoding: 'utf8' });
}

function flipByte(path, offset) {
  const bytes = readFileSync(path);
  bytes[offset] ^= 0xff;
  writeFileSync(path, bytes);
}

test('medical converter accepts the published index', () => {
  const dir = release();
  const run = convert(dir);
  assert.equal(run.status, 0, run.stderr);
  rmSync(dir, { recursive: true });
});

for (const [file, offsetFrom] of [
  ['search.jsonl.gz', () => 100],
  ['details.jsonl.gz', (meta) => meta.details.blocks[7].offset + 20],
  ['aggregates.json.gz', (meta) => meta.aggregates.scopes[0].offset + 20],
]) {
  test(`medical converter refuses a corrupted ${file}`, () => {
    const dir = release();
    const meta = JSON.parse(readFileSync(join(dir, INDEX, 'meta.json'), 'utf8'));
    flipByte(join(dir, INDEX, file), offsetFrom(meta));
    const run = convert(dir);
    assert.equal(run.status, 1);
    assert.match(run.stderr, new RegExp(`input file failed verification: ${INDEX}/${file.replace('.', '\\.')}`));
    rmSync(dir, { recursive: true });
  });
}
