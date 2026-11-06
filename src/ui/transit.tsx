// Transit (connecting) markets in the airport sheet. Every city pair is shown the same way: what you carry through
// the hub now, what quick connections could carry, your share of that market, a badge for what holds it back (the
// sentence behind it is the badge's label), and the one tap that fixes it.
import { useState, type ReactNode } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { viaGroup, type HubTransit, type HubView, type Linkage, type SpokeIdea, type TimingFix } from '../sim/airports';
import { CONNECT_FARE_SHARE, hhmm, layoverKind, STOPOVER_FARE_SHARE, stopoverAppealHours, type NetworkResult, type Plan } from '../sim/simulate';
import { pairKey } from '../sim/markets';
import { MarketShare } from './rivals';
import { count, pct } from './format';
import { InfoDot } from './sheets';
import { Badge, hm, IN, type IconName } from './viz';

const name = (c: string) => AIRPORT_BY_CODE[c].name;
/** A share that stays readable when small: 0.4% rather than 0%. */
const sharePct = (x: number) => (x > 0 && x < 0.095 ? `${(x * 100).toFixed(1)}%` : pct(x));
export { hm };

type OpenPair = (a: string, b: string) => void;
type Suggest = (from: string, to: string, localMin: number) => void;

/** What you carry now (solid) against what quick connections could carry (light), on one scale. */
export function ReachBar({ now, potential }: { now: number; potential: number }) {
  const top = Math.max(1, potential, now);
  return (
    <div className="reach" role="img" aria-label={`現在 ${count(now)}，接好可載約 ${count(potential)}`}>
      <i className="now" style={{ width: `${(100 * now) / top}%` }} />
      <i className="more" style={{ width: `${(100 * Math.max(0, potential - now)) / top}%` }} />
    </div>
  );
}

/** One sentence on why a city pair carries what it does through the hub. */
export function transitReason(hub: string, l: Linkage): { text: string; tone: 'good' | 'warn' | 'bad' | 'idle' } {
  const gap = Math.max(0, l.potential - l.viaPax);
  const more = gap >= 1 ? ` · 接好可多 ${count(gap)} 人` : '';
  const dir = l.slow ? `${l.slow.from}→${l.slow.to} ` : '';
  switch (l.status) {
    case 'connected':
      return l.full && gap >= 1
        ? { text: `接得好但客滿${more}：加班或換大飛機`, tone: 'warn' }
        : { text: `在${hub}轉機${l.wait ? ` ${hm(l.wait)}` : ''}，接得好`, tone: 'good' };
    case 'long':
      return l.wait !== null && layoverKind(l.wait) === 'stopover'
        ? { text: `${dir}要停留 ${hm(l.wait)}，少人搭${more}`, tone: 'warn' }
        : { text: `${dir}要等 ${hm(l.wait ?? 0)}，多數人改搭別家${more}`, tone: 'warn' };
    case 'timing':
      return { text: `${dir}班次接不上${more}`, tone: 'bad' };
    case 'leg':
      return { text: `還沒飛 ${l.missing.map((m) => `${hub}⇄${m}`).join('、')}`, tone: 'idle' };
    case 'nonstop':
      return { text: '你已直飛', tone: 'good' };
    default:
      return { text: `經${hub}繞路太遠`, tone: 'bad' };
  }
}

/** What holds a city pair back, as a badge: an icon, a wait or the missing leg. The full sentence is its label. */
export function TransitBadge({ hub, l }: { hub: string; l: Linkage }) {
  const why = transitReason(hub, l);
  const dir = l.slow ? <small>{l.slow.from}→{l.slow.to}</small> : null;
  let n: IconName = 'check';
  let body: ReactNode = null;
  switch (l.status) {
    case 'connected': n = l.full ? 'spill' : 'check'; body = l.full ? '客滿' : <>接得好{l.wait ? ` ${hm(l.wait)}` : ''}</>; break;
    case 'long': {
      const stop = l.wait !== null && layoverKind(l.wait) === 'stopover';
      n = stop ? 'bed' : 'clock'; body = <>{stop ? '要停留' : '要等'} {hm(l.wait ?? 0)}{dir}</>; break;
    }
    case 'timing': n = 'cross'; body = <>接不上{dir}</>; break;
    case 'leg': n = 'lock'; body = <>還沒飛 {l.missing.map((m) => `${hub}⇄${m}`).join('、')}</>; break;
    case 'nonstop': n = 'plane'; body = '你已直飛'; break;
    default: n = 'detour'; body = '繞路太遠';
  }
  return <Badge n={n} tone={why.tone === 'idle' ? 'muted' : why.tone} label={why.text}>{body}</Badge>;
}

