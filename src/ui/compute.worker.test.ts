import { expect, it, vi } from 'vitest';
const model = vi.hoisted(() => ({ simulate: vi.fn(plan => plan) }));
vi.mock('../sim/simulate', () => ({ simulate: model.simulate }));
vi.mock('../sim/newroute', () => ({ destinationsFrom: vi.fn(), previewChoice: vi.fn() }));
vi.mock('./airport-analysis.worker', () => ({ analyzeAirport: vi.fn() }));

it('skips superseded simulation edits before calculating', async () => {
  vi.useFakeTimers();
  const runtime = { onmessage: null as unknown as (event: unknown) => void };
  vi.stubGlobal('self', runtime);
  try {
    await import('./compute.worker');
    const port = { onmessage: null as unknown as (event: unknown) => void, postMessage: vi.fn() };
    runtime.onmessage({ data: { scope: 'simulation', port } });
    port.onmessage({ data: { id: 1, plan: 'old' } });
    port.onmessage({ data: { id: 2, plan: 'latest' } });
    await vi.runAllTimersAsync();
    expect(model.simulate).toHaveBeenCalledExactlyOnceWith('latest');
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ id: 2, result: 'latest' });
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});
