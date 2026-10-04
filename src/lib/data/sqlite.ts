// dvns-app fork: the SQLite side of the data layer (docs: dvns/docs/_specs/2026-10-04-sqlite-data-layer-design.md).
import Database from "better-sqlite3";
import { join } from "node:path";

export type DataBackend = "files" | "sqlite";

/** Which backend serves the switched data reads. Set per release by the deploy (.release-backend). */
export function dataBackend(): DataBackend {
  const value = process.env.DVNS_DATA_BACKEND ?? "files";
  if (value !== "files" && value !== "sqlite") throw new Error(`DVNS_DATA_BACKEND non valido: ${value}`);
  return value;
}

let connection: Database.Database | null = null;

/** One read-only connection per process to dvns.sqlite in the working directory (the release). */
export function sqliteDb(): Database.Database {
  if (!connection) {
    connection = new Database(join(process.cwd(), "dvns.sqlite"), { readonly: true, fileMustExist: true });
  }
  return connection;
}

/** FTS5 MATCH argument for a folded query: a quoted phrase, which the trigram tokenizer treats as a substring. */
export function ftsPhrase(folded: string): string {
  if (!/^[0-9A-Z]+$/.test(folded)) throw new Error("Query FTS non normalizzata");
  return `"${folded}"`;
}

/** Whether this process opened dvns.sqlite; the parity harness uses it to prove the SQLite side ran. */
export function sqliteDbOpened(): boolean {
  return connection !== null;
}

export function closeSqliteDbForTests(): void {
  connection?.close();
  connection = null;
}
