// Parity cases for searchAnacOperators in src/lib/data/anac-operator-awards-index.ts (spec section 5).
export const name = 'operators';
export const modulePath = 'src/lib/data/anac-operator-awards-index.ts';

const n = (value) => ({ $number: String(value) });   // numbers JSON cannot hold
// Copied from upstream's tests (tests/operator-search-efficiency.test.mjs, anac-operator-awards-index.test.mjs,
// anac-operator-integrity.test.mjs): every query and every limit they pass to searchAnacOperators, plus
// "no limit" (undefined).
const UPSTREAM_QUERIES = ['srl', 'ＳＲＬ', ' acqua ', ['srl', 'autostrade'], 'autostrade', 'éDile', 'stable', 'zzzz', '!!!', 'ab', 'x'.repeat(130)];
const UPSTREAM_LIMITS = [0, 1, 1.9, 2, 10, 10.75, 25, 50, 500, n(NaN), n(Infinity), undefined];

export function buildCases(db, random) {
  const total = db.prepare('select count(*) n from operator_search').get().n;
  const row = db.prepare('select search_key from operator_search where position = ?');
  const cases = [];
  const add = (input) => cases.push({ id: `operators:${cases.length}`, fn: 'searchAnacOperators', input });
  for (const q of UPSTREAM_QUERIES) for (const limit of UPSTREAM_LIMITS) add({ q, limit });
  for (let i = 0; i < 300; i += 1) {
    const key = row.get(1 + Math.floor(random() * total)).search_key;
    if (key.length < 3) { i -= 1; continue; }
    const length = Math.min(key.length, 3 + Math.floor(random() * 10));
    const start = Math.floor(random() * (key.length - length + 1));
    add({ q: key.slice(start, start + length) });
  }
  return cases;
}