/** The one action that grows the market: a better-timed flight or the missing leg. */
function FixButton({ hub, l, onOpenPair, onSuggest }: { hub: string; l: Linkage; onOpenPair: OpenPair; onSuggest: Suggest }) {
  if ((l.status === 'long' || l.status === 'timing') && l.suggest) {
    const s = l.suggest;
    return <button className="chip strong" onClick={() => onSuggest(s.from, s.to, s.local)}>排一班 {hhmm(s.local)} {s.from}→{s.to}</button>;
  }
  if (l.status === 'leg') {
    return <>{l.missing.map((m) => <button key={m} className="chip strong" onClick={() => onOpenPair(m, hub)}>開航 {hub}⇄{m}</button>)}</>;
  }
  return null;
}

/**
 * One city pair through the hub. `title` decides how it is named: as the pair (from the hub) or as a destination
 * (from another airport, whose code is already in the sheet title).
 */
export function TransitRow({ hub, l, net, title = 'pair', onOpenPair, onSuggest }: {
  hub: string; l: Linkage; net: NetworkResult | null; title?: 'pair' | 'dest'; onOpenPair: OpenPair; onSuggest: Suggest;
}) {
  const [open, setOpen] = useState(false);
  const share = l.market >= 1 ? l.viaPax / l.market : 0;
  const reachShare = l.market >= 1 ? l.potential / l.market : 0;
  const unflown = l.status === 'leg';
  return (
    <li className="tr">
      <div className="tr-top">
        <span className="name" title={`${name(l.o)} ⇄ ${name(l.d)}`}>
          {title === 'pair'
            ? <b>{l.o} → {hub} → {l.d}</b>
            : <b>{name(l.d)} {l.d}{l.detourPct >= 0.3 && <> <Badge n="detour" label={`繞路 ${pct(l.detourPct)}`}>{pct(l.detourPct)}</Badge></>}</b>}
        </span>
        {unflown
          ? <span className="tr-num idle"><small>可載約</small>{count(l.potential)}<small>人/週</small></span>
          : <span className="tr-num">{count(l.viaPax)}<small>人/週</small></span>}
      </div>
      <ReachBar now={l.viaPax} potential={l.potential} />
      <div className="tr-meta">
        <TransitBadge hub={hub} l={l} />
        {!unflown && l.potential - l.viaPax >= 1 && <small className="muted">接好可多 {count(l.potential - l.viaPax)} 人</small>}
      </div>
      <div className="chips">
        <FixButton hub={hub} l={l} onOpenPair={onOpenPair} onSuggest={onSuggest} />
        <button className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起' : '市占'}</button>
      </div>
      {open && <>
        <small className="tr-share">市場 {count(l.market)} 人/週 · {unflown ? `接上可占 ${sharePct(reachShare)}` : `你占 ${sharePct(share)}${l.potential - l.viaPax >= 1 ? `，接好 ${sharePct(reachShare)}` : ''}`}</small>
        <MarketShare a={l.o} b={l.d} result={net?.routes[pairKey(l.o, l.d)]} net={net} title="這兩地的旅客怎麼分" />
      </>}
    </li>
  );
}

function More({ list, page, render }: { list: Linkage[]; page: number; render: (l: Linkage) => ReactNode }) {
  const [shown, setShown] = useState(page);
  return (
    <>
      <ul className="trs">{list.slice(0, shown).map(render)}</ul>
      {list.length > shown && <button className="secondary" onClick={() => setShown(shown + page * 2)}>再顯示 {Math.min(page * 2, list.length - shown)} 個</button>}
    </>
  );
}

