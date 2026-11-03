// Builds src/data/airports.json from open data:
//   - OurAirports airports.csv + runways.csv (public domain): airports with scheduled service
//   - GeoNames cities1000 + countryInfo (CC BY 4.0): populations (split between nearby airports) and time zones
//   - Wikidata (CC0): Traditional Chinese airport names
//   - Natural Earth land (src/data/geo.json): which landmass each airport and town is on
// Raw downloads are cached in data-raw/ (git-ignored). Run: npm run build:data
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { NAMES, METROS, HSR, TOURISM_BY_REGION, SLOT_OVERRIDES, TIERS, BRIDGED } from './airport-meta.mjs';
import { CURATED, REGION_OF, HSR_WORLD, WORLD_HUBS } from './world-meta.mjs';

const RAW = new URL('../data-raw/', import.meta.url);
/** How many non-curated airports to keep (plus the busiest airport of every country). */
const WORLD_AIRPORTS = 1200;
/** Curated places: national populations used to rescale GeoNames (which double counts some districts). Approximate, 2024. */
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
function ringOf(lat, lon, tolKm = 8) {
  const pad = 0.1 + tolKm / 111;
  let best = -1, bestD = tolKm;
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

const EXTRA = new Set(['CJU', 'HNL', 'OGG', 'DPS', 'CUN', 'MLE', 'PQC', 'PEN', 'HKT', 'KIX']);
const sizeW = { hub: 10, major: 3, large: 1.5, medium: 1, small: 0.5 };

/** Standard-time UTC offset in minutes for an IANA zone (the smaller of January and July: no daylight saving). */
function stdOffsetMin(tz) {
  const off = (month) => {
    const d = new Date(Date.UTC(2026, month, 15, 12));
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(d);
    const g = (t) => Number(parts.find((p) => p.type === t).value);
    return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - d.getTime()) / 60000;
  };
  return Math.min(off(0), off(6));
}

/** Square kilometres inside a ring (flat approximation, good enough to tell islands from continents). */
function ringAreaKm2(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const lat = (ring[i][1] + ring[j][1]) / 2;
    const k = 111.32 * Math.cos(rad(lat));
    a += (ring[j][0] * k) * (ring[i][1] * 110.57) - (ring[i][0] * k) * (ring[j][1] * 110.57);
  }
  return Math.abs(a) / 2;
}

/** Traditional Chinese names from Wikidata: the city served (preferred) and the airport's own label, by IATA code. */
async function zhNames(codes) {
  const cache = new URL('wikidata-zh2.json', RAW);
  const have = existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : {};
  const todo = codes.filter((c) => !(c in have));
  const LANGS = ['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'];
  const pick = (labels) => LANGS.map((l) => labels[l]).find(Boolean) ?? null;
  for (let i = 0; i < todo.length; i += 150) {
    const batch = todo.slice(i, i + 150);
    const q = `SELECT ?i ?l ?cl ?ll ?cll WHERE { VALUES ?i { ${batch.map((c) => `"${c}"`).join(' ')} } ?a wdt:P238 ?i .
      OPTIONAL { ?a rdfs:label ?l FILTER(lang(?l) IN ("zh-hant","zh-tw","zh-hk","zh-mo")) BIND(lang(?l) AS ?ll) }
      OPTIONAL { ?a wdt:P931 ?c . ?c rdfs:label ?cl FILTER(lang(?cl) IN ("zh-hant","zh-tw","zh-hk","zh-mo")) BIND(lang(?cl) AS ?cll) } }`;
    let json;
    for (let attempt = 0; attempt < 3 && !json; attempt++) {
      const res = await fetch('https://query.wikidata.org/sparql', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json', 'user-agent': 'waypoint-data-build/0.1' }, body: 'query=' + encodeURIComponent(q) });
      if (res.ok) json = await res.json();
      else { console.warn('wikidata', res.status, 'retrying'); await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); }
    }
    if (!json) break;
    const got = {};
    for (const b of json.results.bindings) {
      const g = (got[b.i.value] ??= { airport: {}, city: {} });
      if (b.l) g.airport[b.ll.value] ??= b.l.value;
      if (b.cl) g.city[b.cll.value] ??= b.cl.value;
    }
    for (const c of batch) have[c] = got[c] ? { airport: pick(got[c].airport), city: pick(got[c].city) } : { airport: null, city: null };
  }
  mkdirSync(RAW, { recursive: true });
  writeFileSync(cache, JSON.stringify(have));
  return have;
}

