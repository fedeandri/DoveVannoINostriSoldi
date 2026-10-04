// Converter for src/lib/medical-device-spending.ts (spec section 4.1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InputError, gunzipExact, readVerified, sha256 } from '../lib.mjs';

const ROOT = 'src/data/generated/medical-device-spending-index';
export const name = 'medical';

export function convert(db, ctx) {
  const metaPath = join(ROOT, 'meta.json');
  const metaBytes = readFileSync(metaPath);
  ctx.recordInput(metaPath, sha256(metaBytes));
  const meta = JSON.parse(metaBytes.toString('utf8'));

  // The search scan's lines, in file order, with their searchKey.
  const searchPath = join(ROOT, meta.search.path);
  const search = gunzipExact(readVerified(searchPath, meta.search), meta.search.rawBytes, searchPath);
  ctx.recordInput(searchPath, meta.search.sha256);
  db.exec('create table medical_search(position integer primary key, search_key text not null, line text not null)');
  const insertLine = db.prepare('insert into medical_search values (?, ?, ?)');
  let records = 0;
  db.transaction(() => {
    let start = 0;
    while (start < search.length) {
      const end = search.indexOf(0x0a, start);
      if (end < 0) throw new InputError(searchPath, 'last line has no newline');
      const line = search.toString('utf8', start, end);
      start = end + 1;
      const key = JSON.parse(line).searchKey;
      if (typeof key !== 'string') throw new InputError(searchPath, `line ${records + 1} has no searchKey`);
      records += 1;
      insertLine.run(records, key, line);
    }
  })();
  if (records !== meta.search.records) throw new InputError(searchPath, `${records} lines, manifest says ${meta.search.records}`);
  db.exec(`create virtual table medical_search_fts using fts5(search_key, content='medical_search',
    content_rowid='position', tokenize='trigram case_sensitive 1');
    insert into medical_search_fts(medical_search_fts) values('rebuild');`);

  // The decompressed blocks of details.jsonl.gz and aggregates.json.gz, keyed as readBlock reads them.
  db.exec('create table medical_block(file text not null, key text not null, raw blob not null, primary key (file, key)) without rowid');
  const insertBlock = db.prepare('insert into medical_block values (?, ?, ?)');
  for (const [part, blocks] of [[meta.details, meta.details.blocks], [meta.aggregates, meta.aggregates.scopes]]) {
    const path = join(ROOT, part.path);
    let whole;
    try { whole = readFileSync(path); } catch { throw new InputError(path, 'missing'); }
    if (whole.length !== part.bytes) throw new InputError(path, `size ${whole.length}, manifest says ${part.bytes}`);
    ctx.recordInput(path, sha256(whole));
    db.transaction(() => {
      for (const block of blocks) {
        const bytes = whole.subarray(block.offset, block.offset + block.bytes);
        if (sha256(bytes) !== block.sha256) throw new InputError(path, `block ${block.key}: SHA-256 differs from the manifest`);
        insertBlock.run(part.path, block.key, gunzipExact(bytes, block.rawBytes, `${path} block ${block.key}`));
      }
    })();
  }
}
