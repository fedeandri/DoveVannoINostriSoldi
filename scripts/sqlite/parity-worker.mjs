// Runs one backend over the parity corpus. Started by parity.mjs with DVNS_DATA_BACKEND set.
//   node --experimental-strip-types scripts/sqlite/parity-worker.mjs <corpus.json> <out.json>
import '../ci/register-source-alias.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [corpusPath, outPath] = process.argv.slice(2);
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
const results = [];
for (const group of corpus) {
  const mod = await import(pathToFileURL(resolve(group.modulePath)).href);
  for (const item of group.cases) {
    let outcome;
    try {
      outcome = { value: await mod[item.fn](item.input) };
    } catch (error) {
      outcome = { error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) } };
    }
    results.push({ id: item.id, outcome: JSON.stringify(outcome) });
  }
}
// Prove which side ran: the files process must never open dvns.sqlite, the sqlite process must have
// opened it whenever it ran any case.
const { sqliteDbOpened } = await import(pathToFileURL(resolve('src/lib/data/sqlite.ts')).href);
writeFileSync(outPath, JSON.stringify({ sqliteOpened: sqliteDbOpened(), results }));
