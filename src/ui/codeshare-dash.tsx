// Codeshare dashboard: one glance at both directions (net, travellers, seat use), the trend from the daily history,
// and the few deals that need a look, each one tap from its sheet.
import { useMemo } from 'react';
import { codeshareImpact, hostedImpact } from '../sim/codeshare';
import { airlineName, simulate, type Plan } from '../sim/simulate';
import type { DayRecord } from './clock';
import { signed, turnedAway } from './codeshare';
import { count, pct } from './format';
import { routeName } from './sheets';
import { Badge, Ring, Spark, type Tone } from './viz';

interface Alert { id: string; sev: number; tone: Tone; text: string; sub: string; open: () => void }

const TREND_DAYS = 14;

export function CodeshareDash({ plan, history, onOpen, onOpenHosted }: {
  plan: Plan; history: DayRecord[]; onOpen: (airline: string, key: string) => void; onOpenHosted: (key: string, airline?: string) => void;
}) {
  const d = useMemo(() => {
    const out = plan.codeshares ?? [];
    const inn = plan.hosted ?? [];
    if (!out.length && !inn.length) return null;
    const now = simulate(plan);
    const alerts: Alert[] = [];
    let gain = 0, pax = 0, seats = 0;
    const add = (id: string, sev: number, tone: Tone, text: string, sub: string, open: () => void) => alerts.push({ id, sev, tone, text, sub, open });
    for (const c of out) {
      const imp = codeshareImpact(plan, c.airline, c.key, now);
      const [a, b] = c.key.split('-');
      const sub = `${airlineName(c.airline)} · ${routeName(a, b)}`;
      const open = () => onOpen(c.airline, c.key);
      if (!imp) { add(`o${c.airline}${c.key}`, 5, 'warn', '夥伴停飛', sub, open); continue; }
      gain += imp.gain; pax += imp.stats.pax; seats += imp.stats.seats;
      const away = turnedAway(imp.stats);
      if (imp.stats.pax < 1) add(`o${c.airline}${c.key}`, 4, 'bad', '接不上，沒人搭', sub, open);
      else if (imp.gain < 0) add(`o${c.airline}${c.key}`, 3, 'bad', `虧 ${signed(imp.gain)}／週`, sub, open);
      else if (away.own) add(`o${c.airline}${c.key}`, 2, 'warn', '你的航班滿了', sub, open);
      else if (imp.stats.seats && imp.stats.pax / imp.stats.seats < 0.15) add(`o${c.airline}${c.key}`, 1, 'warn', `座位只用 ${pct(imp.stats.pax / imp.stats.seats)}`, sub, open);
      else if (away.block) add(`o${c.airline}${c.key}`, 0, 'accent', '座位賣光，可加大', sub, open);
    }
    for (const h of inn) {
      const imp = hostedImpact(plan, h.airline, h.key, now);
      const [a, b] = h.key.split('-');
      const sub = `${airlineName(h.airline)} 賣 · ${routeName(a, b)}`;
      const open = () => onOpenHosted(h.key, h.airline);
      if (!imp) { add(`i${h.airline}${h.key}`, 5, 'warn', '航線停飛', sub, open); continue; }
      const s = imp.stats;
      gain += imp.gain; pax += s.pax; seats += s.seats;
      if (s.pax < 1) add(`i${h.airline}${h.key}`, 4, 'bad', '夥伴沒帶來人', sub, open);
      else if (imp.gain < 0) add(`i${h.airline}${h.key}`, 3, 'bad', `虧 ${signed(imp.gain)}／週`, sub, open);
      else if (s.seats && s.pax / s.seats < 0.15) add(`i${h.airline}${h.key}`, 1, 'warn', `座位只用 ${pct(s.pax / s.seats)}`, sub, open);
      else if (s.pax >= s.seats - 1 && s.wanted > s.pax + 5) add(`i${h.airline}${h.key}`, 0, 'accent', '座位賣光，可加大', sub, open);
    }
    alerts.sort((x, y) => y.sev - x.sev);
    return { gain, pax, use: seats ? pax / seats : 0, deals: out.length + inn.length, alerts };
  }, [plan, onOpen, onOpenHosted]);
  if (!d) return null;
  const days = history.slice(-TREND_DAYS).filter((r) => r.cs != null);
  const net = days.map((r) => r.cs ?? 0);
  const trav = days.map((r) => r.csPax ?? 0);
  return (
    <div className="cs-dash">
      <div className="routes-summary">
        <div><small>每週淨賺</small><b className={d.gain >= 0 ? 'good' : 'bad'}>{signed(d.gain)}</b></div>
        <div><small>人/週</small><b>{count(d.pax)}</b></div>
        <div className="cs-dash-use"><small>座位使用</small><b><Ring value={d.use} tone={d.use >= 0.5 ? 'good' : 'warn'} size={26} stroke={4} label={`座位使用 ${pct(d.use)}`} /> {pct(d.use)}</b></div>
      </div>
      {net.length >= 2 && (
        <div className="cs-dash-trend" aria-label="近兩週趨勢">
          <span><small>每日淨賺</small><Spark values={net} width={110} height={24} label="每日共享淨賺" /></span>
          <span><small>每日旅客</small><Spark values={trav} width={110} height={24} label="每日共享旅客" /></span>
        </div>
      )}
      {d.alerts.length > 0 && (
        <ul className="cs-alerts">
          {d.alerts.slice(0, 4).map((a) => (
            <li key={a.id}>
              <button onClick={a.open}>
                <Badge n={a.tone === 'accent' ? 'spill' : 'warn'} tone={a.tone}>{a.text}</Badge>
                <small>{a.sub}</small>
                <span className="chev" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
