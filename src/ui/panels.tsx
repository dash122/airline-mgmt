import { CodeshareHub } from './codeshare';
import type { DayRecord } from './clock';
import { ScheduleBoard, shiftText } from './ScheduleBoard';
import { useMemo, useState } from 'react';
import { AIRCRAFT, MODEL_ORDER, type AircraftModel } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { pairKey } from '../sim/markets';
import { byAirport, dayMark, timeline, zoneDiffHours, type ClockBasis } from '../sim/airports';
import { shiftUnit } from '../sim/schedule';
import { hhmm, routePairs, routeProblem, rotationInfo, runwayFits, topMarketsFrom, type Aircraft, type NetworkResult, type Plan } from '../sim/simulate';
import { count, money, pct } from './format';
import { at, DayBar, PullDown, routeColor, Sheet, shortType, UtilBar } from './sheets';
import { LoadPill } from './FlightLoads';
import { healthRank, RouteRow, routeHealth } from './route-health';
import { Badge, hm, IN, Icon, Kpi, Meter } from './viz';

const withAc = (plan: Plan, ac: Aircraft): Plan => ({ ...plan, fleet: plan.fleet.map((x) => (x.id === ac.id ? ac : x)) });
const dur = hm;

// ---------- Routes ----------

type RouteSort = 'need' | 'profit' | 'load' | 'share';
const SORTS = [['need', '要處理先'], ['profit', '損益'], ['load', '載客率'], ['share', '市占']] as const;
export type RoutesView = 'own' | 'share';

