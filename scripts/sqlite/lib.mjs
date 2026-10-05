// Shared helpers for the dvns-app SQLite converter and parity harness.
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export class InputError extends Error {
  constructor(path, detail) {
    super(`input file failed verification: ${path}: ${detail}`);
    this.name = 'InputError';
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** SHA-256 of a file read in chunks: dvns.sqlite is larger than the 2 GiB a single readFileSync can return. */
export function sha256File(path) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  const descriptor = openSync(path, 'r');
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

/** Read a file and check it against the size and SHA-256 its manifest records, as the files backend does. */
export function readVerified(path, expected) {
  let bytes;
  try { bytes = readFileSync(path); } catch { throw new InputError(path, 'missing'); }
  if (bytes.length !== expected.bytes) throw new InputError(path, `size ${bytes.length}, manifest says ${expected.bytes}`);
  const digest = sha256(bytes);
  if (digest !== expected.sha256) throw new InputError(path, `SHA-256 ${digest}, manifest says ${expected.sha256}`);
  return bytes;
}

export function gunzipExact(bytes, rawBytes, path) {
  const raw = gunzipSync(bytes, { maxOutputLength: Math.max(rawBytes, 1) });
  if (raw.length !== rawBytes) throw new InputError(path, `decompressed ${raw.length} bytes, manifest says ${rawBytes}`);
  return raw;
}

/** Small seeded PRNG so the parity corpus is the same on every run. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
