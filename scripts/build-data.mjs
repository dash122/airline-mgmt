// Builds src/data/airports.json from open data:
//   - OurAirports airports.csv + runways.csv (public domain): major global and original regional scheduled airports
//   - Regional GeoNames catchment seed (CC BY 4.0); global catchments are gameplay estimates
//   - OpenFlights (ODbL/DbCL): fixed UTC offsets, estimated from longitude if absent
//   - Natural Earth land (src/data/geo.json): which landmass each airport and town is on
// Raw downloads are cached in data-raw/ (git-ignored). Run: npm run build:data
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NAMES, METROS, HSR, TIERS } from './airport-meta.mjs';

const RAW = new URL('../data-raw/', import.meta.url);

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

const rad = (d) => (d * Math.PI) / 180;

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
  const zoneRows = parseCsv('id,name,city,country,iata,icao,lat,lon,elevation,offset,dst,zone,type,source\n' + readFileSync(await fetchRaw('openflights.dat', 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat'), 'utf8'));
  const zones = new Map(zoneRows.filter(r => Number.isFinite(Number(r.offset))).map(r => [r.iata, Number(r.offset) * 60]));
  const previous = new Map(JSON.parse(readFileSync(new URL('./regional-airports.json', import.meta.url))).map(a => [a.code, a]));
  const longest = {};
  for (const r of runwaysCsv) {
    if (r.closed === '1' || !/^(ASP|CON|BIT|PEM)/i.test(r.surface)) continue;
    longest[r.airport_ident] = Math.max(longest[r.airport_ident] ?? 0, Number(r.length_ft) || 0);
  }
  const metros = Object.fromEntries(Object.entries(METROS).flatMap(([m, codes]) => codes.map(c => [c, m])));
  for (const codes of [['LHR','LGW','LCY','STN','LTN'], ['JFK','EWR','LGA'], ['CDG','ORY'], ['ICN','GMP'], ['PEK','PKX'], ['PVG','SHA'], ['DXB','DWC']]) for (const c of codes) metros[c] = codes[0];
  const out = [];
  for (const a of airportsCsv) {
    const ft = longest[a.ident] ?? 0;
    if (a.scheduled_service !== 'yes' || !/^[A-Z]{3}$/.test(a.iata_code) || ft < 5300) continue;
    if (a.type !== 'large_airport' && !previous.has(a.iata_code)) continue;
    if (!['large_airport', 'medium_airport', 'small_airport'].includes(a.type)) continue;
    const old = previous.get(a.iata_code), lat = Number(a.latitude_deg), lon = Number(a.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ ...old, code: a.iata_code, name: NAMES[a.iata_code] ?? a.name, country: a.iso_country, region: a.iso_region,
      metro: metros[a.iata_code] ?? a.iata_code, lat, lon,
      size: TIERS[a.iata_code] ?? (a.type === 'large_airport' ? 'large' : 'medium'),
      runwayM: Math.round(ft * 0.3048), maxClass: ft < 6600 ? 'regional' : ft < 8800 ? 'narrowbody' : 'widebody',
      catchment: old?.catchment ?? 2000000, tourism: old?.tourism ?? 1,
      landmass: (old?.landmass && !old.landmass.startsWith('ring-') ? old.landmass : null) ?? (ringOf(lat, lon) >= 0 ? (rings[ringOf(lat, lon)].maxX - rings[ringOf(lat, lon)].minX > 30 ? 'main-' : 'ring-') + ringOf(lat, lon) : 'isl-' + a.iata_code),
      hsr: HSR.has(a.iata_code), slotCap: old?.slotCap ?? 56,
      utcOffset: zones.get(a.iata_code) ?? Math.round(lon / 15) * 60 });
  }
  if (new Set(out.map(a => a.code)).size !== out.length) throw new Error('Duplicate IATA codes');
  out.sort((a,b) => b.catchment - a.catchment || a.code.localeCompare(b.code));
  writeFileSync(new URL('../src/data/airports.json', import.meta.url), JSON.stringify(out).replace(/\},\{/g, '},\n{'));
  console.log(out.length, 'jet-capable airports in', new Set(out.map(a => a.country)).size, 'countries/territories');
}
main();
