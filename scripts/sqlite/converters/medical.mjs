// Converter for src/lib/medical-device-spending.ts (spec section 4.1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InputError, gunzipExact, readVerified, sha256 } from '../lib.mjs';
import { compareSearchTail, normalized, totalSpending, validateSearchCandidate } from '../../../src/lib/medical-device-spending.ts';

const ROOT = 'src/data/generated/medical-device-spending-index';
export const name = 'medical';

export function convert(db, ctx) {
  const metaPath = join(ROOT, 'meta.json');
  const metaBytes = readFileSync(metaPath);
  ctx.recordInput(metaPath, sha256(metaBytes));
  const meta = JSON.parse(metaBytes.toString('utf8'));

  // The search lines, validated and ranked as upstream would (spec 11.1).
  const searchPath = join(ROOT, meta.search.path);
  const search = gunzipExact(readVerified(searchPath, meta.search), meta.search.rawBytes, searchPath);
  ctx.recordInput(searchPath, meta.search.sha256);
  const rows = [];
  const refs = new Set();
  let start = 0;
  while (start < search.length) {
    const end = search.indexOf(0x0a, start);
    if (end < 0) throw new InputError(searchPath, 'last line has no newline');
    const line = search.toString('utf8', start, end);
    start = end + 1;
    let candidate;
    try { candidate = validateSearchCandidate(JSON.parse(line)); } catch (error) {
      throw new InputError(searchPath, `line ${rows.length + 1}: ${error.message}`);
    }
    if (candidate.scopes.some((id) => id >= meta.aggregates.scopes.length)) {
      throw new InputError(searchPath, `line ${rows.length + 1}: scope id outside meta.json's scopes`);
    }
    if (refs.has(candidate.ref)) throw new InputError(searchPath, `line ${rows.length + 1}: duplicate ref ${candidate.ref}`);
    // Upstream's scan skips a line whose raw text lacks the query before parsing it; the SQL matched set
    // tests search_key only. The two agree only if search_key appears literally in the raw line.
    if (!line.includes(candidate.searchKey)) throw new InputError(searchPath, `line ${rows.length + 1}: searchKey is escaped in the raw line`);
    refs.add(candidate.ref);
    rows.push({ position: rows.length + 1, candidate, line });
  }
  if (rows.length !== meta.search.records) throw new InputError(searchPath, `${rows.length} lines, manifest says ${meta.search.records}`);
  const totals = new Map(rows.map((row) => [row.candidate, totalSpending(row.candidate)]));
  rows.slice()
    .sort((a, b) => compareSearchTail(a.candidate, b.candidate, totals) || a.position - b.position)
    .forEach((row, index) => { row.tailRank = index; });

  db.exec(`create table medical_search(position integer primary key, ref text not null, type text not null,
      number text not null, number_folded text not null, search_key text not null, line text not null,
      tail_rank integer not null);
    create table medical_search_year(position integer not null, year integer not null, primary key (position, year)) without rowid;
    create table medical_search_scope(position integer not null, scope_id integer not null, primary key (position, scope_id)) without rowid;`);
  const insertRow = db.prepare('insert into medical_search values (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertYear = db.prepare('insert into medical_search_year values (?, ?)');
  const insertScope = db.prepare('insert or ignore into medical_search_scope values (?, ?)');
  db.transaction(() => {
    for (const { position, candidate, line, tailRank } of rows) {
      insertRow.run(position, candidate.ref, candidate.type, candidate.number, normalized(candidate.number),
        candidate.searchKey, line, tailRank);
      for (const year of Object.keys(candidate.years)) insertYear.run(position, Number(year));
      for (const scopeId of candidate.scopes) insertScope.run(position, scopeId);
    }
  })();
  db.exec(`create index medical_search_number on medical_search(number);
    create virtual table medical_search_fts using fts5(search_key, content='medical_search',
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
