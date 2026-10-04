// dvns-app fork: SQLite side of searchAnacOperators (spec 11.3).
import { ftsPhrase, sqliteDb } from "@/lib/data/sqlite";

/** The first `capacity` matching lines in upstream's order (prefix tier, then tail_rank), and the match count. */
export function sqliteOperatorSearchPage(normalizedQuery: string, capacity: number): { lines: string[]; matched: number } {
  const db = sqliteDb();
  const where = `s.position in (select rowid from operator_search_fts where operator_search_fts match ?)
    and instr(s.search_key, ?) > 0`;
  const params = [ftsPhrase(normalizedQuery), normalizedQuery];
  const matched = (db.prepare(`select count(*) n from operator_search s where ${where}`).get(...params) as { n: number }).n;
  const rows = db.prepare(`select s.line from operator_search s where ${where}
      order by case when substr(s.search_key, 1, ?) = ? then 0 else 1 end, s.tail_rank
      limit ?`).all(...params, normalizedQuery.length, normalizedQuery, capacity);
  return { lines: (rows as Array<{ line: string }>).map((row) => row.line), matched };
}
