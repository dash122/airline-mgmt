import { CodeshareHub } from './codeshare';
import { useMemo, useState } from 'react';
import { AIRCRAFT, classRank, MODEL_ORDER, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { pairKey } from '../sim/markets';
import { byAirport, dayMark, timeline, zoneDiffHours, type ClockBasis } from '../sim/airports';
import {
  gapAt, insertRoundTrip, insertWindow, leaseFor, pickTime, placementOptions, removeUnit, shiftUnit, shiftWindow, slotProblem, typesFor,
  unitOf, type Placement, type Unit,
} from '../sim/schedule';
import {
  blockMinutes, DAY, hhmm, routePairs, routeProblem, rotationInfo, simulate, topMarketsFrom, utcFromLocal,
  type Aircraft, type NetworkResult, type Plan,
} from '../sim/simulate';
import { marketBetween } from '../sim/markets';
import { count, money, pct } from './format';
import { arrival, at, dayStart, legSegments, routeColor, routeName, Sheet, shortType, UtilBar } from './sheets';
import { LoadIcons, LoadPill } from './FlightLoads';
import { healthRank, RouteRow, routeHealth } from './route-health';
import { Badge, hm, IN, Icon, Ring } from './viz';

const withAc = (plan: Plan, ac: Aircraft): Plan => ({ ...plan, fleet: plan.fleet.map((x) => (x.id === ac.id ? ac : x)) });
const dur = hm;

// ---------- Routes ----------

export type RoutesView = 'own' | 'share';

export function RoutesPanel({ plan, result, view, onView, onOpen, onNew, onAdd, onRemoveOne, onOpenCodeshare, onShare, onPartners, onClose }: {
  plan: Plan; result: NetworkResult | null; view: RoutesView; onView: (v: RoutesView) => void;
  onOpen: (key: string) => void; onNew: () => void; onAdd: (key: string) => void; onRemoveOne: (key: string) => void;
  onOpenCodeshare: (airline: string, key: string) => void; onShare: (airline: string, key: string) => void; onPartners: () => void; onClose: () => void;
}) {
  const [only, setOnly] = useState<'all' | 'todo'>('all');
  const shared = plan.codeshares?.length ?? 0;
  const rows = routePairs(plan)
    .map((r) => {
      const res = result?.routes[r.key];
      const figures = res ? { loadFactor: res.loadFactor, spill: res.spill, profit: res.revenue - res.flyingCost } : null;
      const types = [...new Set(plan.fleet.filter((ac) => ac.legs.some((l) => pairKey(l.from, l.to) === r.key)).map((ac) => shortType(ac.type)))];
      return { ...r, figures, types, health: routeHealth(figures, r.flightsPerDay / 2) };
    })
    .sort((x, y) => healthRank(x.health) - healthRank(y.health) || (y.figures?.profit ?? 0) - (x.figures?.profit ?? 0));
  const todo = rows.filter((r) => r.health.key !== 'ok' && r.health.key !== 'pending');
  const shown = only === 'todo' ? todo : rows;
  const total = rows.reduce((s, r) => s + (r.figures?.profit ?? 0), 0);
  const daily = rows.reduce((s, r) => s + r.flightsPerDay, 0) / 2;
  return (
    <Sheet size="full" className="routes-panel" title={`航線 · ${rows.length}`} onClose={onClose}
      info={rows.length > 0 && <p>先列出要處理的航線（客滿、虧損、空位多），每條只給一個建議動作。點航線看票價、航班和市場。損益是每週航段損益，不含租金。</p>}
      action={rows.length > 0 && <button className="primary small" onClick={onNew}>＋ 新航線</button>}>
      {rows.length > 0 && (
        <div className="seg two routes-view" role="tablist" aria-label="航線類別">
          <button role="tab" aria-selected={view === 'own'} className={view === 'own' ? 'on' : ''} onClick={() => onView('own')}>自己飛 {rows.length}</button>
          <button role="tab" aria-selected={view === 'share'} className={view === 'share' ? 'on' : ''} onClick={() => onView('share')}><Icon n="link" /> 代碼共享{shared ? ` ${shared}` : ''}</button>
        </div>
      )}
      {rows.length > 0 && view === 'share' && <CodeshareHub plan={plan} onOpen={onOpenCodeshare} onShare={onShare} onPartners={onPartners} />}
      {view === 'own' && <>
      {rows.length === 0 && (
        <div className="empty-cta">
          <div className="empty-flight" aria-hidden="true"><span>✈</span></div>
          <strong>你的航空網絡，從這裡開始</strong>
          <p>選擇目的地，規劃第一條航線，讓你的機隊起飛。</p>
          <button className="primary wide" onClick={onNew}>＋ 開第一條航線</button>
        </div>
      )}
      {rows.length > 0 && (
        <div className="routes-summary">
          <span><small>每週</small><b className={total >= 0 ? 'good' : 'bad'}>{total >= 0 ? '+' : ''}{money(total)}</b></span>
          <span><b>{daily}</b><small>班來回/日</small></span>
          <span><b className={todo.length ? 'warn' : 'good'}>{todo.length}</b><small>條要處理</small></span>
        </div>
      )}
      {todo.length > 0 && rows.length > 3 && (
        <div className="seg two routes-filter" role="tablist">
          <button role="tab" aria-selected={only === 'all'} className={only === 'all' ? 'on' : ''} onClick={() => setOnly('all')}>全部 {rows.length}</button>
          <button role="tab" aria-selected={only === 'todo'} className={only === 'todo' ? 'on' : ''} onClick={() => setOnly('todo')}>要處理 {todo.length}</button>
        </div>
      )}
      <ul className="route-rows">
        {shown.map((r) => {
          const market = marketBetween(r.a, r.b);
          return (
            <RouteRow key={r.key} name={routeName(r.a, r.b)} swatch={routeColor(r.key)} figures={r.figures} daily={r.flightsPerDay / 2}
              sub={[r.types.join('、'), market?.distKm ? `${count(market.distKm)} 公里` : ''].filter(Boolean).join(' · ')}
              onOpen={() => onOpen(r.key)} onAdd={() => onAdd(r.key)} onRemove={() => onRemoveOne(r.key)} />
          );
        })}
      </ul>
      </>}
    </Sheet>
  );
}

// ---------- Schedule ----------

type SchedView = 'time' | 'airport' | 'aircraft';
const VIEW_KEY = 'waypoint.schedview';
function loadView(): SchedView {
  try { const v = localStorage.getItem(VIEW_KEY); return v === 'time' || v === 'airport' || v === 'aircraft' ? v : 'aircraft'; } catch { return 'aircraft'; }
}

export function SchedulePanel({ plan, result, now, selected, preset, onPickLeg, onGap, onClose }: {
  plan: Plan; result: NetworkResult | null; now: number; selected: { acId: string; legs: number[] } | null; preset?: { airport: string } | null;
  onPickLeg: (acId: string, leg: number) => void; onGap: (acId: string, t: number) => void; onClose: () => void;
}) {
  const [view, setViewState] = useState<SchedView>(() => (preset ? 'time' : loadView()));
  const setView = (v: SchedView) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ } };
  const [mode, setMode] = useState<'dep' | 'arr'>('dep');
  const [basis, setBasis] = useState<ClockBasis>('local');
  const [airport, setAirport] = useState<string | null>(preset?.airport ?? null);
  const start0 = dayStart(plan.base);
  const nowPct = ((((now - start0) % DAY) + DAY) % DAY) / DAY * 100;
  const tapGap = (ac: Aircraft, e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const minute = Math.round((((e.clientX - r.left) / r.width) * DAY) / 15) * 15;
    onGap(ac.id, start0 + minute);
  };
  return (
    <Sheet size="full" title="班表" sub={view === 'aircraft' ? <IN n="clock" v={plan.base} label="時間基準" u="時間" /> : undefined} onClose={onClose}
      info={view === 'aircraft'
        ? <p>點航班調整，點空白處加班。斜線是飛機停在地面的時間：空檔越少，租金攤得越薄。</p>
        : <p>點航班調整。每個航班每天飛一次。<b className="daymark">+1</b> 隔天抵達（含時差），<b className="daymark">-1</b> 抵達當地日期比出發早一天。</p>}>
      <div className="seg three" role="tablist" aria-label="班表檢視">
        {([['time', '時間', 'clock'], ['airport', '機場', 'base'], ['aircraft', '飛機', 'plane']] as const).map(([v, label, ic]) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}><Icon n={ic} /> {label}</button>
        ))}
      </div>
      {view !== 'aircraft' && (
        <ScheduleLists plan={plan} result={result} view={view} mode={mode} basis={basis} airport={airport}
          onMode={setMode} onBasis={setBasis} onAirport={setAirport} onPickLeg={onPickLeg} />
      )}
      {plan.fleet.length === 0 && <div className="hint center">還沒有飛機。租一架飛機後，就能安排航班。</div>}
      {view === 'aircraft' && <div className="gantt">
        <div className="g-row g-hours">
          <span />
          <div className="g-track plain">{[0, 6, 12, 18].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h}</span>)}<span style={{ right: 0 }}>24</span></div>
        </div>
        {plan.fleet.map((ac) => {
          const info = rotationInfo(ac);
          const bad = !info.closed || !info.fits;
          return (
            <div className="g-row" key={ac.id}>
              <span className="g-who">{ac.reg}<small className={bad ? 'bad' : ''}>{AIRCRAFT[ac.type].name.replace(/^(Airbus|Boeing|Embraer) /, '')} · {bad ? '⚠' : pct(info.utilisation)}</small></span>
              <div className="g-track" onClick={(e) => tapGap(ac, e)} role="button" aria-label={`${ac.reg} 加航班`}>
                {[6, 12, 18].map((h) => <i key={h} className="g-tick" style={{ left: `${(h / 24) * 100}%` }} />)}
                {legSegments(ac, plan.base).map((s, k) => (
                  <button key={k} className={`g-blk${selected?.acId === ac.id && selected.legs.includes(s.i) ? ' sel' : ''}`}
                    style={{ left: `${s.left}%`, width: `${s.width}%`, background: s.color }}
                    onClick={(e) => { e.stopPropagation(); onPickLeg(ac.id, s.i); }} aria-label={`${ac.legs[s.i].from} 到 ${ac.legs[s.i].to}`}>
                    {s.width > 4.5 ? s.label : ''}
                  </button>
                ))}
                <i className="g-now" style={{ left: `${nowPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>}
      {view === 'aircraft' && result && plan.fleet.length > 0 && (
        <div className="ins"><IN n="util" v={pct(result.avgUtilisation)} label="平均利用率" w="利用率" /></div>
      )}
    </Sheet>
  );
}

function ScheduleLists({ plan, result, view, mode, basis, airport, onMode, onBasis, onAirport, onPickLeg }: {
  plan: Plan; result: NetworkResult | null; view: SchedView; mode: 'dep' | 'arr'; basis: ClockBasis; airport: string | null;
  onMode: (m: 'dep' | 'arr') => void; onBasis: (b: ClockBasis) => void; onAirport: (a: string | null) => void; onPickLeg: (acId: string, leg: number) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const served = useMemo(() => [...new Set(plan.fleet.flatMap((ac) => ac.legs.flatMap((l) => [l.from, l.to])))].sort(), [plan]);
  const rowsOf = (r: ReturnType<typeof timeline>[number]) => {
    const mark = dayMark(r.shift);
    const zone = basis === 'local' && r.zone !== 0 ? <IN n="clock" v={`${r.zone > 0 ? '+' : ''}${r.zone}h`} label="時差" w="時差" /> : null;
    const fr = result?.byFlight[`${r.ac.id}#${r.index}`];
    return (
      <li key={`${r.ac.id}-${r.index}-${r.at}`} className="tap" onClick={() => onPickLeg(r.ac.id, r.index)}>
        <span className="t">{hhmm(r.time)}{mode === 'arr' && mark && <sup className="daymark" title="出發在前一天">{mark}</sup>}</span>
        <span className="name">
          {r.from} → {r.to}
          <small>
            {mode === 'dep'
              ? <span className="in" title="抵達"><Icon n="down" />{hhmm(r.other)}{mark && <sup className="daymark" title={r.shift > 0 ? '隔天抵達' : '前一天抵達'}>{mark}</sup>}</span>
              : <span className="in" title={`出發${r.shift > 0 ? '（前一天）' : r.shift < 0 ? '（後一天）' : ''}`}><Icon n="up" />{hhmm(r.other)}{r.shift !== 0 ? <sup className="daymark">{r.shift > 0 ? '-1' : '+1'}</sup> : null}</span>}
            {' '}<span className="ins inline"><IN n="plane" v={dur(r.durMin)} label="飛行" w="飛" />{zone}<span>{r.ac.reg}</span></span>
            {fr && <><br /><LoadIcons f={fr} /></>}
          </small>
        </span>
        {fr && <LoadPill f={fr} />}
        <span className="chev">›</span>
      </li>
    );
  };
  const list = view === 'time' ? timeline(plan, { mode, basis, airport: airport ?? undefined }) : null;
  const groups = view === 'airport' ? byAirport(plan, { mode, basis, order: 'busy' }).filter((g) => !airport || g.code === airport) : null;
  return (
    <>
      <div className="viewopts">
        <div className="seg two" aria-label="出發或抵達">
          <button className={mode === 'dep' ? 'on' : ''} onClick={() => onMode('dep')}><Icon n="up" /> 出發</button>
          <button className={mode === 'arr' ? 'on' : ''} onClick={() => onMode('arr')}><Icon n="down" /> 抵達</button>
        </div>
        <div className="seg two" aria-label="時間基準">
          <button className={basis === 'local' ? 'on' : ''} onClick={() => onBasis('local')}>當地</button>
          <button className={basis === 'base' ? 'on' : ''} onClick={() => onBasis('base')}>基地</button>
        </div>
      </div>
      {served.length > 1 && (
        <div className="chips scroll" aria-label="機場篩選">
          <button className={`chip${airport === null ? ' strong' : ''}`} onClick={() => onAirport(null)}>全部</button>
          {served.map((c) => <button key={c} className={`chip${airport === c ? ' strong' : ''}`} onClick={() => onAirport(airport === c ? null : c)}>{c}</button>)}
        </div>
      )}
      {list && (list.length === 0 ? <div className="hint center">沒有符合的航班</div> : <ul className="timetable">{list.map(rowsOf)}</ul>)}
      {groups && (groups.length === 0 ? <div className="hint center">沒有符合的航班</div> : groups.map((g) => (
        <div key={g.code} className="group">
          <button className="group-head" onClick={() => setCollapsed({ ...collapsed, [g.code]: !collapsed[g.code] })} aria-expanded={!collapsed[g.code]}>
            <span className="grow">{AIRPORT_BY_CODE[g.code].name} {g.code}{basis === 'local' && g.code !== plan.base && <small className="tz" title={`比${plan.base}${zoneDiffHours(plan.base, g.code) >= 0 ? '快' : '慢'}`}> <Icon n="clock" />{zoneDiffHours(plan.base, g.code) >= 0 ? '+' : ''}{zoneDiffHours(plan.base, g.code)}h</small>}</span>
            <small><IN n={mode === 'dep' ? 'up' : 'down'} v={`${g.rows.length}/日`} label={mode === 'dep' ? '出發班次/日' : '抵達班次/日'} w={mode === 'dep' ? '出發' : '抵達'} /></small>
            <span className="chev">{collapsed[g.code] ? '▸' : '▾'}</span>
          </button>
          {!collapsed[g.code] && <ul className="timetable">{g.rows.map(rowsOf)}</ul>}
        </div>
      )))}
    </>
  );
}

// ---------- Fleet ----------

export function FleetPanel({ plan, result, onPick, onLease, onClose }: {
  plan: Plan; result: NetworkResult | null; onPick: (id: string) => void; onLease: () => void; onClose: () => void;
}) {
  const avg = plan.fleet.length ? plan.fleet.reduce((s, a) => s + rotationInfo(a).utilisation, 0) / plan.fleet.length : 0;
  return (
    <Sheet size="full" title={`機隊 · ${plan.fleet.length}`} sub={<span className="ins"><IN n="util" v={pct(avg)} label="平均利用率" w="利用率" /><IN n="lease" v={`${money(plan.fleet.reduce((s, a) => s + AIRCRAFT[a.type].ownershipPerWeek, 0))}/週`} label="租金" w="租金" /></span>}
      info={plan.fleet.length > 0 && <p>損益是每週，含租金。色條是飛機的一天（{AIRPORT_BY_CODE[plan.base].name}時間），每個色塊是一個航班。</p>}
      onClose={onClose} action={<button className="primary small" onClick={onLease}>租飛機</button>}>
      {plan.fleet.length === 0 && <div className="hint center">還沒有飛機</div>}
      <ul className="fleet">
        {plan.fleet.map((ac) => {
          const info = rotationInfo(ac);
          const r = result?.aircraft[ac.id];
          const p = r ? r.revenue - r.flyingCost - r.ownershipCost : 0;
          const warn = !ac.legs.length ? '沒有航班' : !info.closed ? '沒回到起點' : !info.fits ? `超過 ${info.cycleDays * 24} 小時` : info.utilisation < 0.3 ? '閒置太久' : '';
          return (
            <li key={ac.id} role="button" tabIndex={0} onClick={() => onPick(ac.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(ac.id); } }}>
              <div className="fleet-top">
                <Ring value={info.utilisation} tone={info.utilisation >= 0.45 ? 'good' : info.utilisation >= 0.3 ? 'warn' : 'bad'} size={34} stroke={4} label={`利用率 ${pct(info.utilisation)}`}>
                  <small>{Math.round(info.utilisation * 100)}</small>
                </Ring>
                <span className="name">{ac.reg} · {shortType(ac.type)}<span className="ins"><IN n="clock" v={`${(info.blockMin / 60).toFixed(1)}h/日`} label="每日飛行" w="飛" />{warn && <Badge n="warn" tone="warn">{warn}</Badge>}</span></span>
                {r && <span className={`pill ${p >= 0 ? 'good' : 'bad'}`} title="每週損益，含租金">{p >= 0 ? '+' : ''}{money(p)}<small>／週</small></span>}
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

// ---------- Lease ----------

/** Rough cost per seat-km on a 1,000 km flight, NT$. */
const seatKmCost = (t: AircraftModel) => {
  const s = AIRCRAFT[t];
  return (s.costPerBlockHour * (1000 / s.speedKmh + 0.5) + s.costPerDeparture) / (s.seats * 1000);
};

export function LeaseSheet({ plan, onLease, onClose }: { plan: Plan; onLease: (type: AircraftModel, to: string | null) => void; onClose: () => void }) {
  const routes = routePairs(plan);
  const base = AIRPORT_BY_CODE[plan.base];
  const fitsBase = (t: AircraftModel) => classRank(AIRCRAFT[t].cls) <= classRank(base.maxClass);
  const [pick, setPick] = useState<AircraftModel>(() => MODEL_ORDER.find((t) => t === 'A20N' && fitsBase(t)) ?? MODEL_ORDER.find(fitsBase)!);
  const dests = topMarketsFrom(plan.base, plan, 40).filter((m) => !routeProblem(plan.base, m.to, pick)).slice(0, 8);
  const flyable = (t: AircraftModel) => routes.filter((r) => !routeProblem(r.a, r.b, t)).length;
  return (
    <Sheet over size="full" title="租飛機" sub={<IN n="base" v={base.name} label="停在" w="停在" />} onClose={onClose}
      info={<p>每座公里：1,000 公里航班的飛行成本除以座位，不含租金，越低越省。灰色機型無法在{base.name}起降。</p>}
      footer={<div className="lease-foot">
        <div className="label">租 {shortType(pick)} 並每日飛往</div>
        <div className="chips scroll">
          {dests.map((m) => (
            <button key={m.to} className="chip" onClick={() => onLease(pick, m.to)}>
              {AIRPORT_BY_CODE[m.to].name}{m.served ? '（加班）' : ''}<small> {count(m.airDemand)} 人/週</small>
            </button>
          ))}
        </div>
        <button className="ghost" onClick={() => onLease(pick, null)}>只租，稍後排班</button>
      </div>}>
      <div className="cmp-wrap">
        <table className="cmp">
          <thead><tr><th>機型</th><th>座位</th><th>航程</th><th>租金/週</th><th>每座公里</th>{routes.length > 0 && <th>可飛</th>}</tr></thead>
          <tbody>
            {MODEL_ORDER.map((t) => {
              const s = AIRCRAFT[t];
              const ok = fitsBase(t);
              return (
                <tr key={t} className={`${pick === t ? 'pick' : ''}${ok ? '' : ' dim'}`} onClick={() => ok && setPick(t)}>
                  <td><b>{shortType(t)}</b></td>
                  <td>{s.seats}</td>
                  <td>{count(s.rangeKm)}</td>
                  <td>{money(s.ownershipPerWeek)}</td>
                  <td>{seatKmCost(t).toFixed(2)}</td>
                  {routes.length > 0 && <td>{flyable(t)}/{routes.length}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Sheet>
  );
}

// ---------- Time stepper ----------

export function TimeStepper({ code, dep, lo, hi, onChange }: { code: string; dep: number; lo: number; hi: number; onChange: (dep: number) => void }) {
  const set = (d: number) => onChange(Math.max(lo, Math.min(hi, dep + d)));
  const steps = [-60, -15, 15, 60];
  return (
    <div className="timepick">
      {steps.slice(0, 2).map((d) => <button key={d} onClick={() => set(d)} disabled={dep + d < lo && dep <= lo}>{d}</button>)}
      <output>{at(code, dep)}</output>
      {steps.slice(2).map((d) => <button key={d} onClick={() => set(d)} disabled={dep + d > hi && dep >= hi}>+{d}</button>)}
    </div>
  );
}

const windowText = (code: string, lo: number, hi: number) =>
  hi - lo >= DAY - 5 ? '全天可飛' : lo === hi ? '沒有空檔可移動' : `可 ${at(code, lo)}–${at(code, hi)} 出發`;

// ---------- Edit one flight ----------

export function FlightEditor({ plan, result, acId, leg, onChange, onMove, onClose }: {
  plan: Plan; result?: NetworkResult | null; acId: string; leg: number; onChange: (plan: Plan, msg?: string) => void; onMove: (acId: string, unit: Unit) => void; onClose: () => void;
}) {
  const [draftDep, setDraftDep] = useState<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const ac = plan.fleet.find((x) => x.id === acId);
  const previewPlan = useMemo(() => {
    if (!ac || !ac.legs[leg] || draftDep === null) return plan;
    const unit = unitOf(ac, leg);
    const delta = draftDep - ac.legs[unit.start].dep;
    return delta ? withAc(plan, shiftUnit(ac, unit, delta)) : plan;
  }, [plan, ac, leg, draftDep]);
  const previewResult = useMemo(() => previewPlan === plan ? result : simulate(previewPlan), [previewPlan, plan, result]);
  if (!ac || !ac.legs[leg]) return null;
  const u = unitOf(ac, leg);
  const first = ac.legs[u.start];
  const last = u.start + u.count - 1;
  const w = shiftWindow(ac, u);
  const isTrip = u.count === 2;
  const dep = draftDep ?? first.dep;
  const delta = dep - first.dep;
  return (
    <Sheet over title={isTrip ? `${first.from} ⇄ ${first.to}` : `${first.from} → ${first.to}`} sub={<span className="ins"><span>{ac.reg} · {shortType(ac.type)}</span><IN n="clock" v={dur(blockMinutes(first.from, first.to, ac.type))} label="單程" w="單程" /></span>} onClose={onClose}>
      <ul className="timetable">
        {Array.from({ length: u.count }, (_, k) => u.start + k).map((i) => (
          <li key={i}>
            <span className="t">{at(ac.legs[i].from, ac.legs[i].dep + delta)}</span>
            <span className="name">{AIRPORT_BY_CODE[ac.legs[i].from].name} → {AIRPORT_BY_CODE[ac.legs[i].to].name}<small><IN n="down" v={at(ac.legs[i].to, arrival(ac, i) + delta)} label="抵達" w="抵達" /></small>
              {previewResult?.byFlight[`${ac.id}#${i}`] && <small><LoadIcons f={previewResult.byFlight[`${ac.id}#${i}`]} /></small>}</span>
            {previewResult?.byFlight[`${ac.id}#${i}`] && <LoadPill f={previewResult.byFlight[`${ac.id}#${i}`]} />}
          </li>
        ))}
      </ul>
      <div>
        <div className="label">{isTrip ? '去程出發（回程跟著移）' : '出發時間'} · {first.from} 當地時間</div>
        <TimeStepper code={first.from} dep={dep} lo={first.dep + w.min} hi={first.dep + w.max} onChange={setDraftDep} />
        <div className="hint">{windowText(first.from, first.dep + w.min, first.dep + w.max)}</div>
      </div>
      {delta !== 0 && <button className="primary" onClick={() => { onChange(withAc(plan, shiftUnit(ac, u, delta)), '已儲存航班時間'); onClose(); }}>儲存時間變更</button>}
      <div className="row">
        {isTrip && <button className="secondary grow" disabled={delta !== 0} onClick={() => onMove(ac.id, u)}><Icon n="plane" /> 換飛機</button>}
        <button className="danger grow" onClick={() => setConfirmCancel(true)}>✕ {isTrip ? '取消來回航班' : '取消航班'}</button>
      </div>
      {delta !== 0 && isTrip && <div className="hint">請先儲存時間，或關閉以放棄變更，再換飛機。</div>}
      {confirmCancel && <div className="confirm"><span>確定取消{isTrip ? '這組來回航班' : '這班航班'}？</span><button onClick={() => setConfirmCancel(false)}>返回</button><button onClick={() => { onChange(withAc(plan, removeUnit(ac, u)), `已取消 ${at(first.from, first.dep)} ${first.from}→${first.to}${isTrip ? ' 與回程' : ''}`); onClose(); }}>確定取消</button></div>}
      {last < ac.legs.length - 1 && !isTrip && <div className="hint warn"><Icon n="warn" /> 飛機可能停在別的機場</div>}
    </Sheet>
  );
}

// ---------- Add a round trip on a route, or move one to another aircraft ----------

export function AddFlightSheet({ plan, routeKey, move, prefer, onDone, onClose }: {
  plan: Plan; routeKey: string; move?: { acId: string; unit: Unit }; prefer?: { from: string; dep: number; acId?: string; gap?: number };
  onDone: (plan: Plan, msg: string, acId: string) => void; onClose: () => void;
}) {
  const [a, b] = routeKey.split('-');
  const src = move ? plan.fleet.find((x) => x.id === move.acId) : undefined;
  const srcLeg = src && move ? src.legs[move.unit.start] : undefined;
  const opts = useMemo(() => {
    const pool = move ? { ...plan, fleet: plan.fleet.filter((x) => x.id !== move.acId) } : plan;
    const choices = placementOptions(pool, a, b, srcLeg?.dep ?? prefer?.dep);
    if (prefer?.acId && prefer.gap !== undefined) {
      const option = choices.find((o) => o.ac.id === prefer.acId);
      const to = prefer.from === a ? b : a;
      const w = option && insertWindow(option.ac, prefer.gap, prefer.from, to);
      if (option && w) option.placement = { acId: option.ac.id, k: prefer.gap, from: prefer.from, to, dep: pickTime(w, prefer.dep), ...w };
    }
    return choices;
  }, [plan, a, b, move, srcLeg?.dep, prefer]);
  const types = typesFor(plan, a, b);
  const firstOk = opts.findIndex((o) => o.placement);
  const preferred = opts.findIndex((o) => o.ac.id === prefer?.acId && o.placement);
  const [choice, setChoice] = useState<number | 'lease'>(preferred >= 0 ? preferred : firstOk >= 0 ? firstOk : 'lease');
  const [leaseType, setLeaseType] = useState<AircraftModel | undefined>(types[0]);
  const chosen: Placement | null = choice === 'lease' ? null : opts[choice]?.placement ?? null;
  const [dep, setDep] = useState<number | null>(null);
  const leaseFrom = b === plan.base ? b : a;
  // A suggested departure is for the leg that leaves `prefer.from`; a new aircraft starting at the other end leaves earlier.
  const leaseDepFor = (t: AircraftModel | undefined) => {
    if (!prefer) return utcFromLocal(leaseFrom, 7 * 60);
    if (leaseFrom === prefer.from || !t) return prefer.dep;
    return Math.floor((prefer.dep - blockMinutes(a, b, t) - AIRCRAFT[t].turnMin) / 5) * 5;
  };
  const defaultLeaseDep = srcLeg ? srcLeg.dep : leaseDepFor(leaseType);
  const cur = chosen ? Math.max(chosen.lo, Math.min(chosen.hi, dep ?? chosen.dep)) : dep ?? defaultLeaseDep;
  const slot = move ? null : slotProblem(plan, a, b);
  const from = chosen ? chosen.from : srcLeg?.from ?? leaseFrom;
  const to = from === a ? b : a;

  const confirm = () => {
    let base = plan;
    if (move && src) base = withAc(plan, removeUnit(src, move.unit));
    if (chosen) {
      const ac = base.fleet.find((x) => x.id === chosen.acId)!;
      const next = withAc(base, insertRoundTrip(ac, chosen.k, chosen.from, chosen.to, cur));
      onDone(next, `${move ? '已換到' : '已排入'} ${ac.reg}：${at(chosen.from, cur)} ${chosen.from}→${chosen.to} 與回程`, ac.id);
    } else if (leaseType) {
      const r = leaseFor(base, a, b, leaseType, cur);
      const reg = r.plan.fleet.find((x) => x.id === r.aircraftId)!.reg;
      onDone(r.plan, `租了新飛機 ${reg}（${AIRCRAFT[leaseType].name}），${at(from, cur)} 出發`, r.aircraftId);
    }
  };

  return (
    <Sheet over size="full" title={move ? '換到別架飛機' : '加一班來回'} sub={<span className="ins"><span>{routeName(a, b)}</span><IN n="clock" v={dur(blockMinutes(a, b, leaseType ?? 'A20N'))} label="單程" w="單程" /></span>} onClose={onClose}
      info={<p>早上 7–10 點與傍晚 4–8 點的航班最好賣。</p>}
      footer={<button className="primary grow" onClick={confirm} disabled={!!slot || (!chosen && !leaseType)}>
        {slot ?? `${move ? '換到' : '加開'} ${at(from, cur)} ${from}→${to} 與回程`}
      </button>}>
      <h4>飛機</h4>
      <div className="options">
        {opts.map((o, i) => (
          <button key={o.ac.id} className={`opt${choice === i ? ' pick' : ''}`} disabled={!o.placement} onClick={() => { setChoice(i); setDep(null); }}>
            <b>{o.ac.reg} · {shortType(o.ac.type)}</b>
            {o.placement
              ? <span className="ins"><IN n="up" v={`${at(o.placement.from, o.placement.dep)} ${o.placement.from}`} label="出發" w="出發" /><IN n="util" v={`${pct(o.utilBefore)}→${pct(o.utilAfter)}`} label="利用率" w="利用率" /></span>
              : <small>{o.reason}</small>}
          </button>
        ))}
        <button className={`opt${choice === 'lease' ? ' pick' : ''}`} onClick={() => { setChoice('lease'); setDep(null); }} disabled={!types.length}>
          <b><Icon n="lease" /> 租新飛機</b>
          {leaseType ? <span className="ins"><span>{shortType(leaseType)}</span><IN n="lease" v={`${money(AIRCRAFT[leaseType].ownershipPerWeek)}/週`} label="租金" w="租金" /></span> : <small>沒有機型能飛</small>}
        </button>
      </div>
      {choice === 'lease' && (
        <div className="chips">
          {types.map((t) => <button key={t} className={`chip${leaseType === t ? ' strong' : ''}`} onClick={() => setLeaseType(t)}>{shortType(t)} <Icon n="seat" />{AIRCRAFT[t].seats}</button>)}
        </div>
      )}
      <div>
        <div className="label">{from} 出發（當地時間）</div>
        <TimeStepper code={from} dep={cur} lo={chosen ? chosen.lo : -Infinity} hi={chosen ? chosen.hi : Infinity} onChange={setDep} />
        <div className="hint">{chosen ? windowText(from, chosen.lo, chosen.hi) : '全天可飛'}</div>
        {prefer && !prefer.acId && <div className="hint">建議 {prefer.from} {at(prefer.from, prefer.dep)} 出發，接得上轉機</div>}
        <div className="hint">{choice === 'lease' ? '租用新飛機' : `使用 ${opts[choice]?.ac.reg}`} · {from} → {to} → {from} · {from} 當地時間 {at(from, cur)} 出發</div>
      </div>
    </Sheet>
  );
}

// ---------- Add a round trip in a gap of one aircraft's day ----------

export function GapSheet({ plan, acId, t, onChoose, onClose }: {
  plan: Plan; acId: string; t: number; onChoose: (key: string, prefer: { from: string; dep: number; acId: string; gap: number }) => void; onClose: () => void;
}) {
  const ac = plan.fleet.find((x) => x.id === acId);
  if (!ac) return null;
  const k = gapAt(ac, t);
  const station = ac.legs.length ? (k > 0 ? ac.legs[k - 1].to : ac.legs[0].from) : plan.base;
  const served = new Set(routePairs(plan).map((r) => r.key));
  const options = topMarketsFrom(station, plan, 60)
    .filter((m) => !routeProblem(station, m.to, ac.type))
    .map((m) => {
      const w = insertWindow(ac, k, station, m.to);
      return { ...m, w, dep: w ? pickTime(w, t) : 0, slot: slotProblem(plan, station, m.to) };
    })
    .filter((m) => m.w && !m.slot)
    .sort((x, y) => Number(served.has(pairKey(station, y.to))) - Number(served.has(pairKey(station, x.to))) || y.airDemand - x.airDemand)
    .slice(0, 10);
  return (
    <Sheet over title={`${ac.reg} 加一班來回`} sub={<IN n="up" v={`${station} ~${at(station, pickTime({ lo: -Infinity, hi: Infinity }, t))}`} label="出發" w="出發" />} onClose={onClose}>
      {options.length === 0 && <div className="hint center">這個空檔放不下來回航班</div>}
      <ul className="markets">
        {options.map((m) => (
          <li key={m.to}>
            <span className="name">{AIRPORT_BY_CODE[m.to].name}<span className="ins"><IN n="clock" v={`${at(station, m.dep)}–${at(station, m.dep + blockMinutes(station, m.to, ac.type) * 2 + AIRCRAFT[ac.type].turnMin)}`} label="出發–回到" /><IN n="pax" v={count(m.airDemand)} label="旅客/週" u="人/週" />{served.has(pairKey(station, m.to)) && <Badge n="check" tone="good" label="已開航" />}</span></span>
            <button onClick={() => onChoose(pairKey(station, m.to), { from: station, dep: m.dep, acId, gap: k })}>選擇</button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export { UtilBar };
