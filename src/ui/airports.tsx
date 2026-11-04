import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CLASS_NAMES } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { modelledAnnualPax } from '../sim/markets';
import { airportTraffic, hubOf, hubOpportunities, linkages, hourly, spokes, stations, viaGroup, viewFromHub, type HubView, type Linkage, type LinkStatus, type Spoke, type SpokeIdea } from '../sim/airports';
import {
  CONNECT_FARE_SHARE, HUB_COST_PER_WEEK, HUB_MCT_CUT, hhmm, layoverKind, MAX_DETOUR, MAX_DETOUR_SHORT, minConnect, STOPOVER_FARE_SHARE, stopoverAppealHours,
  weeklyDepartures, type NetworkResult, type Plan,
} from '../sim/simulate';
import { count, money, pct, short } from './format';
import { Sheet, Stat, tone } from './sheets';
import { airlinesAt } from '../sim/competitors';
import { AirportCompetition, AirportMarkets, AirportTiles, type AirportSection, type Tile } from './airport-views';

const lfClass = (lf: number | null) => (lf === null ? 'idle' : lf >= 0.8 ? 'good' : lf >= 0.6 ? 'warn' : 'bad');

/** Nudge bearings apart so neighbouring labels do not sit on top of each other. */
export function spreadAngles(bearings: number[], minGap = 26): number[] {
  const n = bearings.length;
  if (n < 2) return [...bearings];
  const gap = Math.min(minGap, 340 / n);
  const order = bearings.map((_, i) => i).sort((x, y) => bearings[x] - bearings[y]);
  const a = order.map((i) => bearings[i]);
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let k = 0; k < n; k++) {
      const next = (k + 1) % n;
      const d = next === 0 ? a[0] + 360 - a[k] : a[next] - a[k];
      if (d < gap - 0.01) { const push = (gap - d) / 2; a[k] -= push; a[next] += push; moved = true; }
    }
    if (!moved) break;
  }
  const out = Array<number>(n).fill(0);
  order.forEach((idx, k) => { out[idx] = a[k]; });
  return out;
}

/** The airport at the centre, one spoke per direct route: direction is the real bearing, length grows with distance. */
function Radial({ code, list, onPick }: { code: string; list: Spoke[]; onPick: (key: string) => void }) {
  const W = 320, H = 210, cx = W / 2, cy = H / 2;
  const maxD = Math.max(...list.map((s) => s.distKm), 1);
  const maxP = Math.max(...list.map((s) => s.pax), 1);
  const angle = spreadAngles(list.map((s) => s.bearing));
  return (
    <svg className="radial" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${code} 的直飛航線`}>
      {[0.5, 1].map((k) => <ellipse key={k} cx={cx} cy={cy} rx={118 * k} ry={78 * k} className="ring" />)}
      {list.map((s, i) => {
        const r = 0.28 + 0.72 * Math.sqrt(s.distKm / maxD);
        const x = cx + Math.sin((angle[i] * Math.PI) / 180) * 118 * r, y = cy - Math.cos((angle[i] * Math.PI) / 180) * 78 * r;
        const w = 2 + 6 * Math.sqrt(s.pax / maxP);
        return (
          <g key={s.key} className={`spoke ${lfClass(s.loadFactor)}`} onClick={() => onPick(s.key)} role="button" aria-label={`${s.other}，每日 ${s.flightsPerDay} 班`}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="hit" />
            <line x1={cx} y1={cy} x2={x} y2={y} className="line" strokeWidth={s.loadFactor === null ? 2 : w} />
            <circle cx={x} cy={y} r="4.5" className="node" />
            <text x={x} y={y + (y > cy ? 15 : -8)} textAnchor="middle">{s.other}</text>
            <text x={x} y={y + (y > cy ? 25 : -18)} textAnchor="middle" className="sm">{s.flightsPerDay}班/日</text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="8" className="center" />
      <text x={cx} y={cy + 20} textAnchor="middle" className="center-t">{code}</text>
    </svg>
  );
}

function DayStrip({ plan, code }: { plan: Plan; code: string }) {
  const { dep, arr } = hourly(plan, code);
  const peak = Math.max(1, ...dep, ...arr);
  return (
    <div className="daystrip" aria-label="一天中的起降">
      <div className="cols">
        {dep.map((d, h) => (
          <div key={h} className="col">
            <div className="up"><i style={{ height: `${(d / peak) * 100}%` }} /></div>
            <div className="down"><i style={{ height: `${(arr[h] / peak) * 100}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="hours">{[0, 6, 12, 18].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h}</span>)}</div>
      <div className="legend"><span className="d">■ 出發</span><span className="a">■ 抵達</span><span>當地時間</span></div>
    </div>
  );
}

