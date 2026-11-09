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
  /** Net, travellers and seats across all deals (two simulations, so they arrive first). Null before the first ever. */
  totals: DealTotals | null;
  /** Whether `totals` is for the current plan (otherwise the previous plan's, shown until the new ones arrive). */
  totalsFresh: boolean;
  /** How many deals have a figure for the current plan so far. */
  fresh: number;
}

export interface DealTotals { gain: number; pax: number; seats: number }

export const dealId = (airline: string, key: string) => `${airline}|${key}`;

const NONE: Deals = { out: new Map(), inn: new Map(), done: true, totals: null, totalsFresh: true, fresh: 0 };
/** The last finished set, so coming back to the tab with the same plan shows it at once. */
let remembered: { plan: Plan; deals: Deals } | null = null;
/** Finished sets by plan content, so going back to an earlier plan (undo, switching tabs) shows it at once. */
const finished = new Map<string, Deals>();
const FINISHED_MAX = 6;

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
    const key = JSON.stringify(plan);
    const hit = finished.get(key);
    if (hit) { remembered = { plan, deals: hit }; setState(remembered); return; }
    const w = worker.current ??= createComputeClient('codeshare');
    const id = ++seq.current;
    // The previous figures stay (greyed by the caller) until each one is replaced, so nothing blanks on an edit.
    const out = new Map(latest.current?.deals.out);
    const inn = new Map(latest.current?.deals.inn);
    let totals = latest.current?.deals.totals ?? null;
    let totalsFresh = false;
    const got = new Set<string>();
    const onMessage = (e: MessageEvent<{ id: number; deals?: Deal[]; partial?: boolean; totals?: DealTotals }>) => {
      if (e.data.id !== id || !e.data.deals) return;
      if (e.data.totals) { totals = e.data.totals; totalsFresh = true; }
      for (const d of e.data.deals) {
        (d.side === 'out' ? out : inn).set(dealId(d.airline, d.key), d.imp as never);
        got.add(`${d.side}${dealId(d.airline, d.key)}`);
      }
      const done = !e.data.partial;
      const next = { plan, deals: { out: new Map(out), inn: new Map(inn), done, totals, totalsFresh, fresh: got.size } };
      if (done) {
        remembered = next;
        finished.set(key, next.deals);
        if (finished.size > FINISHED_MAX) finished.delete(finished.keys().next().value!);
      }
      setState(next);
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, kind: 'deals', plan });
    return () => w.removeEventListener('message', onMessage);
  }, [plan, has]);
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  if (!has) return NONE;
  if (!state) return { out: new Map(), inn: new Map(), done: false, totals: null, totalsFresh: false, fresh: 0 };
  const same = state.plan === plan;
  return { ...state.deals, done: same && state.deals.done, totalsFresh: same && state.deals.totalsFresh, fresh: same ? state.deals.fresh : 0 };
}
