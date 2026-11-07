// Codeshare: pick a partner airline's routes to sell as connections with your own flights.
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { airlines } from '../sim/competitors';
import { CODESHARE_FEE_PER_WEEK, CODESHARE_SEAT_SHARE, codeshareImpact, codeshareOptions, partnersOf, type CodeshareImpact, type CodeshareOption } from '../sim/codeshare';
import type { AirlineNetwork } from '../sim/networks';
import type { NetworkResult, Plan } from '../sim/simulate';
import { count, money, pct } from './format';
import { Head, routeName } from './sheets';
import { Badge, IN, Icon, Meter, ProfitBar, Ring, type Tone } from './viz';

const name = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
const SHOWN = 6;

/** The terms, shown behind the "i". */
export const CodeshareTerms = () => (
  <p>代碼共享：夥伴每班給你 {pct(CODESHARE_SEAT_SHARE)} 座位，你只賣給「轉乘你自己航班」的旅客。票價按兩段各自的票價比例分：你的航段歸你，夥伴的航段歸夥伴（短程段分得比距離多一點）。每條共享航線每週 {money(CODESHARE_FEE_PER_WEEK)}。損益變化已算入費用，也算入夥伴旅客占掉你座位的影響。廉價航空不做代碼共享。</p>
);

/** The partner profile's 共享 tab: its routes that connect with yours, ranked by what they would add each week. */
export function CodeshareTab({ plan, net, onToggle, onPickAirport, onOpenRoute }: {
  plan: Plan; net: AirlineNetwork; onToggle: (key: string) => void; onPickAirport: (code: string) => void; onOpenRoute?: (key: string) => void;
}) {
  const options = useMemo(() => codeshareOptions(plan, net.airline.id), [plan, net.airline.id]);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(SHOWN);
  if (net.airline.kind === 'low') return <div className="hint center"><Icon n="lock" /> 廉價航空不做代碼共享</div>;
  if (!plan.fleet.length) return <div className="hint center">先開航線，才接得上夥伴航班</div>;
  const active = options.filter((o) => o.active);
  const ideas = options.filter((o) => !o.active);
  const maxGain = Math.max(1, ...options.map((o) => Math.abs(o.gain)));
  const pax = active.reduce((s, o) => s + (o.stats?.pax ?? 0), 0);
  const gain = active.reduce((s, o) => s + o.gain, 0);
  return (
    <>
      {active.length > 0 && (
        <div className="cs-summary">
          <span><Icon n="link" /> <b>{active.length}</b> 條共享</span>
          <span><Icon n="pax" /> <b>{count(pax)}</b> 人/週</span>
          <span className={gain >= 0 ? 'good' : 'bad'}><Icon n="money" /> <b>{signed(gain)}</b>/週</span>
        </div>
      )}
      {active.length > 0 && (
        <>
          <Head info={<CodeshareTerms />}>已共享</Head>
          <ul className="cs-list">{active.map((o) => <OptionRow key={o.route.key} plan={plan} airline={net.airline.id} o={o} max={maxGain} open={open === o.route.key} onOpen={() => setOpen(open === o.route.key ? null : o.route.key)} onToggle={() => onToggle(o.route.key)} onPickAirport={onPickAirport} onOpenRoute={onOpenRoute} />)}</ul>
        </>
      )}
      <Head info={<CodeshareTerms />} right={<small className="muted">{ideas.length} 條接得上</small>}>{active.length ? '再共享' : '可共享的航線'}</Head>
      {ideas.length === 0 && <div className="hint center">它的航線接不上你的航班</div>}
      <ul className="cs-list">
        {ideas.slice(0, shown).map((o) => <OptionRow key={o.route.key} plan={plan} airline={net.airline.id} o={o} max={maxGain} open={open === o.route.key} onOpen={() => setOpen(open === o.route.key ? null : o.route.key)} onToggle={() => onToggle(o.route.key)} onPickAirport={onPickAirport} onOpenRoute={onOpenRoute} />)}
      </ul>
      {ideas.length > shown && <button className="secondary" onClick={() => setShown(shown + SHOWN * 2)}>再顯示 {Math.min(SHOWN * 2, ideas.length - shown)} 條</button>}
    </>
  );
}

