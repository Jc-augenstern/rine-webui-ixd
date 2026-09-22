import { bootMotion } from "./boot-motion";
import { IxdMotion } from "./ixd-mark";
import { themeAmount } from "./theme-ui";
import { BootLettering } from "./boot-lettering";
import { welcomeFlashState, welcomeTextState } from "./welcome-transition";

const ns = "http://www.w3.org/2000/svg";
const arc = (r: number, start: number, sweep: number, x = 960, y = 540) => {
  const point = (a: number) => `${x + Math.cos(a) * r},${y + Math.sin(a) * r}`;
  if (sweep >= Math.PI * 1.999)
    return `M${point(start)}A${r},${r} 0 1 1 ${point(start + Math.PI)}A${r},${r} 0 1 1 ${point(start + Math.PI * 2)}`;
  return `M${point(start)}A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(start + sweep)}`;
};

export class BootSequence {
  private nodes: Map<string, HTMLElement> = new Map();
  private logoMotion: IxdMotion;
  private brandLines: HTMLElement[];
  private scanPaths: SVGPathElement[];
  private orbitDots: SVGCircleElement[];
  private core: SVGCircleElement;
  private satellites: SVGCircleElement[];
  private caps: SVGCircleElement[];
  private companyInk: HTMLElement[];
  private poweredHTML: string;
  private accessLettering: BootLettering;
  private authLettering: BootLettering;
  constructor(private stage: HTMLElement, private sharedBackground?: HTMLElement) {
    [
      ".access-text",
      ".boot-logo",
      ".auth-status",
      "#auth-message",
      ".scan",
      ".scan > span",
      ".welcome",
      ".welcome-heading",
      ".welcome-panel",
      ".welcome-company",
      ".welcome-highlight",
      ".welcome-database",
      ".welcome-logo",
      ".brand",
      ".powered",
      "#boot-background",
      ".boot-background svg",
      ".boot-white",
    ].forEach((s) => {
      const shared = sharedBackground && (s === "#boot-background" ? sharedBackground
        : s === ".boot-background svg" ? sharedBackground.querySelector<HTMLElement>("svg")
        : s === ".boot-white" ? sharedBackground.querySelector<HTMLElement>(".boot-white") : null);
      this.nodes.set(s, shared || stage.querySelector<HTMLElement>(s)!);
    });
    const mark = stage.querySelector<SVGSVGElement>(".boot-logo svg")!;
    this.logoMotion = new IxdMotion(mark);
    this.logoMotion.render(0);
    this.brandLines = Array.from(
      stage.querySelector(".brand")!.children,
    ) as HTMLElement[];
    this.scanPaths = Array.from(
      stage.querySelectorAll<SVGPathElement>(".scan path"),
    );
    this.orbitDots = Array.from(
      stage.querySelectorAll<SVGCircleElement>(".scan .orbit-dot"),
    );
    this.core = stage.querySelector(".scan .scan-core")!;
    this.core.setAttribute("cx", "959.5");
    this.core.setAttribute("cy", "539.5");
    this.satellites = Array.from({ length: 6 }, () => {
      const dot = document.createElementNS(ns, "circle");
      dot.classList.add("satellite-dot");
      dot.setAttribute("fill", "var(--theme-ink)");
      dot.setAttribute("stroke", "none");
      // Draw beneath the core so its large flashes naturally cover the orbit.
      this.core.parentElement!.insertBefore(dot, this.core);
      return dot;
    });
    this.caps = ["var(--theme-ink)", "var(--theme-paper)"].map((fill) => {
      const cap = document.createElementNS(ns, "circle");
      cap.setAttribute("fill", fill);
      cap.setAttribute("stroke", "none");
      this.core.parentElement!.appendChild(cap);
      return cap;
    });
    this.companyInk = Array.from(
      stage.querySelectorAll<HTMLElement>(".welcome-company strong"),
    );
    this.companyInk.forEach((el) => {
      const ink = document.createElement("span");
      ink.textContent = el.textContent;
      el.replaceChildren(ink);
    });
    this.poweredHTML = this.el(".powered").innerHTML;

    // Bind after collecting the original ring paths. Phrase artwork also has
    // SVG paths, and must never be included in the scan's animated geometry.
    this.accessLettering = new BootLettering(this.el(".access-text"), ["access"]);
    this.authLettering = new BootLettering(this.el("#auth-message"), [
      "identity", "request", "processing", "processingGlitch",
    ]);
    for (const [selector, key, text] of [
      [".scan > span", "permission", "PERMISSION AUTHORIZED"],
      [".welcome-heading", "welcome", "WELCOME TO"],
      [".welcome-database", "database", "INTERNAL DATABASE"],
    ] as const) new BootLettering(this.el(selector), [key]).setText(text);
  }
  private el(selector: string) {
    return this.nodes.get(selector)!;
  }
  private opacity(selector: string, value: number | boolean) {
    this.el(selector).style.opacity = String(Number(value));
  }
  update(time: number) {
    const s = bootMotion(time),
      t = s.t;
    this.stage.dataset.bootFrame = String(s.f);
    this.accessLettering.setText(s.access);
    this.opacity(".access-text", s.accessOpacity);
    this.opacity(".boot-logo", s.logoOpacity);
    this.el(".boot-logo").style.transform =
      `translate(${s.logo.offsetX}px, 1px)`;
    // Run the approved IXD reveal on the existing boot clock. The original
    // container still owns its size, position and slide toward the auth text.
    this.logoMotion.render(t - 9.16);
    this.opacity(".auth-status", s.authOpacity);
    this.authLettering.setText(s.auth);
    this.opacity(".brand", 1);
    this.el(".brand").style.transform = "none";
    this.brandLines.forEach((node, i) => {
      node.style.opacity = String(s.brand[i].opacity);
      node.style.transform = `translateX(${s.brand[i].x}px)`;
    });
    this.opacity(".powered", s.poweredLetters > 0);
    this.el(".powered").style.clipPath =
      `inset(0 ${100 * (1 - s.poweredLetters / "POWERED BY IXD".length)}% 0 0)`;
    this.opacity(".scan", s.scanVisible);
    if (s.scanVisible) this.renderScan(s);
    this.opacity(".welcome", s.welcomeVisible ? s.welcomeOpacity : 0);
    this.el(".welcome").style.transform = `scale(${s.welcomeScale})`;
    this.el(".welcome").style.filter =
      `blur(${s.exitBlur}px)`;
    this.opacity(".welcome-panel", s.welcomePanel);
    this.opacity(".welcome-heading", 1);
    this.el(".welcome-heading").style.color =
      themeAmount > .0001 ? "var(--theme-ink)" : `color-mix(in srgb, var(--theme-ink) ${s.welcomeInk * 100}%, var(--theme-panel))`;
    this.opacity(".welcome-company", s.companyVisible);
    this.el(".welcome-company").style.opacity = String(
      s.companyVisible ? (s.companyMask ? 0.65 : 1) : 0,
    );
    this.companyInk[1].querySelector("span")!.style.opacity = s.companyMask
      ? ".06"
      : "1";
    this.el(".welcome-highlight").style.clipPath =
      `inset(0 ${100 * (1 - s.highlight)}% 0 0)`;
    this.opacity(".welcome-database", s.databaseOpacity);
    if (!this.el(".welcome-logo").dataset.shared) this.opacity(".welcome-logo", s.welcomeLogo);
    if (!this.sharedBackground) {
      this.opacity("#boot-background", s.backgroundOpacity);
      this.opacity(".boot-white", s.white);
      this.el(".boot-background svg").style.transform =
        `translate(${Math.sin(t * 0.16) * 18}px, ${-(t - 6) * 5}px) scale(1.08)`;
    }
    return s;
  }
  private renderScan(s: ReturnType<typeof bootMotion>) {
    this.core.removeAttribute("transform");
    this.scanPaths.slice(0, 4).forEach(path => { path.style.opacity = "1"; });
    [...this.orbitDots, ...this.satellites, ...this.caps].forEach(dot => { dot.style.opacity = "1"; });
    const { scan } = s,
      r = scan.radius;
    const group = this.scanPaths[0].parentElement!;
    group.setAttribute(
      "transform",
      `translate(960 540) scale(${s.ringScale}) translate(-960 -540)`,
    );
    group.style.opacity = String(s.ringOpacity);
    group.style.filter = `blur(${s.ringBlur}px)`;
    this.scanPaths[0].setAttribute(
      "d",
      arc(r, scan.outerStart, scan.outerSweep),
    );
    this.scanPaths[0].setAttribute("stroke-width", "2.4");
    this.scanPaths[1].setAttribute(
      "d",
      arc(scan.whiteRadius, scan.whiteStart, scan.whiteSweep),
    );
    this.scanPaths[1].setAttribute("stroke-width", "4");
    const inner = scan.innerStart;
    this.scanPaths[2].setAttribute(
      "d",
      arc(scan.innerRadius, inner, scan.innerSweep),
    );
    this.scanPaths[3].setAttribute(
      "d",
      arc(scan.innerRadius, inner + Math.PI, scan.innerSweep),
    );
    s.scanOrbit.sides.forEach((side, i) => {
      this.scanPaths[i + 4].setAttribute(
        "d",
        arc(side.radius, side.start, side.sweep, side.x, side.y),
      );
      this.scanPaths[i + 4].style.opacity = s.scanOrbit.sideVisible ? "1" : "0";
    });
    s.scanOrbit.satellites.forEach((point, i) => {
      const dot = this.satellites[i];
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("r", String(point.radius));
    });
    this.core.style.opacity = s.ornament ? "1" : "0";
    this.core.setAttribute("r", String(s.coreRadius));
    const orbit = scan.orbit;
    this.orbitDots.forEach((dot, i) => {
      dot.setAttribute(
        "cx",
        String(960 + Math.cos(orbit + i * Math.PI) * scan.orbitRadius),
      );
      dot.setAttribute(
        "cy",
        String(540 + Math.sin(orbit + i * Math.PI) * scan.orbitRadius),
      );
      dot.setAttribute("r", String(scan.dotRadius));
    });
    this.caps.forEach((cap, i) => {
      const angle = i ? scan.whiteStart : scan.outerStart + scan.outerSweep;
      const radius = i ? scan.whiteRadius : r;
      cap.setAttribute("cx", String(960 + Math.cos(angle) * radius));
      cap.setAttribute("cy", String(540 + Math.sin(angle) * radius));
      cap.setAttribute("r", String(i ? scan.whiteCap : scan.blackCap));
    });
    this.opacity(".scan > span", s.permissionOpacity);
    this.el(".scan > span").style.letterSpacing = `${s.scanTracking}px`;
    this.el(".scan > span").style.setProperty("--boot-phrase-tracking", `${s.scanTracking}px`);
    this.el(".scan > span").style.fontSize = `${s.scanFont}px`;
  }
  /** IXD login owns its timing; the original mark drawing remains unchanged. */
  renderLogin(drawSeconds: number, slide: number) {
    const state = this.update(4.16 + drawSeconds);
    const p = Math.max(0, Math.min(1, slide));
    const eased = p * p * (3 - 2 * p);
    this.el(".boot-logo").style.transform = `translate(${294 * (1 - eased)}px, 1px)`;
    this.opacity(".auth-status", 0);
    this.authLettering.setText("");
    return state;
  }
  /** One local, discrete 300 ms cut; ring geometry is never dismantled. */
  renderWelcomeFlash(elapsedMs: number) {
    this.renderWelcome(18.5);
    this.opacity(".welcome-company", 0);
    this.opacity(".welcome-database", 0);
    if (!this.el(".welcome-logo").dataset.shared) this.opacity(".welcome-logo", 0);
    const flash = welcomeFlashState(elapsedMs);
    this.stage.dataset.welcomeFlashMs = elapsedMs.toFixed(3);
    this.stage.dataset.welcomeFlashFrame = String(flash.sourceFrame);
    this.el(".welcome-panel").style.backgroundColor = "var(--theme-ink)";
    this.opacity(".welcome-panel", flash.panel);
    this.el(".welcome-heading").style.color =
      `color-mix(in srgb, var(--theme-ink) ${flash.ink * 100}%, var(--theme-panel))`;
  }
  renderWelcome(time: number) {
    const state = this.update(time);
    this.opacity(".scan", 0);
    this.opacity(".welcome", 1);
    this.el(".welcome").style.transform = "none";
    this.el(".welcome").style.filter = "none";
    this.opacity(".welcome-panel", 0);
    this.el(".welcome-panel").style.removeProperty("background-color");
    this.el(".welcome-heading").style.color = "var(--theme-ink)";
    this.opacity(".boot-white", 0);
    // Keep the original expanding strip, calibrated to B's measured 60fps
    // cuts. The older archive has an extra database pulse absent in TARGET.
    const text = welcomeTextState((time - 18.52) / 2);
    this.opacity(".welcome-company", text.companyVisible ? (text.companyMask ? .65 : 1) : 0);
    this.companyInk[1].querySelector("span")!.style.opacity = text.companyMask ? ".06" : "1";
    this.opacity(".welcome-database", text.databaseVisible);
    delete this.stage.dataset.welcomeFlashMs;
    delete this.stage.dataset.welcomeFlashFrame;
    return state;
  }
  renderWelcomeExit(progress: number) {
    this.renderWelcome(21.5);
    const p = Math.max(0, Math.min(1, progress));
    for (const key of [".welcome-heading", ".welcome-company", ".welcome-database"]) this.opacity(key, 1 - p * p * (3 - 2 * p));
  }
  reset() {
    // Restore shared corner branding when skipping at any intermediate frame.
    [".brand", ".powered"].forEach((key) =>
      this.el(key).removeAttribute("style"),
    );
    this.brandLines.forEach((node) => node.removeAttribute("style"));
    this.el(".powered").innerHTML = this.poweredHTML;
    if (!this.sharedBackground) this.opacity("#boot-background", 0);
    this.opacity(".welcome-panel", 0);
    delete this.stage.dataset.welcomeFlashMs;
    delete this.stage.dataset.welcomeFlashFrame;
  }
}
