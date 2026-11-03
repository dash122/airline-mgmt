// Solves the per-group demand scales and writes src/data/scales.json. Run: npm run calibrate (after build:data).
import { writeFileSync } from 'node:fs';
import { calibrate } from '../src/sim/markets';

const scales = calibrate();
writeFileSync(new URL('../src/data/scales.json', import.meta.url), JSON.stringify(scales, null, 1));
console.log(Object.keys(scales).length, 'groups');