const STATUS: Record<LinkStatus, { label: string; tone: 'good' | 'warn' | 'bad' | 'idle' }> = {
  nonstop: { label: '已直飛', tone: 'good' },
  connected: { label: '已轉機', tone: 'good' },
  long: { label: '長轉機', tone: 'warn' },
  timing: { label: '時間接不上', tone: 'warn' },
  leg: { label: '缺航線', tone: 'idle' },
  detour: { label: '繞路太遠', tone: 'bad' },
};

const hm = (min: number) => (min % 60 ? `${Math.floor(min / 60)} 小時 ${min % 60} 分` : `${min / 60} 小時`);
const waitLabel = (w: number) => (layoverKind(w) === 'stopover' ? '停留' : layoverKind(w) === 'long' ? '長轉機' : '轉機');
const name = (c: string) => AIRPORT_BY_CODE[c].name;

function LinkRow({ hub, l, onOpenPair, onSuggest }: {
  hub: string; l: Linkage; onOpenPair: (a: string, b: string) => void; onSuggest: (from: string, to: string, localMin: number) => void;
}) {
  const st = l.status === 'long' && l.wait !== null && layoverKind(l.wait) === 'stopover' ? { label: '停留轉機', tone: 'warn' as const } : STATUS[l.status];
  const size = Math.max(1, l.demand, l.est, l.nonstopPax + l.viaPax);
  const share = (x: number) => `${Math.min(100, (x / size) * 100)}%`;
  return (
    <li className="link">
      <div className="link-top">
        <span className="name"><b>{l.o} ⇄ {l.d}</b><small>{name(l.o)} ⇄ {name(l.d)} · {count(l.distKm)} 公里 · 經{hub}多飛 {pct(Math.max(0, l.detourPct))}</small></span>
        <span className={`pill ${st.tone === 'idle' ? '' : st.tone}`}>{st.label}</span>
      </div>
      <div className="split" role="img" aria-label={`直飛 ${count(l.nonstopPax)}，轉機 ${count(l.viaPax)}，其他 ${count(l.lost)}`}>
        <i className="nonstop" style={{ width: share(l.nonstopPax) }} /><i className="via" style={{ width: share(l.viaPax) }} /><i className="lost" style={{ flex: 1 }} />
      </div>
      <small className="nums">
        {l.est >= 1 && <>經{hub}每天一班接得好，需求約 {count(l.est)} 人/週 · </>}
        現有航空旅客 {count(l.demand)}{l.nonstopPax > 0 ? ` · 你直飛 ${count(l.nonstopPax)}` : ''}{l.viaPax > 0.5 ? ` · 經${hub} ${count(l.viaPax)}` : ''}
      </small>
      {l.status === 'leg' && (
        <>
          <small className="why">要經{hub}轉機，還缺 {l.missing.map((c) => `${c} ⇄ ${hub}`).join('、')}。</small>
          <div className="chips">{l.missing.map((c) => <button key={c} className="chip strong" onClick={() => onOpenPair(c, hub)}>開航 {c} ⇄ {hub}</button>)}</div>
        </>
      )}
      {(l.status === 'long' || l.status === 'timing') && l.suggest && (
        <>
          <small className="why">
            {l.status === 'long' && l.wait !== null
              ? <>最快的轉機要在{hub}{waitLabel(l.wait)} {hm(l.wait)}。{layoverKind(l.wait) === 'stopover' ? '有人會順便進城玩，' : '仍有人搭，'}但比 3 小時內的轉機少。</>
              : <>兩段航線都有，但班次接不上。</>}
            {l.suggest.before === undefined
              ? <>{hhmm(l.suggest.arriveLocal)} 抵達{hub}後，排一班 {hhmm(l.suggest.local)} 往 {l.suggest.to} 就能快速轉機。</>
              : <>排一班 {hhmm(l.suggest.local)} 從 {l.suggest.from} 飛來（{hhmm(l.suggest.arriveLocal)} 到{hub}），接上 {hhmm(l.suggest.before)} 那班就能快速轉機。</>}
          </small>
          <div className="chips"><button className="chip strong" onClick={() => onSuggest(l.suggest!.from, l.suggest!.to, l.suggest!.local)}>排入 {hhmm(l.suggest.local)} {l.suggest.from} → {l.suggest.to}</button></div>
        </>
      )}
      {l.status === 'timing' && !l.suggest && <small className="why">兩段航線都有，但時間接不上。到「班表」調整其中一班。</small>}
      {l.status === 'detour' && (
        <>
          <small className="why">經{hub}比直飛長 {pct(l.detourPct)}，超過上限（{pct(MAX_DETOUR - 1)}，800 公里內 {pct(MAX_DETOUR_SHORT - 1)}），旅客不會選。這個市場適合直飛。</small>
          {!l.nonstopFlown && <div className="chips"><button className="chip strong" onClick={() => onOpenPair(l.o, l.d)}>開直飛 {l.o} ⇄ {l.d}</button></div>}
        </>
      )}
    </li>
  );
}

