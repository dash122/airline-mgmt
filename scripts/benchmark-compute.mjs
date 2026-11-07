import { build } from 'esbuild';

const output = await build({ stdin: { contents: `
import { markets } from './src/sim/markets';
import { emptyPlan, addRoundTrip, simulate } from './src/sim/simulate';
import { viewFromHub } from './src/sim/airports';
import { createHash } from 'node:crypto';
const measure = (name, fn) => { const start = performance.now(); const value = fn(); console.log(name + ': ' + (performance.now() - start).toFixed(1) + ' ms'); return value; };
const all = measure('Cold market generation', () => markets());
console.log('Market checksum: ' + createHash('sha256').update(JSON.stringify([...all])).digest('hex'));
let plan = emptyPlan('TPE');
for (const to of ['HKG', 'NRT', 'SIN', 'BKK', 'LHR']) { const next = addRoundTrip(plan, 'TPE', to); if ('plan' in next) plan = next.plan; }
const result = measure('Cold simulation (5 routes)', () => simulate(plan));
measure('Warm simulation (5 routes)', () => simulate(plan));
measure('Cold airport transfer analysis', () => viewFromHub(plan, result, 'TPE', 'HKG'));
measure('Warm airport transfer analysis', () => viewFromHub(plan, result, 'TPE', 'HKG'));
`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
