// Partners selling your routes: a partner sells a block of seats on your flights to its own travellers, who connect
// from anywhere it flies to either end of the route. One list in 航線 → 代碼共享 → 夥伴賣你航線, one sheet per route.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import {
  bestShare, CODESHARE_SEAT_SHARE, HOSTED_FEE_PER_WEEK, hostedChoices, hostedImpact, hostedOptions, hostedShare,
  type HostedImpact, type HostedOption,
} from '../sim/codeshare';
import { airlineName, type NetworkResult, type Plan } from '../sim/simulate';
import { colorOf, DemandBar, MoneySteps, signed } from './codeshare';
import { createComputeClient } from './compute-client';
import { dealId, type Deals } from './deals';
import { count, money, pct } from './format';
import { Head, routeName, Sheet } from './sheets';
import { Badge, Icon, IN, Meter, ProfitBar, Ring, type Tone } from './viz';

const name = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;
const SHOWN = 6;

/** Opens the sheet for partners selling one of your routes (a given partner, or the best one). */
export const HostedLink = createContext<((key: string, airline?: string) => void) | null>(null);

export const HostedTerms = () => (
  <p>夥伴賣你的航線：夥伴把你航班上一塊座位（預設 {pct(CODESHARE_SEAT_SHARE)}，可調 10–40%）賣給它自己的旅客，他們從夥伴在兩端飛的任何航線轉機過來。票價按兩段的票價比例分，你的航段歸你。每條每個夥伴每週 {money(HOSTED_FEE_PER_WEEK)} 轉機處理費。空位多時最賺；航班已滿時，夥伴旅客會擠掉自家旅客。廉價航空不做代碼共享。</p>
);

/** Partners worth letting sell your routes, from the calculation worker. */
function useHostedIdeas(plan: Plan) {
  const [state, setState] = useState<{ plan: Plan; ideas: HostedOption[]; done: boolean } | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!plan.fleet.length) return;
    const w = worker.current ??= createComputeClient('codeshare');
    const id = ++seq.current;
    const onMessage = (e: MessageEvent<{ id: number; ideas?: HostedOption[]; partial?: boolean }>) => { if (e.data.id === id && e.data.ideas) setState({ plan, ideas: e.data.ideas, done: !e.data.partial }); };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, plan, kind: 'hosted' });
    return () => w.removeEventListener('message', onMessage);
  }, [plan]);
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  return state ? { ideas: state.ideas.filter((i) => hostedShare(plan, i.airline, i.key) === null), fresh: state.plan === plan && state.done } : null;
}

const blockTone = (s: { pax: number; seats: number; wanted: number }): Tone =>
  s.pax >= s.seats - 1 && s.wanted > s.pax + 5 ? 'accent' : s.pax / Math.max(1, s.seats) >= 0.5 ? 'good' : 'warn';

