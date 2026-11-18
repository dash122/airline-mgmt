// One calculation on the shared worker, redone whenever the plan or its inputs change. The last answer for the same
// inputs stays on screen until the new one arrives, so a sheet never blanks while it recalculates.
import { useEffect, useRef, useState } from 'react';
import type { Plan } from '../sim/simulate';
import { createComputeClient } from './compute-client';

/** Completed answers survive sheet navigation. Recalculate when the plan changes. */
const lastAnswer = new Map<string, { plan: Plan; value: unknown }>();
const MAX_ANSWERS = 32;

export function useWorkerAnswer<T>(plan: Plan, enabled: boolean, kind: 'fare-curve' | 'what-if', params: Record<string, string>): { value: T; fresh: boolean } | null {
  const tag = `${kind}|${JSON.stringify(params)}`;
  const [state, setState] = useState<{ plan: Plan; tag: string; value: T; partial: boolean } | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!enabled || lastAnswer.get(tag)?.plan === plan) return;
    const w = worker.current ??= createComputeClient('preview');
    const id = ++seq.current;
    const onMessage = (e: MessageEvent<{ id: number; value?: T; partial?: boolean }>) => {
      // A partial answer (the fare curve's first pass) is shown, but is not final: it only fills in the picture.
      if (e.data.id === id && e.data.value !== undefined) {
        if (!e.data.partial) {
          lastAnswer.delete(tag);
          lastAnswer.set(tag, { plan, value: e.data.value });
          if (lastAnswer.size > MAX_ANSWERS) lastAnswer.delete(lastAnswer.keys().next().value!);
        }
        setState({ plan, tag, value: e.data.value, partial: !!e.data.partial });
      }
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, kind, plan, ...params });
    return () => { w.removeEventListener('message', onMessage); w.postMessage({ cancel: true }); };
    // params are compared through tag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, tag, enabled, kind]);
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  // Fresh only once the final answer for this exact plan is in. Anything else is last time's figures, shown as such.
  const cached = lastAnswer.get(tag);
  if (cached?.plan === plan) return { value: cached.value as T, fresh: true };
  if (state?.tag === tag) return { value: state.value, fresh: state.plan === plan && !state.partial };
  return cached ? { value: cached.value as T, fresh: false } : null;
}