async function main() {
  const airportsCsv = parseCsv(readFileSync(await fetchRaw('airports.csv', 'https://davidmegginson.github.io/ourairports-data/airports.csv'), 'utf8'));
  const runwaysCsv = parseCsv(readFileSync(await fetchRaw('runways.csv', 'https://davidmegginson.github.io/ourairports-data/runways.csv'), 'utf8'));
  const citiesZip = await fetchRaw('cities1000.zip', 'https://download.geonames.org/export/dump/cities1000.zip');
  const countryInfo = readFileSync(await fetchRaw('countryInfo.txt', 'https://download.geonames.org/export/dump/countryInfo.txt'), 'utf8');
  const citiesTxt = new URL('cities1000.txt', RAW);
  if (!existsSync(citiesTxt)) execSync(`unzip -o -q "${citiesZip.pathname}" -d "${RAW.pathname}"`);

  const natPop = { ...Object.fromEntries(countryInfo.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => { const f = l.split('\t'); return [f[0], Number(f[7])]; })), ...NATIONAL_POP };

  const longest = {};
  for (const r of runwaysCsv) {
    if (r.closed === '1') continue;
    const len = Number(r.length_ft) || 0;
    longest[r.airport_ident] = Math.max(longest[r.airport_ident] ?? 0, len);
  }

  const base = airportsCsv.filter((a) => a.scheduled_service === 'yes' && a.iata_code && a.type !== 'heliport');
  const keep = base.filter((a) => (CURATED.includes(a.iso_country) ? NAMES[a.iata_code] : a.type === 'large_airport' || a.type === 'medium_airport'));
  const seen = new Set();
  const build = (a) => {
    const lat = Number(a.latitude_deg), lon = Number(a.longitude_deg);
    const ft = longest[a.ident] ?? 0;
    const maxClass = ft < 5300 ? 'turboprop' : ft < 6600 ? 'regional' : ft < 8800 ? 'narrowbody' : 'widebody';
    const size = a.type === 'large_airport' ? 'large' : a.type === 'medium_airport' ? 'medium' : 'small';
    return { code: a.iata_code, name: NAMES[a.iata_code], city: a.municipality, country: a.iso_country, continent: a.continent, region: a.iso_region, lat, lon, size, runwayM: Math.round(ft * 0.3048), maxClass, ring: ringOf(lat, lon, CURATED.includes(a.iso_country) ? 8 : 25) };
  };
  const all = keep.filter((a) => !seen.has(a.iata_code) && seen.add(a.iata_code)).map(build);
  const missing = Object.keys(NAMES).filter((c) => !all.find((a) => a.code === c));
  if (missing.length) console.warn('named but not found:', missing.join(' '));

  // Towns, with the landmass they are on (worked out lazily).
  const towns = {};
  for (const line of readFileSync(citiesTxt, 'utf8').split('\n')) {
    const f = line.split('\t');
    if (!f[8] || ['PPLX', 'PPLH', 'PPLQ', 'PPLW'].includes(f[7])) continue;
    (towns[f[8]] ??= []).push({ lat: Number(f[4]), lon: Number(f[5]), pop: Number(f[14]), tz: f[17], ring: null });
  }
  const townScale = {};
  for (const [c, list] of Object.entries(towns)) {
    const sum = list.reduce((s, t) => s + t.pop, 0);
    townScale[c] = natPop[c] && sum ? natPop[c] / sum : 1;
  }
  const ringOfTown = (t) => (t.ring === null ? (t.ring = ringOf(t.lat, t.lon)) : t.ring);

  const metroOfCurated = {};
  for (const [m, codes] of Object.entries(METROS)) for (const c of codes) metroOfCurated[c] = m;

  function landmasses(list) {
    const ringOfCode = (c) => list.find((a) => a.code === c)?.ring;
    const groupName = new Map();
    for (const c of ['HND', 'FUK', 'MYJ', 'CTS']) if (ringOfCode(c) >= 0) groupName.set(ringOfCode(c), 'jp-main');
    if (ringOfCode('TPE') >= 0) groupName.set(ringOfCode('TPE'), 'tw-main');
    for (const a of list) {
      if (a.code === 'HKG' || a.code === 'MFM') a.landmass = 'prd';
      else if (BRIDGED[a.code]) a.landmass = BRIDGED[a.code];
      else if (a.ring >= 0 && groupName.has(a.ring)) a.landmass = groupName.get(a.ring);
      else a.landmass = a.ring >= 0 ? `ring-${a.ring}` : `isl-${a.code}`;
    }
    return groupName;
  }

  function catchments(list) {
    const groupName = landmasses(list);
    const catchment = Object.fromEntries(list.map((a) => [a.code, 0]));
    if (catchment.HKG !== undefined) catchment.HKG = NATIONAL_POP.HK;
    if (catchment.MFM !== undefined) catchment.MFM = NATIONAL_POP.MO;
    const tierOf = (a) => TIERS[a.code] ?? a.size;
    const byCountry = {};
    for (const a of list) (byCountry[a.country] ??= []).push(a);
    for (const [country, local] of Object.entries(byCountry)) {
      if (country === 'HK' || country === 'MO') continue;
      for (const t of towns[country] ?? []) {
        const pop = t.pop * townScale[country];
        const ring = ringOfTown(t);
        const land = ring >= 0 && groupName.has(ring) ? groupName.get(ring) : ring >= 0 ? `ring-${ring}` : null;
        const cands = [];
        for (const a of local) {
          const d = dist(t.lat, t.lon, a.lat, a.lon);
          if (d > 250) continue;
          const sameLand = land ? a.landmass === land || (a.landmass === `isl-${a.code}` && d < 40) : d < 40;
          if (!sameLand) continue;
          cands.push({ a, d, w: sizeW[tierOf(a)] * Math.exp(-d / 40) });
        }
        if (!cands.length) continue;
        const total = cands.reduce((s, c) => s + c.w, 0);
        const nearest = Math.min(...cands.map((c) => c.d));
        const reach = nearest <= 80 ? 1 : Math.exp(-(nearest - 80) / 120);
        for (const c of cands) catchment[c.a.code] += (pop * reach * c.w) / total;
      }
    }
    return catchment;
  }

  // Pass 1: everything, to rank the world's airports. Pass 2: only those we keep, so people are shared among them.
  const pass1 = catchments(all);
  const curated = all.filter((a) => CURATED.includes(a.country));
  const others = all.filter((a) => !CURATED.includes(a.country)).sort((x, y) => pass1[y.code] - pass1[x.code]);
  const chosen = new Set(others.slice(0, WORLD_AIRPORTS).map((a) => a.code));
  const seenC = new Set();
  for (const a of others) if (!seenC.has(a.country) && seenC.add(a.country)) chosen.add(a.code);
  for (const a of others) if (WORLD_HUBS.has(a.code) || EXTRA.has(a.code)) chosen.add(a.code);
  const list = [...curated, ...others.filter((a) => chosen.has(a.code))];
  const catchment = catchments(list);
  console.log('airports', list.length, 'of', all.length);

  // Names (Traditional Chinese), time zones, regions.
  const zh = await zhNames(list.filter((a) => !a.name).map((a) => a.code));
  const tzNear = (a) => {
    let best = null, bd = Infinity;
    for (const t of towns[a.country] ?? []) {
      const d = Math.abs(t.lat - a.lat) + Math.abs(t.lon - a.lon) * Math.cos(rad(a.lat));
      if (d < bd) { bd = d; best = t; }
    }
    return best?.tz;
  };
  const offsets = {};
  let noZh = 0;
  const strip = (z) => z.replace(/(國際|機場|空港|航空站|空軍基地|空軍基地)+$/u, '').replace(/\s+/g, '');
  // The biggest airport of a city takes the city's name; its smaller neighbours are named by the airport.
  const rankScore = (a) => catchment[a.code] + (WORLD_HUBS.has(a.code) ? 1e10 : 0);
  const cityBest = {};
  for (const a of list) if (!a.name) { const z = zh[a.code]; a.cityZh = z?.city ? strip(z.city) : null; if (a.cityZh && (!cityBest[a.cityZh] || rankScore(a) > rankScore(cityBest[a.cityZh]))) cityBest[a.cityZh] = a; }
  for (const a of list) {
    if (!a.name) {
      const z = zh[a.code] ?? {};
      a.name = (a.cityZh && cityBest[a.cityZh] === a ? a.cityZh : z.airport && strip(z.airport)) || a.cityZh || a.city || a.code;
      if (!z.city && !z.airport) noZh++;
    }
    a.tz = tzNear(a);
    a.utcOffset = a.tz ? (offsets[a.tz] ??= stdOffsetMin(a.tz)) : Math.round(a.lon / 15) * 60;
    a.world = REGION_OF[a.country] ?? ({ AS: 'SAS', AF: 'AF', EU: 'EU', NA: 'NA', SA: 'LAT', OC: 'OC' }[a.continent] ?? 'AF');
  }
  console.log('airports without a Chinese name (using the city):', noZh);

  // Metros: curated places use METROS; elsewhere, airports within 70 km of each other share a metro.
  const parent = Object.fromEntries(list.map((a) => [a.code, a.code]));
  const find = (c) => (parent[c] === c ? c : (parent[c] = find(parent[c])));
  for (const a of list) for (const b of list) {
    if (a.code >= b.code || CURATED.includes(a.country) || a.country !== b.country) continue;
    if (dist(a.lat, a.lon, b.lat, b.lon) < 70) parent[find(a.code)] = find(b.code);
  }
  const lead = {};
  for (const a of list) { const r = find(a.code); if (!lead[r] || catchment[a.code] > catchment[lead[r]]) lead[r] = a.code; }

  // Airports in one metro split its people by importance rather than by who happens to be nearest the centre.
  const metroMembers = {};
  for (const a of list) if (!CURATED.includes(a.country)) (metroMembers[lead[find(a.code)]] ??= []).push(a);
  for (const members of Object.values(metroMembers)) {
    if (members.length < 2) continue;
    const w = (a) => sizeW[a.size] * (WORLD_HUBS.has(a.code) ? 3 : 1);
    const total = members.reduce((s, a) => s + catchment[a.code], 0), wsum = members.reduce((s, a) => s + w(a), 0);
    for (const a of members) catchment[a.code] = (total * w(a)) / wsum;
  }

  // Outside the curated places, tiers follow rank: the world's busiest airports first, then by catchment.
  const ranked = list.filter((a) => !CURATED.includes(a.country)).sort((x, y) => catchment[y.code] + (WORLD_HUBS.has(y.code) ? 1e10 : 0) - catchment[x.code] - (WORLD_HUBS.has(x.code) ? 1e10 : 0)).map((a) => a.code);
  const worldTier = (code) => { const r = ranked.indexOf(code); return r < 90 ? 'hub' : r < 250 ? 'major' : r < 530 ? 'large' : r < 900 ? 'medium' : 'small'; };
  const areaCache = {};
  const areaOfRing = (k) => (k >= 0 ? (areaCache[k] ??= ringAreaKm2(rings[k].ring)) : 0);
  // A big-city airport on a tiny island (Incheon, Singapore, Hong Kong-style) is joined to the mainland by bridges: treat it as mainland.
  const isIslandAirport = (a) => !CURATED.includes(a.country) && (a.landmass.startsWith('isl-') || (areaOfRing(a.ring) < 60000 && catchment[a.code] < 1.5e6));
  for (const a of list) {
    if (CURATED.includes(a.country) || isIslandAirport(a) || areaOfRing(a.ring) >= 60000) continue;
    let best = null, bd = 100;
    for (const b of list) {
      if (b === a || b.country !== a.country || areaOfRing(b.ring) < 60000) continue;
      const d = dist(a.lat, a.lon, b.lat, b.lon);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) a.landmass = best.landmass;
  }
  const out = list
    .map((a) => {
      const curatedPlace = CURATED.includes(a.country);
      const size = curatedPlace ? TIERS[a.code] ?? a.size : worldTier(a.code);
      const island = curatedPlace ? !['jp-main', 'tw-main', 'prd'].includes(a.landmass) : isIslandAirport(a);
      return {
        code: a.code,
        name: a.name,
        country: a.country,
        world: a.world,
        region: a.region,
        metro: curatedPlace ? metroOfCurated[a.code] ?? a.code : lead[find(a.code)],
        lat: Math.round(a.lat * 1e4) / 1e4,
        lon: Math.round(a.lon * 1e4) / 1e4,
        utcOffset: a.utcOffset,
        size,
        runwayM: a.runwayM,
        maxClass: a.maxClass,
        landmass: a.landmass,
        island,
        hsr: HSR.has(a.code) || HSR_WORLD.has(a.code),
        // Small islands often have no town in GeoNames; assume at least a village-sized population.
        catchment: Math.round(Math.max(catchment[a.code], island ? 3000 : 20000)),
        tourism: (TOURISM_BY_REGION[a.region] ?? 1) * (island ? 1.3 : 1),
        slotCap: SLOT_OVERRIDES[a.code] ?? { hub: 140, major: 84, large: 56, medium: 35, small: 14 }[size],
      };
    })
    .sort((x, y) => y.catchment - x.catchment);
  writeFileSync(new URL('../src/data/airports.json', import.meta.url), JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{'));
  console.log(out.length, 'airports');
  const sizes = {};
  for (const a of out) sizes[a.size] = (sizes[a.size] ?? 0) + 1;
  console.log(sizes);
}

main();
