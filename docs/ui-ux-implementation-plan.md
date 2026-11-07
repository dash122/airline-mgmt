# Player UI simplification plan

Status: proposed implementation sequence; application code unchanged.

## Goal

Help players open a viable route, understand its results, and adjust service with fewer decisions and more visible map space. Preserve Traditional Chinese copy, existing visual tokens, saved games, and simulation behavior.

## Evidence and prerequisites

Source review: App.tsx exposes seven primary tabs; NewRoute.tsx already selects a recommended aircraft and departure time; sheets.tsx already supports half/full sheets and optional explanations; style.css defines mobile sheets and a 400px desktop inspector. Build on these patterns.

No live screenshots or usability baseline have been captured. Node/npm and dependencies are unavailable in the current environment. Before implementation validation, restore the local toolchain, run the existing app, and capture the baseline at 390x844 and 1440x900. Include a 320px-wide check, night theme, empty fleet, and an established network. Do not treat source findings as verified visual defects.

## Phase 1: navigation and application shell

Files: src/ui/App.tsx, src/ui/panels.tsx, src/ui/style.css; extract navigation components if useful.

- Replace seven primary destinations with 地圖, 航線, 機隊, 經營.
- Within 機隊, provide 飛機 and 班表 views using existing panels. Airport-specific schedule links must open the filtered 班表 view directly.
- Within 經營, provide financial results and access to airport/competitor research. Keep research reachable even before the first route; empty financial results must not disable the whole destination.
- Keep airport selection on the map and competitor links within existing detail screens.
- Separate primary destination, subsection, selected entity, and editor state. Define Back as editor -> originating detail/list -> parent destination; Close dismisses only the current inspector. Preserve list position and relevant filters on return.
- Use a compact overview for balance, explicitly labeled estimated daily profit, and clock. Keep cost recovery and other metrics in the financial view. Show actual booked results separately from forecasts; derive daily estimates using existing accounting conventions.

Acceptance: all existing destinations remain reachable; deep links land in the right subsection; back/close does not unexpectedly change destinations; new and existing saves load without migration.

## Phase 2: panel sizes and readability

Files: src/ui/sheets.tsx, src/ui/style.css, detail-sheet callers.

- Extend existing half/full behavior with an explicit compact summary state for route, airport, and aircraft inspectors. Keep editors expanded when their task needs it.
- Compact state contains entity name, its key status, a primary action, and a labeled expand control. Details reveal operational information; expanded mode supports long analysis.
- Start with button-based size changes, with keyboard support. Swipe gestures are optional follow-up work.
- On mobile, target roughly one-quarter viewport height for the summary, allowing content growth for zoom and wrapping. Expanded content scrolls while actions remain reachable above navigation and safe areas.
- On desktop, use one selection inspector; modal editing may cover it with a clear return path. Ensure backdrop and hidden layers cannot intercept input incorrectly.
- Enlarge frequent touch controls toward 44x44 CSS px. Prefer fewer visible labels over smaller text. Preserve visible focus and non-color status cues.
- Distinguish nonmodal inspectors from modal editors. Modal editors need focus entry, containment, Escape dismissal where safe, and focus restoration; inspectors must leave map interaction available.

Acceptance: compact views leave at least half the mobile map unobscured at the baseline viewport; no clipped primary actions or page-level horizontal overflow at 320px width; content remains usable at 200% zoom; keyboard users can expand, close, and return to the invoking control.

## Phase 3: guided route opening

Files: src/ui/NewRoute.tsx; reuse src/sim/newroute.ts without changing selection or profitability rules.

- Keep destination selection, search, and map picking.
- After destination selection, show one recommended plan: aircraft, whether it requires a lease, departure and return summary, recurrence, estimated additional network profit, and one 開航 action.
- Explain why the plan is recommended in one short sentence. Clearly label estimates, currency, and daily/weekly periods. Do not imply a negative best option is profitable.
- Put alternative aircraft, time presets/fine adjustment, load metrics, and competition under 調整方案 / 市場詳情 disclosures.
- Reuse existing preview calculations. Editing details updates the summary immediately, and opening/closing a disclosure preserves choices.
- Preserve runway, range, slot, schedule, existing-route, and multi-day constraints. Show blocking reasons next to the action, with a relevant recovery path where available.

Acceptance: after choosing a destination, a valid recommended route can be confirmed without opening advanced controls; no viable choice, loss-making recommendation, existing-aircraft reuse, new lease, and multi-day service all have accurate summaries. Cancel commits no plan changes.

## Phase 4: consistent service editing

Files: src/ui/panels.tsx, src/ui/sheets.tsx, src/ui/App.tsx.

- Standardize adding service from route lists, route detail, timetable gaps, and aircraft detail into one shared round-trip editor with entry-context defaults.
- Preserve distinct operations: adding a round trip, moving its time, assigning another aircraft, and canceling service. Do not silently turn single-leg operations into round-trip operations.
- State affected aircraft, outbound/return flights, local time zones, and recurring frequency before confirmation.
- Present aircraft and time defaults first; disclose precise scheduling controls on request.
- Preview edits in draft state and apply on confirmation. Cancel restores the original plan. Keep existing conflict detection and explain how to fix failures.

Acceptance: equivalent entry points use the same editor and terminology, honor aircraft/time defaults, reject conflicts consistently, and return to their source context. Financial previews match the committed simulation.

## Phase 5: next-action guidance

- Add one contextual, dismissible prompt at a time, initially covering an empty network, an idle aircraft, and a loss-making route.
- Define idle as no scheduled legs; derive route losses from the existing result. Avoid speculative recommendations until supported by calculations.
- Link directly to the appropriate planner or editor. Keep hints from obscuring the map or sticky actions.
- Add lightweight first-session guidance: choose base -> open first route -> inspect first booked result. Explain time controls before encouraging fast-forward.
- Save only optional guidance dismissal state separately from plan/game schemas.

Acceptance: guidance can be dismissed, does not repeatedly interrupt play, and targets a valid action. Existing players retain access to all advanced controls.

## Delivery and validation

Deliver phases 1-3 as the first reviewable release, then phases 4-5 after reviewing the running flows. Review each phase independently before stacking additional interaction changes.

- Run npm test and npm run build when the toolchain is available.
- Add focused interaction coverage for navigation/back context, disclosure state, draft cancel/confirm, and shared-editor entry defaults. Add simulation tests only if simulation behavior changes unexpectedly or a defect is found.
- Manually verify fresh game -> first route -> time progression -> booked result -> add service -> change aircraft/time -> cancel. Also verify an established network, search, airport-filtered schedules, research access, local date rollover, multi-day flights, and save/reload.
- Capture before/after screens in both baseline viewports and both themes; inspect overflow, map visibility, focus, touch targets, disabled reasons, and estimate/actual labels.
- Measure destination-to-confirm interactions, navigation needed to find scheduling, and unobscured map area. These are proposed success checks, not measured outcomes.

## Main risks

- Navigation grouping can make research harder to discover: retain contextual links and a labeled research entry under 經營.
- Hiding advanced options can conceal lease costs: always show new-lease status and expected costs in the recommended summary.
- Shared sheet changes affect many screens: opt callers into compact summaries deliberately, rather than changing every default at once.
- Consolidating editors can lose entry defaults or modify the wrong service scope: preserve source context and test each entry path before retiring older editors.
