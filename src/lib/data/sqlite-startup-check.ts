// dvns-app fork: refuses to serve from a missing, altered or foreign dvns.sqlite (spec section 3).
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";

export type StartupCheck =
  | { ok: true; ms: number }
  | { ok: false; failed: "missing" | "hash" | "commit"; message: string };

function fileSha256(path: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  const descriptor = openSync(path, "r");
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

export function checkDatabaseAtStartup(dir: string): StartupCheck {
  const started = Date.now();
  const dbPath = join(dir, "dvns.sqlite");
  const hashPath = join(dir, "dvns.sqlite.sha256");
  const commitPath = join(dir, ".release-commit");
  for (const path of [dbPath, hashPath, commitPath]) {
    if (!existsSync(path)) return { ok: false, failed: "missing", message: `${path} assente` };
  }
  const expected = readFileSync(hashPath, "utf8").trim();
  const actual = fileSha256(dbPath);
  if (actual !== expected) {
    return { ok: false, failed: "hash", message: `SHA-256 ${actual} diverso da ${expected}` };
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("select value from build_info where key = 'app_commit'").get() as { value: string } | undefined;
    const release = readFileSync(commitPath, "utf8").trim();
    if (!row || row.value !== release) {
      return { ok: false, failed: "commit", message: `database del commit ${row?.value ?? "?"}, release ${release}` };
    }
  } finally {
    db.close();
  }
  return { ok: true, ms: Date.now() - started };
}
