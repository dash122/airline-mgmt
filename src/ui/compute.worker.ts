import { analyzeAirport } from './airport-analysis.worker';
import { destinationsFrom, previewChoice } from '../sim/newroute';
import { simulate, type Plan } from '../sim/simulate';
import { fareCurveSteps, type FarePoint } from '../sim/fares';
import { routeWhatIfSteps } from '../sim/route-whatif';
import { bestShare, codeshareImpact, codeshareIdeaSteps, codeshareOptionSteps, hostedChoices, hostedImpact, hostedIdeaSteps, hostedOptionSteps, shareChoices, type CodeshareIdea, type HostedOption } from '../sim/codeshare';
import type { Deal } from './deals';

/**
 * Requests a sheet on screen is waiting for. The deal-by-deal impact list (hundreds of simulations with many
 * codeshares) steps aside while any of these runs, so an open sheet is not queued behind it.
 */
let urgent = 0;
/** Partners tried for one of your routes: the sheet shows the best 8, and each one tried is a full simulation. */
const HOSTED_CANDIDATES = 10;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const ranked = <T extends { active: boolean; gain: number }>(list: T[]) => [...list].sort((x, y) => Number(y.active) - Number(x.active) || y.gain - x.gain);

self.onmessage = (event: MessageEvent<{ scope: 'simulation' | 'airport' | 'preview' | 'codeshare'; port: MessagePort }>) => {
  const { scope, port } = event.data;
  let version = 0;
  const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  port.onmessage = async (event) => {
    const current = ++version;
    // Collapse superseded edits before doing expensive work.
    await yieldTask();
    if (current !== version) return;
    const { id, request, kind, plan, result, code, transfer, from, to, choices, near, routeKey, a, b, airline, share } = event.data;
    try {
      if (scope === 'simulation') port.postMessage({ id, result: simulate(plan) });
      else if (scope === 'airport') port.postMessage({ id, data: analyzeAirport(plan, result, code, transfer) });
      else if (scope === 'codeshare' && kind === 'deals') {
        // The impact of every codeshare and hosted deal in the plan: a whole week's simulation for each, so in slices,
        // sending each batch as soon as it is done and dropping the rest the moment a newer plan arrives.
        const p = plan as Plan;
        while (urgent > 0) { await sleep(25); if (current !== version) return; }
        const now = simulate(p);
        // The headline totals first: two simulations (with and without every deal) instead of waiting for all of them.
        // Pax and seats are the plan's own figures; the net is exact, though not the sum of the per-deal gains, since
        // deals compete for the same seats.
        const bare = simulate({ ...p, codeshares: [], hosted: [] });
        const stats = [...Object.values(now.codeshares ?? {}), ...Object.values(now.hosted ?? {})] as { pax: number; seats: number }[];
        port.postMessage({
          id, deals: [], partial: true,
          totals: { gain: now.revenue - now.cost - (bare.revenue - bare.cost), pax: stats.reduce((s, x) => s + x.pax, 0), seats: stats.reduce((s, x) => s + x.seats, 0) },
        });
        const work: (() => Deal)[] = [
          ...(p.codeshares ?? []).map((c) => (): Deal => ({ side: 'out', airline: c.airline, key: c.key, imp: codeshareImpact(p, c.airline, c.key, now) })),
          ...(p.hosted ?? []).map((h) => (): Deal => ({ side: 'in', airline: h.airline, key: h.key, imp: hostedImpact(p, h.airline, h.key, now) })),
        ];
        let batch: Deal[] = [];
        let sliceStart = performance.now();
        for (const run of work) {
          while (urgent > 0) { await sleep(25); if (current !== version) return; }
          if (current !== version) return;
          batch.push(run());
          if (performance.now() - sliceStart > 30) {
            port.postMessage({ id, deals: batch, partial: true });
            batch = [];
            await yieldTask();
            sliceStart = performance.now();
          }
        }
        port.postMessage({ id, deals: batch });
      }
      else if (scope === 'codeshare' && (kind === 'cs-options' || kind === 'hs-options')) {
        // A sheet's partner list, a simulation at a time so a newer request drops this one. Each partner is sent as
        // soon as it is worked out, so the list fills in instead of waiting for the last one.
        urgent++;
        try {
          const out: { active: boolean; gain: number }[] = [];
          const steps = kind === 'cs-options' ? codeshareOptionSteps(plan, airline, undefined, undefined, out as never) : hostedOptionSteps(plan, routeKey, HOSTED_CANDIDATES, out as never);
          let step = steps.next();
          let sent = 0;
          while (!step.done) {
            if (out.length > sent) { sent = out.length; port.postMessage({ id, value: ranked(out), partial: true }); }
            await yieldTask();
            if (current !== version) return;
            step = steps.next();
          }
          port.postMessage({ id, value: step.value });
        } finally { urgent--; }
      }
      else if (scope === 'codeshare' && (kind === 'cs-detail' || kind === 'hs-detail')) {
        urgent++;
        try {
        // One deal's sheet: what each seat block adds, then its full impact at the shown block (the best one unless given).
        const out = kind === 'cs-detail';
        const sizes = out ? shareChoices(plan, airline, routeKey) : hostedChoices(plan, airline, routeKey);
        if (current !== version) return;
        const at: number = share ?? bestShare(sizes).share;
        const imp = out ? codeshareImpact(plan, airline, routeKey, undefined, at) : hostedImpact(plan, airline, routeKey, undefined, at);
        port.postMessage({ id, value: { choices: sizes, share: at, imp } });
        } finally { urgent--; }
      }
      else if (scope === 'codeshare') {
        // Partner by partner, yielding between steps so a daily-figure request is not queued behind the whole search,
        // and dropping the search as soon as a newer plan asks for one.
        // Yield about every 30ms of work, not after every partner (browsers clamp repeated timeouts to 4ms), and
        // send the best ideas found so far, so the list fills in rather than appearing all at once.
        const found: (CodeshareIdea | HostedOption)[] = [];
        const steps = kind === 'hosted' ? hostedIdeaSteps(plan, 12, 12, found as HostedOption[]) : codeshareIdeaSteps(plan, 12, near, found as CodeshareIdea[]);
        const best = () => [...found].sort((x, y) => y.gain - x.gain).slice(0, 12);
        let step = steps.next();
        let sliceStart = performance.now();
        while (!step.done) {
          if (performance.now() - sliceStart > 30) {
            await yieldTask();
            if (current !== version) return;
            port.postMessage({ id, ideas: best(), partial: true });
            sliceStart = performance.now();
          }
          step = steps.next();
        }
        port.postMessage({ id, ideas: step.value });
      }
      else if (kind === 'destinations') port.postMessage({ request, destinations: destinationsFrom(plan, from) });
      else if (kind === 'fare-curve' || kind === 'what-if') {
        // A simulation or two at a time: between them other requests (the main simulation above all) get their turn,
        // and the rest is dropped the moment a newer plan arrives. The fare curve sends a coarse version first.
        urgent++;
        try {
        const out: FarePoint[] = [];
        const steps = kind === 'fare-curve' ? fareCurveSteps(plan, routeKey, out) : routeWhatIfSteps(plan, a, b, routeKey);
        let step = steps.next();
        while (!step.done) {
          await yieldTask();
          if (current !== version) return;
          if (step.value === 'coarse') port.postMessage({ id, value: [...out], partial: true });
          step = steps.next();
        }
        port.postMessage({ id, value: step.value });
        } finally { urgent--; }
      }
      else {
        const previews = [];
        for (const { choice, dep } of choices as { choice: Parameters<typeof previewChoice>[2]; dep: number }[]) {
          await yieldTask();
          if (current !== version) return;
          previews.push([choice.id, previewChoice(plan, result, choice, from, to, dep)]);
        }
        port.postMessage({ request, previews });
      }
    } catch (error) { port.postMessage({ id, request, error: String(error) }); }
  };
};
