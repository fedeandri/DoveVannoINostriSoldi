// dvns-app fork: SQLite side of the switched reads in medical-device-spending.ts (spec sections 4.1 and 11.1).
import { ftsPhrase, sqliteDb } from "@/lib/data/sqlite";

export type MedicalSearchFilter = {
  folded: string;
  type: "1" | "2" | null;
  year: number | null;
  scopeIds: readonly number[] | null;
};

/** The matched set of spec 11.1 as a WHERE clause over `medical_search s`. */
function matchedSet(filter: MedicalSearchFilter): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (filter.folded.length >= 3) {
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

/** One page of matching lines, in upstream's order: its three tiers as one expression, then tail_rank. */
export function sqliteMedicalSearchPage(filter: MedicalSearchFilter, start: number, size: number): string[] {
  const { sql, params } = matchedSet(filter);
  const rows = sqliteDb().prepare(`select s.line from medical_search s where ${sql}
      order by case when s.number_folded = ? then 0 when substr(s.search_key, 1, ?) = ? then 1 else 2 end, s.tail_rank
      limit ? offset ?`).all(...params, filter.folded, filter.folded.length, filter.folded, size, start);
  return (rows as Array<{ line: string }>).map((row) => row.line);
}

/** Distinct types among matched rows whose raw number equals the raw trimmed query (requiresType). */
export function sqliteMedicalExactNumberTypes(filter: MedicalSearchFilter, number: string): string[] {
  const { sql, params } = matchedSet(filter);
  const rows = sqliteDb().prepare(`select distinct s.type from medical_search s where ${sql} and s.number = ?`)
    .all(...params, number);
  return (rows as Array<{ type: string }>).map((row) => row.type);
}

/** The decompressed bytes of one details.jsonl.gz or aggregates.json.gz block, as readBlock returns them. */
export function sqliteMedicalBlock(path: string, key: string, rawBytes: number): Buffer {
  const row = sqliteDb().prepare("select raw from medical_block where file = ? and key = ?").get(path, key) as
    { raw: Buffer } | undefined;
  if (!row) throw new Error(`Blocco ${path} ${key} assente da dvns.sqlite`);
  if (row.raw.length !== rawBytes) throw new Error("Dimensione blocco divergente");
  return row.raw;
}
