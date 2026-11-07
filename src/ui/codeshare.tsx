// Codeshare: pick a partner airline's routes to sell as connections with your own flights.
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { airlines } from '../sim/competitors';
import { CODESHARE_FEE_PER_WEEK, CODESHARE_SEAT_SHARE, codeshareOptions, partnersOf, type CodeshareOption } from '../sim/codeshare';
import type { AirlineNetwork } from '../sim/networks';
import type { NetworkResult, Plan } from '../sim/simulate';
import { count, money, pct } from './format';
import { Head } from './sheets';
import { Badge, IN, Icon, ProfitBar } from './viz';

const name = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
const SHOWN = 6;

/** The terms, shown behind the "i". */
export const CodeshareTerms = () => (
  <p>代碼共享：夥伴每班給你 {pct(CODESHARE_SEAT_SHARE)} 座位，你只賣給「轉乘你自己航班」的旅客。票價按兩段各自的票價比例分：你的航段歸你，夥伴的航段歸夥伴（短程段分得比距離多一點）。每條共享航線每週 {money(CODESHARE_FEE_PER_WEEK)}。損益變化已算入費用，也算入夥伴旅客占掉你座位的影響。廉價航空不做代碼共享。</p>
);

/** The partner profile's 共享 tab: its routes that connect with yours, ranked by what they would add each week. */
export function CodeshareTab({ plan, net, onToggle, onPickAirport }: {
  plan: Plan; net: AirlineNetwork; onToggle: (key: string) => void; onPickAirport: (code: string) => void;
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
          <ul className="cs-list">{active.map((o) => <OptionRow key={o.route.key} o={o} max={maxGain} open={open === o.route.key} onOpen={() => setOpen(open === o.route.key ? null : o.route.key)} onToggle={() => onToggle(o.route.key)} onPickAirport={onPickAirport} />)}</ul>
        </>
      )}
      <Head info={<CodeshareTerms />} right={<small className="muted">{ideas.length} 條接得上</small>}>{active.length ? '再共享' : '可共享的航線'}</Head>
      {ideas.length === 0 && <div className="hint center">它的航線接不上你的航班</div>}
      <ul className="cs-list">
        {ideas.slice(0, shown).map((o) => <OptionRow key={o.route.key} o={o} max={maxGain} open={open === o.route.key} onOpen={() => setOpen(open === o.route.key ? null : o.route.key)} onToggle={() => onToggle(o.route.key)} onPickAirport={onPickAirport} />)}
      </ul>
      {ideas.length > shown && <button className="secondary" onClick={() => setShown(shown + SHOWN * 2)}>再顯示 {Math.min(SHOWN * 2, ideas.length - shown)} 條</button>}
    </>
  );
}

function OptionRow({ o, max, open, onOpen, onToggle, onPickAirport }: {
  o: CodeshareOption; max: number; open: boolean; onOpen: () => void; onToggle: () => void; onPickAirport: (code: string) => void;
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
      {open && s && (
        <div className="cs-more">
          <div className="cs-money">
            <span><small>你的航段票價</small><b className="good">{money(s.feedRevenue)}</b></span>
            <span><small>分給夥伴</small><b>{money(s.partnerRevenue)}</b></span>
            <span><small>共享費</small><b className="bad">−{money(s.fee)}</b></span>
          </div>
          {s.markets.length > 0 && (
            <ul className="cs-markets">
              {s.markets.slice(0, 4).map((m) => (
                <li key={`${m.o}${m.d}`}><span>{m.o} <i>→ {m.via} →</i> {m.d}</span><small>{name(m.o)}–{name(m.d)}</small><b>{count(m.pax)}<small> 人/週</small></b></li>
              ))}
            </ul>
          )}
          <div className="chips">
            <span className="chip"><Icon n="seat" /> {count(s.seats)} 座/週可賣</span>
            <button className="chip" onClick={() => onPickAirport(far)}>看{name(far)}機場</button>
          </div>
        </div>
      )}
    </li>
  );
}

/** The 航線 tab's codeshare list: each partner route you sell, with travellers and money. */
export function CodeshareSection({ plan, result, onPick }: { plan: Plan; result: NetworkResult | null; onPick: (airline: string) => void }) {
  const partners = partnersOf(plan);
  if (!partners.length) return null;
  const rows = (plan.codeshares ?? []).map((c) => ({ c, res: result?.codeshares[`${c.airline}|${c.key}`], al: airlines().find((a) => a.id === c.airline) }));
  return (
    <>
      <Head info={<CodeshareTerms />}>代碼共享 · {rows.length}</Head>
      <ul className="cs-routes">
        {rows.map(({ c, res, al }) => {
          const [a, b] = c.key.split('-');
          return (
            <li key={`${c.airline}${c.key}`}>
              <button className="name" onClick={() => onPick(c.airline)}>
                <span className="swatch dashed" style={{ borderColor: al?.color }} />
                <span className="grow"><strong>{name(a)} ⇄ {name(b)}</strong>
                  <small className="route-meta">{al?.name ?? c.airline} · {a}–{b}</small>
                  {res ? <span className="ins"><IN n="pax" v={count(res.pax)} label="轉乘旅客/週" u="人/週" /><IN n="fare" v={money(res.feedRevenue)} label="你的航段票價/週" w="收入" /></span> : <small>模擬計算中</small>}
                </span>
              </button>
              <Badge n="link" tone={res && res.pax > 0 ? 'good' : 'warn'} label={res && res.pax > 0 ? '共享中' : '沒人轉乘'} />
              <span className="chev" aria-hidden="true">›</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
