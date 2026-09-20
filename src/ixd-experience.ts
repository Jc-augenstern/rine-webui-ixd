import { authService } from "./auth/auth-service";
import type { Credentials, AuthService } from "./auth/auth-types";
import { LoginPanel } from "./auth/login-panel";
import type { BootSequence } from "./boot";
import type { TerminalAudio } from "./audio";
import type { RenderQuality } from "./render-quality";
import { GalaxyScene } from "./galaxy/galaxy-scene";
import { StarMapUI } from "./ui/star-map-ui";
import "./ixd-experience.css";

type Phase =
  | "intro"
  | "login"
  | "authenticating"
  | "confirmed"
  | "authorized"
  | "welcome"
  | "galaxy";
interface Options {
  host: HTMLElement;
  stage: HTMLElement;
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
  phase: Phase = "intro";
  private age = 0;
  private bootTime = 1.76;
  private elapsed = 0;
  private login: LoginPanel;
  private galaxyHost = document.createElement("section");
  private galaxy?: GalaxyScene;
  private map?: StarMapUI;
  private abort?: AbortController;
  private lastBoot = -1;
  private sound = true;
  private pointer = (event: PointerEvent) => {
    if (this.phase === "galaxy")
      this.galaxy?.setPointer(
        (event.clientX / innerWidth) * 2 - 1,
        (event.clientY / innerHeight) * 2 - 1,
      );
  };
  constructor(private options: Options) {
    this.galaxyHost.id = "ixd-galaxy";
    this.galaxyHost.hidden = true;
    this.galaxyHost.setAttribute("aria-label", "IXD 星图");
    options.host.append(this.galaxyHost);
    this.login = new LoginPanel(
      options.host,
      (credentials) => void this.authenticate(credentials),
    );
    options.host.classList.add("ixd-experience");
    options.host.addEventListener("pointermove", this.pointer, {
      passive: true,
    });
    this.setPhase("intro");
  }
  private setPhase(phase: Phase) {
    this.phase = phase;
    this.age = 0;
    this.options.host.dataset.experience = phase;
    this.options.stage.dataset.experience = phase;
    document.body.classList.toggle("galaxy-active", phase === "galaxy");
  }
  skipIntro() {
    if (this.phase !== "intro") return;
    this.bootTime = 7.76;
    this.renderBoot(this.bootTime);
    this.setPhase("login");
    this.login.show();
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
    this.age += dt;
    this.elapsed += dt;
    const reduced = this.options.reduced();
    if (this.phase === "intro") {
      if (reduced) {
        this.skipIntro();
        return;
      }
      this.bootTime = Math.min(7.76, this.bootTime + dt);
      this.renderBoot(this.bootTime);
      if (this.bootTime >= 7.76) this.skipIntro();
    } else if (
      this.phase === "confirmed" &&
      this.age >= (reduced ? 0.3 : 0.75)
    ) {
      this.login.hide();
      this.setPhase("authorized");
      this.bootTime = 14.48;
      this.renderBoot(this.bootTime);
    } else if (this.phase === "authorized" || this.phase === "welcome") {
      // Preserve all original ring, mask, logo and lettering tracks at exactly 2×.
      this.bootTime += dt * 2;
      if (reduced) {
        this.renderBoot(this.phase === "authorized" ? 15.4 : 20.4);
        if (this.phase === "authorized" && this.age > 0.5)
          this.setPhase("welcome");
        else if (this.phase === "welcome" && this.age > 0.5) this.enterGalaxy();
      } else {
        this.renderBoot(this.bootTime);
        if (this.bootTime >= 17.76 && this.phase === "authorized")
          this.setPhase("welcome");
        if (this.bootTime >= 21.9) this.enterGalaxy();
      }
    } else if (this.phase === "galaxy") this.galaxy?.update(dt, this.elapsed);
  }
  private enterGalaxy() {
    this.setPhase("galaxy");
    this.login.hide();
    this.galaxyHost.hidden = false;
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
          this.galaxy?.setFocus(position);
          this.options.audio.play(position ? "open" : "back");
        },
        onReplay: this.options.onReplay,
        onSettings: this.options.onSettings,
        onSound: this.options.onSound,
      });
    }
    this.map?.show();
    this.map?.setSound(this.sound);
    this.galaxy.resize();
    this.options.onGalaxy();
  }
  restart() {
    this.abort?.abort();
    this.login.hide();
    this.map?.hide();
    this.galaxy?.setFocus(null);
    this.galaxyHost.hidden = true;
    this.bootTime = 1.76;
    this.lastBoot = -1;
    this.setPhase("intro");
  }
  configure() {
    this.galaxy?.setReduced(this.options.reduced());
    this.map?.setReduced(this.options.reduced());
    this.galaxy?.setQuality(this.options.quality());
  }
  setSound(enabled: boolean) {
    this.sound = enabled;
    this.map?.setSound(enabled);
  }
  resize() {
    this.galaxy?.resize();
  }
  setModalOpen(open: boolean) {
    this.galaxyHost.inert = open;
  }
  stats() {
    return {
      phase: this.phase,
      bootTime: this.bootTime,
      welcomeSpeed: 2,
      galaxy: this.galaxy?.stats() ?? null,
    };
  }
  dispose() {
    this.abort?.abort();
    this.login.dispose();
    this.map?.dispose();
    this.galaxy?.dispose();
    this.galaxyHost.remove();
    this.options.host.removeEventListener("pointermove", this.pointer);
  }
}
