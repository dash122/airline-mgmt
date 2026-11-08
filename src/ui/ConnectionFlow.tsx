// How this route's travellers get onto it: each origin → destination market flows in, coloured by the airport where it
// changes planes, into one bar for the route. Direct travellers are in the split above, so only connecting ones show here.
// Codeshare partners' share of the connecting travellers sits underneath.
import { useMemo } from 'react';
import { pairKey } from '../sim/markets';
import { routeConnections } from '../sim/connections';
import type { NetworkResult } from '../sim/simulate';
import { count, pct } from './format';

const ROW = 36;
const W = 360;
const LEFT_X = 128;
const RIGHT_X = 286;
const BAR_W = 8;
const MAX_MARKETS = 4;
const MIN_BAND = 2;

interface Node { key: string; label: string; sub: string; pax: number; color: string }

export function ConnectionFlow({ a, b, net }: { a: string; b: string; net?: NetworkResult | null }) {
  const nodes = useMemo<Node[]>(() => {
    const flows = routeConnections(net, a, b);
    const out: Node[] = [];
    const shown = flows.slice(0, MAX_MARKETS);
    for (const f of shown) {
      out.push({
        key: `${f.from}|${f.via}|${f.to}`,
        label: `${f.from} → ${f.to}`,
        sub: `在 ${f.via} 接上`,
        pax: f.pax,
        color: f.via === a ? 'var(--accent)' : 'var(--sel)',
      });
    }
    const rest = flows.slice(MAX_MARKETS).reduce((s, f) => s + f.pax, 0);
    if (rest >= 1) out.push({ key: 'rest', label: `其他 ${flows.length - MAX_MARKETS} 個市場`, sub: '', pax: rest, color: 'var(--muted)' });
    return out;
  }, [a, b, net]);

  const total = nodes.reduce((s, n) => s + n.pax, 0);
  if (total < 1) return null;

  // Shared scale for both ends of every band, so widths read the same on the left and the right.
  const maxPax = Math.max(...nodes.map((n) => n.pax));
  const k = (ROW * 0.7) / maxPax;
  const leftH = nodes.length * ROW;
  const rightH = total * k;
  const H = Math.max(leftH, rightH) + 4;
  const rightTop = (H - rightH) / 2;
  const xm = (LEFT_X + RIGHT_X) / 2;

  let cum = rightTop;
  const bands = nodes.map((n, i) => {
    const t = Math.max(MIN_BAND, n.pax * k);
    const yl = i * ROW + ROW / 2 - t / 2;
    const yr = cum;
    cum += n.pax * k;
    const d = `M ${LEFT_X} ${yl} C ${xm} ${yl}, ${xm} ${yr}, ${RIGHT_X} ${yr} L ${RIGHT_X} ${yr + t} C ${xm} ${yr + t}, ${xm} ${yl + t}, ${LEFT_X} ${yl + t} Z`;
    return { n, d, yl, t };
  });

  // Codeshare: travellers on partners' itineraries that fly this route (a subset of the connecting travellers).
  const key = pairKey(a, b);
  const shareWith = Object.values(net?.codeshares ?? {}).flatMap((c) => c.feeds.filter((f) => f.key === key && f.pax >= 1).map((f) => ({ airline: c.airline, pax: f.pax })));
  const sharePax = shareWith.reduce((s, x) => s + x.pax, 0);
  const connecting = nodes.filter((n) => n.key !== 'local').reduce((s, n) => s + n.pax, 0);

  return (
    <div className="conn-flow">
      <div className="conn-head"><b>接駁旅客怎麼上這條航線</b><span>{count(connecting)} 人／週 接駁</span></div>
      <svg className="conn-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={nodes.map((n) => `${n.label} ${count(n.pax)} 人`).join('，')}>
        {bands.map(({ n, d }) => <path key={n.key} d={d} fill={n.color} fillOpacity={n.key === 'local' ? 0.45 : 0.35} />)}
        {nodes.map((n, i) => {
          const cy = i * ROW + ROW / 2;
          return (
            <g key={`l-${n.key}`}>
              <text x={0} y={cy - 2} className="conn-label">{n.label}</text>
              <text x={0} y={cy + 11} className="conn-sub">{n.sub ? `${n.sub} · ` : ''}{count(n.pax)} 人</text>
            </g>
          );
        })}
        <rect x={RIGHT_X} y={rightTop} width={BAR_W} height={rightH} rx={2} fill="var(--accent)" />
        <text x={RIGHT_X + BAR_W + 6} y={rightTop + rightH / 2 - 2} className="conn-label">本航線</text>
        <text x={RIGHT_X + BAR_W + 6} y={rightTop + rightH / 2 + 11} className="conn-sub">{count(total)} 人</text>
      </svg>
      <div className="conn-legend">
        <span><i style={{ background: 'var(--accent)' }} />在 {a} 接上</span>
        <span><i style={{ background: 'var(--sel)' }} />在 {b} 接上</span>
      </div>
      <div className="conn-share">
        <div className="conn-share-bar" role="img" aria-label={`共享夥伴帶進 ${count(sharePax)} 人，占接駁 ${pct(connecting > 0 ? sharePax / connecting : 0)}`}>
          <i style={{ width: `${connecting > 0 ? Math.min(100, (100 * sharePax) / connecting) : 0}%` }} />
        </div>
        <span>
          {sharePax >= 1
            ? <>共享夥伴帶進 <b>{count(sharePax)}</b> 人，占接駁 {pct(sharePax / Math.max(1, connecting))}（{shareWith.map((x) => x.airline).join('、')}）</>
            : '沒有共享夥伴帶進這條航線'}
        </span>
      </div>
    </div>
  );
}
