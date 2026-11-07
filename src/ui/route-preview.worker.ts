import { destinationsFrom, previewChoice, type RouteChoice, type RoutePreview } from '../sim/newroute';
import { type NetworkResult, type Plan } from '../sim/simulate';

self.onmessage = (event: MessageEvent<{ kind?: 'destinations'; request: number; plan: Plan; result: NetworkResult | null; from: string; to: string; choices: { choice: RouteChoice; dep: number }[] }>) => {
  const { kind, request, plan, result, from, to, choices } = event.data;
  try {
    if (kind === 'destinations') { self.postMessage({ request, destinations: destinationsFrom(plan, from) }); return; }
    const previews: [string, RoutePreview][] = choices.map(({ choice, dep }) => [choice.id, previewChoice(plan, result, choice, from, to, dep)]);
    self.postMessage({ request, previews });
  } catch (error) {
    self.postMessage({ request, error: String(error) });
  }
};
