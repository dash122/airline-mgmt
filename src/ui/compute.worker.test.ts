import { expect, it, vi } from 'vitest';
const model = vi.hoisted(() => ({ simulate: vi.fn(plan => plan), out: vi.fn((_plan: unknown, airline: string, key: string) => ({ airline, key, gain: 1 })), inn: vi.fn((_plan: unknown, airline: string, key: string) => ({ airline, key, gain: 2 })) }));
vi.mock('../sim/simulate', () => ({ simulate: model.simulate }));
vi.mock('../sim/codeshare', () => ({ codeshareImpact: model.out, hostedImpact: model.inn, codeshareIdeaSteps: vi.fn(), hostedIdeaSteps: vi.fn() }));
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

// With dozens of codeshares each impact is a whole week's simulation, so the worker sends them in batches: the tab
// shows rows as they are done instead of freezing the page until the last one.
const startWorker = async () => {
  vi.resetModules();
  const runtime = { onmessage: null as unknown as (event: unknown) => void };
  vi.stubGlobal('self', runtime);
  await import('./compute.worker');
  const port = { onmessage: null as unknown as (event: unknown) => void, postMessage: vi.fn() };
  runtime.onmessage({ data: { scope: 'codeshare', port } });
  return port;
};
const slow = () => { let t = 0; vi.spyOn(performance, 'now').mockImplementation(() => (t += 40)); };
const done = (port: { postMessage: ReturnType<typeof vi.fn> }) => vi.waitFor(() => expect(port.postMessage.mock.calls.some(([m]) => m.deals && !m.partial)).toBe(true));
const plan = { codeshares: [{ airline: 'A', key: 'X-Y' }, { airline: 'B', key: 'X-Z' }, { airline: 'C', key: 'Y-Z' }], hosted: [{ airline: 'D', key: 'X-Y' }] };

it('sends every codeshare and hosted impact, in several batches, simulating the plan once', async () => {
  model.simulate.mockClear();
  slow();
  try {
    const port = await startWorker();
    port.onmessage({ data: { id: 1, kind: 'deals', plan } });
    await done(port);
    const messages = port.postMessage.mock.calls.map(([m]) => m);
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.slice(0, -1).every((m) => m.partial === true)).toBe(true);
    expect(messages.at(-1).partial).toBeUndefined();
    const all = messages.flatMap((m) => m.deals);
    expect(all.map((d) => `${d.side}:${d.airline}|${d.key}`)).toEqual(['out:A|X-Y', 'out:B|X-Z', 'out:C|Y-Z', 'in:D|X-Y']);
    expect(model.simulate).toHaveBeenCalledTimes(2); // the plan, and the plan without any deal (for the totals)
    expect(messages[0].totals).toBeDefined();
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it('drops an older deals request when a newer one arrives', async () => {
  slow();
  try {
    const port = await startWorker();
    port.onmessage({ data: { id: 1, kind: 'deals', plan } });
    port.onmessage({ data: { id: 2, kind: 'deals', plan: { codeshares: [{ airline: 'Z', key: 'P-Q' }] } } });
    await vi.waitFor(() => expect(port.postMessage.mock.calls.some(([m]) => m.id === 2 && !m.partial)).toBe(true));
    expect(port.postMessage.mock.calls.some(([m]) => m.id === 1)).toBe(false);
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