export function RoutesPanel({ plan, result, history, view, onView, onOpen, onNew, onAdd, onRemoveOne, onOpenCodeshare, onShare, onPartners, onOpenHosted, onHost, onClose }: {
  plan: Plan; result: NetworkResult | null; history: DayRecord[]; view: RoutesView; onView: (v: RoutesView) => void;
  onOpen: (key: string) => void; onNew: () => void; onAdd: (key: string) => void; onRemoveOne: (key: string) => void;
  onOpenCodeshare: (airline: string, key: string) => void; onShare: (airline: string, key: string) => void; onPartners: () => void;
  onOpenHosted: (key: string, airline?: string) => void; onHost: (airline: string, key: string) => void; onClose: () => void;
}) {
  const [sort, setSort] = useState<RouteSort>('need');
  const shared = (plan.codeshares?.length ?? 0) + (plan.hosted?.length ?? 0);
  const pairs = routePairs(plan);
  // Which end a route hangs from: the hub, then the base, then whichever end has more of your routes.
  const degree = new Map<string, number>();
  for (const r of pairs) for (const c of [r.a, r.b]) degree.set(c, (degree.get(c) ?? 0) + 1);
  const homeOf = (a: string, b: string) => {
    for (const h of [plan.hub, plan.base]) if (h === a || h === b) return h;
    return (degree.get(a) ?? 0) >= (degree.get(b) ?? 0) ? a : b;
  };
  const rows = pairs.map((r) => {
    const res = result?.routes[r.key];
    const figures = res ? { loadFactor: res.loadFactor, spill: res.spill, profit: res.revenue - res.flyingCost } : null;
    const types = [...new Set(plan.fleet.filter((ac) => ac.legs.some((l) => pairKey(l.from, l.to) === r.key)).map((ac) => shortType(ac.type)))];
    const home = homeOf(r.a, r.b);
    return { ...r, figures, types, home, other: home === r.a ? r.b : r.a, share: res?.marketShare ?? 0, health: routeHealth(figures, r.flightsPerDay / 2) };
  });
  type Row = (typeof rows)[number];
  const by: Record<RouteSort, (x: Row, y: Row) => number> = {
    need: (x, y) => healthRank(x.health) - healthRank(y.health) || (y.figures?.profit ?? 0) - (x.figures?.profit ?? 0),
    profit: (x, y) => (y.figures?.profit ?? 0) - (x.figures?.profit ?? 0),
    load: (x, y) => (y.figures?.loadFactor ?? 0) - (x.figures?.loadFactor ?? 0),
    share: (x, y) => y.share - x.share,
  };
  const todo = rows.filter((r) => r.health.key !== 'ok' && r.health.key !== 'pending');
  const shown = rows.slice().sort(by[sort]);
  const loads = rows.filter((r) => r.figures).map((r) => r.figures!.loadFactor);
  const avgLoad = loads.length ? loads.reduce((x, y) => x + y, 0) / loads.length : 0;
  const total = rows.reduce((s, r) => s + (r.figures?.profit ?? 0), 0);
  const daily = rows.reduce((s, r) => s + r.flightsPerDay, 0) / 2;
  const groups = [...new Set(shown.map((r) => r.home))]
    .map((home) => ({ home, rows: shown.filter((r) => r.home === home) }))
    .sort((x, y) => (x.home === (plan.hub ?? plan.base) ? -1 : y.home === (plan.hub ?? plan.base) ? 1 : y.rows.length - x.rows.length));
  return (
    <Sheet size="full" className="routes-panel" title={`航線 · ${rows.length}`} onClose={onClose}
      info={rows.length > 0 && <p>航線按基地和轉運站分組。向右滑加一班來回，向左滑減一班。金額是港幣（HK$）。航線週損益不含租金。</p>}
      action={rows.length > 0 && <button className="primary small" onClick={onNew}>＋ 新航線</button>}>
      {rows.length > 0 && (
        <div className="seg two routes-view" role="tablist" aria-label="航線類別">
          <button role="tab" aria-selected={view === 'own'} className={view === 'own' ? 'on' : ''} onClick={() => onView('own')}>自己飛 {rows.length}</button>
          <button role="tab" aria-selected={view === 'share'} className={view === 'share' ? 'on' : ''} onClick={() => onView('share')}><Icon n="link" /> 代碼共享{shared ? ` ${shared}` : ''}</button>
        </div>
      )}
      {rows.length > 0 && view === 'share' && <CodeshareHub plan={plan} history={history} onOpen={onOpenCodeshare} onShare={onShare} onPartners={onPartners} onOpenHosted={onOpenHosted} onHost={onHost} />}
      {view === 'own' && <>
      {rows.length === 0 && (
        <div className="empty-cta">
          <div className="empty-flight" aria-hidden="true"><span>✈</span></div>
          <strong>開第一條航線</strong>
          <p>選目的地，飛機就起飛。</p>
          <button className="primary wide" onClick={onNew}>＋ 新航線</button>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="kpis">
            <Kpi n="money" label="週損益" v={`${total >= 0 ? '+' : ''}${money(total)}`} tone={total >= 0 ? 'good' : 'bad'} />
            <Kpi n="seat" label="載客" v={pct(avgLoad)} ring={avgLoad} tone={avgLoad >= 0.8 ? 'good' : avgLoad >= 0.6 ? 'warn' : 'bad'} />
            <Kpi n="plane" label="班/日" v={daily} />
            {todo.length > 0 && <Kpi n="warn" label="待處理" v={todo.length} tone="warn" />}
          </div>
          {rows.length > 1 && <div className="list-tools"><PullDown label="排序" items={SORTS} value={sort} onPick={setSort} /></div>}
        </>
      )}
      {groups.map((g) => {
        const sum = g.rows.reduce((s, r) => s + (r.figures?.profit ?? 0), 0);
        return (
          <section key={g.home} className="route-group">
            {groups.length > 1 && <div className="route-group-head">
              <h4>{AIRPORT_BY_CODE[g.home].name} {g.home} · {g.rows.length}</h4>
              <b className={sum >= 0 ? 'good' : 'bad'}>{sum >= 0 ? '+' : ''}{money(sum)}</b>
            </div>}
            <ul className="route-rows">
              {g.rows.map((r) => {
                return (
                  <RouteRow key={r.key} name={AIRPORT_BY_CODE[r.other].name} swatch={routeColor(r.key)} figures={r.figures} daily={r.flightsPerDay / 2}
                    sub={r.types.join('、')}
                    onOpen={() => onOpen(r.key)} onAdd={() => onAdd(r.key)} onRemove={() => onRemoveOne(r.key)} />
                );
              })}
            </ul>
          </section>
        );
      })}
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

export function SchedulePanel({ plan, result, now, selected, preset, onPickLeg, onGap, onChange, onClose }: {
  plan: Plan; result: NetworkResult | null; now: number; selected: { acId: string; legs: number[] } | null; preset?: { airport: string } | null;
  onPickLeg: (acId: string, leg: number) => void; onGap: (acId: string, t: number) => void; onChange: (plan: Plan, msg: string) => void; onClose: () => void;
}) {
  const [view, setViewState] = useState<SchedView>(() => (preset ? 'time' : loadView()));
  const setView = (v: SchedView) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ } };
  const [mode, setMode] = useState<'dep' | 'arr'>('dep');
  const [basis, setBasis] = useState<ClockBasis>('local');
  const [airport, setAirport] = useState<string | null>(preset?.airport ?? null);
  return (
    <Sheet size="full" title="班表" sub={view === 'aircraft' ? <IN n="clock" v={plan.base} label="時間基準" u="時間" /> : undefined} onClose={onClose}
      info={view === 'aircraft'
        ? <p>每欄是一架飛機，時間往下走（{plan.base} 時間）。點航班調整，點空白處加班。按住航班再上下拖就能改時間，來回會一起移；變紅表示會撞到前後航班。</p>
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
      {view === 'aircraft' && plan.fleet.length > 0 && (
        <ScheduleBoard plan={plan} now={now} selected={selected} onPickLeg={onPickLeg} onGap={onGap}
          onShift={(acId, unit, delta) => {
            const ac = plan.fleet.find((x) => x.id === acId);
            if (ac) onChange(withAc(plan, shiftUnit(ac, unit, delta)), `${ac.reg} ${shiftText(delta)}`);
          }} />
      )}
      {view === 'aircraft' && result && plan.fleet.length > 0 && (
        <div className="ins"><IN n="util" v={pct(result.avgUtilisation)} label="平均利用率" w="利用率" /></div>
      )}
    </Sheet>
  );
}

/** Departures or arrivals, in each airport's own time or the base's: one pull-down instead of two switches. */
const SHOW_OPTS = [['dep-local', '出發 · 當地時間'], ['arr-local', '抵達 · 當地時間'], ['dep-base', '出發 · 基地時間'], ['arr-base', '抵達 · 基地時間']] as const;
type ShowOpt = (typeof SHOW_OPTS)[number][0];

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
          <b>{r.from} → {r.to}</b>
          <small className="ins inline">
            {mode === 'dep'
              ? <span className="in" title="抵達"><Icon n="down" />{hhmm(r.other)}{mark && <sup className="daymark" title={r.shift > 0 ? '隔天抵達' : '前一天抵達'}>{mark}</sup>}</span>
              : <span className="in" title={`出發${r.shift > 0 ? '（前一天）' : r.shift < 0 ? '（後一天）' : ''}`}><Icon n="up" />{hhmm(r.other)}{r.shift !== 0 ? <sup className="daymark">{r.shift > 0 ? '-1' : '+1'}</sup> : null}</span>}
            <IN n="plane" v={dur(r.durMin)} label="飛行" w="飛" />{zone}<span>{r.ac.reg}</span>
          </small>
        </span>
        {fr && <LoadPill f={fr} />}
        <span className="chev" aria-hidden="true" />
      </li>
    );
  };
  const list = view === 'time' ? timeline(plan, { mode, basis, airport: airport ?? undefined }) : null;
  const groups = view === 'airport' ? byAirport(plan, { mode, basis, order: 'busy' }).filter((g) => !airport || g.code === airport) : null;
  return (
    <>
      <div className="viewopts">
        <PullDown label="顯示" items={SHOW_OPTS} value={`${mode}-${basis}` as ShowOpt}
          onPick={(v) => { const [m, bs] = v.split('-') as ['dep' | 'arr', ClockBasis]; onMode(m); onBasis(bs); }} />
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
            <span className={`chev${collapsed[g.code] ? '' : ' open'}`} aria-hidden="true" />
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
    <Sheet size="full" title={`機隊 · ${plan.fleet.length}`}       info={plan.fleet.length > 0 && <p>損益是每週，含租金。色條是飛機的一天（{AIRPORT_BY_CODE[plan.base].name}時間），每個色塊是一個航班。</p>}
      onClose={onClose} action={plan.fleet.length > 0 && <button className="primary small" onClick={onLease}>租飛機</button>}>
      {plan.fleet.length === 0 && (
        <div className="empty-cta">
          <div className="empty-flight" aria-hidden="true"><span>✈</span></div>
          <strong>還沒有飛機</strong>
          <p>租一架飛機，它會停在{AIRPORT_BY_CODE[plan.base].name}等你排班。</p>
          <button className="primary wide" onClick={onLease}>租飛機</button>
        </div>
      )}
      {plan.fleet.length > 0 && (
        <div className="kpis">
          <Kpi n="util" label="利用率" v={pct(avg)} ring={avg} tone={avg >= 0.5 ? 'good' : 'warn'} />
          <Kpi n="lease" label="租金/週" v={money(plan.fleet.reduce((s, a) => s + AIRCRAFT[a.type].ownershipPerWeek, 0))} />
        </div>
      )}
      <ul className="fleet">
        {plan.fleet.map((ac) => {
          const info = rotationInfo(ac);
          const r = result?.aircraft[ac.id];
          const p = r ? r.revenue - r.flyingCost - r.ownershipCost : 0;
          const warn = !ac.legs.length ? '沒有航班' : !info.closed ? '沒回到起點' : !info.fits ? `超過 ${info.cycleDays * 24} 小時` : info.utilisation < 0.3 ? '閒置太久' : '';
          return (
            <li key={ac.id} role="button" tabIndex={0} onClick={() => onPick(ac.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(ac.id); } }}>
              <div className="fleet-top">
                <span className="name">{ac.reg} · {shortType(ac.type)}</span>
                {r && <b className={`fleet-profit ${p >= 0 ? 'good' : 'bad'}`} title="每週損益，含租金">{p >= 0 ? '+' : ''}{money(p)}</b>}
              </div>
              <div className="fleet-day">
                <DayBar ac={ac} base={plan.base} compact />
                {warn ? <Badge n="warn" tone="warn">{warn}</Badge> : <small><IN n="clock" v={`${(info.blockMin / 60).toFixed(1)}h/日`} label="每日飛行" w="飛" /></small>}
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
  const fitsBase = (t: AircraftModel) => runwayFits(AIRCRAFT[t], base);
  const [pick, setPick] = useState<AircraftModel>(() => MODEL_ORDER.find((t) => t === 'A20N' && fitsBase(t)) ?? MODEL_ORDER.find(fitsBase)!);
  const dests = topMarketsFrom(plan.base, plan, 40).filter((m) => !routeProblem(plan.base, m.to, pick)).slice(0, 8);
  const maxSeats = Math.max(...MODEL_ORDER.map((t) => AIRCRAFT[t].seats)), maxRange = Math.max(...MODEL_ORDER.map((t) => AIRCRAFT[t].rangeKm));
  const costs = MODEL_ORDER.map(seatKmCost), cheapest = Math.min(...costs), priciest = Math.max(...costs);
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
      <div className="lease-cards" role="listbox" aria-label="機型">
        {MODEL_ORDER.map((t) => {
          const s = AIRCRAFT[t];
          const ok = fitsBase(t);
          const eff = 1 - Math.min(1, Math.max(0, (seatKmCost(t) - cheapest) / (priciest - cheapest || 1)));
          return (
            <button key={t} role="option" aria-selected={pick === t} className={`lease-card${pick === t ? ' pick' : ''}${ok ? '' : ' dim'}`} onClick={() => ok && setPick(t)}>
              <span className="lease-head">
                <b>{shortType(t)}</b>
                {!ok && <Icon n="lock" label="跑道太短" />}
                {routes.length > 0 && <small title="可飛的航線"><Icon n="route" /> {flyable(t)}/{routes.length}</small>}
                <span className="price" title="租金/週"><Icon n="lease" /> {money(s.ownershipPerWeek)}</span>
              </span>
              <span className="lease-bars">
                <span title="座位"><em><Icon n="seat" />{s.seats}</em><Meter value={s.seats / maxSeats} /></span>
                <span title="航程 km"><em><Icon n="long" />{count(s.rangeKm)}</em><Meter value={s.rangeKm / maxRange} tone="accent" /></span>
                <span title="越長越省（每座公里）"><em><Icon n="fast" />{seatKmCost(t).toFixed(2)}</em><Meter value={eff} tone="good" /></span>
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

// ---------- Time stepper ----------

export function TimeStepper({ code, dep, lo, hi, onChange }: { code: string; dep: number; lo: number; hi: number; onChange: (dep: number) => void }) {
  const set = (d: number) => onChange(Math.max(lo, Math.min(hi, dep + d)));
  return (
    <div className="timepick">
      <div className="tp-row">
        <button onClick={() => set(-60)} disabled={dep <= lo} aria-label="早 1 小時" title="−1h"><Icon n="back" size={20} /></button>
        <button onClick={() => set(-15)} disabled={dep <= lo} aria-label="早 15 分鐘" title="−15m"><Icon n="minus" size={20} /></button>
        <output>{at(code, dep)}</output>
        <button onClick={() => set(15)} disabled={dep >= hi} aria-label="晚 15 分鐘" title="+15m"><Icon n="plus" size={20} /></button>
        <button onClick={() => set(60)} disabled={dep >= hi} aria-label="晚 1 小時" title="+1h"><Icon n="fwd" size={20} /></button>
      </div>
      {hi > lo && <input type="range" min={lo} max={hi} step={15} value={Math.max(lo, Math.min(hi, dep))} aria-label="出發時間" onChange={(e) => onChange(Number(e.target.value))} />}
      {hi > lo && <div className="tp-ends"><span>{at(code, lo)}</span><span>{at(code, hi)}</span></div>}
    </div>
  );
}

export { UtilBar };
