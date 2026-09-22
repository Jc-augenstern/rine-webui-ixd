import { authService } from "./auth/auth-service";
import type { Credentials, AuthService } from "./auth/auth-types";
import { LoginPanel } from "./auth/login-panel";
import type { BootSequence } from "./boot";
import type { TerminalAudio } from "./audio";
import type { RenderQuality } from "./render-quality";
import { GalaxyScene } from "./galaxy/galaxy-scene";
import { StarMapUI } from "./ui/star-map-ui";
import { IxdPortal, PORTAL_DURATION, REDUCED_PORTAL_DURATION } from "./ui/ixd-portal";
import "./ixd-experience.css";
import { StartupPreparation, PREPARATION_DURATION } from "./startup-preparation";
import { WELCOME_FLASH_DURATION_MS } from "./welcome-transition";

type Phase =
  | "preparing"
  | "intro"
  | "login-enter"
  | "login"
  | "authenticating"
  | "confirmed"
  | "authorized"
  | "handoff"
  | "welcome"
  | "bridge"
  | "galaxy";
interface Options {
  host: HTMLElement;
  stage: HTMLElement;
  preparation: HTMLElement;
  boot: BootSequence;
  audio: TerminalAudio;
  reduced: () => boolean;
  quality: () => RenderQuality;
  onGalaxy: () => void;
  onReplay: () => void;
  onSettings: () => void;
  onSound: () => void;
  auth?: AuthService;
}
/** Bridges the existing calibrated boot timeline to an input-driven login and star map. */
export class IxdExperience {
  phase: Phase = "preparing";
  private age = 0;
  private bootTime = 4.16;
  private preparation: StartupPreparation;
  private readonly loginEntranceDuration = .72;
  private readonly ringEndDuration = WELCOME_FLASH_DURATION_MS / 1000;
  private handoffStartedAt = 0;
  private elapsed = 0;
  private login: LoginPanel;
  private galaxyHost = document.createElement("section");
  private galaxy?: GalaxyScene;
  private map?: StarMapUI;
  private abort?: AbortController;
  private lastBoot = -1;
  private sound = true;
  private portal: IxdPortal;
  private settingsOpen = false;
  private detailOpen = false;
  private debugBridgePaused = false;
  private pendingPointer: { x: number; y: number } | null = null;
  private pointerLeave = () => {
    this.pendingPointer = null;
    this.map?.setPointer(0, 0);
    this.galaxy?.leavePointer();
  };
  private visibility = () => { if (document.hidden) this.pointerLeave(); };
  private pointer = (event: PointerEvent) => {
    if (this.phase === "galaxy" && event.pointerType !== "touch") {
      this.pendingPointer = { x: event.clientX, y: event.clientY };
      const samples = event.getCoalescedEvents?.() ?? [];
      for (const sample of samples.length ? samples : [event]) {
        this.galaxy?.setPointerClient(sample.clientX, sample.clientY, sample.timeStamp);
      }
    }
  };
  constructor(private options: Options) {
    this.preparation = new StartupPreparation(options.preparation);
    this.galaxyHost.id = "ixd-galaxy";
    this.galaxyHost.hidden = true;
    this.galaxyHost.setAttribute("aria-label", "IXD 星图");
    options.host.append(this.galaxyHost);
    this.portal = new IxdPortal(options.host, this.galaxyHost, options.stage.querySelector(".welcome-logo")!, () => this.skipPortal());
    this.login = new LoginPanel(
      options.host,
      (credentials) => void this.authenticate(credentials),
    );
    options.host.classList.add("ixd-experience");
    options.host.addEventListener("pointermove", this.pointer, {
      passive: true,
    });
    options.host.addEventListener("pointerleave", this.pointerLeave, { passive: true });
    options.host.addEventListener("pointercancel", this.pointerLeave, { passive: true });
    window.addEventListener("blur", this.pointerLeave);
    document.addEventListener("visibilitychange", this.visibility);
    this.setPhase("preparing");
  }
  private setPhase(phase: Phase) {
    this.phase = phase;
    this.age = 0;
    if (phase === "handoff") this.handoffStartedAt = performance.now();
    this.options.host.dataset.experience = phase;
    this.options.stage.dataset.experience = phase;
    document.body.classList.toggle("galaxy-active", phase === "galaxy");
  }
  skipIntro() {
    if (this.phase !== "intro" && this.phase !== "login-enter") return;
    this.bootTime = 7.76;
    this.renderBoot(this.bootTime);
    this.setPhase("login");
    this.login.element.inert = false;
    this.login.show();
    this.login.element.style.opacity = "1";
    this.login.element.style.translate = "0 0";
    this.options.boot.renderLogin(3.6, 1);
  }
  private async authenticate(credentials: Credentials) {
    if (this.phase !== "login") return;
    this.abort?.abort();
    this.abort = new AbortController();
    const request = this.abort;
    this.setPhase("authenticating");
    this.login.progress("AUTHENTICATING", "正在确认访问身份");
    void this.options.audio.unlock().catch(() => false);
    try {
      const result = await (this.options.auth ?? authService).authenticate(
        credentials,
        request.signal,
      );
      if (request.signal.aborted) return;
      if (!result.ok) {
        this.setPhase("login");
        this.login.error();
        return;
      }
      this.setPhase("confirmed");
      this.login.progress("IDENTITY CONFIRMED", "身份已确认 · 准备授权");
      this.options.audio.play("confirm");
    } catch {
      if (!request.signal.aborted) {
        this.setPhase("login");
        this.login.error("ACCESS DENIED / CHANNEL UNAVAILABLE");
      }
    }
  }
  private renderBoot(time: number) {
    if (time === this.lastBoot) return;
    this.lastBoot = time;
    const motion = this.options.boot.update(time);
    this.options.stage.dataset.boot = motion.step;
    this.options.audio.updateBoot(time, false);
  }
  update(dt: number) {
    if (!(this.phase === "bridge" && this.debugBridgePaused)) this.age += dt;
    // The short editorial cut uses elapsed milliseconds, independently of the
    // capped physics dt. A delayed frame skips ahead instead of extending it.
    if (this.phase === "handoff") this.age = (performance.now() - this.handoffStartedAt) / 1000;
    this.elapsed += dt;
    const reduced = this.options.reduced();
    if (this.phase === "preparing") {
      if (this.preparation.update(dt)) {
        this.setPhase("intro");
        this.options.boot.renderLogin(0, 0);
      }
    } else if (this.phase === "intro") {
      if (reduced) {
        this.skipIntro();
        return;
      }
      this.bootTime = 4.16 + Math.min(2.84, this.age);
      this.options.boot.renderLogin(this.bootTime - 4.16, 0);
      this.options.audio.updateBoot(this.bootTime, false);
      if (this.age >= 2.84) {
        this.setPhase("login-enter");
        this.login.element.inert = true;
        this.login.show();
        this.login.element.style.opacity = "0";
        this.login.element.style.translate = "32px 0";
      }
    } else if (this.phase === "login-enter") {
      const p = Math.min(1, this.age / this.loginEntranceDuration), e = p * p * (3 - 2 * p);
      this.options.boot.renderLogin(3.6, p);
      this.login.element.style.opacity = String(e);
      this.login.element.style.translate = `${32 * (1 - e)}px 0`;
      if (p >= 1 || reduced) this.skipIntro();
    } else if (
      this.phase === "confirmed" &&
      this.age >= (reduced ? 0.3 : 0.75)
    ) {
      this.login.hide();
      this.setPhase("authorized");
      this.bootTime = 14.48;
      this.renderBoot(reduced ? 15.4 : this.bootTime);
      this.options.audio.play("scan");
    } else if (this.phase === "authorized") {
      this.bootTime = Math.min(17.5, this.bootTime + dt * 2);
      this.renderBoot(reduced ? 15.4 : this.bootTime);
      if (reduced ? this.age >= .5 : this.bootTime >= 17.5) {
        this.setPhase(reduced ? "welcome" : "handoff");
        if (reduced) {
          this.options.boot.renderWelcome(20.4);
          this.options.audio.syncBootClock(20.4);
          this.options.audio.play("welcome");
        }
        else {
          this.options.boot.renderWelcomeFlash(0);
          this.options.audio.syncBootClock(17.76);
          this.options.audio.play("welcome");
        }
      }
    } else if (this.phase === "handoff") {
      this.options.boot.renderWelcomeFlash(Math.min(WELCOME_FLASH_DURATION_MS, this.age * 1000));
      this.options.audio.syncBootClock(17.76 + Math.min(this.age, this.ringEndDuration) * 2);
      if (this.age >= this.ringEndDuration || reduced) {
        this.setPhase("welcome");
        if (reduced) this.options.boot.renderWelcome(20.4);
      }
    } else if (this.phase === "welcome") {
      this.bootTime = Math.min(21.5, 19.2 + this.age * 2);
      this.options.boot.renderWelcome(reduced ? 20.4 : this.bootTime, reduced ? Infinity : this.age);
      // Single reveal events share the visual clock without truncating the
      // ongoing Welcome chord when the archived clock skips between phases.
      this.options.audio.syncBootClock(reduced ? 20.4 : this.bootTime);
      if (!reduced) for (const cue of [.16, .42]) {
        if (this.age >= cue && this.age - dt < cue) this.options.audio.play("text-reveal");
      }
      // Keep atlas/scene construction away from the short flicker pulses.
      if (this.age >= .55 && this.galaxyHost.hidden) this.prepareGalaxy();
      this.galaxy?.update(dt, this.elapsed);
      if (this.age >= (reduced ? .5 : 1.5)) this.beginPortal();
    } else if (this.phase === "bridge") {
      const duration = reduced ? REDUCED_PORTAL_DURATION : PORTAL_DURATION;
      this.options.boot.renderWelcomeExit(this.age / (reduced ? .28 : .55));
      this.options.audio.syncBootClock(Math.min(21.92, 21.5 + this.age * .8));
      const portalCue = reduced ? .12 : .525;
      if (this.age >= portalCue && this.age - dt < portalCue) this.options.audio.play("array");
      this.galaxy?.setPortalProgress(reduced ? 1 : Math.max(0, Math.min(1, (this.age - 1.2) / .75)));
      this.galaxy?.update(dt, this.elapsed);
      this.portal.update(this.age);
      this.map?.updateArrival(reduced ? this.age / duration : (this.age - 1.95) / .45);
      if (this.age >= duration) this.enterGalaxy();
    } else if (this.phase === "galaxy") {
      if (this.pendingPointer) {
        const rect = this.galaxyHost.getBoundingClientRect();
        this.map?.setPointer((this.pendingPointer.x - rect.left) / Math.max(1, rect.width) * 2 - 1,
          (this.pendingPointer.y - rect.top) / Math.max(1, rect.height) * 2 - 1);
        this.pendingPointer = null;
      }
      this.galaxy?.update(dt, this.elapsed);
      this.map?.update(dt);
    }
  }
  private prepareGalaxy() {
    this.galaxyHost.hidden = false;
    this.galaxyHost.inert = true;
    this.galaxyHost.style.clipPath = "inset(50%)";
    if (!this.galaxy) {
      const sceneHost = document.createElement("div");
      sceneHost.className = "galaxy-canvas";
      this.galaxyHost.append(sceneHost);
      this.galaxy = new GalaxyScene(sceneHost, {
        reduced: this.options.reduced(),
        quality: this.options.quality(),
      });
      this.map = new StarMapUI(this.galaxyHost, {
        reduced: this.options.reduced(),
        onFocus: (position) => {
          this.detailOpen = Boolean(position);
          this.galaxy?.setFocus(position);
          this.syncInteraction();
          this.options.audio.play(position ? "open" : "back");
        },
        onReplay: this.options.onReplay,
        onSettings: this.options.onSettings,
        onSound: this.options.onSound,
      });
    }
    this.galaxy.setInteractionEnabled(false);
    this.galaxy.setPortalProgress(0);
    this.map?.prepareArrival();
    this.map?.setSound(this.sound);
    this.galaxy.resize();
    // Render the actual final scene behind a closed mask before it is revealed.
    this.galaxy.update(0, this.elapsed);
  }
  private beginPortal() {
    this.prepareGalaxy();
    this.setPhase("bridge");
    this.options.stage.inert = true;
    this.portal.start(this.options.reduced(), this.map!.portalAnchor());
  }
  skipPortal() {
    if (this.phase === "bridge") this.enterGalaxy();
  }
  private enterGalaxy() {
    this.debugBridgePaused = false;
    this.galaxy?.setPortalProgress(1);
    this.map?.updateArrival(1);
    this.portal.finish();
    this.setPhase("galaxy");
    this.options.stage.inert = false;
    this.galaxyHost.inert = this.settingsOpen;
    this.login.hide();
    this.map?.show();
    this.syncInteraction();
    this.options.onGalaxy();
    // onGalaxy changes the parent layout and can resize/clear the WebGL canvas.
    // Repaint after that callback in this same frame before the mask is presented.
    this.galaxy?.update(0, this.elapsed);
    if (!location.hash.startsWith("#star/")) this.map?.focusHome();
  }
  private syncInteraction() {
    this.galaxy?.setInteractionEnabled(this.phase === "galaxy" && !this.detailOpen && !this.settingsOpen);
  }
  restart() {
    this.abort?.abort();
    this.debugBridgePaused = false;
    this.portal.finish();
    this.options.stage.inert = false;
    this.pointerLeave();
    this.login.hide();
    this.map?.hide();
    this.galaxy?.setFocus(null);
    this.galaxy?.setInteractionEnabled(false);
    this.detailOpen = false;
    this.settingsOpen = false;
    this.galaxyHost.hidden = true;
    this.bootTime = 4.16;
    this.lastBoot = -1;
    this.preparation.restart();
    this.setPhase("preparing");
  }
  configure() {
    this.galaxy?.setReduced(this.options.reduced());
    this.map?.setReduced(this.options.reduced());
    this.galaxy?.setQuality(this.options.quality());
    if (this.phase === "bridge" && this.options.reduced()) this.skipPortal();
  }
  setSound(enabled: boolean) {
    this.sound = enabled;
    this.map?.setSound(enabled);
  }
  resize() {
    this.galaxy?.resize();
    if (this.phase === "bridge" && this.map) this.portal.resize(this.map.portalAnchor());
  }
  setModalOpen(open: boolean) {
    this.settingsOpen = open;
    this.galaxyHost.inert = open;
    this.syncInteraction();
  }
  /** Only connected to window.rhine in development builds; never a product control. */
  debug(options: { freezeCamera?: boolean; freezeTime?: boolean; resetFlow?: boolean; particles?: boolean; portalSeek?: number | null; probe?: { x: number; y: number }; section?: { x: number; y: number; tx: number; ty: number } }) {
    if (!import.meta.env.DEV) return;
    if (options.freezeCamera !== undefined) this.galaxy?.setCameraFrozen(options.freezeCamera);
    if (options.freezeTime !== undefined) this.galaxy?.setTimeFrozen(options.freezeTime);
    if (options.resetFlow) this.galaxy?.resetFlow();
    if (options.portalSeek !== undefined && this.phase === "bridge") {
      this.debugBridgePaused = options.portalSeek !== null;
      if (options.portalSeek !== null) this.age = Math.max(0, Math.min(PORTAL_DURATION - .001, options.portalSeek));
      this.update(0);
    }
    return { ...this.stats(), sample: options.probe ? this.galaxy?.sampleField(options.probe.x, options.probe.y) : undefined,
      flowSample: options.probe ? this.galaxy?.sampleFlow(options.probe.x, options.probe.y) : undefined,
      flowSection: options.section ? this.galaxy?.sampleFlowSection(options.section.x, options.section.y, options.section.tx, options.section.ty) : undefined,
      particles: options.particles ? this.galaxy?.particleSamples() : undefined };
  }
  stats() {
    return {
      phase: this.phase,
      bootTime: this.bootTime,
      phaseAge: this.age,
      preparationDuration: PREPARATION_DURATION,
      preparationElapsed: this.preparation.elapsed,
      preparationCompletedDuration: this.preparation.completedDuration,
      loginEntranceDuration: this.loginEntranceDuration,
      ringEndDuration: this.ringEndDuration,
      welcomeSpeed: 2,
      bridgeProgress: this.phase === "bridge" ? this.age / (this.options.reduced() ? REDUCED_PORTAL_DURATION : PORTAL_DURATION) : this.phase === "galaxy" ? 1 : 0,
      bridgeDuration: this.options.reduced() ? REDUCED_PORTAL_DURATION : PORTAL_DURATION,
      galaxy: this.galaxy?.stats() ?? null,
    };
  }
  dispose() {
    this.abort?.abort();
    this.options.stage.inert = false;
    document.body.classList.remove("galaxy-active");
    delete this.options.host.dataset.experience;
    delete this.options.stage.dataset.experience;
    this.login.dispose();
    this.preparation.hide();
    this.portal.dispose();
    this.map?.dispose();
    this.galaxy?.dispose();
    this.galaxyHost.remove();
    this.options.host.removeEventListener("pointermove", this.pointer);
    this.options.host.removeEventListener("pointerleave", this.pointerLeave);
    this.options.host.removeEventListener("pointercancel", this.pointerLeave);
    window.removeEventListener("blur", this.pointerLeave);
    document.removeEventListener("visibilitychange", this.visibility);
  }
}
