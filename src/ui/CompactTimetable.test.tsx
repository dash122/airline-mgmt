import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompactTimetable, chronological } from './CompactTimetable';
import { emptyPlan, utcFromLocal } from '../sim/simulate';
import { rivalsFrom } from '../sim/competitors';

describe('compact comparison timetable', () => {
  test('sorts the repeating day by local departure, including UTC and day boundaries', () => {
    const rows = [
      { id: 'late', dep: utcFromLocal('TPE', 23 * 60) },
      { id: 'next-day-morning', dep: utcFromLocal('TPE', 6 * 60) + 1440 },
      { id: 'midnight', dep: utcFromLocal('TPE', 15) },
    ];
    expect(chronological(rows, 'TPE').map((r) => r.id)).toEqual(['midnight', 'next-day-morning', 'late']);
    expect(rows[0].id).toBe('late');
  });

  test('interleaves player and competitor departures and preserves flight editing', () => {
    const plan = emptyPlan('TPE');
    plan.fleet.push({ id: 'test', reg: 'TEST-1', type: 'A20N', legs: [
      { from: 'TPE', to: 'HKG', dep: utcFromLocal('TPE', 1) },
      { from: 'HKG', to: 'TPE', dep: utcFromLocal('HKG', 600) },
    ] });
    const services = rivalsFrom('TPE', 'HKG');
    expect(services.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(<CompactTimetable from="TPE" to="HKG" services={services} plan={plan} onEdit={() => {}} />);
    expect(html).toContain('自家');
    expect(html).toContain('自選');
    expect(html).toContain('TEST-1');
    expect(html).toContain('調整這班航班');
    expect(html.indexOf('你的航空，TPE 00:01')).toBeLessThan(html.indexOf(services[0].airline.name + '，TPE'));
    expect(html.match(/class="compact-flight"/g)?.length).toBe(services.reduce((n, s) => n + s.times.length, 0) + 1);
  });

  test('shows an empty state when a direction has no departures', () => {
    const html = renderToStaticMarkup(<CompactTimetable from="TPE" to="HKG" services={[]} />);
    expect(html).toContain('沒有符合篩選的航班');
  });
});
