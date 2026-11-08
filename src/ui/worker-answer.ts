// One calculation on the shared worker, redone whenever the plan or its inputs change. The last answer for the same
// inputs stays on screen until the new one arrives, so a sheet never blanks while it recalculates.
import { useEffect, useRef, useState } from 'react';
import type { Plan } from '../sim/simulate';
import { createComputeClient } from './compute-client';

export function useWorkerAnswer<T>(plan: Plan, enabled: boolean, kind: 'fare-curve' | 'what-if', params: Record<string, string>): { value: T; fresh: boolean } | null {
  const tag = `${kind}|${JSON.stringify(params)}`;
  const [state, setState] = useState<{ plan: Plan; tag: string; value: T } | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const w = worker.current ??= createComputeClient('preview');
    const id = ++seq.current;
    const onMessage = (e: MessageEvent<{ id: number; value?: T }>) => {
      if (e.data.id === id && e.data.value !== undefined) setState({ plan, tag, value: e.data.value });
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, kind, plan, ...params });
    return () => w.removeEventListener('message', onMessage);
    // params are compared through tag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, tag, enabled, kind]);
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  return state && state.tag === tag ? { value: state.value, fresh: state.plan === plan } : null;
}
