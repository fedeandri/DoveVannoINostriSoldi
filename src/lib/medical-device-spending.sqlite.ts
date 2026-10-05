// dvns-app fork: SQLite side of the switched reads in medical-device-spending.ts (spec sections 4.1 and 11.1).
import { ftsPhrase, sqliteDb } from "@/lib/data/sqlite";

export type MedicalSearchFilter = {
  folded: string;
  type: "1" | "2" | null;
  year: number | null;
  scopeIds: readonly number[] | null;
};

/** The matched set of spec 11.1 as a WHERE clause over `medical_search s`. */
function matchedSet(filter: MedicalSearchFilter, useIndex = true): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (useIndex && filter.folded.length >= 3) {
    parts.push("s.position in (select rowid from medical_search_fts where medical_search_fts match ?)");
    params.push(ftsPhrase(filter.folded));
  }
  parts.push("instr(s.search_key, ?) > 0");   // always: the index may only narrow the set
  params.push(filter.folded);
  if (filter.type !== null) {
    parts.push("s.type = ?");
    params.push(filter.type);
  }
  if (filter.year !== null) {
    parts.push("exists (select 1 from medical_search_year y where y.position = s.position and y.year = ?)");
    params.push(filter.year);
  }
  if (filter.scopeIds !== null) {
    if (filter.scopeIds.length === 0) {
      parts.push("0");   // upstream's `.some` over an empty set matches nothing
    } else {
      parts.push(`exists (select 1 from medical_search_scope c where c.position = s.position and c.scope_id in (${filter.scopeIds.map(() => "?").join(", ")}))`);
      params.push(...filter.scopeIds);
    }
  }
  return { sql: parts.join(" and "), params };
}

export function sqliteMedicalSearchCount(filter: MedicalSearchFilter): number {
  const { sql, params } = matchedSet(filter);
  return (sqliteDb().prepare(`select count(*) n from medical_search s where ${sql}`).get(...params) as { n: number }).n;
}

/** Spec 12.5: one page and the matched count in one pass; `matched` is null when the page is empty. */
export function sqliteMedicalSearchPageCounted(filter: MedicalSearchFilter, start: number, size: number):
  { lines: string[]; matched: number | null } {
  const { sql, params } = matchedSet(filter);
  const rows = sqliteDb().prepare(`select s.line, count(*) over () n from medical_search s where ${sql}
      order by case when s.number_folded = ? then 0 when substr(s.search_key, 1, ?) = ? then 1 else 2 end, s.tail_rank
      limit ? offset ?`).all(...params, filter.folded, filter.folded.length, filter.folded, size, start) as
    Array<{ line: string; n: number }>;
  return { lines: rows.map((row) => row.line), matched: rows.length === 0 ? null : rows[0].n };
}

/** Distinct types among matched rows whose raw number equals the raw trimmed query (requiresType). */
export function sqliteMedicalExactNumberTypes(filter: MedicalSearchFilter, number: string): string[] {
  // Spec 12.5: through the number index; the full-text clause can only narrow a set instr already defines.
  const { sql, params } = matchedSet(filter, false);
  const rows = sqliteDb().prepare(`select distinct s.type from medical_search s where s.number = ? and ${sql}`)
    .all(number, ...params);
  return (rows as Array<{ type: string }>).map((row) => row.type);
}

/** Spec 12.1: the detail lines of a page's refs, from medical_detail. */
export function sqliteMedicalDetailLines(refs: readonly string[]): Array<{ ref: string; line: string }> {
  if (refs.length === 0) return [];
  return sqliteDb().prepare(`select ref, line from medical_detail where ref in (${refs.map(() => "?").join(", ")})`)
    .all(...refs) as Array<{ ref: string; line: string }>;
}

/** The decompressed bytes of one details.jsonl.gz or aggregates.json.gz block, as readBlock returns them. */
export function sqliteMedicalBlock(path: string, key: string, rawBytes: number): Buffer {
  const row = sqliteDb().prepare("select raw from medical_block where file = ? and key = ?").get(path, key) as
    { raw: Buffer } | undefined;
  if (!row) throw new Error(`Blocco ${path} ${key} assente da dvns.sqlite`);
  if (row.raw.length !== rawBytes) throw new Error("Dimensione blocco divergente");
  return row.raw;
}
