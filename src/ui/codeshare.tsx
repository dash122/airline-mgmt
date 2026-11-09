// Codeshare: sell seats on partner airlines' flights as connections with your own.
// One hub (航線 → 共享) lists what you share and the best ideas across every partner; one sheet per codeshare shows
// its demand per flight and lets you size its seat block.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { airlines } from '../sim/competitors';
import {
  bestShare, CODESHARE_FEE_PER_WEEK, CODESHARE_SEAT_SHARE, CODESHARE_SHARES, codeshareFee, codeshareImpact, codeshareOptions, codeshareShare, shareChoices,
  type CodeshareIdea, type CodeshareImpact, type CodeshareOption,
} from '../sim/codeshare';
import type { AirlineNetwork } from '../sim/networks';
import { airlineName, hhmm, localMinutes, type CodeshareDeparture, type CodeshareResult, type NetworkResult, type Plan } from '../sim/simulate';
import { createComputeClient } from './compute-client';
import type { DayRecord } from './clock';
import { CodeshareDash } from './codeshare-dash';
import { HostedHub } from './hosted';
import { count, money, pct } from './format';
import { dealId, useDeals, type Deals } from './deals';
import { JourneyLegend, JourneyPath, journeyUses } from './journey';
import { Head, routeName, Sheet } from './sheets';
import { Badge, IN, Icon, Meter, ProfitBar, Ring, type Tone } from './viz';

const name = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;
export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
export const colorOf = (id: string) => airlines().find((a) => a.id === id)?.color ?? '#888';
const at = (code: string, utc: number) => hhmm(localMinutes(code, utc));
const SHOWN = 6;
const DEPS_SHOWN = 4;
const JOURNEYS_SHOWN = 5;

/** Opens the codeshare sheet for one partner route, from anywhere. `focus` is a route of yours to mark on its journeys. */
export const CodeshareLink = createContext<((airline: string, key: string, focus?: string) => void) | null>(null);

/** The terms, shown behind the "i". */
export const CodeshareTerms = () => (
  <p>代碼共享：夥伴每班留一塊座位給你（預設 {pct(CODESHARE_SEAT_SHARE)}，可調 10–40%），只賣給「轉乘你自己航班」的旅客。票價按兩段各自的票價比例分：你的航段歸你，夥伴的航段歸夥伴。每條每週 {money(codeshareFee(0.1))}–{money(codeshareFee(0.4))}，座位越多越貴、但每座越便宜（{pct(CODESHARE_SEAT_SHARE)} 是 {money(CODESHARE_FEE_PER_WEEK)}）。損益已算入費用和擠掉自家旅客的影響。廉價航空不做代碼共享。</p>
);

// ---------- 航線 → 共享 ----------

/** Ideas across every partner, from the shared calculation worker (about a second on a phone). */
function useCodeshareIdeas(plan: Plan) {
  const [state, setState] = useState<{ plan: Plan; ideas: CodeshareIdea[]; done: boolean } | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!plan.fleet.length) return;
    const w = worker.current ??= createComputeClient('codeshare');
    const id = ++seq.current;
    const onMessage = (e: MessageEvent<{ id: number; ideas?: CodeshareIdea[]; partial?: boolean }>) => { if (e.data.id === id && e.data.ideas) setState({ plan, ideas: e.data.ideas, done: !e.data.partial }); };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, plan });
    return () => w.removeEventListener('message', onMessage);
  }, [plan]);
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  // Keep the last list while a new one is worked out, minus anything just shared.
  return state ? { ideas: state.ideas.filter((i) => codeshareShare(plan, i.airline, i.route.key) === null), fresh: state.plan === plan && state.done } : null;
}

/** The 航線 tab's 共享 view: what you share, then the best new ones across all partners. */
export function CodeshareHub({ plan, history, onOpen, onShare, onPartners, onOpenHosted, onHost }: {
  plan: Plan; history: DayRecord[]; onOpen: (airline: string, key: string) => void; onShare: (airline: string, key: string) => void; onPartners: () => void;
  onOpenHosted: (key: string, airline?: string) => void; onHost: (airline: string, key: string) => void;
}) {
  const [dir, setDir] = useState<'out' | 'in'>('out');
  // Every deal's impact is a week-long simulation: worked out once, in the worker, for the dashboard and both lists.
  const deals = useDeals(plan);
  return (
    <>
      <CodeshareDash plan={plan} history={history} deals={deals} onOpen={onOpen} onOpenHosted={onOpenHosted} />
      <div className="seg two cs-dir-seg" role="tablist" aria-label="共享方向">
        <button role="tab" aria-selected={dir === 'out'} className={dir === 'out' ? 'on' : ''} onClick={() => setDir('out')}>你賣夥伴航線{plan.codeshares?.length ? ` ${plan.codeshares.length}` : ''}</button>
        <button role="tab" aria-selected={dir === 'in'} className={dir === 'in' ? 'on' : ''} onClick={() => setDir('in')}>夥伴賣你航線{plan.hosted?.length ? ` ${plan.hosted.length}` : ''}</button>
      </div>
      {dir === 'out' ? <OutHub plan={plan} deals={deals} onOpen={onOpen} onShare={onShare} onPartners={onPartners} /> : <HostedHub plan={plan} deals={deals} onOpen={onOpenHosted} onShare={onHost} />}
    </>
  );
}

