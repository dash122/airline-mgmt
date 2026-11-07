import { afterEach, expect, it, vi } from 'vitest';
import MapCanvas from './MapCanvas';
import { emptyPlan, newAircraft } from '../sim/simulate';
import { GameClock } from './clock';

vi.mock('./airport-analysis', () => ({ useAirportAnalysis: () => null }));

const hooks = vi.hoisted(() => ({ effects: [] as (() => unknown)[], refs: [] as { current: unknown }[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useLayoutEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useRef: (current: unknown) => {
    const ref = { current };
    hooks.refs.push(ref);
    return ref;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  hooks.effects.length = 0;
  hooks.refs.length = 0;
});

it('reuses map labels between frames and refreshes them after visual changes', () => {
  const measureText = vi.fn(() => ({ width: 30 }));
  const drawImage = vi.fn();
  const ctx = new Proxy({ measureText, drawImage }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : () => {},
    set: () => true,
  });
  const canvas = {
    style: { transform: '' },
    width: 0, height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    setPointerCapture: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  };
  let frame: (time: number) => void = () => {};
  let resize: () => void = () => {};
  const doc = { hidden: false, createElement: () => ({ ...canvas }) };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { devicePixelRatio: 2 });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', (callback: typeof frame) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} closePath() {} });
  const props: Parameters<typeof MapCanvas>[0] = {
    plan: emptyPlan('TPE'), result: null, clock: new GameClock(0),
    selection: null, connectFrom: null, theme: 'day',
    onTapAirport() {}, onTapRoute() {}, onTapEmpty() {}, onDragRoute() {},
  };
  props.plan.fleet.push({ ...newAircraft(props.plan, 'A20N'), legs: [{ from: 'TPE', to: 'HKG', dep: 0 }] });
  MapCanvas(props);
  hooks.refs[0].current = canvas;
  hooks.refs.at(-1)!.current = { ...canvas };
  const cleanup = hooks.effects.at(-1)!() as () => void;
  try {
    // The initial geography and routes are painted synchronously on mount.
    const initial = measureText.mock.calls.length;
    expect(initial).toBeGreaterThan(0);
    const initialImages = drawImage.mock.calls.length;
    frame(performance.now() + 10);
    expect(drawImage).toHaveBeenCalledTimes(initialImages);
    frame(performance.now() + 40);
    expect(measureText).toHaveBeenCalledTimes(initial);
    expect(drawImage).toHaveBeenCalledTimes(initialImages);
    props.theme = 'night';
    frame(performance.now() + 80);
    expect(measureText.mock.calls.length).toBeGreaterThan(initial);
    const beforePlan = measureText.mock.calls.length;
    props.plan = { ...props.plan };
    frame(performance.now() + 120);
    expect(measureText.mock.calls.length).toBeGreaterThan(beforePlan);
    const beforeHidden = measureText.mock.calls.length;
    doc.hidden = true;
    props.theme = 'day';
    frame(performance.now() + 160);
    expect(measureText).toHaveBeenCalledTimes(beforeHidden);
    doc.hidden = false;
    resize();
    frame(performance.now() + 200);
    expect(measureText.mock.calls.length).toBeGreaterThan(beforeHidden);
    const listeners = new Map(canvas.addEventListener.mock.calls.map(([event, handler]) => [event, handler]));
    const pointer = { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 300 };
    listeners.get('pointerdown')(pointer);
    listeners.get('pointermove')({ ...pointer, clientX: 350 });
    const beforeDrag = measureText.mock.calls.length;
    frame(performance.now() + 240);
    expect(canvas.style.transform).toBe('');
    expect(measureText.mock.calls.length).toBeGreaterThan(beforeDrag);
    const screen = (window as unknown as { __wpScreen: (code: string) => number[] }).__wpScreen;
    const afterFirstMove = screen('TPE')[0];
    listeners.get('pointermove')({ ...pointer, clientX: 360 });
    // A second move must advance by its delta, without transform feedback.
    expect(screen('TPE')[0] - afterFirstMove).toBeCloseTo(10);
    const beforeFastFrame = measureText.mock.calls.length;
    frame(performance.now() + 256);
    expect(measureText.mock.calls.length).toBeGreaterThan(beforeFastFrame);
    listeners.get('pointerup')({ ...pointer, clientX: 350 });
    frame(performance.now() + 280);
    expect(canvas.style.transform).toBe('');
    expect(measureText.mock.calls.length).toBeGreaterThan(beforeDrag);
  } finally {
    cleanup();
  }
});
