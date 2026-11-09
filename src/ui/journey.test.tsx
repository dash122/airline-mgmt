import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FocusNote } from './codeshare';
import { JourneyPath, journeyLegs, journeyUses } from './journey';

// The journey from Changsha to Tokyo: your Changsha-Hong Kong and Hong Kong-Osaka flights, then the partner's Osaka-Tokyo.
const path = ['CSX', 'HKG', 'KIX', 'HND'];

describe('journey path', () => {
  test('knows the legs and which route a journey uses, in either direction', () => {
    expect(journeyLegs(path).map((l) => l.key)).toEqual(['CSX-HKG', 'HKG-KIX', 'HND-KIX']);
    expect(journeyUses(path, 'CSX-HKG')).toBe(true);
    expect(journeyUses([...path].reverse(), 'CSX-HKG')).toBe(true);
    expect(journeyUses(path, 'HKG-TPE')).toBe(false);
  });

  test('draws the partner flight dashed, yours solid, and the route you came from thicker', () => {
    const html = renderToStaticMarkup(<JourneyPath path={path} partnerKey="HND-KIX" color="#0a0" airline="紫雲航空" here="CSX-HKG" />);
    expect(html.match(/jy-leg partner/g)).toHaveLength(1);
    expect(html.match(/jy-leg own/g)).toHaveLength(2);
    expect(html.match(/ here/g)).toHaveLength(1);
    // Filled dots at the two ends, hollow ones where the traveller changes planes.
    expect(html.match(/jy-node end/g)).toHaveLength(2);
    expect(html.match(/jy-node via/g)).toHaveLength(2);
  });

  test('says in words which flights the traveller takes', () => {
    const html = renderToStaticMarkup(<JourneyPath path={path} partnerKey="HND-KIX" color="#0a0" airline="紫雲航空" />);
    expect(html).toContain('aria-label="長察，搭你的航班到香港，搭你的航班到大阪關西，搭紫雲航空到東京羽田"');
  });
});

describe('focus note', () => {
  const journeys = [{ path: ['HKG', 'KIX', 'HND'], pax: 1096 }, { path, pax: 23 }];

  test('says how many of the partner\'s travellers go on to the route you came from', () => {
    const text = renderToStaticMarkup(<FocusNote journeys={journeys} focus="CSX-HKG" />).replace(/<[^>]+>/g, '');
    expect(text).toContain('23 人/週（2%）會再搭你的');
  });

  test('says so when none do', () => {
    const text = renderToStaticMarkup(<FocusNote journeys={journeys} focus="HKG-TPE" />).replace(/<[^>]+>/g, '');
    expect(text).toContain('沒有旅客再搭你的');
  });
});
