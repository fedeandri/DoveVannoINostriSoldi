// Times searchMedicalDevices for three queries on each backend, in separate processes (spec 11.5, M2b).
import { spawnSync } from 'node:child_process';

const probe = `await import('./scripts/ci/register-source-alias.mjs');
const m = await import('./src/lib/medical-device-spending.ts');
for (const q of ['PROTESI', '10', '1']) {
  const t = performance.now(); const r = await m.searchMedicalDevices({ q });
  console.log(process.env.DVNS_DATA_BACKEND, q, r.matched, Math.round(performance.now() - t) + ' ms');
}`;
for (const backend of ['files', 'sqlite']) {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', probe],
    { env: { ...process.env, DVNS_DATA_BACKEND: backend }, encoding: 'utf8' });
  process.stdout.write(child.stdout); process.stderr.write(child.stderr);
  if (child.status !== 0) process.exit(child.status ?? 2);
}
