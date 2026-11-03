// Builds src/data/airports.json from open data:
//   - OurAirports airports.csv + runways.csv (public domain): every airport with scheduled service
//   - GeoNames cities1000 (CC BY 4.0): populations, split between nearby airports (catchments)
//   - Natural Earth land (src/data/geo.json): which landmass each airport and town is on
// Raw downloads are cached in data-raw/ (git-ignored). Run: npm run build:data
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { NAMES, METROS, HSR, TOURISM_BY_REGION, SLOT_OVERRIDES, TIERS, BRIDGED } from './airport-meta.mjs';

const RAW = new URL('../data-raw/', import.meta.url);
const COUNTRIES = ['TW', 'HK', 'MO', 'JP'];
/** National populations used to rescale GeoNames (which double counts some districts). Approximate, 2024. */
const NATIONAL_POP = { JP: 124.0e6, TW: 23.4e6, HK: 7.5e6, MO: 0.68e6 };

async function fetchRaw(name, url) {
  mkdirSync(RAW, { recursive: true });
  const path = new URL(name, RAW);
  if (!existsSync(path)) {
    console.log('downloading', url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return path;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
function dist(lat1, lon1, lat2, lon2) {
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// --- Landmasses from Natural Earth rings ---
const geo = JSON.parse(readFileSync(new URL('../src/data/geo.json', import.meta.url)));
const rings = geo.land.map((ring) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { ring, minX, minY, maxX, maxY };
});
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Index of the land ring a point is on, allowing points up to ~8 km off the coastline. */
function ringOf(lat, lon) {
  const pad = 0.1;
  let best = -1, bestD = 8;
  for (let k = 0; k < rings.length; k++) {
    const r = rings[k];
    if (lon < r.minX - pad || lon > r.maxX + pad || lat < r.minY - pad || lat > r.maxY + pad) continue;
    if (inRing(r.ring, lon, lat)) return k;
    // Distance to each coastline segment (flat approximation, km).
    const kx = 111.32 * Math.cos(rad(lat)), ky = 110.57;
    for (let i = 0; i < r.ring.length - 1; i++) {
      const ax = (r.ring[i][0] - lon) * kx, ay = (r.ring[i][1] - lat) * ky;
      const bx = (r.ring[i + 1][0] - lon) * kx, by = (r.ring[i + 1][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < bestD) { bestD = d; best = k; }
    }
  }
  return best;
}

async function main() {
  const airportsCsv = parseCsv(readFileSync(await fetchRaw('airports.csv', 'https://davidmegginson.github.io/ourairports-data/airports.csv'), 'utf8'));
  const runwaysCsv = parseCsv(readFileSync(await fetchRaw('runways.csv', 'https://davidmegginson.github.io/ourairports-data/runways.csv'), 'utf8'));
  const citiesZip = await fetchRaw('cities1000.zip', 'https://download.geonames.org/export/dump/cities1000.zip');
  const citiesTxt = new URL('cities1000.txt', RAW);
  if (!existsSync(citiesTxt)) execSync(`unzip -o -q "${citiesZip.pathname}" -d "${RAW.pathname}"`);

  const longest = {};
  for (const r of runwaysCsv) {
    if (r.closed === '1') continue;
    const len = Number(r.length_ft) || 0;
    longest[r.airport_ident] = Math.max(longest[r.airport_ident] ?? 0, len);
  }

  const airports = airportsCsv
    .filter((a) => COUNTRIES.includes(a.iso_country) && a.scheduled_service === 'yes' && a.iata_code && a.type !== 'heliport')
    .filter((a) => NAMES[a.iata_code])
    .map((a) => {
      const lat = Number(a.latitude_deg), lon = Number(a.longitude_deg);
      const ft = longest[a.ident] ?? 0;
      const maxClass = ft < 5300 ? 'turboprop' : ft < 6600 ? 'regional' : ft < 8800 ? 'narrowbody' : 'widebody';
      const size = a.type === 'large_airport' ? 'large' : a.type === 'medium_airport' ? 'medium' : 'small';
      return { code: a.iata_code, name: NAMES[a.iata_code], country: a.iso_country, region: a.iso_region, lat, lon, size, runwayM: Math.round(ft * 0.3048), maxClass, ring: ringOf(lat, lon) };
    });
  const missing = Object.keys(NAMES).filter((c) => !airports.find((a) => a.code === c));
  if (missing.length) console.warn('named but not found:', missing.join(' '));

  // Landmass groups: link the main islands joined by bridges and tunnels.
  const ringOfCode = (c) => airports.find((a) => a.code === c).ring;
  const groupName = new Map();
  for (const c of ['HND', 'FUK', 'MYJ', 'CTS']) groupName.set(ringOfCode(c), 'jp-main');
  groupName.set(ringOfCode('TPE'), 'tw-main');
  for (const a of airports) {
    if (a.code === 'HKG' || a.code === 'MFM') a.landmass = 'prd';
    else if (BRIDGED[a.code]) a.landmass = BRIDGED[a.code];
    else if (a.ring >= 0 && groupName.has(a.ring)) a.landmass = groupName.get(a.ring);
    else a.landmass = a.ring >= 0 ? `ring-${a.ring}` : `isl-${a.code}`;
  }
  const metroOf = {};
  for (const [m, codes] of Object.entries(METROS)) for (const c of codes) metroOf[c] = m;

  // --- Catchments ---
  const catchment = Object.fromEntries(airports.map((a) => [a.code, 0]));
  catchment.HKG = NATIONAL_POP.HK;
  catchment.MFM = NATIONAL_POP.MO;
  const sizeW = { hub: 10, major: 3, large: 1.5, medium: 1, small: 0.5 };
  const tierOf = (a) => TIERS[a.code] ?? a.size;
  const cityRows = readFileSync(citiesTxt, 'utf8').split('\n');
  const towns = { JP: [], TW: [] };
  for (const line of cityRows) {
    const f = line.split('\t');
    if (!(f[8] in towns)) continue;
    if (['PPLX', 'PPLH', 'PPLQ', 'PPLW'].includes(f[7])) continue;
    towns[f[8]].push({ lat: Number(f[4]), lon: Number(f[5]), pop: Number(f[14]) });
  }
  let unserved = 0;
  for (const [country, list] of Object.entries(towns)) {
    const scale = NATIONAL_POP[country] / list.reduce((s, t) => s + t.pop, 0);
    const local = airports.filter((a) => a.country === country);
    for (const t of list) {
      const pop = t.pop * scale;
      const ring = ringOf(t.lat, t.lon);
      const land = ring >= 0 && groupName.has(ring) ? groupName.get(ring) : ring >= 0 ? `ring-${ring}` : null;
      const cands = [];
      for (const a of local) {
        const d = dist(t.lat, t.lon, a.lat, a.lon);
        const sameLand = land ? a.landmass === land || (a.landmass === `isl-${a.code}` && d < 40) : d < 40;
        if (!sameLand || d > 250) continue;
        cands.push({ a, d, w: sizeW[tierOf(a)] * Math.exp(-d / 40) });
      }
      if (!cands.length) { unserved += pop; continue; }
      const total = cands.reduce((s, c) => s + c.w, 0);
      const nearest = Math.min(...cands.map((c) => c.d));
      const reach = nearest <= 80 ? 1 : Math.exp(-(nearest - 80) / 120);
      for (const c of cands) catchment[c.a.code] += (pop * reach * c.w) / total;
      unserved += pop * (1 - reach);
    }
  }
  console.log('population far from any airport (millions):', (unserved / 1e6).toFixed(1));

  const out = airports
    .map((a) => {
      const island = a.landmass !== 'jp-main' && a.landmass !== 'tw-main' && a.landmass !== 'prd';
      return {
        code: a.code,
        name: a.name,
        country: a.country,
        region: a.region,
        metro: metroOf[a.code] ?? a.code,
        lat: Math.round(a.lat * 1e4) / 1e4,
        lon: Math.round(a.lon * 1e4) / 1e4,
        size: tierOf(a),
        runwayM: a.runwayM,
        maxClass: a.maxClass,
        landmass: a.landmass,
        hsr: HSR.has(a.code),
        // Small islands often have no town in GeoNames; assume at least a village-sized population.
        catchment: Math.round(Math.max(catchment[a.code], island ? 3000 : 0)),
        tourism: (TOURISM_BY_REGION[a.region] ?? 1) * (island ? 1.3 : 1),
        slotCap: SLOT_OVERRIDES[a.code] ?? { hub: 140, major: 84, large: 56, medium: 35, small: 14 }[tierOf(a)],
      };
    })
    .sort((x, y) => y.catchment - x.catchment);
  writeFileSync(new URL('../src/data/airports.json', import.meta.url), JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{'));
  console.log(out.length, 'airports');
  for (const a of out) console.log(a.code, a.name, (a.catchment / 1e6).toFixed(2) + 'M', a.maxClass, a.landmass, a.hsr ? 'HSR' : '');
}

main();
