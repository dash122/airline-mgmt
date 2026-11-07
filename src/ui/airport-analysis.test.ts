import { expect, it, vi } from 'vitest';
import { emptyPlan } from '../sim/simulate';

const hooks = vi.hoisted(() => ({ effects: [] as (() => (() => void) | undefined)[], setState: vi.fn() }));
vi.mock('./compute-client', () => ({ createComputeClient: () => new Worker('mock') }));
vi.mock('react', () => ({
  useEffect: (effect: () => (() => void) | undefined) => hooks.effects.push(effect),
  useState: () => [null, hooks.setState],
}));

it('shares analysis requests and ignores responses after selecting another destination', async () => {
  const postMessage = vi.fn();
  let worker: { onmessage: (e: unknown) => void };
  vi.stubGlobal('Worker', class {
    onmessage = () => {};
    onerror = () => {};
    postMessage = postMessage;
    constructor() { worker = this; }
  });
  try {
    const { useAirportAnalysis } = await import('./airport-analysis');
    const plan = emptyPlan('TPE');
    expect(useAirportAnalysis(plan, null, 'HKG')).toBeNull();
    const cancel = hooks.effects.pop()!()!;
    useAirportAnalysis(plan, null, 'HKG');
    hooks.effects.pop()!();
    expect(postMessage).toHaveBeenCalledTimes(1);
    cancel();
    const data = { annualPax: 123 };
    worker!.onmessage({ data: { id: postMessage.mock.calls[0][0].id, data } });
    await Promise.resolve();
    expect(hooks.setState).toHaveBeenCalledTimes(1);
    expect(hooks.setState.mock.calls[0][0].data).toEqual(data);
    useAirportAnalysis(plan, null, 'HKG');
    hooks.effects.pop()!();
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledTimes(1);
    const nextPlan = { ...plan };
    useAirportAnalysis(nextPlan, null, 'HKG');
    hooks.effects.pop()!();
    expect(postMessage).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});