function OutHub({ plan, deals, onOpen, onShare, onPartners }: {
  plan: Plan; deals: Deals; onOpen: (airline: string, key: string) => void; onShare: (airline: string, key: string) => void; onPartners: () => void;
}) {
  // What each shared route adds, biggest first; one not worked out yet (undefined) goes last.
  const active = useMemo(() => (plan.codeshares ?? [])
    .map((c) => ({ airline: c.airline, key: c.key, imp: deals.out.get(dealId(c.airline, c.key)) }))
    .sort((x, y) => (x.imp === undefined ? 1 : 0) - (y.imp === undefined ? 1 : 0) || (y.imp?.gain ?? 0) - (x.imp?.gain ?? 0)), [plan, deals]);
  const ideas = useCodeshareIdeas(plan);
  const [shown, setShown] = useState(SHOWN);
  if (!plan.fleet.length) return <div className="hint center">先開航線，才接得上夥伴航班</div>;
  // Totals need every row: until then a partial sum would look like the answer.
  const waiting = active.some((a) => a.imp === undefined);
  const gain = active.reduce((s, a) => s + (a.imp?.gain ?? 0), 0);
  const pax = active.reduce((s, a) => s + (a.imp?.stats.pax ?? 0), 0);
  const maxIdea = Math.max(1, ...(ideas?.ideas ?? []).map((i) => i.gain));
  return (
    <>
      {active.length > 0 && (
        <div className="routes-summary">
          <span><small>每週</small>{waiting ? <b className="muted">—</b> : <b className={gain >= 0 ? 'good' : 'bad'}>{signed(gain)}</b>}</span>
          <span><b className={waiting ? 'muted' : undefined}>{waiting ? '—' : count(pax)}</b><small>人/週</small></span>
          <span><b>{active.length}</b><small>條共享</small></span>
        </div>
      )}
      {active.length > 0 && (
        <>
          <Head info={<CodeshareTerms />} right={!deals.done ? <small className="muted">更新中…</small> : undefined}>已共享</Head>
          <ul className="route-rows">
            {active.map((a) => <ActiveRow key={`${a.airline}|${a.key}`} airline={a.airline} routeKey={a.key} imp={a.imp} onOpen={() => onOpen(a.airline, a.key)} />)}
          </ul>
        </>
      )}
      <Head info={<><p>所有夥伴的航線裡，加了之後每週多賺最多的幾條（以 {pct(CODESHARE_SEAT_SHARE)} 座位估算）。點進去可以調座位數再決定。</p><CodeshareTerms /></>}
        right={ideas && !ideas.fresh ? <small className="muted">更新中…</small> : undefined}>推薦共享</Head>
      {(!ideas || (!ideas.fresh && ideas.ideas.length === 0)) && <div className="cs-loading" aria-live="polite"><span className="spin" aria-hidden="true" /> 正在比較所有夥伴的航線</div>}
      {ideas?.fresh && ideas.ideas.length === 0 && <div className="hint center">目前沒有划算的共享，先多開幾條航線</div>}
      {ideas && ideas.ideas.length > 0 && (
        <ul className="cs-ideas">
          {ideas.ideas.slice(0, shown).map((i) => (
            <IdeaRow key={`${i.airline}|${i.route.key}`} o={i} airline={i.airline} max={maxIdea} showAirline
              onOpen={() => onOpen(i.airline, i.route.key)} onShare={() => onShare(i.airline, i.route.key)} />
          ))}
        </ul>
      )}
      {ideas && ideas.ideas.length > shown && <button className="secondary" onClick={() => setShown(shown + SHOWN)}>再顯示 {Math.min(SHOWN, ideas.ideas.length - shown)} 條</button>}
      <div className="chips"><button className="chip" onClick={onPartners}><Icon n="rival" /> 按航空公司找</button></div>
    </>
  );
}

