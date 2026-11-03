# 航點 Waypoint

A single-player, mobile-first airline route planning game on a real map of East Asia. You draw routes between real airports, pick aircraft, frequency and fares, then simulate a week. A deterministic demand model decides how many travellers pick your flights over other airlines, high-speed rail, ferries, or not travelling. The headline score is cost recovery (revenue / operating cost, 100% = break even).

UI language: Traditional Chinese.

## Run

```bash
npm install
npm run dev      # local dev server
npm test         # simulation tests
npm run build    # static build in dist/
npm run build:data  # regenerate airports from open data
```

## Layout

- `src/data/` airports (generated), aircraft classes, calibration constants, and map geometry.
- `src/sim/` the demand model and weekly simulation. These are pure TypeScript functions: the same plan always gives the same result.
- `src/ui/` React UI and the Canvas map.
- `scripts/build-data.mjs` regenerates `src/data/airports.json` from open data (`npm run build:data`). Hand-kept facts the datasets lack (Chinese names, metro groups, rail access, tourism pull, size tiers) live in `scripts/airport-meta.mjs`.

## Demand model

There is no booking data, so demand is scaled from population and airport size:

1. **Airports** are every airport with scheduled service in Taiwan, Hong Kong, Macau and Japan ([OurAirports](https://ourairports.com/data/)). The longest runway sets the largest aircraft that can land.
2. **Catchments.** Every town in [GeoNames](https://www.geonames.org/) (rescaled to national population) is shared between airports on the same landmass within 250 km. The split weights airport size against distance.
3. **Trips.** Each pair of airports gets a pool of potential travellers from a gravity model: (catchment × travel propensity × tourism pull × island factor)^0.85 for each end, divided by distance^0.9.
4. **Mode choice.** Travellers pick between flying, ground travel and not travelling, using a nested logit on generalized cost. Ground travel is rail or road on the same landmass (high-speed where both ends have it), the Hong Kong–Macau bridge, or a ferry from islands near the mainland. Among airlines, each one's share is proportional to its flights, adjusted for fare.
5. **Calibration.** Only a few numbers are set by hand: the yearly air passengers for each country-pair group in `src/data/calibration.ts`. A scale per group is solved so the model reproduces them. Other airlines' frequencies follow from the resulting demand.

All calibration targets are approximate and should be replaced with sourced statistics.

Data: OurAirports (public domain), GeoNames (CC BY 4.0), Natural Earth (public domain).
