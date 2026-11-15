import { AIRPORT_BY_CODE } from '../data/airports';
import { routePairs, rotationInfo, type NetworkResult, type Plan } from '../sim/simulate';
import type { DayRecord } from './clock';
import { hkSigned } from './format';

/**
 * One prompt at a time on the map: what to do next. A new player first gets a three-step guide (open a route, let a
 * day pass, read the result); after that, hints for an empty network, an idle aircraft or a loss-making route.
 * Dismissals are kept apart from the plan and game saves, so restarting a game doesn't bring dismissed hints back
 * and clearing hints never touches a save.
 */
export type NudgeAction =
  | { kind: 'new' }
  | { kind: 'skip' }
  | { kind: 'report' }
  | { kind: 'aircraft'; id: string }
  | { kind: 'route'; key: string };
export interface Nudge { id: string; title: string; text: string; action: string; run: NudgeAction; step?: string }

const HINTS_KEY = 'waypoint.hints.v1';
export interface NudgeMemory { guideDone: boolean; dismissed: string[] }
export function loadNudges(): NudgeMemory {
  try {
    const v = JSON.parse(localStorage.getItem(HINTS_KEY) ?? 'null') as NudgeMemory | null;
    if (v && Array.isArray(v.dismissed)) return { guideDone: !!v.guideDone, dismissed: v.dismissed.filter((x) => typeof x === 'string') };
  } catch { /* storage unavailable */ }
  return { guideDone: false, dismissed: [] };
}
export function saveNudges(m: NudgeMemory) {
  try { localStorage.setItem(HINTS_KEY, JSON.stringify(m)); } catch { /* storage unavailable */ }
}

export function pickNudge(plan: Plan, result: NetworkResult | null, history: DayRecord[], memory: NudgeMemory): Nudge | null {
  const routes = routePairs(plan);
  if (!memory.guideDone) {
    if (!routes.length) return { id: 'guide', step: '1/3', title: '開第一條航線', text: '選一個目的地，飛機、時間和票價都會先幫你配好。也可以在地圖上按住機場。', action: '選目的地', run: { kind: 'new' } };
    if (!history.length) return { id: 'guide', step: '2/3', title: '等第一天結算', text: '時間會自己走，到基地午夜結算一天。上方 ⏸ 暫停，⏩ 加速，或直接跳到結算。', action: '跳到結算', run: { kind: 'skip' } };
    const last = history[history.length - 1];
    return { id: 'guide', step: '3/3', title: `第一天結算 ${hkSigned(last.revenue - last.cost)}`, text: '報表會拆開收入和成本，看看錢從哪裡來。', action: '看報表', run: { kind: 'report' } };
  }
  const seen = new Set(memory.dismissed);
  if (!routes.length) return seen.has('empty') ? null : { id: 'empty', title: '還沒有航線', text: '開一條航線，飛機就會開始賺錢。', action: '開新航線', run: { kind: 'new' } };
  const awake = plan.fleet.filter((ac) => !seen.has(`idle:${ac.id}`));
  // An aircraft with nothing to fly comes first; one that mostly sits on the ground after that.
  const idle = awake.find((ac) => !ac.legs.length);
  if (idle) return { id: `idle:${idle.id}`, title: `${idle.reg} 沒有航班`, text: '租金照付，先幫它排一班來回。', action: '排班', run: { kind: 'aircraft', id: idle.id } };
  const quiet = awake.find((ac) => rotationInfo(ac).utilisation < 0.25);
  if (quiet) return { id: `idle:${quiet.id}`, title: `${quiet.reg} 大多時間停著`, text: '一天飛不到 25%，還放得下一班來回。', action: '加一班', run: { kind: 'aircraft', id: quiet.id } };
  if (result) {
    const losing = routes
      .map((r) => ({ key: r.key, profit: result.routes[r.key] ? result.routes[r.key].revenue - result.routes[r.key].flyingCost : 0 }))
      .filter((r) => r.profit < 0 && !seen.has(`loss:${r.key}`))
      .sort((x, y) => x.profit - y.profit)[0];
    if (losing) {
      const [a, b] = losing.key.split('-');
      return { id: `loss:${losing.key}`, title: `${AIRPORT_BY_CODE[a].name}⇄${AIRPORT_BY_CODE[b].name} 在虧錢`, text: `每週 ${hkSigned(losing.profit)}，試試改票價或減班。`, action: '查看', run: { kind: 'route', key: losing.key } };
    }
  }
  return null;
}

export function NudgeCard({ nudge, onRun, onDismiss }: { nudge: Nudge; onRun: () => void; onDismiss: () => void }) {
  return (
    <div className="nudge" role="status">
      <div className="nudge-text">
        {nudge.step && <small className="nudge-step">新手 {nudge.step}</small>}
        <b>{nudge.title}</b>
        <span>{nudge.text}</span>
      </div>
      <div className="nudge-acts">
        <button className="primary small" onClick={onRun}>{nudge.action}</button>
        <button className="nudge-x" onClick={onDismiss} aria-label={nudge.step ? '略過新手引導' : '不再提示'}>{nudge.step ? '略過' : '✕'}</button>
      </div>
    </div>
  );
}
