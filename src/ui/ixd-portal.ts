import "./ixd-portal.css";

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
export const PORTAL_DURATION = 2.4;
export const REDUCED_PORTAL_DURATION = 0.28;

/** A circular stargate over the live sky, driven only by the application's existing clock. */
export class IxdPortal {
  private element = document.createElement("div");
  private svg: SVGSVGElement;
  private edge: SVGCircleElement;
  private echo: SVGCircleElement;
  private bloom: SVGCircleElement;
  private orbits: SVGEllipseElement[];
  private lines: SVGLineElement[];
  private dust: SVGCircleElement[];
  private origin: HTMLElement;
  private home: HTMLElement;
  private originalStyle: string | null;
  private startRect = { x: 0, y: 0, width: 1, height: 1 };
  private skip: HTMLButtonElement;
  private width = 1;
  private height = 1;
  private anchor = { x: 0, y: 0, size: 62 };
  private elapsed = 0;
  private reduced = false;
  private events = new AbortController();

  constructor(private host: HTMLElement, private sky: HTMLElement, private core: HTMLElement, onSkip: () => void) {
    this.home = core.parentElement!;
    this.originalStyle = core.getAttribute("style");
    this.origin = document.createElement("div");
    this.origin.className = "welcome-logo shared-logo-origin";
    this.origin.setAttribute("aria-hidden", "true");
    this.origin.style.visibility = "hidden";
    this.home.insertBefore(this.origin, core);
    core.classList.add("ixd-shared-logo");
    this.element.className = "ixd-portal";
    this.element.hidden = true;
    this.element.innerHTML = `<svg class="ixd-portal-frame" aria-hidden="true">
      <defs><radialGradient id="ixd-portal-glow"><stop offset="0" stop-color="#fff4e2" stop-opacity=".95"/><stop offset=".32" stop-color="#b7a6ff" stop-opacity=".38"/><stop offset="1" stop-color="#63e3d6" stop-opacity="0"/></radialGradient></defs>
      <circle class="ixd-portal-bloom" fill="url(#ixd-portal-glow)"/>
      <g class="ixd-portal-lines">${Array.from({ length: 28 }, () => "<line/>").join("")}</g>
      <g class="ixd-portal-orbits">${Array.from({ length: 3 }, () => "<ellipse/>").join("")}</g>
      <circle class="ixd-portal-echo"/><circle class="ixd-portal-edge"/>
      <g class="ixd-portal-dust">${Array.from({ length: 18 }, (_, i) => `<circle r="${i % 3 === 0 ? 2.2 : 1.1}"/>`).join("")}</g>
    </svg>
    <button class="ixd-portal-skip" type="button">跳过过渡 <span aria-hidden="true">↗</span></button>`;
    this.svg = this.element.querySelector("svg.ixd-portal-frame")!;
    this.edge = this.element.querySelector(".ixd-portal-edge")!;
    this.echo = this.element.querySelector(".ixd-portal-echo")!;
    this.bloom = this.element.querySelector(".ixd-portal-bloom")!;
    this.orbits = [...this.element.querySelectorAll<SVGEllipseElement>(".ixd-portal-orbits ellipse")];
    this.lines = [...this.element.querySelectorAll("line")];
    this.dust = [...this.element.querySelectorAll<SVGCircleElement>(".ixd-portal-dust circle")];
    this.skip = this.element.querySelector("button")!;
    this.skip.addEventListener("click", onSkip, { signal: this.events.signal });
    this.element.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onSkip(); }
      if (event.key === "Tab") { event.preventDefault(); this.skip.focus(); }
    }, { signal: this.events.signal });
    host.append(this.element);
  }

  start(reduced: boolean, anchor: { x: number; y: number; size: number }) {
    this.reduced = reduced;
    this.elapsed = 0;
    this.element.hidden = false;
    this.element.dataset.reduced = String(reduced);
    this.measureOrigin();
    this.core.dataset.shared = "true";
    this.core.classList.add("ixd-portal-core");
    this.core.style.cssText = "position:absolute;left:0;top:0;margin:0;opacity:1;filter:none;transition:none;";
    // Move the actual Welcome node. Its authored SVG, gradients and IXD word persist.
    this.element.append(this.core);
    this.resize(anchor);
    this.skip.focus({ preventScroll: true });
    this.update(0);
  }

  resize(anchor: { x: number; y: number; size: number }) {
    this.width = this.host.clientWidth;
    this.height = this.host.clientHeight;
    this.anchor = anchor;
    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    this.measureOrigin();
    if (!this.element.hidden) this.update(this.elapsed);
  }

  private measureOrigin() {
    const rect = this.origin.getBoundingClientRect(), host = this.host.getBoundingClientRect();
    const sx = this.host.clientWidth / Math.max(1, host.width), sy = this.host.clientHeight / Math.max(1, host.height);
    this.startRect = { x: (rect.left + rect.width / 2 - host.left) * sx,
      y: (rect.top + rect.height / 2 - host.top) * sy, width: rect.width * sx, height: rect.height * sy };
  }

  private moveCore(seconds: number) {
    const from = this.startRect;
    if (this.reduced) {
      this.core.style.width = `${from.width}px`;
      this.core.style.height = `${from.height}px`;
      this.core.style.transform = `translate(${from.x}px,${from.y}px) translate(-50%,-50%)`;
      this.core.style.opacity = String(1 - ease(seconds / REDUCED_PORTAL_DURATION));
      return;
    }
    const gather = ease(seconds / .65);
    const settle = ease((seconds - 1.95) / .45);
    const x = from.x + (this.width / 2 - from.x) * gather;
    const y = from.y + (this.height / 2 - from.y) * gather;
    this.core.style.width = `${from.width + (52 - from.width) * gather}px`;
    this.core.style.height = `${from.height + (60 - from.height) * gather}px`;
    this.core.style.transform = `translate(${x + (this.anchor.x - x) * settle}px,${y + (this.anchor.y - y) * settle}px) translate(-50%,-50%)`;
    this.core.style.opacity = String(1 - ease((settle - .64) / .36));
  }

  update(seconds: number) {
    this.elapsed = seconds;
    const w = this.width, h = this.height, cx = w / 2, cy = h / 2;
    this.moveCore(seconds);
    if (this.reduced) {
      // Brief stationary reveal; no warp streaks, orbit rings or flying core.
      const p = ease(seconds / REDUCED_PORTAL_DURATION);
      this.sky.style.clipPath = `circle(${(p * 75).toFixed(2)}% at 50% 50%)`;
      return;
    }
    // Star birth: a point of light gathers, the gate irises open, the sky
    // streams outward like a short warp, then the orbit rings dissolve.
    const gather = ease(seconds / 0.45);
    const open = ease((seconds - 0.45) / 0.75);
    const cross = ease((seconds - 1.2) / 0.75);
    const settle = ease((seconds - 1.95) / 0.45);
    const initial = Math.min(w, h) * 0.06;
    const middle = Math.min(w, h) * 0.36;
    const far = Math.hypot(w, h) * .56;
    const radius = seconds < .45 ? initial * gather : seconds < 1.2
      ? initial + (middle - initial) * open
      : middle + (far - middle) * cross;
    const hole = seconds < .45 ? 0 : radius;
    this.sky.style.clipPath = `circle(${hole.toFixed(1)}px at ${cx}px ${cy}px)`;
    for (const ring of [this.edge, this.echo, this.bloom]) { ring.setAttribute("cx", String(cx)); ring.setAttribute("cy", String(cy)); }
    this.edge.setAttribute("r", String(radius));
    this.echo.setAttribute("r", String(radius * 1.04 + 9));
    this.bloom.setAttribute("r", String(Math.max(1, initial * 2.8 * gather + radius * .45)));
    this.bloom.style.opacity = String(gather * (1 - cross) * .9);
    this.svg.style.opacity = String(1 - settle);
    this.orbits.forEach((orbit, i) => {
      const k = 1.3 + i * .42;
      orbit.setAttribute("cx", String(cx)); orbit.setAttribute("cy", String(cy));
      orbit.setAttribute("rx", String(radius * k)); orbit.setAttribute("ry", String(radius * k * (.32 + i * .07)));
      orbit.setAttribute("transform", `rotate(${(-18 + i * 26 + seconds * (8 + i * 5)).toFixed(2)} ${cx} ${cy})`);
      orbit.style.opacity = String(open * (1 - cross * .85) * (.55 - i * .13));
    });
    this.lines.forEach((line, i) => {
      // Warp streaks on seeded lanes, sliding outward from the gate's rim.
      const angle = i * 2.39996;
      const lane = (i * 37 % 100) / 100;
      const travel = (lane + seconds * (.55 + lane * .5)) % 1;
      const inner = radius * (1.02 + travel * .9);
      const outer = inner + (18 + lane * 60) * (.35 + cross * 1.4);
      line.setAttribute("x1", String(cx + Math.cos(angle) * inner));
      line.setAttribute("y1", String(cy + Math.sin(angle) * inner));
      line.setAttribute("x2", String(cx + Math.cos(angle) * outer));
      line.setAttribute("y2", String(cy + Math.sin(angle) * outer));
      line.style.opacity = String(gather * (1 - settle) * (1 - travel) * (.3 + lane * .45));
    });
    this.dust.forEach((dot, i) => {
      const a = i / this.dust.length * Math.PI * 2 + seconds * (.6 + (i % 3) * .18);
      const rr = radius * (1 + (i % 4) * .012) + (i % 2 ? 4 : -3);
      dot.setAttribute("cx", String(cx + Math.cos(a) * rr));
      dot.setAttribute("cy", String(cy + Math.sin(a) * rr));
      dot.style.opacity = String(open * (1 - settle) * (i % 3 === 0 ? .9 : .45));
    });
  }

  finish() {
    this.element.hidden = true;
    this.sky.style.removeProperty("clip-path");
    this.home.append(this.core);
    delete this.core.dataset.shared;
    this.core.classList.remove("ixd-portal-core");
    if (this.originalStyle === null) this.core.removeAttribute("style");
    else this.core.setAttribute("style", this.originalStyle);
    this.core.style.opacity = "0";
  }

  dispose() { this.finish(); this.origin.remove(); this.events.abort(); this.element.remove(); }
}
