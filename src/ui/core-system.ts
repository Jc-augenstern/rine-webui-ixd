import type { StarPosition } from '../data/star-map';

/** Fixed navigation anchors: the surrounding galaxy can breathe, the targets do not orbit. */
export const coreSystemLayout: Record<string, { position: StarPosition; mobilePosition: StarPosition }> = {
  ai: { position: { x: .38, y: .19 }, mobilePosition: { x: .27, y: .12 } },
  robotics: { position: { x: .72, y: .27 }, mobilePosition: { x: .73, y: .25 } },
  interaction: { position: { x: .83, y: .62 }, mobilePosition: { x: .27, y: .42 } },
  visual: { position: { x: .59, y: .81 }, mobilePosition: { x: .73, y: .56 } },
  xr: { position: { x: .27, y: .72 }, mobilePosition: { x: .27, y: .72 } },
  hardware: { position: { x: .13, y: .38 }, mobilePosition: { x: .73, y: .86 } },
};

const dust = Array.from({ length: 90 }, (_, i) => {
  const t = i * 2.39996, r = 25 + ((i * 41) % 350);
  const x = 500 + Math.cos(t) * r, y = 500 + Math.sin(t) * r * .66;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i % 6 === 0 ? 1.6 : .8}" opacity="${.18 + i % 5 * .07}"/>`;
}).join('');

export const coreSystemMarkup = `<div class="sm-core-system" aria-hidden="true">
  <div class="sm-core-atmosphere"></div>
  <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
    <g class="sm-core-arms"><path d="M100 620C135 370 695 176 816 392S429 705 366 528S598 418 551 503"/><path d="M904 335C812 672 318 802 199 601S542 271 625 443S433 582 458 509"/></g>
    <g class="sm-core-orbits"><ellipse cx="500" cy="500" rx="382" ry="273"/><ellipse cx="500" cy="500" rx="235" ry="154"/></g>
    <g class="sm-core-dust">${dust}</g>
  </svg>
  <div class="sm-core-center"><i></i><span>IXD CORE</span><small>六个方向 · 一个灵感宇宙</small></div>
</div><div class="sm-core-heading"><p>IXD CORE / INNER GALAXY</p><h2>六方向星系</h2><span>选择一颗方向星，探索它的知识与实践</span></div>`;

export const smoothRange = (value: number, start: number, end: number) => {
  const p = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return p * p * (3 - 2 * p);
};