function OptionRow({ plan, airline, o, max, open, onOpen, onToggle, onPickAirport, onOpenRoute }: {
  plan: Plan; airline: string; o: CodeshareOption; max: number; open: boolean; onOpen: () => void; onToggle: () => void; onPickAirport: (code: string) => void; onOpenRoute?: (key: string) => void;
}) {
  const r = o.route;
  const far = r.a === o.at ? r.b : r.a;
  const s = o.stats;
  return (
    <li className={`${o.active ? 'on' : ''}${open ? ' open' : ''}`}>
      <div className="cs-top">
        <button className="name" onClick={onOpen} aria-expanded={open}>
          <b>{o.at} ⇄ {name(far)} {far}</b>
          <span className="ins"><IN n="plane" v={`${count(r.freq)}/週`} label="夥伴班次（每個方向）" w="它" /><IN n="pax" v={count(s?.pax ?? 0)} label="轉乘旅客/週" u="人/週" /></span>
        </button>
        <span className="cs-gain">
          <b className={o.gain >= 0 ? 'good' : 'bad'}>{signed(o.gain)}</b><small>/週</small>
          <ProfitBar value={o.gain} max={max} split />
        </span>
        <button className={o.active ? 'secondary small' : 'primary small'} onClick={onToggle} aria-pressed={o.active}>{o.active ? '取消' : '共享'}</button>
      </div>
      {open && <CodeshareDetail plan={plan} airline={airline} routeKey={r.key} onPickAirport={onPickAirport} onOpenRoute={onOpenRoute} far={far} />}
    </li>
  );
}

