import { simulate, type Plan } from '../sim/simulate';

self.onmessage = (event: MessageEvent<{ id: number; plan: Plan }>) => {
  const { id, plan } = event.data;
  try {
    self.postMessage({ id, result: simulate(plan) });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