/** New routes from the hub, ranked by their own travellers plus those who would connect at the hub. */
function HubIdeas({ hub, ideas, onOpenPair }: { hub: string; ideas: SpokeIdea[]; onOpenPair: (a: string, b: string) => void }) {
  if (!ideas.length) return null;
  const top = Math.max(1, ...ideas.map((i) => i.local + i.via));
  return (
    <>
      <h4>從{hub}開這些航線，轉機帶來最多旅客</h4>
      <ul className="ideas">
        {ideas.map((i) => (
          <li key={i.to}>
            <div className="idea-top">
              <span className="name"><b>{name(i.to)} {i.to}</b><small>{count(i.distKm)} 公里 · 需求約 {count(i.local + i.via)} 人/週 · 每天一班可載 {count(i.seats)}</small></span>
              <button onClick={() => onOpenPair(hub, i.to)}>開航</button>
            </div>
            <div className="split" role="img" aria-label={`本地 ${count(i.local)}，轉機 ${count(i.via)}`}>
              <i className="nonstop" style={{ width: `${(i.local / top) * 100}%` }} /><i className="via" style={{ width: `${(i.via / top) * 100}%` }} />
            </div>
            <small>本地 {count(i.local)}{i.via >= 1 ? ` · 轉機 ${count(i.via)}：接 ${i.markets.slice(0, 4).map((m) => m.d).join('、')}${i.markets.length > 4 ? ` 等 ${i.markets.length} 個市場` : ''}` : ' · 還接不到你的其他航線'}</small>
          </li>
        ))}
      </ul>
    </>
  );
}

type ViaFilter = 'all' | 'flown' | 'hubLeg';
const PAGE = 12;

