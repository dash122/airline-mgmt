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
  blockMinutes, DAY, hhmm, routePairs, routeProblem, rotationInfo, topMarketsFrom, utcFromLocal,
  type Aircraft, type NetworkResult, type Plan,
} from '../sim/simulate';
import { count, money, pct } from './format';
import { arrival, at, DayBar, dayStart, legSegments, routeColor, routeName, Sheet, tone, UtilBar } from './sheets';

const withAc = (plan: Plan, ac: Aircraft): Plan => ({ ...plan, fleet: plan.fleet.map((x) => (x.id === ac.id ? ac : x)) });
const dur = (min: number) => `${Math.floor(min / 60)} 小時${min % 60 ? ` ${min % 60} 分` : ''}`;

// ---------- Routes ----------

export function RoutesPanel({ plan, result, onOpen, onAdd, onRemoveOne, onClose }: {
  plan: Plan; result: NetworkResult | null; onOpen: (key: string) => void; onAdd: (key: string) => void; onRemoveOne: (key: string) => void; onClose: () => void;
}) {
  const rows = routePairs(plan)
    .map((r) => ({ ...r, res: result?.routes[r.key], types: [...new Set(plan.fleet.filter((ac) => ac.legs.some((l) => pairKey(l.from, l.to) === r.key)).map((ac) => AIRCRAFT[ac.type].name))] }))
    .sort((x, y) => (y.res ? y.res.revenue - y.res.flyingCost : 0) - (x.res ? x.res.revenue - x.res.flyingCost : 0));
  const daily = rows.reduce((s, r) => s + r.flightsPerDay, 0) / 2;
  return (
    <Sheet size="full" title={`航線 · ${rows.length} 條`} sub={`每日 ${daily} 班來回 · 損益為每週航段損益（不含租金）`} onClose={onClose}>
      {rows.length === 0 && <div className="hint center">在地圖上從一個機場拖到另一個機場，即可開新航線。</div>}
      <ul className="routes">
        {rows.map((r) => {
          const p = r.res ? r.res.revenue - r.res.flyingCost : 0;
          return (
            <li key={r.key}>
              <button className="name" onClick={() => onOpen(r.key)}>
                <span className="swatch" style={{ background: routeColor(r.key) }} />
                <span className="grow">{routeName(r.a, r.b)}<small>{r.types.join('、')}{r.res ? ` · 載客率 ${pct(r.res.loadFactor)}` : ''}</small></span>
              </button>
              {r.res && <span className={`pill ${p < 0 ? 'bad' : tone(r.res.loadFactor) === 'bad' ? 'warn' : 'good'}`}>{p >= 0 ? '+' : ''}{money(p)}</span>}
              <span className="step">
                <button onClick={() => onRemoveOne(r.key)} aria-label="減一班來回">−</button>
                <output>{r.flightsPerDay / 2}</output>
                <button onClick={() => onAdd(r.key)} aria-label="加一班來回">＋</button>
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > 0 && <div className="hint">＋ 會讓你選擇由哪架飛機、幾點飛。在地圖上從機場拖到另一個機場可以開新航線。</div>}
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
    <Sheet size="full" title="班表" sub={view === 'aircraft' ? `${AIRPORT_BY_CODE[plan.base].name}時間 · 點航班可調整，點空白處可加班` : '點航班可調整'} onClose={onClose}>
      <div className="seg three" role="tablist" aria-label="班表檢視">
        {([['time', '時間順序'], ['airport', '按機場'], ['aircraft', '按飛機']] as [SchedView, string][]).map(([v, label]) => (
          <button key={v} role="tab" className={view === v ? 'on' : ''} onClick={() => setView(v)}>{label}</button>
        ))}
      </div>
      {view !== 'aircraft' && (
        <ScheduleLists plan={plan} view={view} mode={mode} basis={basis} airport={airport}
          onMode={setMode} onBasis={setBasis} onAirport={setAirport} onPickLeg={onPickLeg} />
      )}
      {plan.fleet.length === 0 && <div className="hint center">還沒有飛機。在地圖上拖曳開航，或到「機隊」租飛機。</div>}
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
        <div className="hint">平均利用率 {pct(result.avgUtilisation)}。斜線是飛機停在地面的時間；把空檔填滿，租金就攤得更薄。</div>
      )}
    </Sheet>
  );
}

function ScheduleLists({ plan, view, mode, basis, airport, onMode, onBasis, onAirport, onPickLeg }: {
  plan: Plan; view: SchedView; mode: 'dep' | 'arr'; basis: ClockBasis; airport: string | null;
  onMode: (m: 'dep' | 'arr') => void; onBasis: (b: ClockBasis) => void; onAirport: (a: string | null) => void; onPickLeg: (acId: string, leg: number) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const served = useMemo(() => [...new Set(plan.fleet.flatMap((ac) => ac.legs.flatMap((l) => [l.from, l.to])))].sort(), [plan]);
  const rowsOf = (r: ReturnType<typeof timeline>[number]) => {
    const mark = dayMark(r.shift);
    const zone = basis === 'local' && r.zone !== 0 ? ` · 時差 ${r.zone > 0 ? '+' : ''}${r.zone} 小時` : '';
    const flying = `飛行 ${dur(r.durMin)}`;
    return (
      <li key={`${r.ac.id}-${r.index}-${r.at}`} className="tap" onClick={() => onPickLeg(r.ac.id, r.index)}>
        <span className="t">{hhmm(r.time)}{mode === 'arr' && mark && <sup className="daymark" title="出發在前一天">{mark}</sup>}</span>
        <span className="name">
          {r.from} → {r.to}
          <small>
            {mode === 'dep'
              ? <>抵達 {hhmm(r.other)}{mark && <sup className="daymark" title={r.shift > 0 ? '隔天抵達' : '前一天抵達'}>{mark}</sup>}</>
              : <>{hhmm(r.other)} 出發{r.shift > 0 ? '（前一天）' : r.shift < 0 ? '（後一天）' : ''}</>}
            {` · ${flying}${zone} · ${r.ac.reg} · ${AIRCRAFT[r.ac.type].name}`}
          </small>
        </span>
        <span className="chev">調整 ›</span>
      </li>
    );
  };
  const basisHint = basis === 'base' ? `${AIRPORT_BY_CODE[plan.base].name}時間` : '各機場當地時間';
  const list = view === 'time' ? timeline(plan, { mode, basis, airport: airport ?? undefined }) : null;
  const groups = view === 'airport' ? byAirport(plan, { mode, basis, order: 'busy' }).filter((g) => !airport || g.code === airport) : null;
  return (
    <>
      <div className="viewopts">
        <div className="seg two" aria-label="出發或抵達">
          <button className={mode === 'dep' ? 'on' : ''} onClick={() => onMode('dep')}>出發</button>
          <button className={mode === 'arr' ? 'on' : ''} onClick={() => onMode('arr')}>抵達</button>
        </div>
        <div className="seg two" aria-label="時間基準">
          <button className={basis === 'local' ? 'on' : ''} onClick={() => onBasis('local')}>當地時間</button>
          <button className={basis === 'base' ? 'on' : ''} onClick={() => onBasis('base')}>基地時間</button>
        </div>
      </div>
      {served.length > 1 && (
        <div className="chips scroll" aria-label="機場篩選">
          <button className={`chip${airport === null ? ' strong' : ''}`} onClick={() => onAirport(null)}>全部</button>
          {served.map((c) => <button key={c} className={`chip${airport === c ? ' strong' : ''}`} onClick={() => onAirport(airport === c ? null : c)}>{c}</button>)}
        </div>
      )}
      <div className="hint">{basisHint} · 每個航班每天飛一次，每週 7 天。<b className="daymark">+1</b> 表示隔天抵達（含時差），<b className="daymark">-1</b> 表示抵達當地日期比出發早一天。</div>
      {list && (list.length === 0 ? <div className="hint center">沒有符合的航班。</div> : <ul className="timetable">{list.map(rowsOf)}</ul>)}
      {groups && (groups.length === 0 ? <div className="hint center">沒有符合的航班。</div> : groups.map((g) => (
        <div key={g.code} className="group">
          <button className="group-head" onClick={() => setCollapsed({ ...collapsed, [g.code]: !collapsed[g.code] })} aria-expanded={!collapsed[g.code]}>
            <span className="grow">{AIRPORT_BY_CODE[g.code].name} {g.code}{basis === 'local' && g.code !== plan.base && <small className="tz"> · 比{plan.base}{zoneDiffHours(plan.base, g.code) >= 0 ? '快' : '慢'} {Math.abs(zoneDiffHours(plan.base, g.code))} 小時</small>}</span>
            <small>{mode === 'dep' ? '出發' : '抵達'} {g.rows.length} 班/日</small>
            <span className="chev">{collapsed[g.code] ? '展開' : '收合'}</span>
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
    <Sheet size="full" title={`機隊 · ${plan.fleet.length} 架`} sub={`平均利用率 ${pct(avg)} · 每週租金 ${money(plan.fleet.reduce((s, a) => s + AIRCRAFT[a.type].ownershipPerWeek, 0))}`}
      onClose={onClose} action={<button className="primary small" onClick={onLease}>租飛機</button>}>
      {plan.fleet.length === 0 && <div className="hint center">還沒有飛機。按「租飛機」比較機型。</div>}
      <ul className="fleet">
        {plan.fleet.map((ac) => {
          const info = rotationInfo(ac);
          const r = result?.aircraft[ac.id];
          const p = r ? r.revenue - r.flyingCost - r.ownershipCost : 0;
          const warn = !ac.legs.length ? '沒有航班' : !info.closed ? '沒回到起點' : !info.fits ? '超過 24 小時' : info.utilisation < 0.3 ? '閒置太久' : '';
          return (
            <li key={ac.id} onClick={() => onPick(ac.id)}>
              <div className="fleet-top">
                <span className="name">{ac.reg} · {AIRCRAFT[ac.type].name}<small>{ac.legs.length} 航段 · 每日 {(info.blockMin / 60).toFixed(1)} 小時 · 利用率 {pct(info.utilisation)}{warn && <b className="warn-text"> · {warn}</b>}</small></span>
                {r && <span className={`pill ${p >= 0 ? 'good' : 'bad'}`}>{p >= 0 ? '+' : ''}{money(p)}</span>}
              </div>
              <DayBar ac={ac} base={plan.base} compact />
            </li>
          );
        })}
      </ul>
      {plan.fleet.length > 0 && <div className="hint">損益為每週，含租金。每條色塊是一天中的一個航班（{AIRPORT_BY_CODE[plan.base].name}時間）。</div>}
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
    <Sheet over size="full" title="租飛機" sub={`新飛機停在${base.name}`} onClose={onClose}
      footer={<div className="lease-foot">
        <div className="label">租 {AIRCRAFT[pick].name}，並開每日來回：</div>
        <div className="chips scroll">
          {dests.map((m) => (
            <button key={m.to} className="chip" onClick={() => onLease(pick, m.to)}>
              {AIRPORT_BY_CODE[m.to].name}{m.served ? '（加班）' : ''}<small> {count(m.airDemand)}/週</small>
            </button>
          ))}
        </div>
        <button className="ghost" onClick={() => onLease(pick, null)}>只租，稍後在班表排班</button>
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
                  <td><b>{s.name}</b></td>
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
      <div className="hint">每座公里：1,000 公里航班的飛行成本除以座位，不含租金。灰色機型無法在{base.name}起降。</div>
    </Sheet>
  );
}

// ---------- Time stepper ----------

function TimeStepper({ code, dep, lo, hi, onChange }: { code: string; dep: number; lo: number; hi: number; onChange: (dep: number) => void }) {
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
  hi - lo >= DAY - 5 ? '全天都可以' : lo === hi ? '沒有空檔可移動' : `可在 ${at(code, lo)}–${at(code, hi)} 出發`;

// ---------- Edit one flight ----------

export function FlightEditor({ plan, acId, leg, onChange, onMove, onClose }: {
  plan: Plan; acId: string; leg: number; onChange: (plan: Plan, msg?: string) => void; onMove: (acId: string, unit: Unit) => void; onClose: () => void;
}) {
  const ac = plan.fleet.find((x) => x.id === acId);
  if (!ac || !ac.legs[leg]) return null;
  const u = unitOf(ac, leg);
  const first = ac.legs[u.start];
  const last = u.start + u.count - 1;
  const w = shiftWindow(ac, u);
  const isTrip = u.count === 2;
  return (
    <Sheet over title={isTrip ? `${first.from} ⇄ ${first.to} 來回` : `${first.from} → ${first.to}`} sub={`${ac.reg} · ${AIRCRAFT[ac.type].name} · 單程 ${dur(blockMinutes(first.from, first.to, ac.type))}`} onClose={onClose}>
      <ul className="timetable">
        {Array.from({ length: u.count }, (_, k) => u.start + k).map((i) => (
          <li key={i}>
            <span className="t">{at(ac.legs[i].from, ac.legs[i].dep)}</span>
            <span className="name">{AIRPORT_BY_CODE[ac.legs[i].from].name} → {AIRPORT_BY_CODE[ac.legs[i].to].name}<small>抵達 {at(ac.legs[i].to, arrival(ac, i))}（當地時間）</small></span>
          </li>
        ))}
      </ul>
      <div>
        <div className="label">{isTrip ? '去程出發時間（回程跟著移動）' : '出發時間'}</div>
        <TimeStepper code={first.from} dep={first.dep} lo={first.dep + w.min} hi={first.dep + w.max}
          onChange={(d) => onChange(withAc(plan, shiftUnit(ac, u, d - first.dep)))} />
        <div className="hint">{windowText(first.from, first.dep + w.min, first.dep + w.max)}，不影響這架飛機的其他航班。</div>
      </div>
      <div className="row">
        {isTrip && <button className="secondary grow" onClick={() => onMove(ac.id, u)}>換到別架飛機</button>}
        <button className="danger grow" onClick={() => { onChange(withAc(plan, removeUnit(ac, u)), `已取消 ${at(first.from, first.dep)} ${first.from}→${first.to}${isTrip ? ' 與回程' : ''}`); onClose(); }}>
          {isTrip ? '取消這班來回' : '取消這個航段'}
        </button>
      </div>
      {last < ac.legs.length - 1 && !isTrip && <div className="hint">取消單一航段可能讓飛機停在別的機場。</div>}
    </Sheet>
  );
}

// ---------- Add a round trip on a route, or move one to another aircraft ----------

export function AddFlightSheet({ plan, routeKey, move, onDone, onClose }: {
  plan: Plan; routeKey: string; move?: { acId: string; unit: Unit };
  onDone: (plan: Plan, msg: string, acId: string) => void; onClose: () => void;
}) {
  const [a, b] = routeKey.split('-');
  const src = move ? plan.fleet.find((x) => x.id === move.acId) : undefined;
  const srcLeg = src && move ? src.legs[move.unit.start] : undefined;
  const opts = useMemo(() => {
    const pool = move ? { ...plan, fleet: plan.fleet.filter((x) => x.id !== move.acId) } : plan;
    return placementOptions(pool, a, b, srcLeg?.dep);
  }, [plan, a, b, move, srcLeg?.dep]);
  const types = typesFor(plan, a, b);
  const firstOk = opts.findIndex((o) => o.placement);
  const [choice, setChoice] = useState<number | 'lease'>(firstOk >= 0 ? firstOk : 'lease');
  const [leaseType, setLeaseType] = useState<AircraftModel | undefined>(types[0]);
  const chosen: Placement | null = choice === 'lease' ? null : opts[choice]?.placement ?? null;
  const [dep, setDep] = useState<number | null>(null);
  const leaseFrom = b === plan.base ? b : a;
  const defaultLeaseDep = srcLeg ? srcLeg.dep : utcFromLocal(leaseFrom, 7 * 60);
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
    <Sheet over size="full" title={move ? '換到別架飛機' : '加一班來回'} sub={`${routeName(a, b)} · 單程約 ${dur(blockMinutes(a, b, leaseType ?? 'A20N'))}`} onClose={onClose}
      footer={<button className="primary grow" onClick={confirm} disabled={!!slot || (!chosen && !leaseType)}>
        {slot ?? `${move ? '換到' : '加開'} ${at(from, cur)} ${from}→${to} 與回程`}
      </button>}>
      <h4>選擇飛機</h4>
      <div className="options">
        {opts.map((o, i) => (
          <button key={o.ac.id} className={`opt${choice === i ? ' pick' : ''}`} disabled={!o.placement} onClick={() => { setChoice(i); setDep(null); }}>
            <b>{o.ac.reg} · {AIRCRAFT[o.ac.type].name}</b>
            <small>{o.placement
              ? `${at(o.placement.from, o.placement.dep)} 從${AIRPORT_BY_CODE[o.placement.from].name}出發 · 利用率 ${pct(o.utilBefore)} → ${pct(o.utilAfter)}`
              : o.reason}</small>
          </button>
        ))}
        <button className={`opt${choice === 'lease' ? ' pick' : ''}`} onClick={() => { setChoice('lease'); setDep(null); }} disabled={!types.length}>
          <b>租一架新飛機</b>
          <small>{leaseType ? `${AIRCRAFT[leaseType].name} · 租金 ${money(AIRCRAFT[leaseType].ownershipPerWeek)}/週` : '沒有機型能飛這條航線'}</small>
        </button>
      </div>
      {choice === 'lease' && (
        <div className="chips">
          {types.map((t) => <button key={t} className={`chip${leaseType === t ? ' strong' : ''}`} onClick={() => setLeaseType(t)}>{AIRCRAFT[t].name} · {AIRCRAFT[t].seats} 座</button>)}
        </div>
      )}
      <div>
        <div className="label">從{AIRPORT_BY_CODE[from].name}出發時間（當地）</div>
        <TimeStepper code={from} dep={cur} lo={chosen ? chosen.lo : -Infinity} hi={chosen ? chosen.hi : Infinity} onChange={setDep} />
        <div className="hint">{chosen ? windowText(from, chosen.lo, chosen.hi) : '新飛機全天都可以'}。早上 7–10 點與傍晚 4–8 點的航班最好賣。</div>
      </div>
    </Sheet>
  );
}

// ---------- Add a round trip in a gap of one aircraft's day ----------

export function GapSheet({ plan, acId, t, onDone, onClose }: {
  plan: Plan; acId: string; t: number; onDone: (plan: Plan, msg: string) => void; onClose: () => void;
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
    <Sheet over title={`${ac.reg} 加一班來回`} sub={`從${AIRPORT_BY_CODE[station].name}出發，約 ${at(station, pickTime({ lo: -Infinity, hi: Infinity }, t))}`} onClose={onClose}>
      {options.length === 0 && <div className="hint center">這個空檔放不下來回航班。試試別的時段，或先移動其他航班。</div>}
      <ul className="markets">
        {options.map((m) => (
          <li key={m.to}>
            <span className="name">{AIRPORT_BY_CODE[m.to].name}<small>{at(station, m.dep)} 出發 · 回到 {at(station, m.dep + blockMinutes(station, m.to, ac.type) * 2 + AIRCRAFT[ac.type].turnMin)} · 每週 {count(m.airDemand)} 人{served.has(pairKey(station, m.to)) ? ' · 已開航' : ''}</small></span>
            <button onClick={() => onDone(withAc(plan, insertRoundTrip(ac, k, station, m.to, m.dep)), `${ac.reg} 加開 ${at(station, m.dep)} ${station}→${m.to} 與回程`)}>加入</button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export { UtilBar };
