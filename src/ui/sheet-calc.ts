import { useEffect, useRef, useState } from 'react';
import type { Plan } from '../sim/simulate';
import { createComputeClient } from './compute-client';

/**
 * A figure for a sheet, worked out in the calculation worker instead of the page: each one is several full-week
 * simulations, so with many codeshares computing it while rendering froze every tap for seconds. The last figure stays
 * (`fresh` false) until the new one arrives, so a sheet never blanks or stalls when something is edited.
 */
export function useCalc<T>(kind: 'cs-options' | 'cs-detail' | 'hs-options' | 'hs-detail', plan: Plan, params: Record<string, unknown>, enabled = true): { value: T | null; fresh: boolean } {
  const [state, setState] = useState<{ plan: Plan; pkey: string; value: T } | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const pkey = JSON.stringify(params);
  useEffect(() => {
    if (!enabled) return;
    const w = worker.current ??= createComputeClient('codeshare');
    const id = ++seq.current;
    const onMessage = (e: MessageEvent<{ id: number; value?: T }>) => {
      if (e.data.id === id && e.data.value !== undefined) setState({ plan, pkey, value: e.data.value });
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, kind, plan, ...params });
    return () => w.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, kind, pkey, enabled]);
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  return { value: state?.value ?? null, fresh: !!state && state.plan === plan && state.pkey === pkey };
}
