import { useEffect, useRef, useState } from 'react';
import type { CodeshareImpact, HostedImpact } from '../sim/codeshare';
import type { Plan } from '../sim/simulate';
import { createComputeClient } from './compute-client';

/** What one shared partner route adds to the week, as worked out by the calculation worker. */
export interface Deal { side: 'out' | 'in'; airline: string; key: string; imp: CodeshareImpact | HostedImpact | null }

export interface Deals {
  /** Codeshares you sell: the impact of each. Null when the partner no longer flies it; missing until it is worked out. */
  out: Map<string, CodeshareImpact | null>;
  /** Partners that sell your routes, the same way. */
  inn: Map<string, HostedImpact | null>;
  /** Whether every deal has been worked out for the current plan. */
  done: boolean;
}

export const dealId = (airline: string, key: string) => `${airline}|${key}`;

const NONE: Deals = { out: new Map(), inn: new Map(), done: true };
/** The last finished set, so coming back to the tab with the same plan shows it at once. */
let remembered: { plan: Plan; deals: Deals } | null = null;

/**
 * The impact of every codeshare and hosted deal in the plan. Each one is a whole week's simulation (with and without
 * it), so with dozens of deals they are worked out in the calculation worker, a few at a time, and the figures arrive
 * as they are done. Until then the previous figures stay, so a row never blanks while the list refreshes.
 */
export function useDeals(plan: Plan): Deals {
  const [state, setState] = useState<{ plan: Plan; deals: Deals } | null>(() => remembered);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const latest = useRef(state);
  latest.current = state;
  const has = !!(plan.codeshares?.length || plan.hosted?.length) && plan.fleet.length > 0;
  useEffect(() => {
    if (!has || (remembered?.plan === plan && remembered.deals.done)) return;
    const w = worker.current ??= createComputeClient('codeshare');
    const id = ++seq.current;
    const out = new Map(latest.current?.deals.out);
    const inn = new Map(latest.current?.deals.inn);
    const onMessage = (e: MessageEvent<{ id: number; deals?: Deal[]; partial?: boolean }>) => {
      if (e.data.id !== id || !e.data.deals) return;
      for (const d of e.data.deals) (d.side === 'out' ? out : inn).set(dealId(d.airline, d.key), d.imp as never);
      const next = { plan, deals: { out: new Map(out), inn: new Map(inn), done: !e.data.partial } };
      if (next.deals.done) remembered = next;
      setState(next);
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, kind: 'deals', plan });
    return () => w.removeEventListener('message', onMessage);
  }, [plan, has]);
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  if (!has) return NONE;
  if (!state) return { out: new Map(), inn: new Map(), done: false };
  return { out: state.deals.out, inn: state.deals.inn, done: state.plan === plan && state.deals.done };
}
