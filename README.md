# 航點 Waypoint

A single-player, mobile-first airline route planning game on a real map of the world. You draw routes between real airports, pick real aircraft types, frequency and fares, and watch time run: aircraft fly their schedules on the map and each day's profit or loss is booked at local midnight (pause, 1×, 4× or 12× speed). A deterministic demand model decides how many travellers pick your flights over other airlines, high-speed rail, ferries, or not travelling. The headline score is cost recovery (revenue / operating cost, 100% = break even).

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

## Schedules and fleet

You lease individual aircraft and give each one a daily rotation: a chain of flights with departure times, each leaving after the previous one has landed and turned around. The rotation repeats every day, so it should end where it started and fit in 24 hours. Costs are split into a weekly lease, paid whether the aircraft flies or not, flying costs per block hour and per departure, and passenger costs (NT$250 per passenger per flight plus 12% of fares for sales). Aircraft are real types from the ATR 72 to the 777-300ER, with typical seat counts and rough real-world lease and operating costs. That makes utilisation (block hours per day) and matching the aircraft to the market matter: a narrowbody on a busy route can make a profit, a 777 on a short route will not.

Departure time matters too. Morning and evening departures attract more travellers than midday ones, and very few want to leave at 3am. When one of your flights lands at an airport 45 minutes to 4 hours before another of your flights leaves, travellers can connect between them. Connections count as an option in the market for the whole trip.

### Managing them

The map is where you open routes: drag from one airport to another. Everything after that lives in the tab bar at the bottom:

- **航線** lists every route with its profit and a daily round-trip stepper. **＋** asks which aircraft should fly the new round trip and when, and only leases a new aircraft if you pick that. A route can be closed from its sheet.
- **班表** shows every aircraft's day on one 24-hour chart in base time. Tap a flight to move it (only that round trip moves), switch it to another aircraft, or cancel it. Tap an empty stretch to add a round trip there.
- **機隊** shows each aircraft's day bar, utilisation and profit, and compares all types before you lease one.

Schedule editing helpers live in `src/sim/schedule.ts`.

## Competitor airlines

Other airlines are fictional and generated from the airport data (`src/sim/competitors.ts`), so they work for any set of airports. Every country gets a full-service airline at its busiest airport. Countries with enough people get a low-cost airline at their top three cities, and countries with at least four smaller airports get a regional airline for domestic routes. Each market's existing service (`Market.rivalFreq`) is split between the airlines that would plausibly fly it. Busier routes are flown with bigger aircraft rather than ever more flights (`rivalLoad` in `src/sim/markets.ts`), so Hong Kong–Taipei has about 15 departures a day each way, mostly widebodies. Each airline gets timed departures, an aircraft type sized to the load, and a fare level: full-service 110% of the reference fare with a better product, low-cost 78% with a worse one, regional 100%. Travellers choose between your flights and each competitor by frequency, departure times, fare and product. Competitors fly fixed schedules and do not react to you. They show up in the route sheet, in the airport sheet's 對手 tab, and as dotted lines on the map when an airport is selected.

## Demand model

Existing competitor service also respects the maintained network rules in `src/data/competitor-network.ts`: Macau uses documented destinations within the game's coverage, and Itami has domestic service only. These rules apply during baseline calibration, so excluded routes have zero competitor flights and baseline air passengers while retaining potential demand for player service. Other routes still use the demand-based approximation; this is not a complete real-world timetable. Sources are recorded beside the network rules.

There is no booking data, so demand is scaled from population and airport size:

1. **Airports** include major scheduled-service airports worldwide plus eligible airports from the original Taiwan, Hong Kong, Macau and Japan network ([OurAirports](https://ourairports.com/data/)). Closed and unpaved runways are excluded. Airports below the game’s regional-jet runway threshold (5,300 ft) are removed. This is a gameplay approximation, not an operational certification.
2. **Catchments.** Newly added global airports use an estimated 2 million people each; these are gameplay estimates, not measured passenger demand. Regional catchments are preserved in `scripts/regional-airports.json`, generated by `scripts/build-regional-data.mjs`. Every town in [GeoNames](https://www.geonames.org/) (rescaled to national population) is shared between airports on the same landmass within 250 km. The split weights airport size against distance.
3. **Trips.** Each pair of airports gets a pool of potential travellers from a gravity model: (catchment × travel propensity × tourism pull × island factor)^0.85 for each end, divided by distance^0.9.
4. **Mode choice.** Travellers pick between flying, ground travel and not travelling, using a nested logit on generalized cost. Ground travel is rail or road on the same landmass (high-speed where both ends have it; Hong Kong and Macau count as joined to mainland China, whose cities all have high-speed rail, so almost nobody flies Hong Kong–Guangzhou), the Hong Kong–Macau bridge, or a ferry from islands near the mainland. Among airlines, each one's share is proportional to its flights, adjusted for fare.
5. **Calibration.** Only a few numbers are set by hand: the yearly air passengers for each country-pair group in `src/data/calibration.ts`. A scale per group is solved so the model reproduces them. Other airlines' frequencies follow from the resulting demand.

All calibration targets are approximate and should be replaced with sourced statistics.

Data: OurAirports (public domain), GeoNames (CC BY 4.0), Natural Earth (public domain).

Global markets without a calibration target inherit the JP–TW gravity scale. Local clocks use fixed UTC offsets from [OpenFlights](https://openflights.org/data.php) (ODbL/DbCL), with longitude estimates where unavailable; seasonal DST is not simulated. Run `npm run build:map` before `npm run build:data` when regenerating global geography.

## Real-world reference data

`src/data/airport-reference.json` holds, for every airport, annual passengers (Wikidata, 2023-2024 or 85% of the best of 2016-2019) and the people living within 40 km in the same country (GeoNames towns, at least the city served in Wikidata). `src/data/airport-traffic.ts` merges it with a hand-kept table of ACI 2024 figures for the busiest airports, which wins where both exist. Outside Taiwan, Hong Kong, Macau and Japan, an airport's catchment is its metro's population shared by passenger traffic, its size tier comes from passengers (35M hub, 12M major, 4M large, 1.2M medium), and the demand model is fitted so each airport carries about its real traffic. Regenerate with `npm run build:reference` (downloads are cached in `data-raw/`).