/** 代碼共享 → 夥伴賣你航線: who sells which of your routes, then the best partners to add. */
export function HostedHub({ plan, deals, onOpen, onShare }: { plan: Plan; deals: Deals; onOpen: (key: string, airline?: string) => void; onShare: (airline: string, key: string) => void }) {
  // Worked out once for the whole tab (see useDeals); one not done yet (undefined) goes last.
  const active = useMemo(() => (plan.hosted ?? [])
    .map((h) => ({ ...h, imp: deals.inn.get(dealId(h.airline, h.key)) }))
    .sort((x, y) => (x.imp === undefined ? 1 : 0) - (y.imp === undefined ? 1 : 0) || (y.imp?.gain ?? 0) - (x.imp?.gain ?? 0)), [plan, deals]);
  const ideas = useHostedIdeas(plan);
  const [shown, setShown] = useState(SHOWN);
  if (!plan.fleet.length) return <div className="hint center">先開航線，夥伴才有航班可賣</div>;
  const waiting = active.some((a) => a.imp === undefined);
  const gain = active.reduce((s, a) => s + (a.imp?.gain ?? 0), 0);
  const pax = active.reduce((s, a) => s + (a.imp?.stats.pax ?? 0), 0);
  const max = Math.max(1, ...(ideas?.ideas ?? []).map((i) => i.gain));
  return (
    <>
      {active.length > 0 && (
        <>
          <div className="routes-summary">
            <span><small>每週</small>{waiting ? <b className="muted">—</b> : <b className={gain >= 0 ? 'good' : 'bad'}>{signed(gain)}</b>}</span>
            <span><b className={waiting ? 'muted' : undefined}>{waiting ? '—' : count(pax)}</b><small>人/週</small></span>
            <span><b>{active.length}</b><small>個夥伴在賣</small></span>
          </div>
          <Head info={<HostedTerms />}>夥伴在賣</Head>
          <ul className="route-rows">
            {active.map((a) => {
              const [x, y] = a.key.split('-');
              const s = a.imp?.stats;
              const use = s && s.seats ? s.pax / s.seats : 0;
              return (
                <li key={`${a.airline}|${a.key}`} className={`route-row cs-row${a.imp && a.imp.gain < 0 ? ' loss' : ''}`}>
                  <button className="route-row-main" onClick={() => onOpen(a.key, a.airline)}>
                    <span className="swatch dashed" style={{ borderColor: colorOf(a.airline) }} />
                    <span className="route-row-text">
                      <span className="route-row-top"><strong>{routeName(x, y)}</strong>{a.imp && <b className={`route-row-profit ${a.imp.gain < 0 ? 'bad' : 'good'}`}>{signed(a.imp.gain)}<small>／週</small></b>}</span>
                      <span className="route-row-meta">
                        {a.imp === undefined && <Badge n="clock" tone="accent">計算中…</Badge>}
                        {a.imp && a.imp.gain < 0 && <Badge n="down" tone="bad">虧錢</Badge>}
                        {s && <span className="route-row-load"><Meter value={use} tone={blockTone(s)} label={`夥伴座位賣出 ${pct(use)}`} /><b className={blockTone(s)}>{pct(use)}</b></span>}
                        <small className="route-row-sub">{airlineName(a.airline)} 賣 · {pct(s?.share ?? CODESHARE_SEAT_SHARE)} 座位</small>
                      </span>
                    </span>
                    <span className="chev" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Head info={<><p>讓哪個夥伴賣你哪條航線，每週多賺最多（以 {pct(CODESHARE_SEAT_SHARE)} 座位估算）。點進去可以比較同一條航線的其他夥伴、調座位數。</p><HostedTerms /></>}
        right={ideas && !ideas.fresh ? <small className="muted">更新中…</small> : undefined}>推薦夥伴</Head>
      {(!ideas || (!ideas.fresh && ideas.ideas.length === 0)) && <div className="cs-loading" aria-live="polite"><span className="spin" aria-hidden="true" /> 正在比較各夥伴</div>}
      {ideas?.fresh && ideas.ideas.length === 0 && <div className="hint center">目前沒有划算的夥伴，你的航班可能已經很滿</div>}
      {ideas && ideas.ideas.length > 0 && (
        <ul className="cs-ideas">
          {ideas.ideas.slice(0, shown).map((o) => {
            const [x, y] = o.key.split('-');
            return (
              <li key={`${o.airline}|${o.key}`}>
                <button className="cs-idea-main" onClick={() => onOpen(o.key, o.airline)}>
                  <span className="swatch dashed" style={{ borderColor: colorOf(o.airline) }} />
                  <span className="grow">
                    <b>{name(x)} ⇄ {name(y)}</b>
                    <span className="ins"><span className="in">{airlineName(o.airline)}</span><IN n="pax" v={count(o.pax)} label="夥伴旅客/週" u="人/週" /></span>
                  </span>
                  <span className="cs-gain"><b className="good">{signed(o.gain)}</b><small>/週</small><ProfitBar value={o.gain} max={max} split={false} /></span>
                </button>
                <button className="primary small" onClick={() => onShare(o.airline, o.key)}>開放</button>
              </li>
            );
          })}
        </ul>
      )}
      {ideas && ideas.ideas.length > shown && <button className="secondary" onClick={() => setShown(shown + SHOWN)}>再顯示 {Math.min(SHOWN, ideas.ideas.length - shown)} 個</button>}
    </>
  );
}

/**
 * One of your routes and the partners that sell (or could sell) it: pick a partner, see what it adds, size its block,
 * how full your flights get, and which of its routes bring the travellers.
 */
export function HostedSheet({ plan, routeKey, airline: initial, onSet, onStop, onOpenRoute, onPartner, onClose }: {
  plan: Plan; routeKey: string; airline?: string;
  onSet: (airline: string, share: number) => void; onStop: (airline: string) => void; onOpenRoute: () => void; onPartner: (airline: string) => void; onClose: () => void;
}) {
  const options = useMemo(() => hostedOptions(plan, routeKey, 16), [plan, routeKey]);
  const [picked, setPicked] = useState<string | undefined>(initial);
  const airline = picked ?? options[0]?.airline;
  const [a, b] = routeKey.split('-');
  const chips = options.slice(0, 8);
  if (airline && !chips.some((o) => o.airline === airline)) {
    const o = options.find((x) => x.airline === airline);
    if (o) chips.push(o);
  }
  return (
    <Sheet size="full" className="cs-sheet" title={routeName(a, b)} sub={<span className="ins"><b>{a}–{b}</b><span className="in">夥伴賣你的航線</span></span>} onClose={onClose} info={<HostedTerms />}
      action={<button className="secondary small" onClick={onOpenRoute}>航線<span className="chev inline" aria-hidden="true" /></button>}>
      {options.length === 0 && <div className="hint center">兩端都沒有夥伴的航班接得上</div>}
      {chips.length > 0 && (
        <div className="chips scroll cs-partners" role="radiogroup" aria-label="夥伴">
          {chips.map((o) => (
            <button key={o.airline} role="radio" aria-checked={o.airline === airline} className={`chip${o.airline === airline ? ' on' : ''}`} onClick={() => setPicked(o.airline)}>
              <i className="dash" style={{ borderColor: colorOf(o.airline) }} />{airlineName(o.airline)}
              <small className={o.gain >= 0 ? 'good' : 'bad'}>{o.active ? '在賣 ' : ''}{signed(o.gain)}</small>
            </button>
          ))}
        </div>
      )}
      {airline && <HostedDetail key={airline} plan={plan} routeKey={routeKey} airline={airline} onSet={(s) => onSet(airline, s)} onStop={() => onStop(airline)} onPartner={() => onPartner(airline)} />}
    </Sheet>
  );
}

function HostedDetail({ plan, routeKey, airline, onSet, onStop, onPartner }: {
  plan: Plan; routeKey: string; airline: string; onSet: (share: number) => void; onStop: () => void; onPartner: () => void;
}) {
  const current = hostedShare(plan, airline, routeKey);
  const active = current !== null;
  const choices = useMemo(() => hostedChoices(plan, airline, routeKey), [plan, airline, routeKey]);
  const best = bestShare(choices);
  const [pick, setPick] = useState<number | null>(null);
  const share = active ? current : pick ?? best.share;
  const imp: HostedImpact | null = useMemo(() => hostedImpact(plan, airline, routeKey, undefined, share), [plan, airline, routeKey, share]);
  if (!imp) return <div className="hint center">這條航線還沒有航班</div>;
  const s = imp.stats;
  const left = Math.max(0, s.wanted - s.pax);
  const blockFull = s.pax >= s.seats - 1 && left > 5;
  const next = choices.find((c) => c.share > share)?.share;
  return (
    <>
      <div className="cs-partner-line">
        <button className="cs-partner" onClick={onPartner}><span className="swatch dashed inline" style={{ borderColor: colorOf(airline) }} /><b>{airlineName(airline)}</b><span className="chev inline" aria-hidden="true" /></button>
        {active ? <Badge n="link" tone="good">在賣 {pct(share)}</Badge> : <Badge n="link">還沒開放</Badge>}
      </div>
      <MoneySteps imp={{ ...imp, feedRevenue: imp.revenue }} feedLabel="夥伴旅客票價" feeLabel="處理費" />

      <Head info={<p>夥伴最多能賣你每班的多少座位。座位越多，夥伴旅客越多，但航班滿時也擠掉越多自家旅客。每格下面是每週多賺多少，★ 是最賺的。</p>}>給夥伴的座位</Head>
      <div className="seg four cs-share-seg" role="radiogroup" aria-label="每班給夥伴的座位">
        {choices.map((c) => (
          <button key={c.share} role="radio" aria-checked={share === c.share} className={share === c.share ? 'on' : ''}
            onClick={() => (active ? (c.share !== current && onSet(c.share)) : setPick(c.share))}>
            <span>{c.share === best.share && <span className="star" aria-label="最賺">★</span>}{pct(c.share)}</span>
            <small className={c.gain >= 0 ? 'good' : 'bad'}>{signed(c.gain)}</small>
          </button>
        ))}
      </div>

      <div className="cs-foot inline">
        {active
          ? <><span className="cs-foot-state"><Icon n="link" /> 在賣 · {pct(share)} 座位</span><button className="secondary danger" onClick={onStop}>停止</button></>
          : <button className="primary wide" onClick={() => onSet(share)}><Icon n="link" /> 開放 {pct(share)} 座位給{airlineName(airline)}</button>}
      </div>

      <Head info={<p>想訂：想買夥伴這個行程的旅客。賣出：真的坐上你航班的。座位：每週給夥伴的座位。</p>}>需求</Head>
      <DemandBar s={s} tone={blockTone(s)} />
      {left > Math.max(5, s.pax * 0.02) && (
        <div className="cs-tip">
          {blockFull
            ? <><Badge n="spill" tone="accent">座位賣光 · {count(left)} 人沒訂到</Badge>{next && <button className="chip" onClick={() => (active ? onSet(next) : setPick(next))}><Icon n="plus" /> 加到 {pct(next)}</button>}</>
            : <Badge n="spill" tone="warn">你的航班滿 · {count(left)} 人上不了</Badge>}
        </div>
      )}

      <Head info={<p>整條航線的載客率，夥伴賣之前 → 之後。航班已滿時，夥伴旅客擠掉的是付全票的自家旅客。</p>}>你的航班</Head>
      <div className="cs-lf">
        <Ring value={imp.lfAfter} tone={imp.lfAfter >= 0.8 ? 'good' : imp.lfAfter >= 0.6 ? 'warn' : 'bad'} size={36} stroke={5} label={`載客率 ${pct(imp.lfAfter)}`}><small>{Math.round(imp.lfAfter * 100)}</small></Ring>
        <span className="grow"><span>載客率 {pct(imp.lfBefore)} → <b>{pct(imp.lfAfter)}</b></span>
          {imp.displacedPax >= 1 ? <Badge n="warn" tone="warn">擠掉自家 {count(imp.displacedPax)} 人</Badge> : <Badge n="check" tone="good">補空位</Badge>}</span>
      </div>

      {s.sources.length > 0 && (
        <>
          <Head info={<p>夥伴的哪些航線把旅客接到你的航班。</p>}>從夥伴哪些航線來</Head>
          <ul className="cs-sources">
            {s.sources.slice(0, 6).map((x) => {
              const [p, q] = x.key.split('-');
              return <li key={x.key}><span>{p} ⇄ {q}</span><small>{name(p)}–{name(q)}</small><b>{count(x.pax)}<small> 人/週</small></b></li>;
            })}
          </ul>
        </>
      )}
      {s.markets.length > 0 && (
        <>
          <Head>旅客從哪來</Head>
          <ul className="cs-markets">
            {s.markets.slice(0, 4).map((m) => (
              <li key={`${m.o}${m.d}`}><span>{m.o} <i>→ {m.via} →</i> {m.d}</span><small>{name(m.o)}–{name(m.d)}</small><b>{count(m.pax)}<small> 人/週</small></b></li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** The route sheet's line: partners selling this route, and a way to find more. */
export function HostedNote({ net, routeKey }: { net: NetworkResult | null | undefined; routeKey: string }) {
  const open = useContext(HostedLink);
  const list = Object.values(net?.hosted ?? {}).filter((h) => h.key === routeKey).sort((x, y) => y.pax - x.pax);
  if (!open) return null;
  // Nobody sells this route yet: one quiet row, the same as "extend this route" below it.
  if (!list.length) return (
    <button className="ext-toggle" onClick={() => open(routeKey)}>
      <span><Icon n="link" /> 讓夥伴賣這條</span>
      <small>夥伴</small>
      <span className="chev" aria-hidden="true" />
    </button>
  );
  return (
    <div className="chips scroll hosted-note">
      {list.map((h) => (
        <button key={h.airline} className="chip" onClick={() => open(routeKey, h.airline)}>
          <i className="dash" style={{ borderColor: colorOf(h.airline) }} />{airlineName(h.airline)} 賣 · {count(h.pax)} 人
        </button>
      ))}
      <button className="chip" onClick={() => open(routeKey)}><Icon n="link" /> 其他夥伴</button>
    </div>
  );
}
