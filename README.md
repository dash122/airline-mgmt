# 航點 Waypoint

A single-player, mobile-first airline route planning game on a real map of East Asia. You draw routes between real airports, pick aircraft, frequency and fares, then simulate a week. A deterministic demand model decides how many travellers pick your flights over other airlines, high-speed rail, ferries, or not travelling. The headline score is cost recovery (revenue / operating cost, 100% = break even).

UI language: Traditional Chinese.

## Run

```bash
npm install
npm run dev      # local dev server
npm test         # simulation tests
npm run build    # static build in dist/
```

## Layout

- `src/data/` airports, aircraft classes, rail/ferry alternatives, and map geometry (`geo.json`, built from Natural Earth via `npm run build:map`).
- `src/sim/` the demand model and weekly simulation. These are pure TypeScript functions: the same plan always gives the same result.
- `src/ui/` React UI and the Canvas map.

## Demand model (milestone 1)

1. A gravity model gives each airport pair a weekly air market. It is balanced so that each airport's total matches its approximate annual passengers.
2. Travellers choose between your flights, other airlines, surface transport and not travelling. The choice is a logit on generalized cost (fare + value of time × door-to-door time + waiting time) plus a frequency term.
3. Seats cap what you carry, and the rest spills.

All airport figures are approximate placeholders and still need to be replaced with sourced data.
