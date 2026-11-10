// One calculation on the shared worker, redone whenever the plan or its inputs change. The last answer for the same
// inputs stays on screen until the new one arrives, so a sheet never blanks while it recalculates.
import { useEffect, useRef, useState } from 'react';
import type { Plan } from '../sim/simulate';
import { createComputeClient } from './compute-client';

/** Last answer per request, kept across sheets so reopening a route shows its curve at once while a fresh one is worked out. */
const lastAnswer = new Map<string, unknown>();

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
      if (e.data.id === id && e.data.value !== undefined) { lastAnswer.set(tag, e.data.value); setState({ plan, tag, value: e.data.value }); }
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, kind, plan, ...params });
    return () => w.removeEventListener('message', onMessage);
    // params are compared through tag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, tag, enabled, kind]);
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  if (state && state.tag === tag) return { value: state.value, fresh: state.plan === plan };
  const cached = lastAnswer.get(tag) as T | undefined;
  return cached !== undefined ? { value: cached, fresh: false } : null;
}
