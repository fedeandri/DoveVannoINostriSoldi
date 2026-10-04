// Converter for searchAnacOperators in src/lib/data/anac-operator-awards-index.ts (spec 11.3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InputError, sha256 } from '../lib.mjs';
import { assertAnacOperatorSearchHit, compareOperatorTail, parseJsonl, readGunzipped } from '../../../src/lib/data/anac-operator-awards-index.ts';

const ROOT = 'src/data/generated/anac-operator-awards-index';
const MAX_SEARCH_BYTES = 64 * 1024 * 1024;     // as upstream's MAX_SEARCH_BYTES (module line 23)
const MAX_SEARCH_RECORDS = 1_000_000;          // as upstream's MAX_SEARCH_RECORDS (module line 25)
export const name = 'operators';

export function convert(db, ctx) {
  const metaPath = join(ROOT, 'meta.json');
  const metaBytes = readFileSync(metaPath);
  ctx.recordInput(metaPath, sha256(metaBytes));
  const meta = JSON.parse(metaBytes.toString('utf8'));
  const searchPath = join(ROOT, 'search.jsonl.gz');
  let text;
  let hits;
  try {
    text = readGunzipped(searchPath, MAX_SEARCH_BYTES, meta.search);
    hits = parseJsonl(text, assertAnacOperatorSearchHit, MAX_SEARCH_RECORDS);
  } catch (error) {
    throw new InputError(searchPath, error.message);
  }
  ctx.recordInput(searchPath, meta.search.sha256);
  if (hits.length !== meta.totals.operators) {
    throw new InputError(searchPath, `${hits.length} records, manifest says ${meta.totals.operators}`);
  }
  const lines = text.split('\n').filter((line) => line.length > 0);
  const rows = hits.map((hit, index) => ({ position: index + 1, hit, line: lines[index] }));
  rows.slice()
    .sort((a, b) => compareOperatorTail(a.hit, b.hit) || a.position - b.position)   // upstream's stable order
    .forEach((row, index) => { row.tailRank = index; });
  db.exec(`create table operator_search(position integer primary key, search_key text not null, line text not null,
    tail_rank integer not null)`);
  const insert = db.prepare('insert into operator_search values (?, ?, ?, ?)');
  db.transaction(() => {
    for (const row of rows) insert.run(row.position, row.hit.searchKey, row.line, row.tailRank);
  })();
  db.exec(`create virtual table operator_search_fts using fts5(search_key, content='operator_search',
    content_rowid='position', tokenize='trigram case_sensitive 1');
    insert into operator_search_fts(operator_search_fts) values('rebuild');`);
}
