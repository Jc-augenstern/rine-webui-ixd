import "./ixd-portal.css";

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
export const PORTAL_DURATION = 2.4;
export const REDUCED_PORTAL_DURATION = 0.28;

/** A clip over the live sky, driven only by the application's existing clock. */
export class IxdPortal {
  private element = document.createElement("div");
  private svg: SVGSVGElement;
  private edge: SVGPolygonElement;
  private echo: SVGPolygonElement;
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
      <g class="ixd-portal-lines">${Array.from({ length: 8 }, () => '<line/>').join("")}</g>
      <polygon class="ixd-portal-echo"/><polygon class="ixd-portal-edge"/>
      <g class="ixd-portal-dust">${Array.from({ length: 16 }, (_, i) => `<circle r="${i % 3 === 0 ? 1.8 : 1}"/>`).join("")}</g>
    </svg>
    <button class="ixd-portal-skip" type="button">跳过过渡 <span aria-hidden="true">↗</span></button>`;
    this.svg = this.element.querySelector("svg.ixd-portal-frame")!;
    this.edge = this.element.querySelector(".ixd-portal-edge")!;
    this.echo = this.element.querySelector(".ixd-portal-echo")!;
    this.lines = [...this.element.querySelectorAll("line")];
    this.dust = [...this.element.querySelectorAll("circle")];
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
      // Brief stationary reveal; no camera travel, contracting lines or flying core.
      const p = ease(seconds / REDUCED_PORTAL_DURATION);
      this.sky.style.clipPath = `inset(${(1 - p) * 50}% ${(1 - p) * 50}%)`;
      return;
    }
    const gather = ease(seconds / 0.45);
    const open = ease((seconds - 0.45) / 0.75);
    const cross = ease((seconds - 1.2) / 0.75);
    const settle = ease((seconds - 1.95) / 0.45);
    const initial = Math.min(w, h) * 0.075;
    const middle = Math.min(w, h) * 0.4;
    const radius = seconds < .45 ? initial * gather : seconds < 1.2
      ? initial + (middle - initial) * open
      : middle + ((w + h) * .55 - middle) * cross;
    const diamond = (r: number) => `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
    const hole = seconds < .45 ? 0 : radius;
    this.sky.style.clipPath = `polygon(${cx}px ${cy - hole}px,${cx + hole}px ${cy}px,${cx}px ${cy + hole}px,${cx - hole}px ${cy}px)`;
    this.edge.setAttribute("points", diamond(radius));
    this.echo.setAttribute("points", diamond(radius * 1.025 + 7));
    this.svg.style.opacity = String(1 - settle);
    this.lines.forEach((line, i) => {
      const angle = i * Math.PI / 4;
      const outer = Math.max(w, h) * .8 * (1 - gather) + radius;
      const inner = radius * .72;
      line.setAttribute("x1", String(cx + Math.cos(angle) * inner));
      line.setAttribute("y1", String(cy + Math.sin(angle) * inner));
      line.setAttribute("x2", String(cx + Math.cos(angle) * outer));
      line.setAttribute("y2", String(cy + Math.sin(angle) * outer));
      line.style.opacity = String((1 - open) * .6);
    });
    this.dust.forEach((dot, i) => {
      const u = ((i / 4 + seconds * .13) % 1);
      const edge = Math.floor(i / 4);
      const points = [[cx, cy - radius], [cx + radius, cy], [cx, cy + radius], [cx - radius, cy]];
      const a = points[edge], b = points[(edge + 1) % 4];
      dot.setAttribute("cx", String(a[0] + (b[0] - a[0]) * u));
      dot.setAttribute("cy", String(a[1] + (b[1] - a[1]) * u));
      dot.style.opacity = String(open * (1 - settle) * (i % 3 === 0 ? .8 : .4));
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
