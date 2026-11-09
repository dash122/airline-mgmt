# Player UI: status and next steps

Last reviewed 2026-11-08 against the running app (phone 390×844, desktop 1440×900). Earlier versions of this file were a proposal written before the maps-style shell existed; this one records what is built, the conventions the UI now follows, and what is left.

## Goal

Help players open a viable route, understand its results, and adjust service with fewer decisions and more visible map space. Keep Traditional Chinese copy, the existing visual tokens, saved games, and simulation behaviour.

## Built

- **Shell.** One bottom sheet over the map (a side panel on wide screens) with three sections, 航線 / 機隊 / 市場. A title menu switches views inside a section (機隊: 飛機 / 班表, 市場: 機場 / 航空公司). Routes, airports, aircraft, airlines and the report are pages pushed over the home sheet with a back button. The status pill at the top shows balance, estimated daily profit and the clock.
- **Sheet sizes.** Compact, half and full, with a drag handle. The home sheet keeps one height per size, so the section switcher does not move between tabs.
- **Guided route opening.** Pick a destination, see one recommended plan (aircraft, departure, network profit) and one 開航 button. Alternative aircraft, times and market detail sit under two disclosures. The destination picker and the plan step open at half height and the map fits the planned route above the sheet, so the map stays visible.
- **Route sheet.** Numbers first (load factor, route profit, share), then 旅客怎麼轉 (one row per trip through the route: direct travellers, your connections and partner-flown trips, with this route's leg drawn thick and partner legs dashed), then three tabs (票價 / 航班 / 市場; rival timetables sit under 市場). Partner and extension rows sit at the bottom.

## Conventions

These keep the screens consistent; new screens should follow them.

- **Currency.** The simulation is priced in NT$. `src/ui/format.ts` converts to Hong Kong dollars at a fixed 4 NT$ per HK$, and it is the only place that does. Use `money()` for bare amounts in lists, `hk()` / `hkSigned()` for a headline figure that names the currency once, and `price()` for a fare. Never print `NT$`.
- **Profit has two levels, and the label says which.** 全網 (whole network, lease included) is the headline and what decisions are judged on. 航線 (one route, lease excluded) is the detail. Do not use bare 週損益, 網路 or 航段 for either.
- **One headline per screen.** A figure appears once. If a readout card already shows it, do not repeat it in a banner, a tile or a footer.
- **Terms.** 租用 is said once where it matters (the plan readout), not on every tile.

## Not built yet

1. **One service editor.** Adding a round trip, moving one, switching aircraft and cancelling still go through separate sheets (`AddFlightSheet`, `GapSheet`, the edit overlay). Merge them into one editor that takes its defaults from where it was opened, previews in draft state, and applies on confirmation.
2. **Next-action prompts.** One dismissible hint at a time, starting with an empty network, an idle aircraft and a loss-making route. Store dismissal separately from the plan and game saves.
3. **First-session guidance.** Choose base → open first route → read the first booked result, with time controls explained before fast-forward is suggested.
4. **Airport profit pill.** Each airport's profit is its share of the routes that touch it, so the figures add up to the network total but two ends of one route show the same number. A clearer label or a split view would help.

## Validation checklist

- `npm test`, `npm run build`.
- Walk: fresh game → first route → time progression → booked result → add service → change aircraft/time → cancel. Also an established network, search, airport-filtered schedules, a rival's page, the report, night theme, and save/reload.
- Check 320 px, 390 px and 1440 px: no horizontal overflow, primary actions reachable above the navigation, touch targets near 44 px, visible focus, and non-colour status cues.
