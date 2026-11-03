// Web Mercator in degree-like units, plus a pan/zoom view.
export interface View {
  cx: number; // projected center x
  cy: number; // projected center y
  scale: number; // pixels per projected unit
}

const DEG = 180 / Math.PI;
export const projX = (lon: number) => lon;
export const nearestLongitude = (lon: number, center: number) => lon + 360 * Math.round((center - lon) / 360);

/** World copies intersecting the viewport, including a margin for routes. */
export function worldCopies(view: View, width: number): number[] {
  const left = Math.floor((view.cx - width / (2 * view.scale) + 180) / 360) - 1;
  const right = Math.floor((view.cx + width / (2 * view.scale) + 180) / 360) + 1;
  return Array.from({ length: right - left + 1 }, (_, i) => (left + i) * 360);
}
export const projY = (lat: number) => DEG * Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));

export function toScreen(view: View, w: number, h: number, lat: number, lon: number): [number, number] {
  return [w / 2 + (projX(lon) - view.cx) * view.scale, h / 2 - (projY(lat) - view.cy) * view.scale];
}

export function screenToProj(view: View, w: number, h: number, x: number, y: number): [number, number] {
  return [view.cx + (x - w / 2) / view.scale, view.cy - (y - h / 2) / view.scale];
}

/** View that fits a lat/lon box into a w x h canvas. */
export function fitView(w: number, h: number, minLat: number, minLon: number, maxLat: number, maxLon: number): View {
  const x0 = projX(minLon), x1 = projX(maxLon), y0 = projY(minLat), y1 = projY(maxLat);
  const scale = Math.min(w / (x1 - x0), h / (y1 - y0));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale };
}

/** Zoom around a screen point. */
export function zoomAt(view: View, w: number, h: number, x: number, y: number, factor: number): View {
  const [px, py] = screenToProj(view, w, h, x, y);
  const scale = Math.max(0.5, Math.min(400, view.scale * factor));
  return { scale, cx: px - (x - w / 2) / scale, cy: py + (y - h / 2) / scale };
}