/** The 航線 tab's codeshare list: each partner route you sell; tap one to see what it does to your flights. */
export function CodeshareSection({ plan, result, onPick, onToggle, onOpenRoute }: {
  plan: Plan; result: NetworkResult | null; onPick: (airline: string) => void; onToggle: (airline: string, key: string) => void; onOpenRoute: (key: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const partners = partnersOf(plan);
  if (!partners.length) return null;
  const rows = (plan.codeshares ?? []).map((c) => ({ c, id: `${c.airline}|${c.key}`, res: result?.codeshares[`${c.airline}|${c.key}`], al: airlines().find((a) => a.id === c.airline) }));
  const pax = rows.reduce((s, r) => s + (r.res?.pax ?? 0), 0);
  const income = rows.reduce((s, r) => s + (r.res ? r.res.feedRevenue - r.res.fee : 0), 0);
  return (
    <>
      <Head info={<CodeshareTerms />} right={<small className="muted">{count(pax)} 人/週 · 票價−費用 <b className={income >= 0 ? 'good' : 'bad'}>{signed(income)}</b></small>}>代碼共享 · {rows.length}</Head>
      <ul className="cs-routes">
        {rows.map(({ c, id, res, al }) => {
          const [a, b] = c.key.split('-');
          const isOpen = open === id;
          const use = res && res.seats ? res.pax / res.seats : 0;
          return (
            <li key={id} className={isOpen ? 'open' : ''}>
              <button className="name" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen}>
                <span className="swatch dashed" style={{ borderColor: al?.color }} />
                <span className="grow"><strong>{name(a)} ⇄ {name(b)}</strong>
                  <small className="route-meta">{al?.name ?? c.airline} · {a}–{b}</small>
                  {res ? <span className="cs-use"><Meter value={use} tone={seatTone(res)} label={`共享座位賣出 ${pct(use)}`} /><small>{count(res.pax)}/{count(res.seats)} 座</small></span> : <small>模擬計算中</small>}
                </span>
                <span className="cs-row-money">
                  {res && <><b className={res.pax > 0 ? 'good' : 'muted'}>+{money(res.feedRevenue)}</b><small>票價/週</small></>}
                </span>
                <span className={`chev${isOpen ? ' up' : ''}`} aria-hidden="true">›</span>
              </button>
              {isOpen && (
                <>
                  <CodeshareDetail plan={plan} airline={c.airline} routeKey={c.key} onOpenRoute={onOpenRoute} />
                  <div className="cs-acts">
                    <button className="secondary small" onClick={() => onPick(c.airline)}><Icon n="rival" /> 看{al?.name ?? '夥伴'}</button>
                    <button className="secondary small danger" onClick={() => { setOpen(null); onToggle(c.airline, c.key); }}><Icon n="cross" /> 取消共享</button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

const seatTone = (s: { pax: number; seats: number; wanted: number }): Tone => (s.wanted > s.pax + 1 ? 'accent' : s.pax / Math.max(1, s.seats) >= 0.5 ? 'good' : 'warn');

/**
 * What one codeshare does, from a simulation with and without it: where the money comes from and goes,
 * how many of its seats sell, and which of your flights it fills (and whom it pushes off them).
 */
export function CodeshareDetail({ plan, airline, routeKey, far, onOpenRoute, onPickAirport }: {
  plan: Plan; airline: string; routeKey: string; far?: string; onOpenRoute?: (key: string) => void; onPickAirport?: (code: string) => void;
}) {
  const imp = useMemo(() => codeshareImpact(plan, airline, routeKey), [plan, airline, routeKey]);
  if (!imp) return <div className="hint center">它不飛這條航線了</div>;
  const s = imp.stats;
  const left = Math.max(0, s.wanted - s.pax);
  return (
    <div className="cs-detail">
      <MoneySteps imp={imp} />
      <Head info={<p>夥伴每班留給你 {pct(CODESHARE_SEAT_SHARE)} 的座位，只賣給轉乘你航班的旅客。座位賣光時，再加共享也帶不進更多人。</p>}>共享座位</Head>
      <div className="cs-seats">
        <Meter value={s.seats ? s.pax / s.seats : 0} tone={seatTone(s)} label={`賣出 ${pct(s.seats ? s.pax / s.seats : 0)}`} />
        <span className="ins">
          <IN n="seat" v={`${count(s.pax)}/${count(s.seats)}`} label="共享座位賣出/每週" w="賣出" u="座/週" />
          <IN n="plane" v={count(s.flights)} label="夥伴航班/週" u="班/週" />
        </span>
        {left >= Math.max(10, s.pax * 0.02) && <Badge n="spill" tone="accent">部分班次賣光・還有 {count(left)} 人想訂</Badge>}
      </div>
      {imp.routes.length > 0 && (
        <>
          <Head info={<p>共享旅客也要搭你的航班。座位有空時，他們把空位補滿；客滿時，他們會擠掉原本買直飛或其他轉機的旅客。載客率是加共享前 → 加共享後。</p>}>帶進你的航班</Head>
          <ul className="cs-feeds">
            {imp.routes.map((r) => {
              const [a, b] = r.key.split('-');
              const body = (
                <>
                  <Ring value={r.lfAfter} tone={r.lfAfter >= 0.8 ? 'good' : r.lfAfter >= 0.6 ? 'warn' : 'bad'} size={30} stroke={4} label={`載客率 ${pct(r.lfAfter)}`}><small>{Math.round(r.lfAfter * 100)}</small></Ring>
                  <span className="grow">
                    <b>{routeName(a, b)}</b>
                    <span className="ins">
                      <IN n="pax" v={`+${count(r.feedPax)}`} label="共享旅客/週" u="人/週" tone="good" />
                      <span className="in">載客率 {pct(r.lfBefore)} → <b>{pct(r.lfAfter)}</b></span>
                      {r.displacedPax >= 1
                        ? <Badge n="warn" tone="warn">擠掉自家 {count(r.displacedPax)} 人</Badge>
                        : <Badge n="check" tone="good">補空位</Badge>}
                    </span>
                  </span>
                </>
              );
              return <li key={r.key}>{onOpenRoute ? <button onClick={() => onOpenRoute(r.key)}>{body}<span className="chev" aria-hidden="true">›</span></button> : <div>{body}</div>}</li>;
            })}
          </ul>
        </>
      )}
      {s.markets.length > 0 && (
        <>
          <Head>旅客從哪來</Head>
          <ul className="cs-markets">
            {s.markets.slice(0, 3).map((m) => (
              <li key={`${m.o}${m.d}`}><span>{m.o} <i>→ {m.via} →</i> {m.d}</span><small>{name(m.o)}–{name(m.d)}</small><b>{count(m.pax)}<small> 人/週</small></b></li>
            ))}
          </ul>
        </>
      )}
      {far && onPickAirport && <div className="chips"><button className="chip" onClick={() => onPickAirport(far)}><Icon n="base" /> 看{name(far)}機場</button></div>}
    </div>
  );
}

/** The week's profit change as steps: fares it brings, fares it pushes out, extra service cost, the fee, and what is left. */
function MoneySteps({ imp }: { imp: CodeshareImpact }) {
  const steps: { key: string; label: string; value: number; tone: Tone }[] = [
    { key: 'feed', label: '共享旅客票價', value: imp.feedRevenue, tone: 'good' },
    ...(Math.abs(imp.ownRevenue) >= 1000 ? [{ key: 'own', label: imp.ownRevenue < 0 ? '擠掉自家旅客' : '自家旅客增加', value: imp.ownRevenue, tone: (imp.ownRevenue < 0 ? 'warn' : 'good') as Tone }] : []),
    ...(Math.abs(imp.paxCost) >= 1000 ? [{ key: 'cost', label: '多載客成本', value: -imp.paxCost, tone: (imp.paxCost > 0 ? 'bad' : 'good') as Tone }] : []),
    { key: 'fee', label: '共享費', value: -imp.fee, tone: 'bad' },
  ];
  const max = Math.max(1, ...steps.map((x) => Math.abs(x.value)), Math.abs(imp.gain));
  return (
    <div className="cs-steps" role="table" aria-label="每週損益變化">
      <div className={`cs-net ${imp.gain >= 0 ? 'good' : 'bad'}`}>
        <small>{imp.active ? '這條共享每週帶來' : '共享後每週'}</small>
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