/** One codeshare you run: route, partner, how full its seat block is, what it adds. */
function ActiveRow({ airline, routeKey, imp, onOpen }: { airline: string; routeKey: string; imp: CodeshareImpact | null | undefined; onOpen: () => void }) {
  const [a, b] = routeKey.split('-');
  const s = imp?.stats;
  const use = s && s.seats ? s.pax / s.seats : 0;
  const away = s ? turnedAway(s) : null;
  const soldOut = !!away?.block;
  const ownFull = !!away?.own;
  const dead = !!s && s.pax < 1;
  return (
    <li className={`route-row cs-row${imp && imp.gain < 0 ? ' loss' : ''}`}>
      <button className="route-row-main" onClick={onOpen}>
        <span className="swatch dashed" style={{ borderColor: colorOf(airline) }} />
        <span className="route-row-text">
          <span className="route-row-top"><strong>{routeName(a, b)}</strong>{imp && <b className={`route-row-profit ${imp.gain < 0 ? 'bad' : 'good'}`}>{signed(imp.gain)}<small>／週</small></b>}</span>
          <span className="route-row-meta">
            {imp === undefined ? <Badge n="clock" tone="accent">計算中…</Badge>
              : !imp ? <Badge n="warn" tone="warn">停飛</Badge>
              : dead ? <Badge n="warn" tone="bad">接不上</Badge>
              : soldOut ? <Badge n="spill" tone="accent">座位賣光</Badge>
              : ownFull ? <Badge n="spill" tone="warn">你的航班滿</Badge>
              : imp.gain < 0 ? <Badge n="down" tone="bad">虧錢</Badge> : null}
            {s && <span className="route-row-load"><Meter value={use} tone={seatTone(s)} label={`共享座位賣出 ${pct(use)}`} /><b className={seatTone(s)}>{pct(use)}</b></span>}
            <small className="route-row-sub">{airlineName(airline)} · {pct(s?.share ?? CODESHARE_SEAT_SHARE)} 座位</small>
          </span>
        </span>
        <span className="chev" aria-hidden="true" />
      </button>
    </li>
  );
}

/** A codeshare you could start: route, partner, travellers, what it would add, and a one-tap 共享. */
function IdeaRow({ o, airline, max, showAirline, onOpen, onShare }: {
  o: CodeshareOption; airline: string; max: number; showAirline?: boolean; onOpen: () => void; onShare: () => void;
}) {
  const r = o.route;
  const far = r.a === o.at ? r.b : r.a;
  return (
    <li className={o.active ? 'on' : ''}>
      <button className="cs-idea-main" onClick={onOpen}>
        {showAirline && <span className="swatch dashed" style={{ borderColor: colorOf(airline) }} />}
        <span className="grow">
          <b>{o.at} ⇄ {name(far)}</b>
          <span className="ins">
            {showAirline && <span className="in">{airlineName(airline)}</span>}
            <IN n="pax" v={count(o.stats?.pax ?? 0)} label="轉乘旅客/週" u="人/週" />
          </span>
        </span>
        <span className="cs-gain">
          <b className={o.gain >= 0 ? 'good' : 'bad'}>{signed(o.gain)}</b><small>/週</small>
          <ProfitBar value={o.gain} max={max} split={false} />
        </span>
      </button>
      <button className={o.active ? 'secondary small' : 'primary small'} onClick={onShare} aria-pressed={o.active}>{o.active ? '取消' : '共享'}</button>
    </li>
  );
}

/**
 * Travellers who wanted the codeshare but didn't get on, split by cause: the partner's seat block sold out
 * (a bigger block helps) or your own flight was full (more flights of yours help).
 */
export function turnedAway(s: CodeshareResult) {
  let block = 0, own = 0;
  for (const d of s.departures) {
    const n = Math.max(0, d.wanted - d.pax) * d.perWeek;
    if (d.pax >= d.seats - 0.5) block += n; else own += n;
  }
  const min = Math.max(10, s.pax * 0.02);
  return { block: block >= min ? block : 0, own: own >= min ? own : 0 };
}

const seatTone = (s: CodeshareResult): Tone => (turnedAway(s).block > 0 ? 'accent' : s.pax / Math.max(1, s.seats) >= 0.5 ? 'good' : 'warn');

// ---------- The partner profile's 共享 tab ----------

