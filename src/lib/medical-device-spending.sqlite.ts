// dvns-app fork: SQLite side of the two switched reads in medical-device-spending.ts (spec section 4.1).
import { ftsPhrase, sqliteDb } from "@/lib/data/sqlite";

/** The search.jsonl.gz lines whose searchKey contains the folded query, in file order. */
export function sqliteMedicalSearchLines(folded: string): string[] {
  const db = sqliteDb();
  const rows = folded.length >= 3
    ? db.prepare(`select s.line from medical_search_fts f join medical_search s on s.position = f.rowid
        where medical_search_fts match ? order by s.position`).all(ftsPhrase(folded))
    : db.prepare("select line from medical_search where instr(search_key, ?) > 0 order by position").all(folded);
  return (rows as Array<{ line: string }>).map((row) => row.line);
}

/** The decompressed bytes of one details.jsonl.gz or aggregates.json.gz block, as readBlock returns them. */
export function sqliteMedicalBlock(path: string, key: string, rawBytes: number): Buffer {
  const row = sqliteDb().prepare("select raw from medical_block where file = ? and key = ?").get(path, key) as
    { raw: Buffer } | undefined;
  if (!row) throw new Error(`Blocco ${path} ${key} assente da dvns.sqlite`);
  if (row.raw.length !== rawBytes) throw new Error("Dimensione blocco divergente");
  return row.raw;
}
