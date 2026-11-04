// Builds src/data/airport-reference.json: real-world reference numbers for every airport in airports.json.
//   pax  - annual passengers, millions: Wikidata P3872 (CC0), latest of 2023-2024, or 85% of the best of 2016-2019 if higher
//          (some airports' recent series are partial). The hand-kept table in airport-traffic.ts (ACI 2024) overrides it.
//   pop  - people living within 40 km of the airport in the same country: GeoNames cities1000 (CC BY 4.0), at least the
//          population of the city served (Wikidata P931/P131, P1082).
// Raw downloads are cached in data-raw/ (git-ignored). Run: npm run build:reference
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const RAW = new URL('../data-raw/', import.meta.url);
const airports = JSON.parse(readFileSync(new URL('../src/data/airports.json', import.meta.url), 'utf8'));
const codes = airports.map((a) => a.code);

async function cached(name, make) {
  mkdirSync(RAW, { recursive: true });
  const path = new URL(name, RAW);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const data = await make();
  writeFileSync(path, JSON.stringify(data));
  return data;
}

async function sparql(query) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://query.wikidata.org/sparql', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json', 'user-agent': 'waypoint-data-build/0.1' },
      body: 'query=' + encodeURIComponent(query),
    });
    if (res.ok) return (await res.json()).results.bindings;
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error('Wikidata query failed');
}

const batches = (n) => Array.from({ length: Math.ceil(codes.length / n) }, (_, i) => codes.slice(i * n, i * n + n).map((c) => `"${c}"`).join(' '));

const paxRows = await cached('wd-pax.json', async () => {
  const out = [];
  for (const vals of batches(60)) {
    for (const b of await sparql(`SELECT ?i ?pax ?yr WHERE { VALUES ?i { ${vals} } ?a wdt:P238 ?i . ?a p:P3872 ?s . ?s ps:P3872 ?pax . OPTIONAL { ?s pq:P585 ?t BIND(YEAR(?t) AS ?yr) } }`)) {
      out.push([b.i.value, Number(b.pax.value), b.yr ? Number(b.yr.value) : null]);
    }
  }
  return out;
});
const popRows = await cached('wd-pop.json', async () => {
  const out = [];
  for (const vals of batches(50)) {
    for (const b of await sparql(`SELECT ?i ?p ?pop ?yr WHERE { VALUES ?i { ${vals} } ?a wdt:P238 ?i . { ?a wdt:P931 ?p } UNION { ?a wdt:P131 ?p } ?p p:P1082 ?s . ?s ps:P1082 ?pop . OPTIONAL { ?s pq:P585 ?t BIND(YEAR(?t) AS ?yr) } }`)) {
      out.push([b.i.value, b.p.value, Number(b.pop.value), b.yr ? Number(b.yr.value) : null]);
    }
  }
  return out;
});

// --- traffic
const byYear = {};
for (const [c, pax, yr] of paxRows) if (yr) ((byYear[c] ??= {})[yr] ??= []).push(pax);
const pax = {};
for (const [c, ys] of Object.entries(byYear)) {
  const best = (y) => (ys[y] ? Math.max(...ys[y]) : 0);
  const recent = Math.max(best(2024), best(2023));
  const before = Math.max(best(2019), best(2018), best(2017), best(2016));
  const v = Math.max(recent, 0.85 * before);
  if (v >= 3e5) pax[c] = Math.round(v / 1e5) / 10;
}

// --- population
const dl = async (name, url) => {
  const path = new URL(name, RAW);
  if (!existsSync(path)) { const res = await fetch(url); if (!res.ok) throw new Error(url); writeFileSync(path, Buffer.from(await res.arrayBuffer())); }
  return path;
};
const zip = await dl('cities1000.zip', 'https://download.geonames.org/export/dump/cities1000.zip');
if (!existsSync(new URL('cities1000.txt', RAW))) execSync(`unzip -o -q "${zip.pathname}" -d "${RAW.pathname}"`);
const towns = [];
for (const line of readFileSync(new URL('cities1000.txt', RAW), 'utf8').split('\n')) {
  const f = line.split('\t');
  if (!f[8] || ['PPLX', 'PPLH', 'PPLQ', 'PPLW'].includes(f[7])) continue;
  towns.push({ lat: Number(f[4]), lon: Number(f[5]), pop: Number(f[14]), country: f[8] });
}
const rad = (d) => (d * Math.PI) / 180;
const nearby = (a, km) => {
  let s = 0;
  const kx = 111.32 * Math.cos(rad(a.lat));
  for (const t of towns) {
    if (t.country !== a.country || Math.abs(t.lat - a.lat) > km / 110 || Math.abs(t.lon - a.lon) * kx > km) continue;
    if (Math.hypot((t.lat - a.lat) * 110.57, (t.lon - a.lon) * kx) <= km) s += t.pop;
  }
  return s;
};
const city = {};
const seen = {};
for (const [c, p, pop, yr] of popRows) {
  const k = `${c}|${p}`;
  if (!seen[k] || (yr ?? 0) >= seen[k].yr) seen[k] = { yr: yr ?? 0, pop };
}
for (const [k, v] of Object.entries(seen)) { const c = k.split('|')[0]; city[c] = Math.max(city[c] ?? 0, v.pop); }

const out = {};
for (const a of airports) {
  const entry = {};
  if (pax[a.code]) entry.pax = pax[a.code];
  const pop = Math.max(nearby(a, 40), city[a.code] ?? 0);
  if (pop) entry.pop = Math.round(pop / 1e3) * 1e3;
  out[a.code] = entry;
}
writeFileSync(new URL('../src/data/airport-reference.json', import.meta.url), JSON.stringify(out).replace(/\},"/g, '},\n"'));
console.log(Object.keys(out).length, 'airports;', Object.values(out).filter((e) => e.pax).length, 'with traffic;', Object.values(out).filter((e) => e.pop).length, 'with population');
