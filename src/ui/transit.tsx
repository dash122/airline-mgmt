// Transit (connecting) markets in the airport sheet. Every city pair is shown the same way: what you carry through
// the hub now, what quick connections could carry, your share of that market, one plain sentence on what holds it
// back, and the one tap that fixes it.
import { useState, type ReactNode } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { viaGroup, type HubTransit, type HubView, type Linkage, type SpokeIdea, type TimingFix } from '../sim/airports';
import { CONNECT_FARE_SHARE, hhmm, layoverKind, STOPOVER_FARE_SHARE, stopoverAppealHours, type NetworkResult, type Plan } from '../sim/simulate';
import { pairKey } from '../sim/markets';
import { MarketShare } from './rivals';
import { count, pct } from './format';
import { InfoDot } from './sheets';

const name = (c: string) => AIRPORT_BY_CODE[c].name;
/** A share that stays readable when small: 0.4% rather than 0%. */
const sharePct = (x: number) => (x > 0 && x < 0.095 ? `${(x * 100).toFixed(1)}%` : pct(x));
export const hm = (min: number) => (min < 60 ? `${min} 分` : min % 60 ? `${Math.floor(min / 60)} 小時 ${min % 60} 分` : `${min / 60} 小時`);

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
  const why = transitReason(hub, l);
  const share = l.market >= 1 ? l.viaPax / l.market : 0;
  const reachShare = l.market >= 1 ? l.potential / l.market : 0;
  const unflown = l.status === 'leg';
  return (
    <li className="tr">
      <div className="tr-top">
        <span className="name">
          {title === 'pair'
            ? <><b>{l.o} → {hub} → {l.d}</b><small>{name(l.o)} ⇄ {name(l.d)}</small></>
            : <><b>{name(l.d)} {l.d}</b><small>{l.o} → {hub} → {l.d}{l.detourPct >= 0.3 ? ` · 繞路 ${pct(l.detourPct)}` : ''}</small></>}
        </span>
        {unflown
          ? <span className="tr-num idle"><small>可載約</small>{count(l.potential)}<small>/週</small></span>
          : <span className="tr-num"><small>現在</small>{count(l.viaPax)}<small>/週</small></span>}
      </div>
      <ReachBar now={l.viaPax} potential={l.potential} />
      <small className="tr-share">
        市場 {count(l.market)} 人/週 · {unflown ? `接上可占 ${sharePct(reachShare)}` : `你占 ${sharePct(share)}${l.potential - l.viaPax >= 1 ? `，接好 ${sharePct(reachShare)}` : ''}`}
      </small>
      <small className={`tr-why ${why.tone}`}>{why.text}</small>
      <div className="chips">
        <FixButton hub={hub} l={l} onOpenPair={onOpenPair} onSuggest={onSuggest} />
        <button className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起' : '市占'}</button>
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
      {list.length > shown && <button className="secondary" onClick={() => setShown(shown + page * 2)}>再顯示 {Math.min(page * 2, list.length - shown)} 個（共 {list.length}）</button>}
    </>
  );
}

function Legend({ hub, extra }: { hub: string; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="legend-line"><span className="k now">■</span> 現在載的 <span className="k more">■</span> 接好可多載<InfoDot open={open} onClick={() => setOpen(!open)} /></div>
      {open && <div className="info-note" onClick={() => setOpen(false)}>
        <p>「接好」是 4 小時內能轉機。百分比是你在這兩地所有航空旅客中的占比。</p>
        <p>轉機票價約直飛的 {pct(CONNECT_FARE_SHARE)}；等 4 小時以上的旅客少很多，8 小時以上算停留（票價約 {pct(STOPOVER_FARE_SHARE)}，{name(hub)}的停留吸引力約抵 {stopoverAppealHours(hub).toFixed(1)} 小時）。</p>
        {extra}
      </div>}
    </>
  );
}

