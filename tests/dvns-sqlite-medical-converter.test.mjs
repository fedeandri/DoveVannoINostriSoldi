import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

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

test('medical converter refuses a search line upstream would reject', () => {
  const dir = release();
  const meta = JSON.parse(readFileSync(join(dir, INDEX, 'meta.json'), 'utf8'));
  const lines = gunzipSync(readFileSync(join(dir, INDEX, 'search.jsonl.gz'))).toString('utf8').split('\n');
  const first = JSON.parse(lines[0]);
  first.number = 'not-a-number';
  lines[0] = JSON.stringify(first);
  const raw = Buffer.from(lines.join('\n'));
  const gz = gzipSync(raw);
  writeFileSync(join(dir, INDEX, 'search.jsonl.gz'), gz);
  meta.search.bytes = gz.length;
  meta.search.rawBytes = raw.length;
  meta.search.sha256 = createHash('sha256').update(gz).digest('hex');
  writeFileSync(join(dir, INDEX, 'meta.json'), JSON.stringify(meta));
  const run = convert(dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /input file failed verification: .*search\.jsonl\.gz: line 1/);
  rmSync(dir, { recursive: true });
});

function rewriteDetailsBlock(dir, index, edit) {
  // Rewrites one details block and patches meta.json so the file and block hashes still verify.
  const metaPath = join(dir, INDEX, 'meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const path = join(dir, INDEX, meta.details.path);
  const whole = readFileSync(path);
  const blocks = meta.details.blocks;
  const pieces = blocks.map((b) => whole.subarray(b.offset, b.offset + b.bytes));
  const raw = gunzipSync(pieces[index]).toString('utf8');
  const newRaw = Buffer.from(edit(raw, meta));
  pieces[index] = gzipSync(newRaw);
  let offset = 0;
  blocks.forEach((b, i) => {
    b.offset = offset; b.bytes = pieces[i].length; offset += b.bytes;
    if (i === index) { b.rawBytes = newRaw.length; b.sha256 = createHash('sha256').update(pieces[i]).digest('hex'); }
  });
  const file = Buffer.concat(pieces);
  writeFileSync(path, file);
  meta.details.bytes = file.length;
  if (meta.details.sha256 !== undefined) meta.details.sha256 = createHash('sha256').update(file).digest('hex');
  writeFileSync(metaPath, JSON.stringify(meta));
}

test('medical converter refuses a detail stored in the wrong block', () => {
  const dir = release();
  rewriteDetailsBlock(dir, 3, (raw) => {
    const lines = raw.trimEnd().split('\n');
    const first = JSON.parse(lines[0]);
    first.ref = `${first.ref.slice(0, 3)}04${first.ref.slice(5)}`;   // names block 4, stored in block 3
    lines[0] = JSON.stringify(first);
    return `${lines.join('\n')}\n`;
  });
  const run = convert(dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /block 03: .* belongs to another block/);
  rmSync(dir, { recursive: true });
});

test('medical converter refuses a details block whose fact count differs from meta.json', () => {
  const dir = release();
  rewriteDetailsBlock(dir, 5, (raw) => {
    const lines = raw.trimEnd().split('\n');
    const first = JSON.parse(lines[0]);
    first.facts = first.facts.slice(1);
    lines[0] = JSON.stringify(first);
    return `${lines.join('\n')}\n`;
  });
  const run = convert(dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /block 05: .* facts, manifest says/);
  rmSync(dir, { recursive: true });
});
