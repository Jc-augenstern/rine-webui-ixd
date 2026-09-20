/** Native SVG reconstruction of the supplied IXD mark. No raster background. */
export function ixdMark(id = 'ixd') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="200 130 1160 1340" preserveAspectRatio="xMidYMid meet" role="img" aria-label="IXD" class="ixd-mark">
  <defs>
    <linearGradient id="${id}-frame" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#55dce0"/><stop offset=".5" stop-color="#8950ff"/><stop offset="1" stop-color="#55dce0"/></linearGradient>
    <linearGradient id="${id}-type"><stop stop-color="#8950ff"/><stop offset=".5" stop-color="#7394f6"/><stop offset="1" stop-color="#55dce0"/></linearGradient>
  </defs>
  <g class="ixd-symbol" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path data-stroke="frame" pathLength="1" d="M454 880 L309 735 Q280 706 309 677 L752 234 Q782 204 812 234 L1255 677 Q1285 706 1255 736 L812 1178 Q782 1208 752 1178 L616 1038" stroke="url(#${id}-frame)" stroke-width="88"/>
    <path data-stroke="cross" pathLength="1" d="M321 998 L682 637" stroke="#7e7bf7" stroke-width="64"/>
    <path data-stroke="arrow" pathLength="1" d="M877 782 L1235 424" stroke="#7e7bf7" stroke-width="64"/>
    <path data-arrowhead="" d="M1156 411 L1274 377 Q1286 374 1282 388 L1249 505 Q1246 517 1237 508 L1152 426 Q1142 416 1156 411Z" fill="#7e7bf7" stroke="none"/>
    <path data-stroke="front-a" pathLength="1" d="M324 418 L794 888" stroke="#6ba3ef" stroke-width="64"/>
    <path data-stroke="front-b" pathLength="1" d="M788 545 L1244 1002" stroke="#6ba3ef" stroke-width="64"/>
  </g>
  <g fill="url(#${id}-type)" class="ixd-word" transform="translate(634 1308) skewX(-8)">
    <path data-letter="" d="M0 0H24V142H0Z"/>
    <path data-letter="" d="M46 0H75L111 52L148 0H177L126 70L179 142H149L110 87L71 142H42L96 70Z"/>
    <path data-letter="" fill-rule="evenodd" d="M203 0H258Q315 0 315 57V85Q315 142 258 142H203ZM227 21V121H257Q290 121 290 85V57Q290 21 257 21Z"/>
  </g>
  </svg>`;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const strokeTimings = [[.12, 1.72], [.65, 1.1], [1.05, 1.15], [.8, 1.2], [1.02, 1.2]];

/** Deterministic, seekable reveal; safe to connect to the existing boot clock. */
export class IxdMotion {
  private strokes: SVGPathElement[];
  private head: SVGPathElement;
  private letters: SVGPathElement[];
  private root: SVGSVGElement;
  private strokeProgress: number[] = [];
  private strokeOpacity: number[] = [];
  private letterProgress: number[] = [];
  private arrowProgress = NaN;
  private settleProgress = NaN;
  private renderedTime = NaN;
  private revealEnd: number;
  constructor(root: SVGSVGElement) {
    this.root = root;
    this.strokes = [...root.querySelectorAll<SVGPathElement>('[data-stroke]')];
    this.head = root.querySelector('[data-arrowhead]')!;
    this.letters = [...root.querySelectorAll<SVGPathElement>('[data-letter]')];
    this.revealEnd = Math.max(2.5, 2.06 + (this.letters.length - 1) * .09 + .6);
    this.strokes.forEach(path => { path.style.strokeDasharray = '1 1'; });
  }
  render(seconds: number) {
    // Before the reveal and after it settles, the exact same SVG can be reused.
    seconds = Math.max(0, Math.min(seconds, this.revealEnd));
    if (seconds === this.renderedTime) return;
    this.renderedTime = seconds;
    this.strokes.forEach((path, i) => {
      const [start, duration] = strokeTimings[i];
      const p = ease((seconds - start) / duration);
      if (p !== this.strokeProgress[i]) {
        path.style.strokeDashoffset = String(1 - p);
        this.strokeProgress[i] = p;
      }
      const opacity = clamp(p * 18);
      if (opacity !== this.strokeOpacity[i]) {
        path.style.opacity = String(opacity);
        this.strokeOpacity[i] = opacity;
      }
    });
    const arrow = ease((seconds - 1.78) / .52);
    if (arrow !== this.arrowProgress) {
      this.head.style.opacity = String(arrow);
      this.head.setAttribute('transform', `translate(${-24 * (1 - arrow)} ${24 * (1 - arrow)})`);
      this.arrowProgress = arrow;
    }
    this.letters.forEach((letter, i) => {
      const p = ease((seconds - 2.06 - i * .09) / .6);
      if (p !== this.letterProgress[i]) {
        letter.style.opacity = String(p);
        letter.setAttribute('transform', `translate(0 ${22 * (1 - p)})`);
        this.letterProgress[i] = p;
      }
    });
    const settle = ease(seconds / 2.5);
    if (settle !== this.settleProgress) {
      this.root.style.transform = `scale(${.96 + settle * .04})`;
      this.settleProgress = settle;
    }
  }
}
