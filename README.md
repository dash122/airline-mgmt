# 航點 Waypoint

A single-player, mobile-first airline route planning game on a real map of the world: about 1,400 airports, all open from the start. You draw routes between real airports, pick real aircraft types, frequency and fares, and watch time run: aircraft fly their schedules on the map and each day's profit or loss is booked at local midnight (pause, 1×, 4× or 12× speed). A deterministic demand model decides how many travellers pick your flights over other airlines, high-speed rail, ferries, or not travelling. The headline score is cost recovery (revenue / operating cost, 100% = break even).

UI language: Traditional Chinese.

Long-haul note: a rotation still has to fit in 24 hours, so very long routes are out of reach for now. Multi-day rotations are planned.

## Run

```bash
npm install
npm run dev      # local dev server
npm test         # simulation tests
npm run build    # static build in dist/
npm run build:data  # regenerate airports from open data (about 5 minutes; downloads are cached in data-raw/)
npm run calibrate   # re-solve the demand scales in src/data/scales.json after the airports change
```

## Layout

- `src/data/` airports (generated), aircraft classes, calibration constants, and map geometry.
- `src/sim/` the demand model and weekly simulation. These are pure TypeScript functions: the same plan always gives the same result.
- `src/ui/` React UI and the Canvas map.
- `scripts/build-data.mjs` regenerates `src/data/airports.json` from open data (`npm run build:data`). Hand-kept facts the datasets lack (Chinese names, metro groups, rail access, tourism pull, size tiers) live in `scripts/airport-meta.mjs`.

## Schedules and fleet

You lease individual aircraft and give each one a daily rotation: a chain of flights with departure times, each leaving after the previous one has landed and turned around. The rotation repeats every day, so it should end where it started and fit in 24 hours. Costs are split into a weekly lease, paid whether the aircraft flies or not, flying costs per block hour and per departure, and passenger costs (NT$250 per passenger per flight plus 12% of fares for sales). Aircraft are real types from the ATR 72 to the 777-300ER, with typical seat counts and rough real-world lease and operating costs. That makes utilisation (block hours per day) and matching the aircraft to the market matter: a narrowbody on a busy route can make a profit, a 777 on a short route will not.

Departure time matters too. Morning and evening departures attract more travellers than midday ones, and very few want to leave at 3am. When one of your flights lands at an airport 45 minutes to 4 hours before another of your flights leaves, travellers can connect between them. Connections count as an option in the market for the whole trip.

### Managing them

The map is where you open routes: drag from one airport to another. Everything after that lives in the tab bar at the bottom:

- **航線** lists every route with its profit and a daily round-trip stepper. **＋** asks which aircraft should fly the new round trip and when, and only leases a new aircraft if you pick that. A route can be closed from its sheet.
- **班表** shows every aircraft's day on one 24-hour chart in base time. Tap a flight to move it (only that round trip moves), switch it to another aircraft, or cancel it. Tap an empty stretch to add a round trip there.
- **機隊** shows each aircraft's day bar, utilisation and profit, and compares all types before you lease one.

Schedule editing helpers live in `src/sim/schedule.ts`.

## Demand model

There is no booking data, so demand is scaled from population and airport size:

1. **Airports.** Taiwan, Hong Kong, Macau and Japan have every airport with scheduled service, hand-named and grouped. The rest of the world has the roughly 1,200 airports with the biggest catchments plus the busiest airport of every country ([OurAirports](https://ourairports.com/data/)); Chinese names come from Wikidata. The longest runway sets the largest aircraft that can land. Each airport has a standard-time UTC offset (no daylight saving) and a world region. Airports within 70 km of each other in one country are one metro and never form a market with each other.
2. **Catchments.** Every town in [GeoNames](https://www.geonames.org/) (rescaled to national population from GeoNames country data) is shared between airports on the same landmass within 250 km. The split weights airport size against distance.
3. **Trips.** Each pair of airports gets a pool of potential travellers from a gravity model: (catchment × travel propensity × tourism pull × island factor)^0.85 for each end, divided by distance^0.9.
4. **Mode choice.** Travellers pick between flying, ground travel and not travelling, using a nested logit on generalized cost. Ground travel is rail or road on the same landmass (high-speed where both ends have it), the Hong Kong–Macau bridge, or a ferry from islands near the mainland. Among airlines, each one's share is proportional to its flights, adjusted for fare.
5. **Calibration.** Only a few numbers are set by hand: the yearly air passengers for each group in `src/data/calibration.ts`. Groups are country pairs for the four hand-kept places, domestic markets of big countries (US, China, India, Brazil, Russia, Indonesia), and pairs of world regions for everything else. `npm run calibrate` solves a scale per group (saved in `src/data/scales.json`) so the model reproduces them. Other airlines' frequencies follow from the resulting demand.
6. **On demand.** There are about a million airport pairs, so a market is worked out the first time something asks for it (`marketBetween`, `marketsFrom`) and then cached.

Ground travel: high-speed rail where both cities have it (Japan, Taiwan, China, Korea, much of Western Europe, Turkey, the US Northeast and a few others, see `scripts/world-meta.mjs`), otherwise rail or road on one landmass, ferries from islands near the mainland, and nothing across oceans.

All calibration targets are approximate and should be replaced with sourced statistics.

Data: OurAirports (public domain), GeoNames (CC BY 4.0), Wikidata (CC0), Natural Earth (public domain).
