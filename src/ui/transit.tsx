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
import { Badge, hm, IN, Icon, type IconName } from './viz';

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
    case 'connected': n = l.full ? 'spill' : 'check'; body = l.full ? null : l.wait ? hm(l.wait) : null; break;
    case 'long': n = l.wait !== null && layoverKind(l.wait) === 'stopover' ? 'bed' : 'clock'; body = <>{hm(l.wait ?? 0)}{dir}</>; break;
    case 'timing': n = 'cross'; body = dir; break;
    case 'leg': n = 'lock'; body = l.missing.map((m) => `${hub}⇄${m}`).join(' '); break;
    case 'nonstop': n = 'plane'; break;
    default: n = 'detour';
  }
  return <Badge n={n} tone={why.tone === 'idle' ? 'muted' : why.tone} label={why.text}>{body}</Badge>;
}

/** The one action that grows the market: a better-timed flight or the missing leg. */
function FixButton({ hub, l, onOpenPair, onSuggest }: { hub: string; l: Linkage; onOpenPair: OpenPair; onSuggest: Suggest }) {
  if ((l.status === 'long' || l.status === 'timing') && l.suggest) {
    const s = l.suggest;
    return <button className="chip strong" onClick={() => onSuggest(s.from, s.to, s.local)} aria-label={`排一班 ${hhmm(s.local)} ${s.from} 到 ${s.to}`}><Icon n="plus" /> {hhmm(s.local)} {s.from}→{s.to}</button>;
  }
  if (l.status === 'leg') {
    return <>{l.missing.map((m) => <button key={m} className="chip strong" onClick={() => onOpenPair(m, hub)} aria-label={`開航 ${hub} ⇄ ${m}`}><Icon n="plus" /> {hub}⇄{m}</button>)}</>;
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
          ? <span className="tr-num idle" title="接上後每週可載約">~{count(l.potential)}</span>
          : <span className="tr-num" title="現在每週載"><Icon n="pax" />{count(l.viaPax)}</span>}
      </div>
      <ReachBar now={l.viaPax} potential={l.potential} />
      <div className="tr-meta">
        <TransitBadge hub={hub} l={l} />
        <span className="ins">
          <IN n="market" v={count(l.market)} label="這兩地每週航空旅客" />
          <IN n="share" v={unflown ? `→${sharePct(reachShare)}` : `${sharePct(share)}${l.potential - l.viaPax >= 1 ? `→${sharePct(reachShare)}` : ''}`} label={unflown ? '接上可占市場' : '你的市占（→ 接好後）'} />
        </span>
      </div>
      <div className="chips">
        <FixButton hub={hub} l={l} onOpenPair={onOpenPair} onSuggest={onSuggest} />
        <button className="chip" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={open ? '收起市占' : '市占'}><Icon n={open ? 'cross' : 'share'} /></button>
      </div>
      {open && <MarketShare a={l.o} b={l.d} result={net?.routes[pairKey(l.o, l.d)]} net={net} title="這兩地的旅客怎麼分" />}
    </li>
  );
}

function More({ list, page, render }: { list: Linkage[]; page: number; render: (l: Linkage) => ReactNode }) {
  const [shown, setShown] = useState(page);
  return (
    <>
      <ul className="trs">{list.slice(0, shown).map(render)}</ul>
      {list.length > shown && <button className="secondary" onClick={() => setShown(shown + page * 2)}>+{Math.min(page * 2, list.length - shown)} <small>/ {list.length}</small></button>}
    </>
  );
}

