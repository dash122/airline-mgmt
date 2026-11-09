import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FocusNote } from './codeshare';
import { JourneyPath, journeyLegs, journeyUses, orientJourney, shortName } from './journey';

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
    // Each airport carries the line to the next one: Changsha-Hong Kong (yours, thick), Hong Kong-Osaka (yours), Osaka-Tokyo (partner).
    const nodes = html.match(/class="jy-node [^"]*"/g)!;
    expect(nodes).toHaveLength(4);
    expect(nodes.filter((n) => /\bpartner\b/.test(n))).toHaveLength(1);
    expect(nodes.filter((n) => /\bown\b/.test(n))).toHaveLength(2);
    expect(nodes.filter((n) => /\bhere\b/.test(n))).toHaveLength(1);
    // Filled dots at the two ends, hollow ones where the traveller changes planes.
    expect(nodes.filter((n) => /\bend\b/.test(n))).toHaveLength(2);
    expect(nodes.filter((n) => /\bvia\b/.test(n))).toHaveLength(2);
  });

  test('gives every airport an equal column, so rows with the same number of stops line up', () => {
    const three = renderToStaticMarkup(<JourneyPath path={['HKG', 'KIX', 'HND']} partnerKey="HND-KIX" color="#0a0" airline="A" />);
    const other = renderToStaticMarkup(<JourneyPath path={['FUK', 'HND', 'HKG']} partnerKey="FUK-HND" color="#0a0" airline="A" />);
    expect(three).toContain('grid-template-columns:repeat(3, minmax(0, 1fr))');
    expect(other).toContain('grid-template-columns:repeat(3, minmax(0, 1fr))');
  });

  test('says in words which flights the traveller takes', () => {
    const html = renderToStaticMarkup(<JourneyPath path={path} partnerKey="HND-KIX" color="#0a0" airline="紫雲航空" />);
    expect(html).toContain('aria-label="長察，搭你的航班到香港，搭你的航班到大阪關西，搭紫雲航空到東京羽田"');
  });
});

describe('orientation and names', () => {
  test('reads every journey your flights first and the partner flight last', () => {
    expect(orientJourney(['HKG', 'HND', 'ITM'], 'HND-ITM')).toEqual(['HKG', 'HND', 'ITM']);
    expect(orientJourney(['CTS', 'HND', 'HKG'], 'CTS-HND')).toEqual(['HKG', 'HND', 'CTS']);
    expect(orientJourney(['FUK', 'HND', 'HKG'], 'FUK-HND')).toEqual(['HKG', 'HND', 'FUK']);
    // Partner flight first of three legs: turned round. In the middle of an even trip: left as it is.
    expect(orientJourney(['H', 'K', 'I', 'J'], 'H-K')).toEqual(['J', 'I', 'K', 'H']);
    expect(orientJourney(['A', 'B', 'C', 'D'], 'B-C')).toEqual(['A', 'B', 'C', 'D']);
  });

  test('a journey without the partner flight is left alone', () => {
    expect(orientJourney(['A', 'B', 'C'], 'X-Y')).toEqual(['A', 'B', 'C']);
  });

  test('labels drop a bracketed part so names are short', () => {
    expect(shortName('HKG')).toBe('香港');
    expect(shortName('MYJ')).not.toMatch(/[（(]/);
    expect(shortName('MYJ').length).toBeLessThan(5);
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
