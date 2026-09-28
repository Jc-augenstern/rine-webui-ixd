import { ixdMark } from "../ixd-mark";
import { escapeHtml as escape } from "../html";
import { contentSource, growthSteps, type ClubContent } from "../data/club-content";
import { constellationLinks, starMap, type StarMapNode, type StarPosition } from "../data/star-map";
import "./star-map.css";
import { galaxyGlyph, dormantGlyph, surveyMarkup } from "./galaxy-glyph";
import { coreSystemLayout, coreSystemMarkup, smoothRange } from './core-system';
import './core-system.css';

export interface StarMapUIOptions {
  onFocus: (position: StarPosition | null) => void;
  onSettings: () => void;
  onReplay: () => void;
  onSound: () => void;
  reduced: boolean;
  onContentOpen?: (id: string, host: HTMLElement) => void;
  onContentClose?: () => void;
  onLevelChange?: (level: 'main' | 'directions') => void;
  canClose?: () => boolean;
}

type GlyphGeometry = { x: number; y: number; size: number };
type GlyphFlight = { from: GlyphGeometry; elapsed: number; duration: number; leaving: boolean; hold: boolean };

/** Same authored cubic timing, evaluated on the shared frame clock. */
function flightEase(x: number, x1: number, x2: number) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 16; i++) {
    const t = (lo + hi) / 2, v = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
    if (v < x) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2;
  return x >= 1 ? 1 : x <= 0 ? 0 : t * t * (3 - 2 * t);
}

/** A small accessible DOM navigation layer; background stars stay on the GPU. */
export class StarMapUI {
  readonly element: HTMLElement;
  private readonly home: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly terminal: HTMLElement;
  private readonly controller = new AbortController();
  private readonly explored = new Set<string>();
  private readonly exploredGrowth = new Set<number>();
  private readonly options: StarMapUIOptions;
  private returnFocus: HTMLElement | null = null;
  private modalOpen = false;
  private visible = false;
  private reduced: boolean;
  private priorHash = "";
  private readonly voyager: HTMLElement;
  private readonly nodeGlyphs: HTMLElement[];
  private readonly arrivalItems: { element: HTMLElement; start: number; opacity: number }[];
  private flight: GlyphFlight | null = null;
  private geometry: GlyphGeometry = { x: 0, y: 0, size: 96 };
  private glyphHome: HTMLElement | null = null;
  private activeGlyph: HTMLElement | null = null;
  private pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  private level: 'main' | 'directions' = 'main';
  private coreJourney: { progress: number; target: 0 | 1; resolve: (entered: boolean) => void } | null = null;
  private preparingCoreEntry = false;
  private coreScroll = 0;
  private mainScroll = 0;

