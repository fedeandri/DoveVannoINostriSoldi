// Parity cases for src/lib/medical-device-spending.ts (spec section 5).
import { readFileSync } from 'node:fs';

export const name = 'medical';
export const modulePath = 'src/lib/medical-device-spending.ts';

// Every searchMedicalDevices input used in upstream's tests/medical-device-spending-index.test.mjs (the
// abort-signal calls keep only their q). The filtered PROFEMUR search takes its year, region and company
// from a fact of device 1175175, so it runs through the worker's 'profemurFiltered' adapter.
const UPSTREAM_SEARCHES = [
  { q: '122392', limit: 10 },
  { q: 'PRPR0005', type: '1', limit: 5 },
  { q: 'MICROPORT ORTHOPEDICS', type: '1' },
  { q: 'P090804010204', type: '1' },
  { q: 'protesi' },
];

function pick(random, list) { return list[Math.floor(random() * list.length)]; }

export function buildCases(db, random) {
  const meta = JSON.parse(readFileSync('src/data/generated/medical-device-spending-index/meta.json', 'utf8'));
  const total = db.prepare('select count(*) n from medical_search').get().n;
  const row = db.prepare('select search_key, line from medical_search where position = ?');
  const randomRow = () => row.get(1 + Math.floor(random() * total));
  const substring = (minLength) => {
    for (;;) {
      const key = randomRow().search_key;
      const length = minLength + Math.floor(random() * (13 - minLength));
      if (key.length < length) continue;
      const start = Math.floor(random() * (key.length - length + 1));
      return key.slice(start, start + length);
    }
  };
  const cases = [];
  const add = (fn, input) => cases.push({ id: `medical:${fn}:${cases.length}`, fn, input });

  for (const input of UPSTREAM_SEARCHES) add('searchMedicalDevices', input);
  add('profemurFiltered', undefined);
  // Review Focus 1 and 2: the broadest queries and unusual characters.
  for (const q of ['1', '10', 'ＳＲＬ', 'éDile', '!!!', 'protesi d\'anca', '  PROTESI  ']) add('searchMedicalDevices', { q });
  for (let i = 0; i < 200; i += 1) add('searchMedicalDevices', { q: substring(1) });
  for (let i = 0; i < 50; i += 1) add('searchMedicalDevices', { q: JSON.parse(randomRow().line).number });

  const scopes = meta.aggregates.scopes;
  const regionScopes = scopes.filter((s) => s.region !== null && s.company === null);
  for (const scope of regionScopes) {
    add('searchMedicalDevices', { q: substring(3), year: String(scope.year), region: scope.region });
  }

  // Cursor walks: page 1 of 10 queries with limit 5, then pages 2 to 5, each backend following its own
  // nextCursor. Parity compares every page, cursor strings included, so a cursor that differs between
  // the backends fails on the page that holds it.
  for (let i = 0; i < 10; i += 1) add('walkSearch', { q: substring(3), limit: '5', pages: 5 });

  // 200 devices, 100 of each device type, each with its full fact list walked to the end.
  const perType = { 1: 0, 2: 0 };
  while (perType[1] < 100 || perType[2] < 100) {
    const device = JSON.parse(randomRow().line);
    if (perType[device.type] >= 100) continue;
    perType[device.type] += 1;
    add('getMedicalDeviceProfile', { type: device.type, number: device.number });
    add('walkFacts', { type: device.type, number: device.number, limit: '100', pages: 100000 });
  }

  add('listMedicalDeviceFilters', undefined);
  const years = [...new Set(scopes.map((s) => s.year))];
  const regions = [...new Set(regionScopes.map((s) => s.region))];
  const chosenRegions = [];
  while (chosenRegions.length < Math.min(20, regions.length)) {
    const region = pick(random, regions);
    if (!chosenRegions.includes(region)) chosenRegions.push(region);
  }
  for (const dimension of ['territory', 'classification', 'manufacturer']) {
    for (const year of years) {
      for (const region of [null, ...chosenRegions]) {
        if (region !== null && !regionScopes.some((s) => s.year === year && s.region === region)) continue;
        add('aggregateMedicalDeviceSpending', { year: String(year), region, dimension, limit: '100' });
        add('firstBucketFacts', { year: String(year), region, dimension });
      }
    }
  }
  return cases;
}