/** One destination reached through the hub: both legs at a glance, its transit demand, and the one-tap fix. */
function ViaRow({ hub, l, onOpenPair, onSuggest }: {
  hub: string; l: Linkage; onOpenPair: (a: string, b: string) => void; onSuggest: (from: string, to: string, localMin: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const leg = (a: string) => {
    const missing = l.missing.includes(a);
    return <span className={`leg ${missing ? 'miss' : 'ok'}`}>{a === l.o ? `${l.o}⇄${hub}` : `${hub}⇄${l.d}`}{missing ? '' : ' ✓'}</span>;
  };
  const st = l.status === 'long' && l.wait !== null && layoverKind(l.wait) === 'stopover' ? { label: '停留轉機', tone: 'warn' as const } : STATUS[l.status];
  return (
    <li className="via">
      <div className="via-top" onClick={() => setOpen(!open)} role="button" aria-expanded={open}>
        <span className="name"><b>{name(l.d)} {l.d}</b><small>{count(l.distKm)} 公里 · 經{hub}多飛 {pct(Math.max(0, l.detourPct))}</small></span>
        <span className="num">{count(Math.max(l.est, l.viaPax))}<small>/週</small></span>
      </div>
      <div className="via-legs">
        {leg(l.o)}{leg(l.d)}
        {l.status !== 'leg' && <span className={`pill ${st.tone === 'idle' ? '' : st.tone}`}>{st.label}{l.viaPax > 0.5 ? ` ${count(l.viaPax)}` : ''}</span>}
        {l.missing.filter((m) => m !== l.o).map((m) => <button key={m} className="chip strong" onClick={() => onOpenPair(hub, m)}>開航 {hub}⇄{m}</button>)}
        {(l.status === 'long' || l.status === 'timing') && l.suggest && (
          <button className="chip strong" onClick={() => onSuggest(l.suggest!.from, l.suggest!.to, l.suggest!.local)}>排入 {hhmm(l.suggest.local)} {l.suggest.from}→{l.suggest.to}</button>
        )}
      </div>
      {open && <ul className="links"><LinkRow hub={hub} l={l} onOpenPair={onOpenPair} onSuggest={onSuggest} /></ul>}
    </li>
  );
}

/** A non-hub airport seen from the hub: every market its travellers could reach through the hub, flown or not. */
function FromHub({ plan, view, filter, onFilter, onOpenPair, onSuggest, onPickHub }: {
  plan: Plan; view: HubView; filter: ViaFilter; onFilter: (f: ViaFilter) => void;
  onOpenPair: (a: string, b: string) => void; onSuggest: (from: string, to: string, localMin: number) => void; onPickHub: () => void;
}) {
  const { hub, code } = view;
  const role = plan.hub === hub ? '轉運站' : '基地';
  const [shown, setShown] = useState(PAGE);
  const groups = { flown: view.rows.filter((l) => viaGroup(l) === 'flown'), hubLeg: view.rows.filter((l) => viaGroup(l) === 'hubLeg') };
  const sum = (ls: Linkage[]) => ls.reduce((s, l) => s + Math.max(l.est, l.viaPax), 0);
  const list = filter === 'all' ? view.rows : groups[filter];
  return (
    <>
      <div className="hubview">
        <div className="hv-path"><b>{code}</b><i className={view.legFlown ? 'on' : 'off'} /><b className="hv-hub" onClick={onPickHub} role="button">{hub}<small>{role}</small></b><i className={groups.flown.length ? 'on' : 'off'} /><b>{view.rows.length} 個地方</b></div>
        <small>{name(code)}的旅客在{hub}換機，可以去 {view.rows.length} 個地方。兩段都開、班次接得好時，轉機需求共約 <b>{count(view.total)}</b> 人/週。</small>
        {view.legFlown
          ? <small>{code} ⇄ {hub} 已開航 ✓</small>
          : <small>第一步是開 {code} ⇄ {hub}：本地需求約 {count(view.local)} 人/週{view.unlockCount ? `，馬上接上你從${hub}已飛的 ${view.unlockCount} 個地方（約 ${count(view.unlock)} 人/週）` : ''}。每天一班可載 {count(view.seats)} 人/週。</small>}
        {!view.legFlown && <button className="primary small" onClick={() => onOpenPair(code, hub)}>開航 {code} ⇄ {hub}</button>}
      </div>
      {view.rows.length > 0 && (
        <>
          <div className="seg three" role="tablist">
            {([['all', '全部', view.rows], ['flown', `${hub}已飛`, groups.flown], ['hubLeg', `${hub}還沒飛`, groups.hubLeg]] as [ViaFilter, string, Linkage[]][]).map(([f, label, ls]) => (
              <button key={f} role="tab" className={filter === f ? 'on' : ''} onClick={() => { onFilter(f); setShown(PAGE); }}>{label} {ls.length}<small>{count(sum(ls))}/週</small></button>
            ))}
          </div>
          <ul className="vias">{list.slice(0, shown).map((l) => <ViaRow key={l.d} hub={hub} l={l} onOpenPair={onOpenPair} onSuggest={onSuggest} />)}</ul>
          {list.length > shown && <button className="secondary" onClick={() => setShown(shown + PAGE * 2)}>再顯示 {Math.min(PAGE * 2, list.length - shown)} 個（共 {list.length}）</button>}
          {list.length === 0 && <div className="hint center">{filter === 'flown' ? `你從${hub}飛的航線還接不到${name(code)}的市場。看「${hub}還沒飛」。` : '沒有。'}</div>}
          <div className="hint">數字是每週兩個方向的轉機需求，用的是和模擬一樣的算法：每天一班、轉機 1 到 2 小時。實際載客還受座位、班次時間和票價影響。點一列看細節。</div>
        </>
      )}
      {view.rows.length === 0 && <div className="hint center">經{hub}轉機繞路太遠，{name(code)}比較適合直飛。</div>}
      {!plan.hub && <div className="hint">你還沒設轉運站，這裡從基地 {hub} 來看。到一個機場的「航線」分頁可以設轉運站。</div>}
    </>
  );
}

function LayoverLegend({ hub }: { hub: string }) {
  return (
    <div className="hint">
      轉機時間：3 小時內是一般轉機（票價約直飛 {pct(CONNECT_FARE_SHARE)}）；3 到 8 小時是長轉機，旅客較少、票價打折；8 小時以上旅客會進城停留，
      {name(hub)}的停留吸引力約抵 {stopoverAppealHours(hub).toFixed(1)} 小時，票價約 {pct(STOPOVER_FARE_SHARE)}。
    </div>
  );
}

export function AirportSheet({ plan, result, code, onConnect, onOpen, onOpenPair, onSuggest, onOpenRoute, onToggleHub, onShowSchedule, onPickAirport, onHint, onClose, action }: {
  plan: Plan; result: NetworkResult | null; code: string; onConnect: () => void; onOpen: (to: string) => void; onOpenPair: (a: string, b: string) => void;
  onSuggest: (from: string, to: string, localMin: number) => void; onOpenRoute: (key: string) => void;
  onToggleHub: () => void; onShowSchedule: () => void; onPickAirport: (code: string) => void;
  /** Legs to sketch on the map while transit ideas are on screen (dashed = not flown yet). */
  onHint: (legs: [string, string][] | null) => void; onClose: () => void; action?: ReactNode;
}) {
  const [tab, setTab] = useState<AirportSection>('routes');
  const persp = hubOf(plan);
  const isPersp = code === persp;
  const view = useMemo(() => (isPersp ? null : viewFromHub(plan, result, persp, code)), [plan, result, persp, code, isPersp]);
  const [viaFilter, setViaFilter] = useState<ViaFilter>('all');
  const ideas = useMemo(() => (isPersp && tab === 'transfer' ? hubOpportunities(plan, code) : []), [plan, code, isPersp, tab]);
  useEffect(() => {
    if (isPersp) onHint(tab === 'transfer' ? ideas.slice(0, 5).map((i) => [code, i.to]) : null);
    else if (view) {
      const legs = new Map<string, [string, string]>();
      if (!view.legFlown) legs.set(code, [code, persp]);
      // The fan out of the hub: the biggest destinations in the chosen list (dashed where the leg is not flown yet).
      if (tab === 'transfer') for (const l of view.rows.filter((r) => viaFilter === 'all' || viaGroup(r) === viaFilter).slice(0, 10)) legs.set(l.d, [persp, l.d]);
      onHint(legs.size ? [...legs.values()] : null);
    }
    return () => onHint(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ideas, tab, isPersp, code, persp, viaFilter]);
  const a = AIRPORT_BY_CODE[code];
  const used = weeklyDepartures(plan, code);
  const list = spokes(plan, result, code);
  const isHub = plan.hub === code;
  const transfer = result?.transfers[code];
  const links = tab === 'transfer' && isPersp ? linkages(plan, result, code) : [];
  const served = used > 0;
  const carriers = airlinesAt(code);
  const traffic = useMemo(() => airportTraffic(result, code), [result, code]);
  const ourPax = list.reduce((s, x) => s + x.pax, 0);
  const tiles: Tile[] = [
    { key: 'routes', label: '你的航線', value: list.length ? `${list.length} 條` : '—', sub: list.length ? `${short(ourPax)} 人/週` : '還沒飛' },
    { key: 'rivals', label: '對手', value: carriers.length ? `${carriers.length} 家` : '—', sub: carriers.length ? `${short(carriers.reduce((s, c) => s + c.flights, 0))} 班/週` : '沒有對手' },
    { key: 'market', label: '市場', value: traffic.ours >= 1 ? pct(traffic.ours / Math.max(1, traffic.total)) : '0%', sub: `共 ${short(traffic.total)} 人/週` },
    isPersp
      ? { key: 'transfer', label: '轉機', value: short(transfer?.pax ?? 0), sub: '人/週在這裡轉' }
      : { key: 'transfer', label: `經${persp}轉機`, value: `${view?.rows.length ?? 0} 處`, sub: `約 ${short(view?.total ?? 0)} 人/週` },
  ];
  return (
    <Sheet title={`${a.name} ${a.code}`} onClose={onClose} action={action}
      sub={`腹地人口 ${count(a.catchment / 1e4)} 萬 · 模擬年旅客 ${(modelledAnnualPax(code) / 1e6).toFixed(1)} 百萬 · 時間帶 ${used}/${a.slotCap} 班/週 · 跑道 ${count(a.runwayM)} 公尺（最大 ${CLASS_NAMES[a.maxClass]}）${code === plan.base ? ' · 你的基地' : ''}${isHub ? ' · 轉運站' : ''}`}>
      <AirportTiles tiles={tiles} on={tab} onPick={setTab} />

      {tab === 'routes' && (
        <>
          {list.length === 0 ? <div className="hint center">你還沒有從這裡起降的航班。</div> : <Radial code={code} list={list} onPick={onOpenRoute} />}
          {list.length > 0 && <div className="hint">線的粗細是旅客數，顏色是載客率（綠 80% 以上、黃 60% 以上、紅偏低），方向大致對應實際方位。點線可開啟航線。</div>}
          {list.length > 0 && <DayStrip plan={plan} code={code} />}
          <ul className="markets">
            {list.map((s) => (
              <li key={s.key} onClick={() => onOpenRoute(s.key)} className="tapli">
                <span className="name">{AIRPORT_BY_CODE[s.other].name} <small>{s.other} · {count(s.distKm)} 公里 · 每日 {s.flightsPerDay} 班</small></span>
                {s.loadFactor !== null && <span className={`num ${tone(s.loadFactor)}`}>{pct(s.loadFactor)}</span>}
                {s.profit !== null && <span className={`pill ${s.profit >= 0 ? 'good' : 'bad'}`}>{s.profit >= 0 ? '+' : ''}{money(s.profit)}</span>}
              </li>
            ))}
          </ul>
          {view && (view.rows.length > 0 || !view.legFlown) && (
            <button className="hubteaser" onClick={() => setTab('transfer')}>
              <span className="grow"><b>經{persp}轉機的市場</b>
                <small>{view.legFlown
                  ? `可去 ${view.rows.length} 個地方，轉機需求約 ${count(view.total)} 人/週 · ${view.rows.filter((r) => r.viaPax > 0.5).length} 個已有人轉機`
                  : `可去 ${view.rows.length} 個地方，轉機需求約 ${count(view.total)} 人/週 · 本地約 ${count(view.local)} 人/週`}</small></span>
              <span className="chev">›</span>
            </button>
          )}
          <button className="primary wide" onClick={onConnect}>從這裡開新航線</button>
          {served && <button className="secondary" onClick={onShowSchedule}>看這個機場的班表</button>}
          {served && (
            <div className="hubbox">
              <div className="grow">
                <b>轉運站</b>
                <small>{isHub ? `已啟用：這裡的轉機最短時間縮短 ${HUB_MCT_CUT} 分鐘，每週 ${money(HUB_COST_PER_WEEK)}` : `轉機最短時間縮短 ${HUB_MCT_CUT} 分鐘，每週 ${money(HUB_COST_PER_WEEK)}。同一時間只能有一個。`}</small>
              </div>
              <button className={isHub ? 'secondary' : 'primary small'} onClick={onToggleHub}>{isHub ? '取消' : '設為轉運站'}</button>
            </div>
          )}
        </>
      )}

      {tab === 'transfer' && view && (
        <>
          <FromHub plan={plan} view={view} filter={viaFilter} onFilter={setViaFilter} onOpenPair={onOpenPair} onSuggest={onSuggest} onPickHub={() => onPickAirport(persp)} />
          {transfer && transfer.flows.length > 0 && (
            <>
              <h4>在{code}換機的旅客（每週）</h4>
              <TransferFlows code={code} flows={transfer.flows} />
            </>
          )}
          <LayoverLegend hub={persp} />
        </>
      )}

      {tab === 'transfer' && isPersp && (
        <>
          {served && (
            <div className="stats">
              <Stat label="每週轉機旅客" value={transfer ? count(transfer.pax) : '0'} tone={transfer && transfer.pax > 0 ? 'good' : undefined} />
              <Stat label="長轉機 / 停留" value={transfer ? `${count(transfer.long)} / ${count(transfer.stopover)}` : '—'} />
              <Stat label="最短轉機" value={`${minConnectLabel(plan, code)} 分`} />
            </div>
          )}
          {!served && <div className="hint center">還沒有從{code}起降的航班。先開幾條航線，旅客就能在這裡轉機。</div>}
          {transfer && transfer.flows.length > 0 && (
            <>
              <h4>在這裡換機的旅客（每週）</h4>
              <TransferFlows code={code} flows={transfer.flows} />
            </>
          )}
          <HubIdeas hub={code} ideas={ideas} onOpenPair={onOpenPair} />
          {served && links.length > 0 && (
            <>
              <h4>經{code}轉機的市場（每週兩個方向）</h4>
              <ul className="links">
                {links.map((l) => <LinkRow key={`${l.o}${l.d}`} hub={code} l={l} onOpenPair={onOpenPair} onSuggest={onSuggest} />)}
              </ul>
              <div className="hint"><span className="k nonstop">■</span> 直飛 <span className="k via">■</span> 經{code}轉機 <span className="k lost">■</span> 其他航空或沒搭到。轉機旅客只拿到市場的一部分，班次越密、等待越短，拿到越多。</div>
            </>
          )}
          <div className="hint">點地圖上其他機場，再看「轉機」分頁，就能看到那個機場的旅客經{code}可以去哪裡、還缺哪段航線。</div>
          <LayoverLegend hub={code} />
        </>
      )}

      {tab === 'rivals' && <AirportCompetition result={result} code={code} onOpenRoute={onOpenRoute} onOpen={onOpen} />}

      {tab === 'market' && <AirportMarkets plan={plan} result={result} code={code} onOpen={onOpen} onOpenRoute={onOpenRoute} />}
    </Sheet>
  );
}

/** The international minimum connection at this airport, as the player sees it. */
const minConnectLabel = (plan: Plan, code: string) => {
  const other = Object.keys(AIRPORT_BY_CODE).find((c) => AIRPORT_BY_CODE[c].country !== AIRPORT_BY_CODE[code].country) ?? code;
  return minConnect(code, other, other, plan.hub);
};

function TransferFlows({ code, flows }: { code: string; flows: NonNullable<NetworkResult['transfers'][string]>['flows'] }) {
  return (
    <ul className="markets">
      {flows.filter((f) => f.pax >= 0.5).slice(0, 8).map((f) => (
        <li key={`${f.from}${f.to}`}>
          <span className="name">{f.from} → {code} → {f.to}<small>{name(f.from)} → {name(f.to)}{f.stopover >= 0.5 ? ` · 停留 ${count(f.stopover)}` : ''}{f.long >= 0.5 ? ` · 長轉機 ${count(f.long)}` : ''}</small></span>
          <span className="num good">{count(f.pax)}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------- Airports tab ----------

export function AirportsPanel({ plan, result, onPick, onClose }: { plan: Plan; result: NetworkResult | null; onPick: (code: string) => void; onClose: () => void }) {
  const [order, setOrder] = useState<'busy' | 'profit' | 'transfer'>('busy');
  const rows = stations(plan, result).sort((x, y) =>
    order === 'profit' ? (y.profit ?? 0) - (x.profit ?? 0) : order === 'transfer' ? y.transferPax - x.transferPax : 0);
  return (
    <Sheet size="full" title={`機場 · ${rows.length} 個`} onClose={onClose} sub="時間帶用量、轉機旅客、損益（兩端各算一半，不含租金）">
      {rows.length === 0 && <div className="hint center">在地圖上開航後，這裡會列出你服務的機場。</div>}
      <div className="seg three">
        {([['busy', '班次'], ['profit', '損益'], ['transfer', '轉機']] as const).map(([k, label]) => (
          <button key={k} className={order === k ? 'on' : ''} onClick={() => setOrder(k)}>{label}</button>
        ))}
      </div>
      <ul className="stations">
        {rows.map((r) => {
          const use = r.departures / r.slotCap;
          return (
            <li key={r.code} onClick={() => onPick(r.code)}>
              <div className="st-top">
                <span className="name"><span className="st-title">{AIRPORT_BY_CODE[r.code].name} {r.code}{r.code === plan.base && <span className="chip">基地</span>}{r.isHub && <span className="chip">轉運站</span>}</span>
                  <small>{r.routes} 條航線 · 週旅客 {count(r.pax)}{r.transferPax > 0 ? ` · 轉機 ${count(r.transferPax)}` : ''}</small></span>
                {r.profit !== null && <span className={`pill ${r.profit >= 0 ? 'good' : 'bad'}`}>{r.profit >= 0 ? '+' : ''}{money(r.profit)}</span>}
              </div>
              <div className="util" title={`時間帶 ${r.departures}/${r.slotCap}`}><div className={`util-fill ${use >= 0.9 ? 'bad' : use >= 0.7 ? 'warn' : 'good'}`} style={{ width: `${Math.min(100, use * 100)}%` }} /></div>
              <small className="slots">{r.departures}/{r.slotCap} 班/週{use >= 0.9 ? ' · 時間帶快滿了' : ''}</small>
            </li>
          );
        })}
      </ul>
      {plan.hub && <div className="hint">轉運站 {plan.hub}：每週 {money(HUB_COST_PER_WEEK)}，轉機最短時間縮短 {HUB_MCT_CUT} 分鐘。</div>}
    </Sheet>
  );
}