  constructor(host: HTMLElement, options: StarMapUIOptions) {
    this.options = options;
    this.reduced = options.reduced;
    this.element = document.createElement("section");
    this.element.className = "sm-root";
    this.element.setAttribute("aria-label", "IXD 星图主页");
    this.element.dataset.starMap = "";
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="sm-home">
        <header class="sm-header">
          <div class="sm-system-brand"><span class="sm-mark" aria-hidden="true">${ixdMark("star-map-mark")}</span><span>IXD <b>ANALYSIS OS</b></span></div>
          <p class="sm-system-state"><i></i>星图已连接 <span> / SYSTEM ONLINE</span></p>
        </header>
        <button class="sm-level-back" type="button" data-action="main-level" hidden>← 返回 IXD CORE</button>
        <nav class="sm-direct" aria-label="栏目直达"><button data-star-direct="announcements">公告</button><button data-star-direct="competitions">赛事</button><button data-star-direct="projects">项目</button><button data-star-direct="events">活动</button><button data-star-direct="learning">学习</button><button data-star-direct="works">作品</button><button data-star-direct="core">社团</button><button data-star-direct="account">个人中心</button></nav>
        <div class="sm-field" role="group" aria-label="星图导航，点击星星探索；方向键切换星星">
          ${coreSystemMarkup}
          ${this.linesMarkup()}
          <div class="sm-intro">
            <p class="sm-kicker">IXD STAR MAP <span> / 001</span></p>
            <h1>IXD</h1>
            <p class="sm-motto">让灵感漫步于星辰大海</p>
            <p class="sm-english">LET INSPIRATION ROAM THE COSMOS</p>
            <p class="sm-invitation"><span>＋</span> 选择一颗星，开始探索</p>
          </div>
          ${starMap.map((star) => this.starMarkup(star)).join("")}
          <div class="sm-map-coordinates" aria-hidden="true">IXD CONSTELLATION<br>R.A. 20h 26m &nbsp; DEC. +06°</div>
        </div>
        <section class="sm-growth" aria-label="成长星轨，社团培养路径">
          <div class="sm-growth-heading"><h2>成长星轨</h2><p>每一次探索，点亮下一程</p><span data-explored-count>00 / ${starMap.filter(star => star.enabled).length} 已探索</span></div>
          <div class="sm-growth-track">
            <svg viewBox="0 0 1000 42" preserveAspectRatio="none" aria-hidden="true"><path d="M25 32 C210 32 180 5 370 5 S650 42 780 27 S910 9 975 16"/></svg>
            ${growthSteps.map((step, index) => `<button class="sm-growth-stop" style="--stop:${index};--step-y:${[31, 20, 6, 18, 28, 16][index]}px" type="button" data-growth="${index}" aria-label="成长星轨：${escape(step.title)}"><i></i><span>${escape(step.title)}</span></button>`).join("")}
          </div>
          <p class="sm-growth-note">星轨点亮记录本次浏览，培养路径以学年循环。</p>
        </section>
        <footer class="sm-footer">
          <div class="sm-legend"><span><i class="sm-legend-main"></i>平台栏目</span><span><i></i>社团节点</span><span class="sm-legend-unexplored"><i></i>未探索空间</span></div>
          <div class="sm-tools"><button type="button" data-action="settings">画质与设置</button><button type="button" data-action="sound" aria-pressed="false">声音 <span data-sound-label>关</span></button><button type="button" data-action="replay">重播开场 <span aria-hidden="true">↗</span></button></div>
        </footer>
      </div>
      <section class="sm-modal" role="dialog" aria-modal="true" aria-labelledby="sm-detail-title" tabindex="-1" hidden>
        <button type="button" class="sm-flight-cancel" data-action="close">← 返回星图</button>
        <div class="sm-voyager" aria-hidden="true"><div class="sm-voyager-glyph"></div>${surveyMarkup}</div>
        <div class="sm-focus-link" aria-hidden="true"><span>IXD / DATA LINK</span></div>
        <div class="sm-focus-caption" aria-hidden="true"></div>
        <article class="sm-terminal">
          <header class="sm-terminal-top"><span>IXD ANALYSIS OS <b>/ DATA TERMINAL</b></span><button type="button" class="sm-close" data-action="close" aria-label="关闭详情，返回星图">返回星图 <span aria-hidden="true">×</span></button></header>
          <div class="sm-detail-scroll" tabindex="0" aria-label="星图节点详情"></div>
          <footer class="sm-terminal-bottom"><span>IXD / KNOWLEDGE NETWORK</span><span>ESC 返回</span></footer>
        </article>
      </section>
      <div class="sm-announcer" role="status" aria-live="polite" aria-atomic="true"></div>`;
    host.append(this.element);
    this.home = this.element.querySelector(".sm-home")!;
    this.modal = this.element.querySelector(".sm-modal")!;
    this.terminal = this.element.querySelector(".sm-terminal")!;
    this.voyager = this.element.querySelector(".sm-voyager")!;
    this.nodeGlyphs = [...this.home.querySelectorAll<HTMLElement>(".sm-star-glyph")];
    this.arrivalItems = [...this.home.querySelectorAll<HTMLElement>(".sm-star,.sm-empty,.sm-header,.sm-intro,.sm-constellation,.sm-map-coordinates,.sm-growth,.sm-footer")].map((element) => {
      const star = starMap.find(node => node.id === element.dataset.star);
      const start = star?.id === "core" ? .52 : star?.type === "direction" ? .06 + Number(star.number) * .055
        : star ? .27 + starMap.filter(node => node.type === "function").indexOf(star) * .055
        : element.classList.contains("sm-intro") ? .4 : .56;
      return { element, start, opacity: element.classList.contains("sm-constellation") ? .75 : 1 };
    });
    this.setReduced(options.reduced);
    this.setLevel('main');
    const { signal } = this.controller;
    this.element.addEventListener("click", this.onClick, { signal });
    this.element.addEventListener("keydown", this.onKeyDown, { signal });
    window.addEventListener("resize", this.onResize, { signal });
    document.addEventListener("visibilitychange", () => {
      this.element.dataset.pageHidden = String(document.hidden);
    }, { signal });
  }

  show() {
    if (this.visible) return;
    delete this.element.dataset.arrival;
    this.element.inert = false;
    for (const { element } of this.arrivalItems) element.style.removeProperty("opacity");
    this.visible = true;
    this.element.hidden = false;
    this.element.scrollTop = 0;
    this.home.inert = false;
    this.element.classList.add("is-visible");
    const hashId = !this.options.onContentOpen && location.hash.match(/^#star\/([a-z-]+)$/)?.[1];
    if (hashId && starMap.some((star) => star.id === hashId && star.enabled)) {
      this.priorHash = "";
      this.openStar(hashId);
    }
  }

  hide() {
    this.visible = false;
    this.preparingCoreEntry = false;
    const journey = this.coreJourney;
    this.coreJourney = null;
    this.clearCoreJourneyStyles();
    this.closeDetail(false);
    this.setLevel('main');
    journey?.resolve(false);
    this.element.classList.remove("is-visible");
    this.element.hidden = true;
    this.element.inert = false;
    delete this.element.dataset.arrival;
    for (const { element } of this.arrivalItems) element.style.removeProperty("opacity");
  }

  prepareArrival() {
    this.element.hidden = false;
    this.element.inert = true;
    this.home.inert = true;
    this.element.scrollTop = 0;
    this.element.dataset.arrival = "true";
    this.updateArrival(0);
  }

  updateArrival(progress: number) {
    for (const { element, start, opacity } of this.arrivalItems) {
      const p = Math.max(0, Math.min(1, (progress - start) / .26));
      element.style.opacity = String(p * p * (3 - 2 * p) * opacity);
    }
  }

  portalAnchor() {
    const core = this.home.querySelector<HTMLElement>('[data-star="core"] .sm-star-glyph')!.getBoundingClientRect();
    const host = this.element.parentElement!.getBoundingClientRect();
    return { x: core.left + core.width / 2 - host.left, y: core.top + core.height / 2 - host.top, size: core.width };
  }

  focusHome() { this.home.querySelector<HTMLElement>('[data-star="core"]')?.focus({ preventScroll: true }); }

  get activeStar() { return this.modal.dataset.activeStar ?? null; }
  get detailHost() { return this.element.querySelector<HTMLElement>('.sm-detail-scroll')!; }
  get currentLevel() { return this.level; }
  get inCoreJourney() { return this.coreJourney !== null; }
  prepareCoreEntry() { this.preparingCoreEntry = true; }

  /** The original detail glyph grows through the view before the inner field unfolds. */
  async enterDirections() {
    if (!this.preparingCoreEntry || this.coreJourney || !this.visible || this.activeStar !== 'core') return false;
    await new Promise<void>(resolve => {
      const wait = () => !this.visible || !this.flight ? resolve() : requestAnimationFrame(wait);
      wait();
    });
    if (!this.preparingCoreEntry || !this.visible || this.activeStar !== 'core' || !this.modalOpen) return false;
    this.preparingCoreEntry = false;
    this.coreScroll = this.detailHost.scrollTop;
    this.mainScroll = this.element.scrollTop;
    this.setLevel('directions');
    return this.startCoreJourney(0, 1);
  }

  /** Caller loads fresh CORE content before returning, so no private page is cached. */
  leaveDirections(content: string) {
    if (this.coreJourney || !this.visible || !this.modal.hidden || this.level !== 'directions') return Promise.resolve(false);
    this.setLevel('main');
    if (!this.openStar('core', true)) { this.setLevel('directions'); return Promise.resolve(false); }
    this.flight = null;
    this.detailHost.innerHTML = content;
    this.detailHost.scrollTop = this.coreScroll;
    this.setLevel('directions');
    return this.startCoreJourney(1, 0).then(() => this.activeStar === 'core' && this.level === 'main');
  }

  cancelCoreEntry() {
    this.preparingCoreEntry = false;
    if (!this.coreJourney || this.coreJourney.target === 0) return;
    this.coreJourney.target = 0;
    this.element.dataset.coreJourney = 'leaving';
  }

  private startCoreJourney(progress: number, target: 0 | 1) {
    this.flight = null;
    this.modal.classList.remove('is-ready');
    this.modal.dataset.journey = 'detail';
    this.terminal.inert = true;
    this.home.classList.remove('is-focusing', 'is-returning');
    this.home.inert = true;
    if (target === 1) this.element.scrollTop = 0;
    this.element.dataset.coreJourney = target ? 'entering' : 'leaving';
    this.options.onFocus({ x: .5, y: .5 });
    // Keep Escape on the existing dialog while the shared CORE glyph travels.
    this.modal.focus({ preventScroll: true });
    const result = new Promise<boolean>(resolve => { this.coreJourney = { progress, target, resolve }; });
    this.paintCoreJourney(progress);
    if (this.reduced) this.finishCoreJourney(target);
    return result;
  }

  private paintCoreJourney(progress: number) {
    const source = this.flightLayout();
    const grow = smoothRange(progress, 0, .69);
    const center = smoothRange(progress, 0, .46);
    this.placeGlyph({
      x: source.x + (innerWidth / 2 - source.x) * center,
      y: source.y + (innerHeight / 2 - source.y) * center,
      size: source.size * Math.pow(Math.max(innerWidth, innerHeight) * 3.5 / source.size, grow),
    });
    this.voyager.style.opacity = String(1 - smoothRange(progress, .49, .72));
    const reveal = smoothRange(progress, .44, 1);
    const field = this.home.querySelector<HTMLElement>('.sm-field')!;
    field.style.transform = `scale(${Math.pow(.065, 1 - reveal)})`;
    field.style.opacity = String(smoothRange(progress, .43, .69));
    // A viewport origin, also on a tall mobile map: no sideways page slide.
    const left = field.offsetLeft, top = field.offsetTop;
    field.style.transformOrigin = `${innerWidth / 2 - left}px ${innerHeight / 2 + this.element.scrollTop - top}px`;
    this.element.style.setProperty('--core-space-reveal', String(smoothRange(progress, .7, 1)));
    this.element.dataset.coreProgress = progress.toFixed(3);
  }

  private clearCoreJourneyStyles() {
    delete this.element.dataset.coreJourney;
    delete this.element.dataset.coreProgress;
    this.element.style.removeProperty('--core-space-reveal');
    const field = this.home.querySelector<HTMLElement>('.sm-field')!;
    field.style.removeProperty('transform'); field.style.removeProperty('transform-origin'); field.style.removeProperty('opacity');
    this.voyager.style.removeProperty('opacity');
  }

  private finishCoreJourney(target: 0 | 1) {
    const journey = this.coreJourney;
    if (!journey) return;
    this.coreJourney = null;
    this.clearCoreJourneyStyles();
    if (target === 1) {
      this.modalOpen = false;
      this.finishExit(false);
      this.setLevel('directions');
      this.options.onFocus(null);
      this.element.querySelector<HTMLElement>('.sm-level-back')!.focus({ preventScroll: true });
      this.element.querySelector('.sm-announcer')!.textContent = '已进入 IXD CORE 六方向星系';
    } else {
      this.home.classList.add('is-core-restored');
      this.setLevel('main');
      this.element.scrollTop = this.mainScroll;
      this.home.classList.add('is-focusing');
      this.home.inert = true;
      this.modalOpen = true;
      this.finishEntry();
      const geometry = this.flightLayout();
      this.options.onFocus({ x: geometry.x / innerWidth, y: geometry.y / innerHeight });
      this.detailHost.querySelector<HTMLElement>('[data-pf="directions"]')?.focus({ preventScroll: true });
      this.element.querySelector('.sm-announcer')!.textContent = '已返回 IXD CORE 社团介绍';
    }
    journey.resolve(target === 1);
  }
  setConnection(connected: boolean) {
    this.home.querySelector<HTMLElement>('.sm-system-state')!.innerHTML = connected ? '<i></i>星图已连接 <span>/ SYSTEM ONLINE</span>' : '<i></i>平台连接暂不可用 <span>/ RETRY IN CONTENT</span>';
  }
  async navigateStar(id: string) {
    if (this.activeStar === id && this.modalOpen) return true;
    if (!this.modal.hidden) {
      this.closeDetail();
      await new Promise<void>(resolve => { const wait = () => this.modal.hidden ? resolve() : requestAnimationFrame(wait); wait(); });
    }
    return this.openStar(id);
  }
  setLevel(level: 'main' | 'directions') {
    this.level = level; this.element.dataset.level = level;
    this.home.querySelectorAll<HTMLElement>('[data-star]').forEach(node => {
      const star = starMap.find(star => star.id === node.dataset.star)!;
      node.hidden = level === 'directions' ? star.type !== 'direction' : star.type === 'direction';
    });
    this.element.querySelector<HTMLElement>('.sm-level-back')!.hidden = level === 'main';
    this.element.querySelector<HTMLElement>('.sm-constellation')!.style.visibility = level === 'directions' ? 'visible' : 'hidden';
    this.home.querySelector<HTMLElement>('.sm-kicker')!.textContent = level === 'directions' ? 'IXD / 六方向二级星图' : 'IXD STAR MAP / PLATFORM';
  }
  updateSite(settings: { siteName: string; tagline: string; nodes: { routeKey: string; title: string; subtitle: string; enabled: boolean; visualPreset: string }[] }) {
    this.home.querySelector<HTMLElement>('.sm-intro h1')!.textContent = settings.siteName;
    // The paired hero slogan is authored frontend copy; site data still owns the title and nodes.
    for (const config of settings.nodes) {
      const node = this.home.querySelector<HTMLButtonElement>(`[data-star="${config.routeKey}"]`);
      if (!node) continue;
      node.disabled = !config.enabled;
      node.dataset.displayTitle = config.title;
      node.dataset.displaySubtitle = config.subtitle;
      node.setAttribute('aria-label', `${config.title}，打开详情`);
      const label = node.querySelector<HTMLElement>('.sm-star-label')!;
      label.firstChild!.textContent = config.title;
      node.querySelector<HTMLElement>('.sm-star-meta')!.textContent = config.subtitle;
      const direct = this.home.querySelector<HTMLButtonElement>(`[data-star-direct="${config.routeKey}"]`);
      if (direct) { direct.textContent = config.title; direct.disabled = !config.enabled; }
      // Preset changes are applied only to resting artwork, never a star in flight.
      const model = starMap.find(star => star.id === config.routeKey)!;
      if (this.activeStar !== config.routeKey && node.dataset.visualPreset !== config.visualPreset) {
        const preset = starMap.find(star => star.visualPreset === config.visualPreset);
        if (preset) {
          node.querySelector('.sm-star-glyph')!.innerHTML = galaxyGlyph({ ...model, visualPreset: preset.visualPreset, motionPreset: preset.motionPreset }, model.id);
          node.dataset.visualPreset = preset.visualPreset;
        }
      }
    }
  }

  setReduced(reduced: boolean) {
    this.reduced = reduced;
    this.element.dataset.reduced = String(reduced);
    if (reduced && this.coreJourney) {
      this.finishCoreJourney(this.coreJourney.target);
    } else if (reduced && this.modalOpen) {
      this.finishEntry();
    } else if (reduced && !this.modal.hidden) {
      this.finishExit(true);
    }
  }

  setPointer(x: number, y: number) {
    this.pointer.targetX = x;
    this.pointer.targetY = y;
  }

  /** Shares the app's frame clock; only the node artwork drifts, never its hitbox. */
  update(dt: number) {
    if (!this.visible || document.hidden) return;
    if (this.coreJourney) {
      const journey = this.coreJourney;
      journey.progress = Math.max(0, Math.min(1, journey.progress + (journey.target ? 1 : -1) * Math.min(dt, .1) / 1.9));
      this.paintCoreJourney(journey.progress);
      if (journey.progress === journey.target) this.finishCoreJourney(journey.target);
      return;
    }
    const x = this.reduced || !this.modal.hidden ? 0 : this.pointer.targetX;
    const y = this.reduced || !this.modal.hidden ? 0 : this.pointer.targetY;
    if (Math.abs(x - this.pointer.x) + Math.abs(y - this.pointer.y) >= 0.0001) {
      const ease = this.reduced ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 5.2);
      this.pointer.x += (x - this.pointer.x) * ease;
      this.pointer.y += (y - this.pointer.y) * ease;
      const offset = `${(this.pointer.x * -7).toFixed(2)}px ${(this.pointer.y * -5).toFixed(2)}px`;
      for (const glyph of this.nodeGlyphs) glyph.style.translate = offset;
    }
    const flight = this.flight;
    if (!flight) return;
    flight.elapsed += Math.min(dt, .1) * 1000;
    const progress = Math.min(1, flight.elapsed / flight.duration);
    const eased = flightEase(progress, flight.leaving ? .45 : .4, flight.leaving ? .22 : .18);
    const p = flight.hold ? Math.max(0, (eased - .18) / .82) : eased;
    // The empty original holder still participates in the real layout/parallax.
    const target = flight.leaving ? this.originGeometry(this.returnFocus!) : this.flightLayout();
    this.placeGlyph({ x: flight.from.x + (target.x - flight.from.x) * p,
      y: flight.from.y + (target.y - flight.from.y) * p,
      size: flight.from.size + (target.size - flight.from.size) * p });
    if (progress === 1) {
      if (flight.leaving) this.finishExit(true); else this.finishEntry();
    }
  }

  /** The owner changes the existing audio system and reports its actual state. */
  setSound(enabled: boolean) {
    const button = this.element.querySelector<HTMLButtonElement>('[data-action="sound"]')!;
    button.setAttribute("aria-pressed", String(enabled));
    button.querySelector("[data-sound-label]")!.textContent = enabled ? "开" : "关";
  }

  /** Also supports future navigation or deep links without synthesizing clicks. */
  openStar(id: string, restoreCoreParent = false): boolean {
    if (!this.visible || !this.modal.hidden || this.coreJourney) return false;
    const star = starMap.find((node) => node.id === id);
    if (!star?.enabled || !star.content) return false;
    const button = this.element.querySelector<HTMLElement>(`[data-star="${star.id}"]`)!;
    // A parent return must remain available even if a refreshed configuration
    // disables its entry. Content is still read through the authorized API.
    if ((button as HTMLButtonElement).disabled && !(restoreCoreParent && id === 'core')) return false;
    this.setLevel(star.type === 'direction' ? 'directions' : 'main');
    this.returnFocus = button;
    this.home.querySelectorAll(".is-selected").forEach((node) => node.classList.remove("is-selected"));
    button.classList.add("is-selected");
    button.setAttribute("aria-expanded", "true");
    this.explored.add(id);
    this.updateExploration();
    this.renderDetail(button.dataset.displayTitle ?? star.title, star.content, star.number ? `DIRECTION ${star.number}` : button.dataset.displaySubtitle ?? star.subtitle, star.type === "direction");
    this.modal.dataset.activeStar = id;
    this.enterDetail(button, star.route);
    this.options.onContentOpen?.(id, this.detailHost);
    return true;
  }

  closeDetail(restoreFocus = true) {
    if ((this.coreJourney || this.preparingCoreEntry) && restoreFocus) { this.options.onLevelChange?.('main'); return; }
    if (this.modalOpen && restoreFocus && this.options.canClose && !this.options.canClose()) return;
    // Repeated Escape during flight/exit must not restart or cancel its cleanup.
    if (!this.modalOpen) {
      if (!restoreFocus) {
        this.finishExit(false);
      }
      return;
    }
    this.modalOpen = false;
    this.home.classList.remove('is-core-restored');
    this.options.onContentClose?.();
    this.modal.classList.remove("is-ready");
    this.modal.dataset.journey = "leaving";
    this.terminal.inert = true;
    this.home.classList.add("is-returning");
    this.options.onFocus(null);
    this.restoreRoute();
    if (this.reduced || !restoreFocus) { this.finishExit(restoreFocus); return; }
    this.flight = { from: { ...this.geometry }, elapsed: 0, duration: 920, leaving: true, hold: true };
  }

  private finishExit(restoreFocus: boolean) {
    this.flight = null;
    // Move before hiding the overlay, atomically in this frame. Never recreate
    // the artwork or re-run the home arrival/opacity animation.
    if (this.activeGlyph && this.glyphHome) this.moveGlyph(this.glyphHome, this.activeGlyph);
    else this.activeGlyph?.remove();
    this.activeGlyph = this.glyphHome = null;
    this.modal.hidden = true;
    this.modal.classList.remove("is-ready");
    this.modal.dataset.journey = "idle";
    this.home.inert = false;
    this.home.classList.remove("is-focusing", "is-returning", "is-core-restored");
    delete this.modal.dataset.activeStar;
    this.home.querySelectorAll<HTMLElement>(".is-selected").forEach((node) => {
      node.classList.remove("is-selected");
      node.setAttribute("aria-expanded", "false");
    });
    if (restoreFocus && this.visible && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
  }

  dispose() {
    this.hide();
    this.controller.abort();
    this.element.remove();
  }

  private starMarkup(star: StarMapNode) {
    const layout = coreSystemLayout[star.id] ?? star;
    const mobile = layout.mobilePosition ?? layout.position;
    const style = `--x:${layout.position.x * 100}%;--y:${layout.position.y * 100}%;--mx:${mobile.x * 100}%;--my:${mobile.y * 100}%;--star-color:${star.color ?? "#97aacd"};--brightness:${star.brightness}`;
    if (!star.enabled) return `<span class="sm-empty" style="${style}" data-reserved-star="${escape(star.id)}" hidden inert aria-hidden="true"><i class="sm-empty-glyph">${dormantGlyph(star)}</i><span>UNEXPLORED<br><b>等待下一次探索</b></span></span>`;
    return `<button type="button" class="sm-star sm-star-${star.type}" style="${style}" data-star="${star.id}" data-visual-preset="${star.visualPreset}" data-motion-preset="${star.motionPreset}" data-route="${escape(star.route ?? "")}" aria-label="${escape(star.title)}，打开详情" aria-haspopup="dialog" aria-expanded="false">
      <span class="sm-star-glyph" aria-hidden="true">${galaxyGlyph(star, star.id)}</span>
      ${star.number ? `<span class="sm-star-number" aria-hidden="true">${star.number}</span>` : ""}
      <span class="sm-star-label">${escape(star.title)}<span class="sm-star-meta">${escape(star.type === "direction" ? star.content!.eyebrow : star.subtitle)}</span></span>
      ${star.type === 'direction' ? `<span class="sm-star-hover" aria-hidden="true">${escape(star.subtitle)} <b>↗</b></span>` : ''}
    </button>`;
  }

  private linesMarkup() {
    const lines = (mobile: boolean) => constellationLinks.map(([start, end]) => {
      const a = coreSystemLayout[start] ?? starMap.find((node) => node.id === start)!;
      const b = coreSystemLayout[end] ?? starMap.find((node) => node.id === end)!;
      const p = mobile ? a.mobilePosition ?? a.position : a.position;
      const q = mobile ? b.mobilePosition ?? b.position : b.position;
      return `<line x1="${p.x * 1000}" y1="${p.y * 1000}" x2="${q.x * 1000}" y2="${q.y * 1000}"/>`;
    }).join("");
    return `<svg class="sm-constellation" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><g class="sm-desktop-lines">${lines(false)}</g><g class="sm-mobile-lines">${lines(true)}</g></svg>`;
  }

  private renderDetail(title: string, content: ClubContent, code: string, direction = false) {
    this.element.querySelector(".sm-focus-caption")!.innerHTML = `<span>${escape(code)}</span><p>${escape(title)}</p><small>COORDINATE LOCKED / 星系已连接</small>`;
    const scroll = this.element.querySelector<HTMLElement>(".sm-detail-scroll")!;
    scroll.innerHTML = `
      <p class="sm-detail-code">${escape(code)} <span> / IXD</span></p>
      <h2 id="sm-detail-title">${escape(title)}</h2>
      <p class="sm-detail-english">${escape(content.eyebrow)}</p>
      <div class="sm-source-status"><i></i>筹建规划 <span> / INITIAL PROPOSAL</span></div>
      <section class="sm-detail-section sm-detail-position"><h3>${direction ? "定位" : "探索概览"}</h3><p>${escape(content.summary)}</p></section>
      ${content.keywords ? `<section class="sm-detail-section"><h3>学习关键词 <span>LEARNING SIGNALS</span></h3><ul class="sm-keywords">${content.keywords.map((keyword) => `<li>${escape(keyword)}</li>`).join("")}</ul></section>` : ""}
      ${content.projects ? `<section class="sm-detail-section"><h3>典型项目 <span>PROJECT POSSIBILITIES</span></h3><p class="sm-project-note">方向选题示例 · 非已完成成果</p><ul class="sm-projects">${content.projects.map((project, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span>${escape(project)}</li>`).join("")}</ul></section>` : ""}
      ${content.competitions ? `<ol class="sm-orbits" aria-label="六个竞赛辅导方向">${content.competitions.map((competition, index) => `<li><span class="sm-orbit-point">${String(index + 1).padStart(2, "0")}</span><h3>${escape(competition.title)}</h3><p>${escape(competition.description)}</p></li>`).join("")}</ol>` : ""}
      ${content.sections.map((section) => `<section class="sm-detail-section"><h3>${escape(section.title)}</h3>${section.body ? `<p>${escape(section.body)}</p>` : ""}${section.items ? `<ul class="sm-content-list">${section.items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>` : ""}</section>`).join("")}
      ${content.notice ? `<p class="sm-content-notice">${escape(content.notice)}</p>` : ""}
      <p class="sm-source">${escape(contentSource)}</p>
      <button class="sm-return-link" type="button" data-action="close">← 返回星图，继续探索</button>`;
    scroll.scrollTop = 0;
  }

  private enterDetail(origin: HTMLElement, route: string | null) {
    if (route && !this.options.onContentOpen) {
      this.priorHash = location.hash.startsWith("#star/") ? "" : location.hash;
      history.replaceState(history.state, "", location.pathname + location.search + route);
    }
    this.modalOpen = true;
    this.modal.hidden = false;
    this.modal.classList.remove("is-ready");
    this.modal.dataset.journey = "entering";
    this.terminal.inert = true;
    const source = this.originGeometry(origin);
    const glyph = origin.querySelector<HTMLElement>(".sm-star-glyph");
    const holder = this.voyager.querySelector<HTMLElement>(".sm-voyager-glyph")!;
    this.glyphHome = glyph;
    this.activeGlyph = glyph?.querySelector<HTMLElement>(".sm-node-visual") ?? null;
    if (this.activeGlyph) this.moveGlyph(holder, this.activeGlyph);
    else { holder.innerHTML = galaxyGlyph(20); this.activeGlyph = holder.firstElementChild as HTMLElement; }
    this.modal.style.setProperty("--star-color", getComputedStyle(origin).getPropertyValue("--star-color") || "#a8b9f5");
    const destination = this.flightLayout();
    this.placeGlyph(this.reduced ? destination : source);
    this.flight = this.reduced ? null : { from: source, elapsed: 0, duration: 1100, leaving: false, hold: false };
    this.home.classList.add("is-focusing");
    this.options.onFocus({ x: source.x / innerWidth, y: source.y / innerHeight });
    this.modal.focus({ preventScroll: true });
    this.home.inert = true;
    if (this.reduced) this.finishEntry();
    this.element.querySelector(".sm-announcer")!.textContent = "正在探索：" + this.modal.querySelector("h2")!.textContent;
  }

  private originGeometry(origin: HTMLElement) {
    const glyph = origin.querySelector<HTMLElement>(".sm-star-glyph");
    const rect = (glyph ?? origin).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: glyph ? rect.width : 46 };
  }

  private placeGlyph(geometry: GlyphGeometry) {
    this.geometry = geometry;
    // Resize the SVG viewport instead of scaling a 420px wrapper. This keeps
    // vector-effect strokes identical to the real home SVG at the handoff.
    this.voyager.style.width = this.voyager.style.height = `${geometry.size}px`;
    this.voyager.style.transform = `translate3d(${geometry.x - geometry.size / 2}px, ${geometry.y - geometry.size / 2}px, 0)`;
  }

  private moveGlyph(parent: HTMLElement, glyph: HTMLElement) {
    const preserving = parent as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
    if (preserving.moveBefore) { preserving.moveBefore(glyph, null); return; }
    // Older engines retain the same DOM and restore CSS loop phase after a
    // conventional move. Authored layer transforms still transition naturally.
    const phases = glyph.getAnimations({ subtree: true }).filter((a): a is CSSAnimation => a instanceof CSSAnimation)
      .map(a => ({ target: (a.effect as KeyframeEffect).target, name: a.animationName, time: a.currentTime }));
    parent.append(glyph);
    for (const animation of glyph.getAnimations({ subtree: true })) {
      if (!(animation instanceof CSSAnimation)) continue;
      const phase = phases.find(p => p.target === (animation.effect as KeyframeEffect).target && p.name === animation.animationName);
      if (phase?.time != null) animation.currentTime = phase.time;
    }
  }

  private flightLayout() {
    const mobile = innerWidth <= 760;
    const compact = innerWidth <= 1100;
    const x = innerWidth * (mobile ? 0.5 : compact ? 0.19 : 0.27);
    const y = mobile && innerHeight > 600 ? 103 : innerHeight * 0.46;
    const size = mobile ? 160 : Math.min(420, innerWidth * 0.32, innerHeight * 0.55);
    this.modal.style.setProperty("--focus-x", `${x}px`);
    this.modal.style.setProperty("--focus-y", `${y}px`);
    this.modal.style.setProperty("--focus-size", `${size}px`);
    const link = this.modal.querySelector<HTMLElement>(".sm-focus-link")!;
    const start = x + size * 0.34;
    link.style.left = `${start}px`;
    link.style.top = `${y}px`;
    link.style.width = `${Math.max(0, this.terminal.offsetLeft - start)}px`;
    return { x, y, size };
  }

  private finishEntry() {
    if (!this.modalOpen || !this.visible) return;
    this.flight = null;
    const target = this.flightLayout();
    this.placeGlyph(target);
    this.modal.classList.add("is-ready");
    this.modal.dataset.journey = "detail";
    this.terminal.inert = false;
    this.modal.querySelector<HTMLButtonElement>(".sm-close")!.focus({ preventScroll: true });
  }

  private onResize = () => {
    if (this.coreJourney) { this.paintCoreJourney(this.coreJourney.progress); return; }
    if (this.modal.hidden) return;
    if (this.flight) {
      this.flight = { ...this.flight, from: { ...this.geometry }, duration: Math.max(1, this.flight.duration - this.flight.elapsed), elapsed: 0, hold: false };
      this.flightLayout();
    } else if (this.modalOpen) this.placeGlyph(this.flightLayout());
  };

  private openGrowth(index: number, origin: HTMLElement) {
    if (this.options.onContentOpen) { if (this.openStar('learning')) this.options.onContentOpen('learning-paths', this.detailHost); return; }
    if (!this.modal.hidden || !growthSteps[index]) return;
    const step = growthSteps[index];
    this.returnFocus = origin;
    this.exploredGrowth.add(index);
    this.updateExploration();
    this.renderDetail(step.title, {
      eyebrow: `GROWTH ORBIT / ${String(index + 1).padStart(2, "0")}`,
      summary: step.description,
      sections: [{ title: "成长，是持续的探索", body: "了解专业 → 选择方向 → 完成项目 → 参与比赛 → 形成作品集 → 下一学年带领新成员。" }],
      notice: "这是社团的培养目标。星轨点亮记录本次浏览，不代表个人已完成相应学习阶段。",
    }, `成长星轨 ${String(index + 1).padStart(2, "0")}`);
    this.enterDetail(origin, null);
  }

  private updateExploration() {
    this.element.querySelector("[data-explored-count]")!.textContent = `${String(this.explored.size).padStart(2, "0")} / ${starMap.filter((star) => star.enabled).length} 已探索`;
    this.element.querySelectorAll<HTMLElement>("[data-growth]").forEach((element, index) => {
      const lit = index < this.explored.size || this.exploredGrowth.has(index);
      element.classList.toggle("is-lit", lit);
      element.dataset.explored = String(lit);
    });
    this.element.querySelectorAll<HTMLElement>("[data-star]").forEach((element) => element.classList.toggle("is-explored", this.explored.has(element.dataset.star!)));
  }

  private restoreRoute() {
    if (this.options.onContentOpen) return;
    if (location.hash.startsWith("#star/")) history.replaceState(history.state, "", location.pathname + location.search + this.priorHash);
  }

  private onClick = (event: MouseEvent) => {
    const target = event.target as Element;
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action) {
      event.stopPropagation();
      if (action === "close") this.closeDetail();
      else if (action === "settings") this.options.onSettings();
      else if (action === "sound") this.options.onSound();
      else if (action === "replay") this.options.onReplay();
      else if (action === 'main-level') this.options.onLevelChange?.('main');
      return;
    }
    const star = target.closest<HTMLElement>("[data-star]");
    if (star) { event.stopPropagation(); this.openStar(star.dataset.star!); return; }
    const direct = target.closest<HTMLElement>('[data-star-direct]');
    if (direct) { event.stopPropagation(); this.openStar(direct.dataset.starDirect!); return; }
    const growth = target.closest<HTMLElement>("[data-growth]");
    if (growth) { event.stopPropagation(); this.openGrowth(Number(growth.dataset.growth), growth); }
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.visible) return;
    if (this.coreJourney) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.options.onLevelChange?.('main'); }
      if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (event.key === 'Escape' && this.level === 'directions' && this.modal.hidden) {
      event.preventDefault(); event.stopPropagation(); this.options.onLevelChange?.('main'); return;
    }
    if (this.modalOpen || !this.modal.hidden) {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); this.closeDetail(); }
      if (event.key === "Tab") {
        if (!this.modal.classList.contains("is-ready")) { event.preventDefault(); return; }
        const stops = [...this.terminal.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter(el => el.getClientRects().length > 0 && !el.closest('[inert]'));
        const first = stops[0], last = stops[stops.length - 1];
        const current = document.activeElement;
        if (event.shiftKey && (current === first || !this.terminal.contains(current))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (current === last || !this.terminal.contains(current))) { event.preventDefault(); first?.focus(); }
      }
      return;
    }
    const origin = (event.target as Element).closest<HTMLElement>("[data-star]");
    if (!origin || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const sign = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const rect = origin.getBoundingClientRect();
    const candidates = [...this.home.querySelectorAll<HTMLElement>("[data-star]")].filter((node) => node !== origin && !node.hidden && !(node as HTMLButtonElement).disabled).map((node) => {
      const other = node.getBoundingClientRect();
      const primary = (horizontal ? other.left - rect.left : other.top - rect.top) * sign;
      const secondary = Math.abs(horizontal ? other.top - rect.top : other.left - rect.left);
      return { node, primary, score: primary + secondary * 1.8 };
    }).filter((candidate) => candidate.primary > 4).sort((a, b) => a.score - b.score);
    candidates[0]?.node.focus({ preventScroll: false });
  };
}
