// Runs one backend over the parity corpus. Started by parity.mjs with DVNS_DATA_BACKEND set.
//   node --experimental-strip-types scripts/sqlite/parity-worker.mjs <corpus.json> <out.json>
import '../ci/register-source-alias.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [corpusPath, outPath] = process.argv.slice(2);
// Corpus numbers JSON cannot hold travel as { $number: 'NaN' | 'Infinity' | '-Infinity' }.
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'), (_key, value) =>
  value && typeof value === 'object' && typeof value.$number === 'string' && Object.keys(value).length === 1
    ? Number(value.$number) : value);
async function call(mod, fn, input) {
  if (fn === 'walkSearch' || fn === 'walkFacts') {
    const target = fn === 'walkSearch' ? mod.searchMedicalDevices : mod.listMedicalDeviceFacts;
    const { pages, ...rest } = input;
    const out = [];
    let cursor;
    for (let page = 0; page < pages; page += 1) {
      const result = await target({ ...rest, cursor });
      out.push(result);
      cursor = result.pagination.nextCursor;
      if (!cursor) break;
    }
    // Spec section 5: pages must join without gaps or duplicates. A broken join stops the worker
    // (exit 3), so it fails the run even when both backends break the same way.
    const ids = out.flatMap((page) => fn === 'walkSearch'
      ? page.hits.map((hit) => hit.ref)
      : page.rows.map((row) => `${row.datasetId}:${row.sourceRow}`));
    if (new Set(ids).size !== ids.length) { console.error(`cursor walk ${JSON.stringify(input)}: duplicate rows`); process.exit(3); }
    if (fn === 'walkSearch') {
      const whole = await target({ ...rest, limit: String(Math.min(100, ids.length || 1)) });
      const expected = whole.hits.map((hit) => hit.ref).slice(0, ids.length);
      if (expected.join() !== ids.join()) { console.error(`cursor walk ${JSON.stringify(input)}: pages do not join`); process.exit(3); }
    }
    return out;
  }
  if (fn === 'firstBucketFacts') {
    const aggregate = await mod.aggregateMedicalDeviceSpending({ ...input, limit: '1' });
    const first = aggregate.rows[0];
    if (!first) return null;
    return mod.listMedicalDeviceAggregateFacts({ ...input, value: first.drilldown.value, role: first.drilldown.role, limit: '25' });
  }
  if (fn === 'profemurFiltered') {
    // The filtered search of upstream's test: year, region and company come from a fact of device 1175175.
    const detail = await mod.listMedicalDeviceFacts({ type: '1', number: '1175175', limit: 1 });
    const fact = detail.rows[0];
    return mod.searchMedicalDevices({ q: 'PROFEMUR PRESERVE', type: '1', year: String(fact.year), region: fact.region, company: fact.company });
  }
  if (fn === 'cursorBeyond') {
    // A well-formed cursor whose `next` is beyond the match count, built as nextCursor builds it.
    const { canonicalJson, sha256Hex } = await import(pathToFileURL(resolve('src/lib/integrated-source-contract.ts')).href);
    const meta = JSON.parse(readFileSync('src/data/generated/medical-device-spending-index/meta.json', 'utf8'));
    const folded = mod.normalized(input.q.trim());
    const filter = sha256Hex(canonicalJson({ company: null, q: folded, region: null, type: null, year: null }));
    // input.next: 'end' is the match count itself (an empty last page); otherwise beyond it.
    const next = input.next === 'end' ? (await mod.searchMedicalDevices({ q: input.q })).matched : 1_000_000;
    const cursor = Buffer.from(canonicalJson({ filter, next, source: meta.sourceSpecSha256, v: 1 })).toString('base64url');
    return mod.searchMedicalDevices({ q: input.q, cursor, ...(input.limit === undefined ? {} : { limit: input.limit }) });
  }
  return mod[fn](input);
}

const started = performance.now();
const results = [];
for (const group of corpus) {
  const mod = await import(pathToFileURL(resolve(group.modulePath)).href);
  for (const item of group.cases) {
    let outcome;
    try {
      outcome = { value: await call(mod, item.fn, item.input) };
    } catch (error) {
      outcome = { error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) } };
    }
    results.push({ id: item.id, outcome: JSON.stringify(outcome) });
  }
}
// Prove which side ran: the files process must never open dvns.sqlite, the sqlite process must have
// opened it whenever it ran any case.
const { sqliteDbOpened } = await import(pathToFileURL(resolve('src/lib/data/sqlite.ts')).href);
// maxRSS is in kilobytes. Spec 2: the parent decides concurrency from these measurements.
const maxRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
const elapsedS = Math.round((performance.now() - started) / 1000);   // the cases only, not module loading
writeFileSync(outPath, JSON.stringify({ sqliteOpened: sqliteDbOpened(), maxRssMb, elapsedS, results }));