/** Its routes that connect with yours, ranked by what they would add each week. Tap one for the full picture. */
export function CodeshareTab({ plan, net, onToggle }: { plan: Plan; net: AirlineNetwork; onToggle: (key: string) => void }) {
  const open = useContext(CodeshareLink);
  const options = useMemo(() => codeshareOptions(plan, net.airline.id), [plan, net.airline.id]);
  const [shown, setShown] = useState(SHOWN);
  if (net.airline.kind === 'low') return <div className="hint center"><Icon n="lock" /> 廉價航空不做代碼共享</div>;
  if (!plan.fleet.length) return <div className="hint center">先開航線，才接得上夥伴航班</div>;
  const active = options.filter((o) => o.active);
  const ideas = options.filter((o) => !o.active);
  const max = Math.max(1, ...options.map((o) => Math.abs(o.gain)));
  const gain = active.reduce((s, o) => s + o.gain, 0);
  const row = (o: CodeshareOption) => (
    <IdeaRow key={o.route.key} o={o} airline={net.airline.id} max={max} onOpen={() => open?.(net.airline.id, o.route.key)} onShare={() => onToggle(o.route.key)} />
  );
  return (
    <>
      {active.length > 0 && (
        <>
          <Head info={<CodeshareTerms />} right={<small className={gain >= 0 ? 'good' : 'bad'}><b>{signed(gain)}</b>/週</small>}>已共享 · {active.length}</Head>
          <ul className="cs-ideas">{active.map(row)}</ul>
        </>
      )}
      <Head info={<CodeshareTerms />} right={<small className="muted">{ideas.length} 條接得上</small>}>{active.length ? '再共享' : '可共享的航線'}</Head>
      {ideas.length === 0 && <div className="hint center">它的航線接不上你的航班</div>}
      <ul className="cs-ideas">{ideas.slice(0, shown).map(row)}</ul>
      {ideas.length > shown && <button className="secondary" onClick={() => setShown(shown + SHOWN * 2)}>再顯示 {Math.min(SHOWN * 2, ideas.length - shown)} 條</button>}
    </>
  );
}

// ---------- One codeshare ----------

/**
 * Everything about one codeshare: what it adds, its seat block (with what each size would add), demand against
 * seats, each partner departure and the flight of yours it connects with, the flights it fills and where travellers go.
 */
