// Pointer-tracked specular highlight for the Liquid Glass surfaces (see glass.css).
const SEL = '.sheet, .tabbar, .island, .speed, .map-legend, button.primary, .primary.wide, button.secondary, button.ghost, .chip';

export function initGlass(): void {
  if (typeof document === 'undefined') return;
  let raf = 0;
  document.addEventListener('pointermove', (e) => {
    if (raf) return;
    const { clientX, clientY, target } = e;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const el = target instanceof Element ? target.closest<HTMLElement>(SEL) : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      el.style.setProperty('--gx', `${((clientX - r.left) / r.width) * 100}%`);
      el.style.setProperty('--gy', `${((clientY - r.top) / r.height) * 100}%`);
    });
  }, { passive: true });
}
