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
  const more = gap >= 1 ? `，接好約可多載 ${count(gap)} 人/週` : '';
  const dir = l.slow ? `${l.slow.from}→${l.slow.to} ` : '';
  switch (l.status) {
    case 'connected':
      return l.full && gap >= 1
        ? { text: `時間接得好，但航班太滿${more}：加班或換大飛機。`, tone: 'warn' }
        : { text: `在${hub}轉機${l.wait ? ` ${hm(l.wait)}` : ''}，接得好。`, tone: 'good' };
    case 'long':
      return l.wait !== null && layoverKind(l.wait) === 'stopover'
        ? { text: `${dir}要在${hub}停留 ${hm(l.wait)}，只有想順便進城的人會搭${more}。`, tone: 'warn' }
        : { text: `${dir}要在${hub}等 ${hm(l.wait ?? 0)}，多數人改搭別家${more}。`, tone: 'warn' };
    case 'timing':
      return { text: `兩段都有飛，但${dir}班次接不上，沒人能轉${more}。`, tone: 'bad' };
    case 'leg':
      return { text: `還沒飛 ${l.missing.map((m) => `${hub}⇄${m}`).join('、')}。開航後每天一班約可載 ${count(l.potential)} 人/週。`, tone: 'idle' };
    case 'nonstop':
      return { text: '你已經直飛這兩地。', tone: 'good' };
    default:
      return { text: `經${hub}繞路太遠，旅客不會選。`, tone: 'bad' };
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
        這兩地每週 {count(l.market)} 人搭飛機 · {unflown ? `接上後約占 ${sharePct(reachShare)}` : `你經${hub}占 ${sharePct(share)}${l.potential - l.viaPax >= 1 ? `，接好可到 ${sharePct(reachShare)}` : ''}`}
      </small>
      <small className={`tr-why ${why.tone}`}>{why.text}</small>
      <div className="chips">
        <FixButton hub={hub} l={l} onOpenPair={onOpenPair} onSuggest={onSuggest} />
        <button className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起' : '誰載這兩地的旅客'}</button>
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

const Legend = ({ hub }: { hub: string }) => (
  <div className="hint">
    <span className="k now">■</span> 你現在經{hub}載的 <span className="k more">■</span> 班次接好（4 小時內轉機）還能多載的。
    百分比是你在這兩地之間所有航空旅客中的占比。轉機票價約直飛的 {pct(CONNECT_FARE_SHARE)}；等 4 小時以上的旅客少很多，8 小時以上是停留（票價約 {pct(STOPOVER_FARE_SHARE)}，{name(hub)}的停留吸引力約抵 {stopoverAppealHours(hub).toFixed(1)} 小時）。
  </div>
);

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
          <div><small>現在每週在{hub}轉機</small><b>{count(transferPax)}</b></div>
          <div><small>班次都接好可到</small><b className="more">{count(Math.max(reach, transferPax))}</b></div>
        </div>
        <ReachBar now={transferPax} potential={Math.max(reach, transferPax)} />
        <small>其中等 4 到 8 小時的 {count(transfer.long)} 人、停留 8 小時以上的 {count(transfer.stopover)} 人 · 最短轉機 {transfer.mct} 分</small>
      </div>
      {transit.carried.length > 0
        ? <>
          <h4>在{hub}轉機的市場 <small>{transit.carried.length} 個城市對 · 載最多的在前</small></h4>
          <More list={transit.carried} page={5} render={(l) => <TransitRow key={`${l.o}${l.d}`} hub={hub} l={l} net={net} onOpenPair={onOpenPair} onSuggest={onSuggest} />} />
        </>
        : <div className="hint center">還沒有旅客在{hub}換機。從{hub}飛出兩條以上的航線，並讓抵達和出發相隔 1 到 4 小時。</div>}

      {transit.fixes.length > 0 && (
        <>
          <h4>調班表就能多載 <small>約 +{count(gain)} 人/週</small></h4>
          <ul className="trs">{transit.fixes.slice(0, 5).map((f) => <FixCard key={`${f.suggest.from}${f.suggest.to}${f.suggest.local}`} hub={hub} f={f} onSuggest={onSuggest} />)}</ul>
        </>
      )}

      {ideas.length > 0 && (
        <>
          <h4>開新航線，接上更多轉機 <small>每週，雙向</small></h4>
          <HubIdeas hub={hub} ideas={ideas} onOpenPair={onOpenPair} />
        </>
      )}
      <Legend hub={hub} />
      <div className="hint">點地圖上其他機場，再看它的「經{hub}轉機」，就能看到那裡的旅客經{hub}可以去哪裡。</div>
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
          ? <small>{name(code)}的旅客可以在{hub}換搭你的航班。現在每週 <b>{count(view.now)}</b> 人這樣搭，接上 {linked.length} 個地方。</small>
          : <small>還沒飛 {code} ⇄ {hub}。開了之後，{name(code)}的旅客就能在{hub}換搭你的航班：本地約 {count(view.local)} 人/週{view.unlockCount ? `，再加上轉機到你從${hub}已飛的 ${view.unlockCount} 個地方約 ${count(view.unlock)} 人/週` : ''}。每天一班 {count(view.seats)} 個座位/週。</small>}
        {!view.legFlown && <button className="primary small" onClick={() => onOpenPair(code, hub)}>開航 {code} ⇄ {hub}</button>}
      </div>
      {linked.length > 0 && (
        <>
          <h4>{view.legFlown ? '已接上' : `開了 ${code}⇄${hub} 就能接上`} <small>{linked.length} 個地方{view.legFlown ? ` · 現在 ${count(view.now)} 人/週` : ''}</small></h4>
          <More list={linked} page={6} render={row} />
        </>
      )}
      {open.length > 0 && (
        <>
          <h4>再開一條 {hub} 出發的航線就能去 <small>可載最多的在前</small></h4>
          <More list={open} page={6} render={row} />
        </>
      )}
      {view.rows.length === 0 && <div className="hint center">經{hub}轉機繞路太遠，{name(code)}比較適合直飛。</div>}
      {view.rows.length > 0 && <Legend hub={hub} />}
      {!plan.hub && <div className="hint">你還沒設轉運站，這裡從基地 {hub} 來看。到一個機場的「航線」分頁可以設轉運站。</div>}
    </>
  );
}
