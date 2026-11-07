import { createComputeClient } from './compute-client';
import { useEffect, useState } from 'react';
import type { NetworkResult, Plan } from '../sim/simulate';
import type { analyzeAirport } from './airport-analysis.worker';

type Analysis = ReturnType<typeof analyzeAirport>;
type Entry = { plan: Plan; result: NetworkResult | null; code: string; transfer: boolean; promise: Promise<Analysis> };
let worker: Worker | null = null;
let nextId = 0;
const cache: Entry[] = [];
const pending = new Map<number, { resolve: (data: Analysis) => void; reject: (error: Error) => void }>();

function request(plan: Plan, result: NetworkResult | null, code: string, transfer: boolean) {
  const cached = cache.find(e => e.plan === plan && e.result === result && e.code === code && e.transfer === transfer);
  if (cached) return cached.promise;
  if (!worker) {
    worker = createComputeClient('airport');
    worker.onmessage = (event: MessageEvent<{ id: number; data: Analysis; error?: string }>) => {
      const task = pending.get(event.data.id);
      pending.delete(event.data.id);
      if (event.data.error) task?.reject(new Error(event.data.error));
      else task?.resolve(event.data.data);
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const task of pending.values()) task.reject(new Error('Airport analysis failed'));
      pending.clear();
      cache.length = 0;
    };
  }
  const id = ++nextId;
  const promise = new Promise<Analysis>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, plan, result, code, transfer });
  });
  const entry = { plan, result, code, transfer, promise };
  cache.push(entry);
  if (cache.length > 16) cache.shift();
  void promise.catch(() => { const i = cache.indexOf(entry); if (i >= 0) cache.splice(i, 1); });
  return promise;
}

export function useAirportAnalysis(plan: Plan, result: NetworkResult | null, code: string | null, transfer = false) {
  const [state, setState] = useState<{ plan: Plan; result: NetworkResult | null; code: string; transfer: boolean; data: Analysis } | null>(null);
  useEffect(() => {
    if (!code) return;
    let active = true;
    void request(plan, result, code, transfer).then(data => {
      if (active) setState({ plan, result, code, transfer, data });
    }).catch(error => { if (active) console.error(error); });
    return () => { active = false; };
  }, [plan, result, code, transfer]);
  return state?.plan === plan && state.result === result && state.code === code && state.transfer === transfer ? state.data : null;
}