/** The first `page` items, and a button for the rest. */
function ShowSome<T>({ list, page, className, render }: { list: T[]; page: number; className?: string; render: (x: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <ul className={className}>{(all ? list : list.slice(0, page)).map(render)}</ul>
      {!all && list.length > page && <button className="secondary" onClick={() => setAll(true)}>再顯示 {list.length - page} 個</button>}
    </>
  );
}

function Legend({ hub, extra }: { hub: string; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="legend-line"><span className="k now">■</span> 現在載的 <span className="k more">■</span> 接好可多載<InfoDot open={open} onClick={() => setOpen(!open)} /></div>
      {open && <div className="info-note" onClick={() => setOpen(false)}>
        <p>「接好」是 4 小時內能轉機。點「市占」看這兩地的市場大小和你的占比。</p>
        <p>轉機票價約直飛的 {pct(CONNECT_FARE_SHARE)}；等 4 小時以上的旅客少很多，8 小時以上算停留（票價約 {pct(STOPOVER_FARE_SHARE)}，{name(hub)}的停留吸引力約抵 {stopoverAppealHours(hub).toFixed(1)} 小時）。</p>
        {extra}
      </div>}
    </>
  );
}

/** A flight that would make quick connections, with the markets it fixes. */
function FixCard({ hub, f, onSuggest }: { hub: string; f: TimingFix; onSuggest: Suggest }) {
  const s = f.suggest;
  const wait = Math.round((s.local - s.arriveLocal + 1440) % 1440);
  const why = s.before === undefined ? `${hhmm(s.arriveLocal)} 抵達${hub}的旅客 ${hm(wait)} 後就能轉機` : `${hhmm(s.arriveLocal)} 到${hub}，接上 ${hhmm(s.before)} 那班`;
  return (
    <li className="fix">
      <div className="fix-top">
        <span className="name"><b>{hhmm(s.local)} {s.from} → {s.to}</b><small title={why}>接好 {f.markets.slice(0, 3).map((l) => `${l.o}⇄${l.d}`).join('、')}{f.markets.length > 3 ? ` 等 ${f.markets.length} 個` : ''}</small></span>
        <span className="tr-num good">+{count(f.gain)}<small>人/週</small></span>
      </div>
      <div className="chips"><button className="chip strong" onClick={() => onSuggest(s.from, s.to, s.local)}>排入這班</button></div>
    </li>
  );
}

/** New routes from the hub, ranked by their own travellers plus those who would connect at the hub. */
function HubIdeas({ hub, ideas, onOpenPair }: { hub: string; ideas: SpokeIdea[]; onOpenPair: OpenPair }) {
  if (!ideas.length) return null;
  const top = Math.max(1, ...ideas.map((i) => Math.max(i.local + i.via, i.seats)));
  return (
    <ul className="ideas">
      {ideas.map((i) => {
        const want = i.local + i.via;
        return (
          <li key={i.to}>
            <div className="idea-top">
              <span className="name"><b>{name(i.to)} {i.to}</b>{want > i.seats * 1.05 && <Badge n="spill" tone="warn" label="一天一班坐不下，可加班或用大飛機">坐不下</Badge>}</span>
              <span className="tr-num"><small>約</small>{count(want)}<small>人/週</small></span>
              <button onClick={() => onOpenPair(hub, i.to)}>開航</button>
            </div>
            <div className="split" role="img" aria-label={`本地 ${count(i.local)}，轉機 ${count(i.via)}，每天一班 ${count(i.seats)} 座`}>
              <i className="nonstop" style={{ width: `${(i.local / top) * 100}%` }} /><i className="via" style={{ width: `${(i.via / top) * 100}%` }} />
              {i.seats > want && <i className="seats" style={{ width: `${((i.seats - want) / top) * 100}%` }} />}
            </div>
            <div className="ins">
              <span className="in"><span className="k nonstop">■</span>本地 {count(i.local)}</span>
              {i.via >= 1 && <span className="in"><span className="k via">■</span>轉機 {count(i.via)}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The hub's own 轉機 section. */
export function HubTransitView({ hub, net, transit, ideas, transfer, onOpenPair, onSuggest }: {
  hub: string; net: NetworkResult | null; transit: HubTransit; ideas: SpokeIdea[]; transfer: { pax: number; long: number; stopover: number; mct: number };
  onOpenPair: OpenPair; onSuggest: Suggest;
}) {
  const transferPax = transfer.pax;
  const [ideasShown, setIdeasShown] = useState(3);
  const reach = transit.carried.reduce((s, l) => s + l.potential, 0);
  const gain = transit.fixes.reduce((s, f) => s + f.gain, 0);
  return (
    <>
      <div className="tr-card">
        <div className="tr-card-nums">
          <div><small>現在轉機/週</small><b>{count(transferPax)}</b></div>
          <div><small>接好可到</small><b className="more">{count(Math.max(reach, transferPax))}</b></div>
        </div>
        <ReachBar now={transferPax} potential={Math.max(reach, transferPax)} />
        <div className="ins">
          <IN n="clock" v={count(transfer.long)} label="等 4–8 小時的旅客" w="等 4–8h" />
          <IN n="bed" v={count(transfer.stopover)} label="停留過夜的旅客" w="停留" />
          <IN n="fast" v={`${transfer.mct}m`} label="最短轉機時間" w="最短轉機" />
        </div>
      </div>
      <Legend hub={hub} extra={<p>點地圖上其他機場，看它的「經{hub}轉機」，就知道那裡的旅客經{hub}能去哪裡。</p>} />
      {transit.carried.length > 0
        ? <>
          <h4>轉機市場 <small>{transit.carried.length}</small></h4>
          <More list={transit.carried} page={5} render={(l) => <TransitRow key={`${l.o}${l.d}`} hub={hub} l={l} net={net} onOpenPair={onOpenPair} onSuggest={onSuggest} />} />
        </>
        : <div className="hint center">還沒有人轉機：從{hub}飛兩條以上航線，抵達和出發隔 1–4 小時</div>}

      {transit.fixes.length > 0 && (
        <>
          <h4>調班表 <Badge tone="good">約 +{count(gain)} 人/週</Badge></h4>
          <ShowSome list={transit.fixes} page={3} className="trs" render={(f) => <FixCard key={`${f.suggest.from}${f.suggest.to}${f.suggest.local}`} hub={hub} f={f} onSuggest={onSuggest} />} />
        </>
      )}

      {ideas.length > 0 && (
        <>
          <h4>開新航線</h4>
          <HubIdeas hub={hub} ideas={ideas.slice(0, ideasShown)} onOpenPair={onOpenPair} />
          {ideas.length > ideasShown && <button className="secondary" onClick={() => setIdeasShown(ideas.length)}>再顯示 {ideas.length - ideasShown} 條</button>}
        </>
      )}
    </>
  );
}

/** Another airport's travellers seen from the hub: where they connect today, and where one more route would take them. */
export function FromHubView({ plan, net, view, onOpenPair, onSuggest, onPickHub }: {
  plan: Plan; net: NetworkResult | null; view: HubView; onOpenPair: OpenPair; onSuggest: Suggest; onPickHub: () => void;
}) {
  const { hub, code } = view;
  const role = plan.hub === hub ? '轉運站' : '基地';
  const linked = view.rows.filter((l) => viaGroup(l) === 'flown');
  const open = view.rows.filter((l) => viaGroup(l) === 'hubLeg');
  const row = (l: Linkage) => <TransitRow key={l.d} hub={hub} l={l} net={net} title="dest" onOpenPair={onOpenPair} onSuggest={onSuggest} />;
  return (
    <>
      <div className="hubview">
        <div className="hv-path"><b>{code}</b><i className={view.legFlown ? 'on' : 'off'} /><b className="hv-hub" onClick={onPickHub} role="button">{hub}<small>{role}</small></b><i className={linked.length ? 'on' : 'off'} /><b>世界各地</b></div>
        <div className="ins lg">
          {view.legFlown
            ? <><IN n="transfer" v={count(view.now)} label={`每週在${hub}轉你的航班`} strong u="人/週" /><IN n="market" v={linked.length} label="接上的地方" w="接上" u="地" /></>
            : <><IN n="pax" v={`~${count(view.local)}`} label="本地旅客/週" w="本地" />{view.unlockCount > 0 && <><IN n="transfer" v={`+${count(view.unlock)}`} label="轉機旅客/週" w="轉機" /><IN n="market" v={view.unlockCount} label="接上的地方" w="接上" u="地" /></>}<IN n="seat" v={count(view.seats)} label="每天一班的座位/週" w="座位" /></>}
        </div>
        {!view.legFlown && <button className="primary small" onClick={() => onOpenPair(code, hub)}>開航 {code} ⇄ {hub}</button>}
      </div>
      {view.rows.length > 0 && <Legend hub={hub} extra={!plan.hub && <p>你還沒設轉運站，這裡從基地 {hub} 來看。可在機場的「航線」分頁設轉運站。</p>} />}
      {linked.length > 0 && (
        <>
          <h4>{view.legFlown ? '已接上' : '開航後接上'} <small>{linked.length}</small></h4>
          <More list={linked} page={6} render={row} />
        </>
      )}
      {open.length > 0 && (
        <>
          <h4>再開一條{hub}航線可去 <small>{open.length} 個</small></h4>
          <More list={open} page={6} render={row} />
        </>
      )}
      {view.rows.length === 0 && <div className="hint center">經{hub}繞路太遠，適合直飛</div>}
    </>
  );
}
