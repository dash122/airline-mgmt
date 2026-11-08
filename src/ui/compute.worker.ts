import { analyzeAirport } from './airport-analysis.worker';
import { destinationsFrom, previewChoice } from '../sim/newroute';
import { simulate } from '../sim/simulate';
import { codeshareIdeas, hostedIdeas } from '../sim/codeshare';

self.onmessage = (event: MessageEvent<{ scope: 'simulation' | 'airport' | 'preview' | 'codeshare'; port: MessagePort }>) => {
  const { scope, port } = event.data;
  let version = 0;
  const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  port.onmessage = async (event) => {
    const current = ++version;
    // Collapse superseded edits before doing expensive work.
    await yieldTask();
    if (current !== version) return;
    const { id, request, kind, plan, result, code, transfer, from, to, choices } = event.data;
    try {
      if (scope === 'simulation') port.postMessage({ id, result: simulate(plan) });
      else if (scope === 'airport') port.postMessage({ id, data: analyzeAirport(plan, result, code, transfer) });
      else if (scope === 'codeshare') port.postMessage({ id, ideas: kind === 'hosted' ? hostedIdeas(plan) : codeshareIdeas(plan) });
      else if (kind === 'destinations') port.postMessage({ request, destinations: destinationsFrom(plan, from) });
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
