// Builds src/data/geo.json: East Asia coastlines and borders from Natural Earth 50m (via world-atlas).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { feature, mesh } from 'topojson-client';

const require = createRequire(import.meta.url);
const world = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
const BBOX = [-180, -60, 180, 85]; // whole world except Antarctica

const r = (n) => Math.round(n * 100) / 100;
const inBox = (ring) => ring.some(([x, y]) => x >= BBOX[0] && x <= BBOX[2] && y >= BBOX[1] && y <= BBOX[3]);
const clean = (ring) => {
  const out = [];
  for (const [x, y] of ring) {
    const p = [r(x), r(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  // A ring crossing the antimeridian jumps from +180 to -180; make it continuous (longitudes past 180) and let the map repeat the world.
  if (out.some((p, i) => i && Math.abs(p[0] - out[i - 1][0]) > 180)) for (const p of out) if (p[0] < 0) p[0] = r(p[0] + 360);
  return out;
};

const land = [];
for (const f of feature(world, world.objects.land).features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) if (inBox(poly[0])) land.push(clean(poly[0]));
}
const b = mesh(world, world.objects.countries, (a, c) => a !== c);
const borders = b.coordinates.filter(inBox).map(clean);
writeFileSync(new URL('../src/data/geo.json', import.meta.url), JSON.stringify({ land, borders }));
console.log('land rings', land.length, 'borders', borders.length);
