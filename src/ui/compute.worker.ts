import { analyzeAirport } from './airport-analysis.worker';
import { destinationsFrom, previewChoice } from '../sim/newroute';
import { simulate } from '../sim/simulate';
import { fareCurve } from '../sim/fares';
import { routeWhatIf } from '../sim/route-whatif';
import { codeshareIdeaSteps, hostedIdeaSteps, type CodeshareIdea, type HostedOption } from '../sim/codeshare';

self.onmessage = (event: MessageEvent<{ scope: 'simulation' | 'airport' | 'preview' | 'codeshare'; port: MessagePort }>) => {
  const { scope, port } = event.data;
  let version = 0;
  const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  port.onmessage = async (event) => {
    const current = ++version;
    // Collapse superseded edits before doing expensive work.
    await yieldTask();
    if (current !== version) return;
    const { id, request, kind, plan, result, code, transfer, from, to, choices, near, routeKey, a, b } = event.data;
    try {
      if (scope === 'simulation') port.postMessage({ id, result: simulate(plan) });
      else if (scope === 'airport') port.postMessage({ id, data: analyzeAirport(plan, result, code, transfer) });
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
      else if (kind === 'fare-curve') port.postMessage({ id, value: fareCurve(plan, routeKey) });
      else if (kind === 'what-if') port.postMessage({ id, value: routeWhatIf(plan, a, b, routeKey) });
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
