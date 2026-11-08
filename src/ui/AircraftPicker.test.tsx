import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AircraftPicker } from './NewRoute';
import { AIRCRAFT } from '../data/aircraft';
import { routeChoices, type RoutePreview, type RouteChoice } from '../sim/newroute';
import { emptyPlan } from '../sim/simulate';

const preview = (networkDelta: number): RoutePreview => ({ pax: 100, seats: 200, loadFactor: 0.5, routeProfit: 0, networkDelta, lease: 0 });

describe('aircraft picker', () => {
  test('shows every type that can fly the route as one tile each, with the chosen one selected', () => {
    const plan = emptyPlan('TPE');
    const choices = routeChoices(plan, 'TPE', 'LAX');
    const previews = new Map<string, RoutePreview>(choices.map((c, i) => [c.id, preview(1_000_000 - i * 1000)]));
    const best: RouteChoice = choices[0];
    const html = renderToStaticMarkup(<AircraftPicker plan={plan} choices={choices} previews={previews} best={best} chosen={best} onPick={() => {}} />);

    expect(html.match(/<button[^>]*class="ac-tile[ "]/g)?.length).toBe(choices.length);
    expect(html.match(/aria-checked="true"/g)?.length).toBe(1);
    expect(html).toContain('aria-label="飛機方案"');
    expect(html).toContain('ac-hero');
    expect(html).toContain('建議');
    expect(html).toContain(AIRCRAFT[best.type].name);
  });

  test('lists the new long-haul types, and the A380 only where its runways allow', () => {
    const plan = emptyPlan('TPE');
    const choices = routeChoices(plan, 'TPE', 'LAX');
    const previews = new Map<string, RoutePreview>(choices.map((c) => [c.id, preview(0)]));
    const html = renderToStaticMarkup(<AircraftPicker plan={plan} choices={choices} previews={previews} best={choices[0]} chosen={choices[0]} onPick={() => {}} />);
    for (const t of ['A388', 'B779', 'A35K', 'B78X', 'A339'] as const) {
      expect(html, t).toContain(`title="租用 · ${AIRCRAFT[t].name}"`);
    }
  });

  test('renders nothing when no aircraft can fly the route', () => {
    const plan = emptyPlan('TPE');
    const html = renderToStaticMarkup(<AircraftPicker plan={plan} choices={[]} previews={new Map()} best={null} chosen={null} onPick={() => {}} />);
    expect(html).toBe('');
  });
});
