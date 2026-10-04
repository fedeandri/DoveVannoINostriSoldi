// dvns-app fork: with the SQLite backend, check the database once when the server starts and exit if it
// is unusable, so a bad release fails the deploy smoke check instead of serving errors (spec section 9).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if ((process.env.DVNS_DATA_BACKEND ?? "files") !== "sqlite") return;
  const { checkDatabaseAtStartup } = await import("@/lib/data/sqlite-startup-check");
  const result = checkDatabaseAtStartup(process.cwd());
  if (!result.ok) {
    console.error(`[dvns] database check failed (${result.failed}): ${result.message}`);
    process.exit(1);
  }
  console.log(`[dvns] database check ok in ${result.ms} ms`);
}
