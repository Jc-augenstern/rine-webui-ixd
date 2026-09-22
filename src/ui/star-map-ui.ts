import { ixdMark } from "../ixd-mark";
import { escapeHtml as escape } from "../html";
import { contentSource, growthSteps, type ClubContent } from "../data/club-content";
import { constellationLinks, starMap, type StarMapNode, type StarPosition } from "../data/star-map";
import "./star-map.css";
import { galaxyGlyph, dormantGlyph, surveyMarkup } from "./galaxy-glyph";

export interface StarMapUIOptions {
  onFocus: (position: StarPosition | null) => void;
  onSettings: () => void;
  onReplay: () => void;
  onSound: () => void;
  reduced: boolean;
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
  private transitionTimer = 0;
  private modalOpen = false;
  private visible = false;
  private reduced: boolean;
  private priorHash = "";
  private readonly voyager: HTMLElement;
  private readonly nodeGlyphs: HTMLElement[];
  private readonly arrivalItems: { element: HTMLElement; start: number; opacity: number }[];
  private flight: Animation | null = null;
  private pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };

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
        <div class="sm-field" role="group" aria-label="星图导航，点击星星探索；方向键切换星星">
          ${this.linesMarkup()}
          <div class="sm-intro">
            <p class="sm-kicker">IXD STAR MAP <span> / 001</span></p>
            <h1>IXD</h1>
            <p class="sm-motto">让灵感漫步于星辰大海</p>
            <p class="sm-english">LET INSPIRATION WANDER AMONG THE STARS</p>
            <p class="sm-invitation"><span>＋</span> 选择一颗星，开始探索</p>
          </div>
          ${starMap.map((star) => this.starMarkup(star)).join("")}
          <div class="sm-map-coordinates" aria-hidden="true">IXD CONSTELLATION<br>R.A. 20h 26m &nbsp; DEC. +06°</div>
        </div>
        <section class="sm-growth" aria-label="成长星轨，社团培养路径">
          <div class="sm-growth-heading"><h2>成长星轨</h2><p>每一次探索，点亮下一程</p><span data-explored-count>00 / 12 已探索</span></div>
          <div class="sm-growth-track">
            <svg viewBox="0 0 1000 42" preserveAspectRatio="none" aria-hidden="true"><path d="M25 32 C210 32 180 5 370 5 S650 42 780 27 S910 9 975 16"/></svg>
            ${growthSteps.map((step, index) => `<button class="sm-growth-stop" style="--stop:${index};--step-y:${[31, 20, 6, 18, 28, 16][index]}px" type="button" data-growth="${index}" aria-label="成长星轨：${escape(step.title)}"><i></i><span>${escape(step.title)}</span></button>`).join("")}
          </div>
          <p class="sm-growth-note">星轨点亮记录本次浏览，培养路径以学年循环。</p>
        </section>
        <footer class="sm-footer">
          <div class="sm-legend"><span><i class="sm-legend-main"></i>专业方向</span><span><i></i>社团节点</span><span class="sm-legend-unexplored"><i></i>未探索空间</span></div>
          <div class="sm-tools"><button type="button" data-action="settings">画质与设置</button><button type="button" data-action="sound" aria-pressed="false">声音 <span data-sound-label>关</span></button><button type="button" data-action="replay">重新登录 <span aria-hidden="true">↗</span></button></div>
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
    const hashId = location.hash.match(/^#star\/([a-z-]+)$/)?.[1];
    if (hashId && starMap.some((star) => star.id === hashId && star.enabled)) {
      this.priorHash = "";
      this.openStar(hashId);
    }
  }

  hide() {
    this.visible = false;
    this.closeDetail(false);
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

  setReduced(reduced: boolean) {
    this.reduced = reduced;
    this.element.dataset.reduced = String(reduced);
    if (reduced && this.modalOpen) {
      window.clearTimeout(this.transitionTimer);
      this.finishEntry();
    } else if (reduced && !this.modal.hidden) {
      window.clearTimeout(this.transitionTimer);
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
    const x = this.reduced || !this.modal.hidden ? 0 : this.pointer.targetX;
    const y = this.reduced || !this.modal.hidden ? 0 : this.pointer.targetY;
    if (Math.abs(x - this.pointer.x) + Math.abs(y - this.pointer.y) < 0.0001) return;
    const ease = this.reduced ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 5.2);
    this.pointer.x += (x - this.pointer.x) * ease;
    this.pointer.y += (y - this.pointer.y) * ease;
    // Direct compositor transforms avoid invalidating inherited CSS variables on
    // every orbit/dust SVG element on every pointer frame.
    const offset = `${(this.pointer.x * -7).toFixed(2)}px ${(this.pointer.y * -5).toFixed(2)}px`;
    for (const glyph of this.nodeGlyphs) glyph.style.translate = offset;
  }

  /** The owner changes the existing audio system and reports its actual state. */
  setSound(enabled: boolean) {
    const button = this.element.querySelector<HTMLButtonElement>('[data-action="sound"]')!;
    button.setAttribute("aria-pressed", String(enabled));
    button.querySelector("[data-sound-label]")!.textContent = enabled ? "开" : "关";
  }

  /** Also supports future navigation or deep links without synthesizing clicks. */
  openStar(id: string): boolean {
    if (!this.visible || !this.modal.hidden) return false;
    const star = starMap.find((node) => node.id === id);
    if (!star?.enabled || !star.content) return false;
    const button = this.element.querySelector<HTMLElement>(`[data-star="${star.id}"]`)!;
    this.returnFocus = button;
    this.home.querySelectorAll(".is-selected").forEach((node) => node.classList.remove("is-selected"));
    button.classList.add("is-selected");
    button.setAttribute("aria-expanded", "true");
    this.explored.add(id);
    this.updateExploration();
    this.renderDetail(star.title, star.content, star.number ? `DIRECTION ${star.number}` : star.subtitle, star.type === "direction");
    this.modal.dataset.activeStar = id;
    this.enterDetail(button, star.route);
    return true;
  }

  closeDetail(restoreFocus = true) {
    // Repeated Escape during flight/exit must not restart or cancel its cleanup.
    if (!this.modalOpen) {
      if (!restoreFocus) {
        window.clearTimeout(this.transitionTimer);
        this.finishExit(false);
      }
      return;
    }
    window.clearTimeout(this.transitionTimer);
    this.modalOpen = false;
    this.modal.classList.remove("is-ready");
    this.modal.dataset.journey = "leaving";
    this.terminal.inert = true;
    this.home.classList.add("is-returning");
    this.options.onFocus(null);
    this.restoreRoute();
    if (this.reduced || !restoreFocus) { this.finishExit(restoreFocus); return; }
    const current = getComputedStyle(this.voyager).transform;
    this.flight?.cancel();
    const origin = this.originGeometry(this.returnFocus!);
    this.flight = this.voyager.animate([
      { transform: current, offset: 0, opacity: 1 },
      { transform: current, offset: 0.18, opacity: 1 },
      { transform: this.flightTransform(origin.x, origin.y, origin.size / 420), offset: 1, opacity: 1 },
    ], { duration: 920, easing: "cubic-bezier(.45,0,.22,1)", fill: "forwards" });
    this.transitionTimer = window.setTimeout(() => this.finishExit(true), 920);
  }

  private finishExit(restoreFocus: boolean) {
    this.flight?.cancel();
    this.flight = null;
    this.modal.hidden = true;
    this.modal.classList.remove("is-ready");
    this.modal.dataset.journey = "idle";
    this.home.inert = false;
    this.home.classList.remove("is-focusing", "is-returning");
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
    window.clearTimeout(this.transitionTimer);
    this.element.remove();
  }

  private starMarkup(star: StarMapNode) {
    const mobile = star.mobilePosition ?? star.position;
    const style = `--x:${star.position.x * 100}%;--y:${star.position.y * 100}%;--mx:${mobile.x * 100}%;--my:${mobile.y * 100}%;--star-color:${star.color ?? "#97aacd"};--brightness:${star.brightness}`;
    if (!star.enabled) return `<span class="sm-empty" style="${style}" tabindex="0" role="img" aria-label="未探索星，等待下一次探索，暂不可进入"><i class="sm-empty-glyph">${dormantGlyph(star)}</i><span>UNEXPLORED<br><b>等待下一次探索</b></span></span>`;
    return `<button type="button" class="sm-star sm-star-${star.type}" style="${style}" data-star="${star.id}" data-visual-preset="${star.visualPreset}" data-motion-preset="${star.motionPreset}" data-route="${escape(star.route ?? "")}" aria-label="${escape(star.title)}，打开详情" aria-haspopup="dialog" aria-expanded="false">
      <span class="sm-star-glyph" aria-hidden="true">${galaxyGlyph(star)}</span>
      ${star.number ? `<span class="sm-star-number" aria-hidden="true">${star.number}</span>` : ""}
      <span class="sm-star-label">${escape(star.title)}<span class="sm-star-meta">${escape(star.type === "direction" ? star.content!.eyebrow : star.subtitle)}</span></span>
      <span class="sm-star-hover" aria-hidden="true">${star.type === "direction" ? escape(star.subtitle) : "探索社团节点"} <b>↗</b></span>
    </button>`;
  }

  private linesMarkup() {
    const lines = (mobile: boolean) => constellationLinks.map(([start, end]) => {
      const a = starMap.find((node) => node.id === start)!;
      const b = starMap.find((node) => node.id === end)!;
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
    window.clearTimeout(this.transitionTimer);
    if (route) {
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
    this.voyager.querySelector(".sm-voyager-glyph")!.innerHTML = glyph?.innerHTML ?? galaxyGlyph(20);
    this.modal.style.setProperty("--star-color", getComputedStyle(origin).getPropertyValue("--star-color") || "#a8b9f5");
    const destination = this.flightLayout();
    this.flight?.cancel();
    this.voyager.style.transform = this.flightTransform(destination.x, destination.y, destination.size / 420);
    if (!this.reduced) {
      const start = this.flightTransform(source.x, source.y, source.size / 420);
      this.flight = this.voyager.animate([
        { transform: start, offset: 0 },
        { transform: start, offset: 0.12 },
        { transform: this.flightTransform(innerWidth * 0.5, innerHeight * 0.47, destination.size * 0.84 / 420), offset: 0.66 },
        { transform: this.voyager.style.transform, offset: 1 },
      ], { duration: 1100, easing: "cubic-bezier(.4,0,.18,1)", fill: "forwards" });
    }
    this.home.classList.add("is-focusing");
    this.options.onFocus({ x: source.x / innerWidth, y: source.y / innerHeight });
    this.modal.focus({ preventScroll: true });
    this.home.inert = true;
    if (this.reduced) this.finishEntry();
    else this.transitionTimer = window.setTimeout(() => this.finishEntry(), 1100);
    this.element.querySelector(".sm-announcer")!.textContent = "正在探索：" + this.modal.querySelector("h2")!.textContent;
  }

  private originGeometry(origin: HTMLElement) {
    const glyph = origin.querySelector<HTMLElement>(".sm-star-glyph");
    const rect = (glyph ?? origin).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: glyph ? rect.width : 46 };
  }

  private flightTransform(x: number, y: number, scale: number) {
    return `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
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
    this.flight?.cancel();
    this.flight = null;
    const target = this.flightLayout();
    this.voyager.style.transform = this.flightTransform(target.x, target.y, target.size / 420);
    this.modal.classList.add("is-ready");
    this.modal.dataset.journey = "detail";
    this.terminal.inert = false;
    this.modal.querySelector<HTMLButtonElement>(".sm-close")!.focus({ preventScroll: true });
  }

  private onResize = () => {
    if (this.modalOpen) {
      window.clearTimeout(this.transitionTimer);
      this.finishEntry();
    } else if (!this.modal.hidden) {
      window.clearTimeout(this.transitionTimer);
      this.finishExit(true);
    }
  };

  private openGrowth(index: number, origin: HTMLElement) {
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
      return;
    }
    const star = target.closest<HTMLElement>("[data-star]");
    if (star) { event.stopPropagation(); this.openStar(star.dataset.star!); return; }
    const growth = target.closest<HTMLElement>("[data-growth]");
    if (growth) { event.stopPropagation(); this.openGrowth(Number(growth.dataset.growth), growth); }
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.visible) return;
    if (this.modalOpen || !this.modal.hidden) {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); this.closeDetail(); }
      if (event.key === "Tab") {
        if (!this.modal.classList.contains("is-ready")) { event.preventDefault(); return; }
        const stops = [...this.terminal.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]')];
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
    const candidates = [...this.home.querySelectorAll<HTMLElement>("[data-star]")].filter((node) => node !== origin).map((node) => {
      const other = node.getBoundingClientRect();
      const primary = (horizontal ? other.left - rect.left : other.top - rect.top) * sign;
      const secondary = Math.abs(horizontal ? other.top - rect.top : other.left - rect.left);
      return { node, primary, score: primary + secondary * 1.8 };
    }).filter((candidate) => candidate.primary > 4).sort((a, b) => a.score - b.score);
    candidates[0]?.node.focus({ preventScroll: false });
  };
}
