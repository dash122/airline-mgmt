import { expect, it, vi } from 'vitest';

it('shares one runtime while keeping client channels and lifetimes independent', async () => {
  const workers: { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('Worker', class extends EventTarget {
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() { super(); workers.push(this); }
  });
  vi.stubGlobal('MessageChannel', class {
    port1 = Object.assign(new EventTarget(), { start: vi.fn(), close: vi.fn(), postMessage: vi.fn() });
    port2 = {};
  });
  try {
    const { createComputeClient } = await import('./compute-client');
    const simulation = createComputeClient('simulation');
    const airport = createComputeClient('airport');
    const preview = createComputeClient('preview');
    expect(workers).toHaveLength(1);
    expect(workers[0].postMessage.mock.calls.map(([message]) => message.scope)).toEqual(['simulation', 'airport', 'preview']);
    expect(simulation).not.toBe(airport);
    expect(airport).not.toBe(preview);
    simulation.terminate();
    expect(workers[0].terminate).not.toHaveBeenCalled();
    airport.postMessage({ id: 1 });
    expect(airport.postMessage).toHaveBeenCalledWith({ id: 1 });
  } finally { vi.unstubAllGlobals(); }
});
