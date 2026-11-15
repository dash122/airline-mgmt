// All calculation clients share one runtime and its expensive, immutable market
// and competitor caches. Separate ports keep their request IDs independent.
let runtime: Worker | null = null;
function runtimeWorker(): Worker {
  if (!runtime) {
    const worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    runtime = worker;
    worker.addEventListener('error', () => {
      if (runtime === worker) runtime = null;
      worker.terminate();
    });
  }
  return runtime;
}
/** Starts the shared calculation runtime and has it build the demand model in the background, before anything asks. */
export function warmCompute() {
  try { runtimeWorker().postMessage({ scope: 'warm' }); } catch { /* no worker support: the first request builds it */ }
}
export function createComputeClient(scope: 'simulation' | 'airport' | 'preview' | 'codeshare'): Worker {
  const worker = runtimeWorker();
  const channel = new MessageChannel();
  worker.postMessage({ scope, port: channel.port2 }, [channel.port2]);
  const port = channel.port1;
  port.start();
  const client = Object.assign(port, { onerror: null as Worker['onerror'], terminate: () => {
    worker.removeEventListener('error', fail);
    port.close();
  } });
  const fail = (event: ErrorEvent) => {
    port.dispatchEvent(new ErrorEvent('error', { message: event.message }));
    client.onerror?.call(client as unknown as Worker, event);
  };
  worker.addEventListener('error', fail);
  // The consumers use the common message/event API; termination closes only
  // this client so another panel cannot destroy the shared calculation cache.
  return client as unknown as Worker;
}