/** A flight that would make quick connections, with the markets it fixes. */
function FixCard({ hub, f, onSuggest }: { hub: string; f: TimingFix; onSuggest: Suggest }) {
  const s = f.suggest;
  const pairs = f.markets.map((l) => `${l.o}⇄${l.d}`);
  return (
    <li className="fix">
      <div className="fix-top">
        <span className="name">
          <b>排一班 {hhmm(s.local)} {s.from} → {s.to}</b>
          <small>{s.before === undefined ? `${hhmm(s.arriveLocal)} 抵達${hub}的旅客 ${hm(Math.round((s.local - s.arriveLocal + 1440) % 1440))}後就能轉機` : `${hhmm(s.arriveLocal)} 到${hub}，接上 ${hhmm(s.before)} 那班`}</small>
        </span>
        <span className="tr-num good"><small>約</small>+{count(f.gain)}<small>/週</small></span>
      </div>
      <small className="tr-share">接好 {pairs.slice(0, 4).join('、')}{pairs.length > 4 ? ` 等 ${pairs.length} 個市場` : ''}{f.markets[0].wait !== null ? `（現在最快要等 ${hm(f.markets[0].wait)}）` : '（現在接不上）'}</small>
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
              <span className="name"><b>{hub} ⇄ {name(i.to)} {i.to}</b><small>{count(i.distKm)} 公里 · 每天一班 {count(i.seats)} 個座位/週</small></span>
              <span className="tr-num"><small>約</small>{count(want)}<small>/週</small></span>
              <button onClick={() => onOpenPair(hub, i.to)}>開航</button>
            </div>
            <div className="split" role="img" aria-label={`本地 ${count(i.local)}，轉機 ${count(i.via)}`}>
              <i className="nonstop" style={{ width: `${(i.local / top) * 100}%` }} /><i className="via" style={{ width: `${(i.via / top) * 100}%` }} />
              {i.seats > want && <i className="seats" style={{ width: `${((i.seats - want) / top) * 100}%` }} />}
            </div>
            <small>
              <span className="k nonstop">■</span> {hub}⇄{i.to} 本地 {count(i.local)}
              {i.via >= 1 ? <> · <span className="k via">■</span> 在{hub}轉機 {count(i.via)}（接 {i.markets.slice(0, 4).map((m) => m.d).join('、')}{i.markets.length > 4 ? ` 等 ${i.markets.length} 地` : ''}）</> : ' · 還接不到你的其他航線'}
              {want > i.seats * 1.05 ? ' · 一天一班坐不下，可加班或用大飛機' : ''}
            </small>
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
          <div><small>現在轉機/週</small><b>{count(transferPax)}</b></div>
          <div><small>接好可到</small><b className="more">{count(Math.max(reach, transferPax))}</b></div>
        </div>
        <ReachBar now={transferPax} potential={Math.max(reach, transferPax)} />
        <small>等 4–8 小時 {count(transfer.long)} 人 · 停留 {count(transfer.stopover)} 人 · 最短轉機 {transfer.mct} 分</small>
      </div>
      <Legend hub={hub} extra={<p>點地圖上其他機場，看它的「經{hub}轉機」，就知道那裡的旅客經{hub}能去哪裡。</p>} />
      {transit.carried.length > 0
        ? <>
          <h4>轉機市場 <small>{transit.carried.length} 個</small></h4>
          <More list={transit.carried} page={5} render={(l) => <TransitRow key={`${l.o}${l.d}`} hub={hub} l={l} net={net} onOpenPair={onOpenPair} onSuggest={onSuggest} />} />
        </>
        : <div className="hint center">還沒有人轉機：從{hub}飛兩條以上航線，抵達和出發隔 1–4 小時</div>}

      {transit.fixes.length > 0 && (
        <>
          <h4>調班表 <small>約 +{count(gain)} 人/週</small></h4>
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
        {view.legFlown
          ? <small>每週 <b>{count(view.now)}</b> 人在{hub}轉你的航班，接上 {linked.length} 個地方</small>
          : <small>開 {code} ⇄ {hub}：本地約 {count(view.local)} 人/週{view.unlockCount ? ` + 轉機 ${count(view.unlock)} 人（${view.unlockCount} 個地方）` : ''} · 每天一班 {count(view.seats)} 座/週</small>}
        {!view.legFlown && <button className="primary small" onClick={() => onOpenPair(code, hub)}>開航 {code} ⇄ {hub}</button>}
      </div>
      {view.rows.length > 0 && <Legend hub={hub} extra={!plan.hub && <p>你還沒設轉運站，這裡從基地 {hub} 來看。可在機場的「航線」分頁設轉運站。</p>} />}
      {linked.length > 0 && (
        <>
          <h4>{view.legFlown ? '已接上' : '開航後接上'} <small>{linked.length} 個</small></h4>
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
