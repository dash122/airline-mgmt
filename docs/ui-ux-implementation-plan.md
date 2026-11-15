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

- **One service editor** (`src/ui/service-editor.tsx`). Adding a round trip, retiming one, switching aircraft and cancelling all happen in one sheet. It takes its defaults from where it was opened (a flight, a route's ＋, or a gap in an aircraft's day, which first asks where to fly). Changes stay a draft and are previewed with the whole network's weekly profit change until the single apply button. Other aircraft and leases sit behind one 換飛機 row.
- **Next-action prompts and first-session guide** (`src/ui/nudge.tsx`). One card under the status pill, one at a time: a three-step guide for new players (open a route → let a day pass → read the report), then hints for an empty network, an idle or barely used aircraft and the worst loss-making route. Dismissals are stored under `waypoint.hints.v1`, separate from plan and game saves.
- **Time controls.** Play/pause plus one fast-forward button that cycles 1× / 4× / 12×. 跳到下次結算 in the pill's menu (and in the guide) runs at full speed until the next day is booked, then goes back to the previous speed.
- **Fewer controls.** The schedule list's two switches (departures/arrivals and local/base time) are one 顯示 pull-down. The fleet list's empty state carries the lease button.
- **Airport profit** is labelled 分攤損益 (each route's profit split half to each end), so it no longer reads as double counting.
- **Map gestures.** Press and hold an airport to plan a route from it; keep holding and drag to another airport to pick both ends.

## Validation checklist

- `npm test`, `npm run build`.
- Walk: fresh game → first route → time progression → booked result → add service → change aircraft/time → cancel. Also an established network, search, airport-filtered schedules, a rival's page, the report, night theme, and save/reload.
- Check 320 px, 390 px and 1440 px: no horizontal overflow, primary actions reachable above the navigation, touch targets near 44 px, visible focus, and non-colour status cues.