export function CodeshareSheet({ plan, airline, routeKey, focus, onShare, onStop, onOpenRoute, onPartner, onClose }: {
  plan: Plan; airline: string; routeKey: string;
  /** A route of yours to mark on the journeys: the one the sheet was opened from. */
  focus?: string;
  onShare: (share: number) => void; onStop: () => void; onOpenRoute: (key: string) => void; onPartner: () => void; onClose: () => void;
}) {
  const current = codeshareShare(plan, airline, routeKey);
  const active = current !== null;
  const choices = useMemo(() => shareChoices(plan, airline, routeKey), [plan, airline, routeKey]);
  const best = bestShare(choices);
  const [pick, setPick] = useState<number | null>(null);
  const [allJourneys, setAllJourneys] = useState(false);
  const share = active ? current : pick ?? best.share;
  const imp = useMemo(() => codeshareImpact(plan, airline, routeKey, undefined, share), [plan, airline, routeKey, share]);
  const [a, b] = routeKey.split('-');
  const color = colorOf(airline);
  const sub = <span className="ins"><button className="cs-partner" onClick={onPartner}><span className="swatch dashed inline" style={{ borderColor: color }} /><b>{airlineName(airline)}</b><span className="chev inline" aria-hidden="true" /></button>{imp && <IN n="plane" v={count(imp.stats.flights / 2)} label="夥伴班次（每個方向）" u="班/週" />}</span>;
  if (!imp) {
    return (
      <Sheet size="full" className="cs-sheet" title={routeName(a, b)} sub={sub} onClose={onClose}
        footer={active ? <div className="cs-foot"><button className="secondary danger" onClick={onStop}><Icon n="cross" /> 取消共享</button></div> : undefined}>
        <div className="hint center">{airlineName(airline)} 不飛這條航線了</div>
      </Sheet>
    );
  }
  const s = imp.stats;
  const away = turnedAway(s);
  const next = CODESHARE_SHARES.find((x) => x > share);
  // The fullest of your flights it feeds, where an extra flight would take the travellers turned away.
  const fullRoute = [...imp.routes].sort((x, y) => y.lfAfter - x.lfAfter)[0];
  const fee = codeshareFee(share);
  return (
    <Sheet size="full" className="cs-sheet" title={routeName(a, b)} sub={sub} onClose={onClose} info={<CodeshareTerms />}
      footer={<div className="cs-foot">
        {active
          ? <><span className="cs-foot-state"><Icon n="link" /> 共享中 · {pct(share)} 座位</span><button className="secondary danger" onClick={onStop}>取消共享</button></>
          : <button className="primary wide" onClick={() => onShare(share)}><Icon n="link" /> 共享 {pct(share)} 座位 · {money(fee)}/週</button>}
      </div>}>
      <MoneySteps imp={imp} />

      {s.journeys.length > 0 && (
        <>
          <Head info={<p>旅客從哪裡出發、怎麼轉到終點：每一行是一條完整的行程。虛線是夥伴的航班，實線是你的航班，空心圓是轉機的機場。{focus ? '粗線是你剛才看的航線。' : ''}</p>}
            right={<small className="muted">{count(s.journeys.reduce((sum, j) => sum + j.pax, 0))} 人/週</small>}>旅客怎麼轉</Head>
          {focus && <FocusNote journeys={s.journeys} focus={focus} />}
          <JourneyLegend airline={airlineName(airline)} color={color} here={!!focus && s.journeys.some((j) => journeyUses(j.path, focus))} />
          <ul className="cs-journeys">
            {(allJourneys ? s.journeys : s.journeys.slice(0, JOURNEYS_SHOWN)).map((j) => (
              <li key={j.path.join('>')}>
                <JourneyPath path={j.path} partnerKey={routeKey} color={color} airline={airlineName(airline)} here={focus} />
                <b>{count(j.pax)}<small> 人</small></b>
              </li>
            ))}
          </ul>
          {s.journeys.length > JOURNEYS_SHOWN && <button className="cs-more" onClick={() => setAllJourneys((v) => !v)}>{allJourneys ? '收起' : `再顯示 ${s.journeys.length - JOURNEYS_SHOWN} 條`}</button>}
        </>
      )}

      <Head info={<p>每班留給你的座位比例。座位越多，賣光的班次越少，但費用越高。每格下面是用那個大小時每週多賺多少（已扣費用），★ 是最賺的。</p>}>共享座位</Head>
      <div className="seg four cs-share-seg" role="radiogroup" aria-label="每班共享座位">
        {choices.map((c) => (
          <button key={c.share} role="radio" aria-checked={share === c.share} className={share === c.share ? 'on' : ''}
            onClick={() => (active ? (c.share !== current && onShare(c.share)) : setPick(c.share))}>
            <span>{c.share === best.share && <span className="star" aria-label="最賺">★</span>}{pct(c.share)}</span>
            <small className={c.gain >= 0 ? 'good' : 'bad'}>{signed(c.gain)}</small>
          </button>
        ))}
      </div>

      <Head info={<p>想訂：選這個共享行程的旅客。賣出：真的坐上的（共享座位或你的航班客滿時會少一些）。座位：每週夥伴留給你的位子。</p>}>需求</Head>
      <DemandBar s={s} tone={seatTone(s)} />
      {away.block > 0 && (
        <div className="cs-tip">
          <Badge n="spill" tone="accent">座位賣光 · {count(away.block)} 人沒訂到</Badge>
          {next && <button className="chip" onClick={() => (active ? onShare(next) : setPick(next))}><Icon n="plus" /> 加到 {pct(next)}</button>}
        </div>
      )}
      {away.own > 0 && fullRoute && (
        <div className="cs-tip">
          <Badge n="spill" tone="warn">你的航班滿 · {count(away.own)} 人上不了</Badge>
          <button className="chip" onClick={() => onOpenRoute(fullRoute.key)}><Icon n="plus" /> 看 {fullRoute.key.replace('-', '⇄')} 加班</button>
        </div>
      )}

      <Departures deps={s.departures} />

      {imp.routes.length > 0 && (
        <>
          <Head info={<p>共享旅客也要搭你的航班。座位有空時，他們把空位補滿；客滿時，他們會擠掉原本買直飛或其他轉機的旅客。載客率是加共享前 → 加共享後。</p>}>帶進你的航班</Head>
          <ul className="cs-feeds">
            {imp.routes.map((r) => {
              const [x, y] = r.key.split('-');
              return (
                <li key={r.key}><button onClick={() => onOpenRoute(r.key)}>
                  <Ring value={r.lfAfter} tone={r.lfAfter >= 0.8 ? 'good' : r.lfAfter >= 0.6 ? 'warn' : 'bad'} size={30} stroke={4} label={`載客率 ${pct(r.lfAfter)}`}><small>{Math.round(r.lfAfter * 100)}</small></Ring>
                  <span className="grow">
                    <b>{routeName(x, y)}</b>
                    <span className="ins">
                      <IN n="pax" v={`+${count(r.feedPax)}`} label="共享旅客/週" u="人/週" tone="good" />
                      <span className="in">{pct(r.lfBefore)} → <b>{pct(r.lfAfter)}</b></span>
                      {r.displacedPax >= 1 ? <Badge n="warn" tone="warn">擠掉 {count(r.displacedPax)}</Badge> : <Badge n="check" tone="good">補空位</Badge>}
                    </span>
                  </span>
                  <span className="chev" aria-hidden="true" />
                </button></li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}

/** In words, how much of the partner's traffic goes on to the route you came from: the answer to "does it reach my route?". */
export function FocusNote({ journeys, focus }: { journeys: CodeshareResult['journeys']; focus: string }) {
  const total = journeys.reduce((sum, j) => sum + j.pax, 0);
  const through = journeys.filter((j) => journeyUses(j.path, focus)).reduce((sum, j) => sum + j.pax, 0);
  const [x, y] = focus.split('-');
  return (
    <p className="jy-focus">
      {through >= 1
        ? <><b>{count(through)}</b> 人/週（{pct(through / Math.max(1, total))}）會再搭你的 {routeName(x, y)}</>
        : <>沒有旅客再搭你的 {routeName(x, y)}</>}
    </p>
  );
}

/** Wanted, sold and seats on one bar: sold fills it, a tick marks how many wanted. */
export function DemandBar({ s, tone }: { s: { pax: number; wanted: number; seats: number }; tone: Tone }) {
  // Demand far above the seats would squash the bar: past twice the seats, the tick sits at the end.
  const top = Math.max(s.seats, Math.min(s.wanted, s.seats * 2), 1);
  return (
    <div className="cs-demand">
      <div className="cs-demand-nums">
        <span><small>想訂</small><b>{count(s.wanted)}</b></span>
        <span><small>賣出</small><b className={tone}>{count(s.pax)}</b></span>
        <span><small>座位</small><b>{count(s.seats)}</b></span>
        <small className="muted">每週</small>
      </div>
      <div className="cs-demand-bar" role="img" aria-label={`想訂 ${count(s.wanted)}，賣出 ${count(s.pax)}，座位 ${count(s.seats)}`}>
        <i className="seats" style={{ width: `${(100 * s.seats) / top}%` }} />
        <i className={`sold ${tone}`} style={{ width: `${(100 * s.pax) / top}%` }} />
        <i className="want" style={{ left: `calc(${(100 * Math.min(s.wanted, top)) / top}% - 2px)` }} />
      </div>
    </div>
  );
}

/** Each partner departure, per direction: times, seats sold, and the flight of yours it connects with. */
function Departures({ deps }: { deps: CodeshareDeparture[] }) {
  const [all, setAll] = useState(false);
  const dirs = [...new Set(deps.map((d) => `${d.from}>${d.to}`))];
  const linked = deps.filter((d) => d.links > 0).length;
  return (
    <>
      <Head info={<p>夥伴每個班次賣出多少共享座位。「接不上」是指沒有你的航班在可轉機的時間內到達或出發，調整你航班的時刻就能接上。</p>}
        right={<small className={linked < deps.length ? 'warn' : 'muted'}>{linked}/{deps.length} 班接得上</small>}>夥伴班次</Head>
      {dirs.map((dir) => {
        const [from, to] = dir.split('>');
        const every = deps.filter((d) => d.from === from && d.to === to);
        const list = all || every.length <= DEPS_SHOWN + 1 ? every : every.slice(0, DEPS_SHOWN);
        return (
          <div key={dir} className="cs-dir">
            <div className="cs-dir-head"><b>{from} → {to}</b><small>{name(from)} → {name(to)}</small></div>
            <ul className="cs-deps">
              {list.map((d, i) => {
                const use = d.seats ? d.pax / d.seats : 0;
                const full = d.pax >= d.seats - 0.5 && d.wanted > d.pax + 0.5;
                return (
                  <li key={i} className={d.links ? '' : 'off'}>
                    <span className="t"><b>{at(d.from, d.dep)}</b><small>→ {at(d.to, d.arr)}</small></span>
                    {d.links
                      ? <span className="m"><Meter value={use} tone={full ? 'accent' : use >= 0.5 ? 'good' : 'warn'} label={`賣出 ${pct(use)}`} /><small>{count(d.pax)}/{d.seats}{d.perWeek < 6.5 ? ` · ${count(d.perWeek)}/週` : ''}</small></span>
                      : <span className="m"><small>接不上</small></span>}
                    <span className="l">{d.top ? <small>接 {d.top.from}→{d.top.to} {at(d.top.from, d.top.dep)}</small> : d.links ? <small>{d.links} 班可接</small> : null}</span>
                  </li>
                );
              })}
            </ul>
            {list.length < every.length && <button className="cs-more" onClick={() => setAll(true)}>再顯示 {every.length - list.length} 班</button>}
          </div>
        );
      })}
    </>
  );
}

/** The week's profit change as steps: fares it brings, fares it pushes out, extra service cost, the fee, and what is left. */
export function MoneySteps({ imp, feedLabel = '共享旅客票價', feeLabel = '共享費' }: {
  imp: Pick<CodeshareImpact, 'active' | 'gain' | 'feedRevenue' | 'ownRevenue' | 'paxCost' | 'fee'>; feedLabel?: string; feeLabel?: string;
}) {
  const steps: { key: string; label: string; value: number; tone: Tone }[] = [
    { key: 'feed', label: feedLabel, value: imp.feedRevenue, tone: 'good' },
    ...(Math.abs(imp.ownRevenue) >= 1000 ? [{ key: 'own', label: imp.ownRevenue < 0 ? '擠掉自家旅客' : '自家旅客增加', value: imp.ownRevenue, tone: (imp.ownRevenue < 0 ? 'warn' : 'good') as Tone }] : []),
    ...(Math.abs(imp.paxCost) >= 1000 ? [{ key: 'cost', label: '多載客成本', value: -imp.paxCost, tone: (imp.paxCost > 0 ? 'bad' : 'good') as Tone }] : []),
    { key: 'fee', label: feeLabel, value: -imp.fee, tone: 'bad' },
  ];
  const max = Math.max(1, ...steps.map((x) => Math.abs(x.value)), Math.abs(imp.gain));
  return (
    <div className="cs-steps" role="table" aria-label="每週損益變化">
      <div className={`cs-net ${imp.gain >= 0 ? 'good' : 'bad'}`}>
        <small>{imp.active ? '每週帶來' : '共享後每週'}</small>
        <b>{signed(imp.gain)}</b>
        <Badge n={imp.gain >= 0 ? 'up' : 'down'} tone={imp.gain >= 0 ? 'good' : 'bad'}>{imp.gain >= 0 ? '划算' : '虧錢'}</Badge>
      </div>
      {steps.map((x) => (
        <div key={x.key} className="cs-step" role="row">
          <span className="lbl">{x.label}</span>
          <span className="bar"><i className={x.tone} style={{ width: `${(100 * Math.abs(x.value)) / max}%` }} /></span>
          <b className={x.value >= 0 ? 'good' : x.tone === 'warn' ? 'warn' : 'bad'}>{signed(x.value)}</b>
        </div>
      ))}
    </div>
  );
}

const FED_AIRLINES = 3;
const FED_ROUTES = 4;
/** Travellers of a group that the journeys listed under it don't account for. */
const otherPax = (g: FeedGroup) => g.pax - g.journeys.slice(0, FED_ROUTES).reduce((sum, j) => sum + j.pax, 0);

/** A whole journey that flies a route of yours, with the partner route (`key`) it uses. */
export interface FeedJourney { path: string[]; pax: number; key: string }
/** One partner airline's feed into a route: what it brings in total, the partner routes that bring it, and the journeys. */
export interface FeedGroup { airline: string; pax: number; routes: { key: string; pax: number }[]; journeys: FeedJourney[] }

/** Partner feeds into one route, grouped by airline, the biggest airline first and each airline's biggest journeys first. */
export function groupFeeds(net: NetworkResult | null | undefined, routeKey: string): FeedGroup[] {
  const by = new Map<string, FeedGroup>();
  for (const c of Object.values(net?.codeshares ?? {})) {
    for (const f of c.feeds) {
      if (f.key !== routeKey || f.pax < 1) continue;
      const g = by.get(c.airline) ?? { airline: c.airline, pax: 0, routes: [], journeys: [] };
      g.pax += f.pax;
      g.routes.push({ key: c.key, pax: f.pax });
      by.set(c.airline, g);
    }
    const g = by.get(c.airline);
    if (g) for (const j of c.journeys ?? []) if (journeyUses(j.path, routeKey)) g.journeys.push({ path: j.path, pax: j.pax, key: c.key });
  }
  for (const g of by.values()) {
    g.routes.sort((x, y) => y.pax - x.pax);
    g.journeys.sort((x, y) => y.pax - x.pax);
  }
  return [...by.values()].sort((x, y) => y.pax - x.pax);
}

/**
 * The route sheet's note: travellers partners bring onto this route. One total and one bar with a segment per airline,
 * then the biggest airlines. An airline opens to the airports its travellers come from (the far end of each partner
 * route), and each of those opens that codeshare.
 */
export function FedByNote({ net, routeKey, routePax }: { net: NetworkResult | null | undefined; routeKey: string; routePax: number }) {
  const open = useContext(CodeshareLink);
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => groupFeeds(net, routeKey), [net, routeKey]);
  if (!groups.length) return null;
  const total = groups.reduce((s, g) => s + g.pax, 0);
  const shown = all ? groups : groups.slice(0, FED_AIRLINES);
  const rest = groups.slice(FED_AIRLINES);
  return (
    <div className="cs-feed-note">
      <div className="cs-feed-head">
        <span><b>{count(total)}</b> 人/週 由夥伴帶來</span>
        <small>{pct(total / Math.max(1, routePax))}</small>
      </div>
      <div className="cs-feed-bar" role="img" aria-label={groups.map((g) => `${airlineName(g.airline)} ${count(g.pax)} 人`).join('，')}>
        {groups.map((g) => <i key={g.airline} style={{ width: `${(100 * g.pax) / total}%`, background: colorOf(g.airline) }} />)}
      </div>
      <ul className="cs-feed-list">
        {shown.map((g) => {
          const on = expanded === g.airline;
          return (
            <li key={g.airline}>
              <button className="cs-feed-row" aria-expanded={on} onClick={() => setExpanded(on ? null : g.airline)}>
                <i className="dot" style={{ background: colorOf(g.airline) }} />
                <span className="name">{airlineName(g.airline)}</span>
                <small>{g.routes.length} 條航線</small>
                <b>{pct(g.pax / total)}</b>
                <span className="chev" aria-hidden="true" />
              </button>
              {on && (
                <>
                  <JourneyLegend airline={airlineName(g.airline)} color={colorOf(g.airline)} here />
                  <ul className="cs-feed-routes">
                    {g.journeys.slice(0, FED_ROUTES).map((j) => (
                      <li key={`${j.key}|${j.path.join('>')}`}>
                        <button onClick={() => open?.(g.airline, j.key, routeKey)}>
                          <JourneyPath path={j.path} partnerKey={j.key} color={colorOf(g.airline)} airline={airlineName(g.airline)} here={routeKey} />
                          <b>{count(j.pax)}<small> 人</small></b>
                          <span className="chev" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                    {otherPax(g) >= 1 && <li className="cs-feed-more-routes">其他 {count(otherPax(g))} 人</li>}
                  </ul>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {rest.length > 0 && (
        <button className="cs-feed-all" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? '收起' : `其他 ${rest.length} 家 · ${pct(rest.reduce((sum, g) => sum + g.pax, 0) / total)}`}
        </button>
      )}
    </div>
  );
}

/** Same ideas hook as the hub, limited to partner routes that start or end at this route's airports. Worked out only when opened. */
function useNearIdeas(plan: Plan, near: string[], enabled: boolean) {
  const [state, setState] = useState<{ plan: Plan; key: string; ideas: CodeshareIdea[]; done: boolean } | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const key = near.join('|');
  useEffect(() => {
    if (!enabled || !plan.fleet.length) return;
    const w = worker.current ??= createComputeClient('codeshare');
    const id = ++seq.current;
    // The worker sends partial lists while it searches; only the last one is the answer.
    const onMessage = (e: MessageEvent<{ id: number; ideas?: CodeshareIdea[]; partial?: boolean }>) => { if (e.data.id === id && e.data.ideas) setState({ plan, key, ideas: e.data.ideas, done: !e.data.partial }); };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, plan, near: key.split('|') });
    return () => w.removeEventListener('message', onMessage);
  }, [plan, key, enabled]);
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  return state && state.plan === plan && state.key === key
    ? { ideas: state.ideas.filter((i) => codeshareShare(plan, i.airline, i.route.key) === null), done: state.done }
    : null;
}

/** "Extend this route": partner routes that connect at either end, so their travellers can be sold on yours. */
export function RouteExtensions({ plan, a, b }: { plan: Plan; a: string; b: string }) {
  const open = useContext(CodeshareLink);
  const [on, setOn] = useState(false);
  const result = useNearIdeas(plan, [a, b], on);
  const ideas = result?.ideas;
  const done = !!result?.done;
  return (
    <div className="ext">
      <button className="ext-toggle" aria-expanded={on} onClick={() => setOn((v) => !v)}>
        <span><Icon n="link" /> 延伸這條航線</span>
        <small>{done && ideas ? `${ideas.length} 條可接` : ideas?.length ? '比較中…' : '夥伴的航線'}</small>
        <span className="chev" aria-hidden="true" />
      </button>
      {on && !done && !ideas?.length && <div className="cs-loading" aria-live="polite"><span className="spin" aria-hidden="true" /> 正在比較夥伴航線</div>}
      {on && done && ideas && ideas.length === 0 && <div className="hint center">這兩端接不上夥伴的航線</div>}
      {on && ideas && ideas.length > 0 && (
        <ul className="ext-list">
          {ideas.slice(0, 5).map((i) => {
            const [x, y] = i.route.key.split('-');
            const hub = [a, b].find((c) => i.route.a === c || i.route.b === c) ?? a;
            return (
              <li key={`${i.airline}|${i.route.key}`}>
                <button onClick={() => open?.(i.airline, i.route.key)}>
                  <i className="dash" style={{ borderColor: colorOf(i.airline) }} />
                  <span className="grow">
                    <b>{x} ⇄ {y}</b>
                    <small>{airlineName(i.airline)} · 在 {hub} 接上</small>
                  </span>
                  <span className="ext-gain good">{signed(i.gain)}<small>/週</small></span>
                  <span className="chev" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