function Legend({ hub, extra }: { hub: string; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="legend-line"><span className="k now">■</span> 現在 <span className="k more">■</span> 接好<InfoDot open={open} onClick={() => setOpen(!open)} /></div>
      {open && <div className="info-note" onClick={() => setOpen(false)}>
        <p>「接好」是 4 小時內能轉機。<Icon n="share" /> 是你在這兩地所有航空旅客中的占比，<Icon n="market" /> 是這兩地每週的航空旅客。</p>
        <p><Icon n="check" /> 接得好 · <Icon n="clock" /> 要等很久 · <Icon n="bed" /> 要停留過夜 · <Icon n="cross" /> 班次接不上 · <Icon n="lock" /> 還沒飛那一段 · <Icon n="spill" /> 客滿 · <Icon n="detour" /> 繞路。點徽章看原因。</p>
        <p>轉機票價約直飛的 {pct(CONNECT_FARE_SHARE)}；等 4 小時以上的旅客少很多，8 小時以上算停留（票價約 {pct(STOPOVER_FARE_SHARE)}，{name(hub)}的停留吸引力約抵 {stopoverAppealHours(hub).toFixed(1)} 小時）。</p>
        <p>轉機比直飛便宜，所以也搶得到直飛的旅客；航程越長，多花的時間越不要緊。</p>
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
        <button className="chip strong" onClick={() => onSuggest(s.from, s.to, s.local)} aria-label={`排一班 ${hhmm(s.local)} ${s.from} 到 ${s.to}`}><Icon n="plus" /> {hhmm(s.local)} {s.from}→{s.to}</button>
        <span className="tr-num good" title="每週約多載">+{count(f.gain)}<Icon n="pax" /></span>
      </div>
      <div className="ins" title={why}>
        <IN n="down" v={hhmm(s.arriveLocal)} label={`抵達${hub}`} />
        {s.before === undefined ? <IN n="transfer" v={hm(wait)} label="轉機等" /> : <IN n="up" v={hhmm(s.before)} label="接上的航班" />}
        <IN n="clock" v={f.markets[0].wait !== null ? hm(f.markets[0].wait) : '—'} label="現在最快要等" tone="warn" />
      </div>
      <div className="code-chips">{f.markets.slice(0, 6).map((l) => <span key={`${l.o}${l.d}`}>{l.o}⇄{l.d}</span>)}{f.markets.length > 6 && <span>+{f.markets.length - 6}</span>}</div>
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
              <span className="name"><b>{name(i.to)} {i.to}</b>{want > i.seats * 1.05 && <Badge n="spill" tone="warn" label="一天一班坐不下，可加班或用大飛機">×{Math.ceil(want / i.seats)}</Badge>}</span>
              <span className="tr-num" title="每週約">~{count(want)}</span>
              <button onClick={() => onOpenPair(hub, i.to)} aria-label={`開航 ${hub} ⇄ ${i.to}`}><Icon n="plus" /></button>
            </div>
            <div className="split" role="img" aria-label={`本地 ${count(i.local)}，轉機 ${count(i.via)}，每天一班 ${count(i.seats)} 座`}>
              <i className="nonstop" style={{ width: `${(i.local / top) * 100}%` }} /><i className="via" style={{ width: `${(i.via / top) * 100}%` }} />
              {i.seats > want && <i className="seats" style={{ width: `${((i.seats - want) / top) * 100}%` }} />}
            </div>
            <div className="ins">
              <span className="in" title={`${hub}⇄${i.to} 本地`}><span className="k nonstop">■</span>{count(i.local)}</span>
              {i.via >= 1 && <span className="in" title={`在${hub}轉機`}><span className="k via">■</span><Icon n="transfer" />{count(i.via)}</span>}
              <IN n="long" v={`${count(i.distKm)}km`} label="距離" />
              {i.markets.length > 0 && <span className="code-chips">{i.markets.slice(0, 4).map((m) => <span key={m.d}>{m.d}</span>)}{i.markets.length > 4 && <span>+{i.markets.length - 4}</span>}</span>}
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
  const reach = transit.carried.reduce((s, l) => s + l.potential, 0);
  const gain = transit.fixes.reduce((s, f) => s + f.gain, 0);
  return (
    <>
      <div className="tr-card">
        <div className="tr-card-nums">
          <div title="現在每週轉機"><b><Icon n="transfer" /> {count(transferPax)}</b></div>
          <div title="接好可到"><b className="more">▸ {count(Math.max(reach, transferPax))}</b></div>
        </div>
        <ReachBar now={transferPax} potential={Math.max(reach, transferPax)} />
        <div className="ins">
          <IN n="clock" v={count(transfer.long)} label="等 4–8 小時的旅客" />
          <IN n="bed" v={count(transfer.stopover)} label="停留過夜的旅客" />
          <IN n="fast" v={`${transfer.mct}m`} label="最短轉機時間" />
        </div>
      </div>
      <Legend hub={hub} extra={<p>點地圖上其他機場，看它的「經{hub}轉機」，就知道那裡的旅客經{hub}能去哪裡。</p>} />
      {transit.carried.length > 0
        ? <>
          <h4>轉機市場 <small>{transit.carried.length}</small></h4>
          <More list={transit.carried} page={5} render={(l) => <TransitRow key={`${l.o}${l.d}`} hub={hub} l={l} net={net} onOpenPair={onOpenPair} onSuggest={onSuggest} />} />
        </>
        : <div className="hint center"><Icon n="transfer" /> 0 · 飛兩條以上航線，隔 1–4 小時</div>}

      {transit.fixes.length > 0 && (
        <>
          <h4>調班表 <Badge n="pax" tone="good" label="每週約多載">+{count(gain)}</Badge></h4>
          <ul className="trs">{transit.fixes.slice(0, 5).map((f) => <FixCard key={`${f.suggest.from}${f.suggest.to}${f.suggest.local}`} hub={hub} f={f} onSuggest={onSuggest} />)}</ul>
        </>
      )}

      {ideas.length > 0 && (
        <>
          <h4>開新航線</h4>
          <HubIdeas hub={hub} ideas={ideas} onOpenPair={onOpenPair} />
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
            ? <><IN n="transfer" v={count(view.now)} label={`每週在${hub}轉你的航班`} strong /><IN n="market" v={linked.length} label="接上的地方" /></>
            : <><IN n="pax" v={`~${count(view.local)}`} label="本地旅客/週" />{view.unlockCount > 0 && <><IN n="transfer" v={`+${count(view.unlock)}`} label="轉機旅客/週" /><IN n="market" v={view.unlockCount} label="接上的地方" /></>}<IN n="seat" v={count(view.seats)} label="每天一班的座位/週" /></>}
        </div>
        {!view.legFlown && <button className="primary small" onClick={() => onOpenPair(code, hub)}><Icon n="plus" /> {code} ⇄ {hub}</button>}
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
          <h4><Icon n="lock" /> 再開 {hub} 航線 <small>{open.length}</small></h4>
          <More list={open} page={6} render={row} />
        </>
      )}
      {view.rows.length === 0 && <div className="hint center"><Icon n="detour" /> 經{hub}繞太遠，直飛較好</div>}
    </>
  );
}
