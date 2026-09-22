import * as THREE from "three";
import {
  normalizeQuality,
  renderDimensions,
  type RenderQuality,
} from "../render-quality";
import { GalaxyCamera, type GalaxyPosition } from "./galaxy-camera";
import { createAtmosphere } from "./galaxy-atmosphere";
import { StarField, seededRandom, type StarUniforms } from "./star-field";
import { nebulaAtlas } from "./nebula-texture";
import { GalaxyInteraction } from "./galaxy-interaction";

export type GalaxyOptions = { reduced: boolean; quality: RenderQuality };

/** Owns only the sky. Navigation, focusable stars and the shared frame loop stay with the app. */
export class GalaxyScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private view = new GalaxyCamera();
  private interaction = new GalaxyInteraction();
  private field: StarField | null = null;
  private atmosphere: ReturnType<typeof createAtmosphere> | null = null;
  private fallback: HTMLCanvasElement;
  private events = new AbortController();
  private quality: RenderQuality;
  private reduced: boolean;
  private disposed = false;
  private contextLost = false;
  private fallbackReason: string | null = null;
  private dirty = true;
  private width = 1;
  private height = 1;
  private renderWidth = 1;
  private renderHeight = 1;
  private ratio = 1;
  private renderedFrames = 0;
  private time = 0;
  private pointerX = 0;
  private pointerY = 0;
  private interactionEnabled = true;
  private hasFocus = false;
  private cameraFrozen = false;
  private timeFrozen = false;
  private adaptiveLevel = 0;
  private frameSamples = 0;
  private frameTime = 0;
  private slowWindows = 0;
  private uniforms: StarUniforms = {
    ...this.interaction.uniforms,
    uTime: { value: 0 },
    uMotion: { value: 1 },
    // Render displacement only: the solver, input footprint and decay stay intact.
    uFlowDisplayGain: { value: 1.4 },
    uAspect: { value: 1 },
    uPixelRatio: { value: 1 },
    uPointer: { value: new THREE.Vector2() },
    uFocus: { value: 0 },
    uTarget: { value: new THREE.Vector2(0.5, 0.5) },
    uParallaxOffset: { value: new THREE.Vector2() },
  };

  constructor(
    private host: HTMLElement,
    options: GalaxyOptions,
  ) {
    this.quality = normalizeQuality(options.quality);
    this.reduced = options.reduced;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    this.adaptiveLevel = navigator.hardwareConcurrency <= 4 || (memory !== undefined && memory <= 4) ? 1 : 0;
    this.uniforms.uMotion.value = this.reduced ? 0 : 1;
    document.addEventListener("visibilitychange", this.onVisibilityChange, {
      signal: this.events.signal,
    });
    window.addEventListener("blur", this.leavePointer.bind(this), { signal: this.events.signal });
    this.fallback = document.createElement("canvas");
    this.fallback.className = "galaxy-static-sky";
    this.fallback.setAttribute("aria-hidden", "true");
    this.fallback.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;background:#070b18;";
    host.append(this.fallback);
    try {
      this.renderer = new THREE.WebGLRenderer({
        alpha: false,
        antialias: false,
        powerPreference: "low-power",
      });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor("#070b18", 1);
      this.renderer.domElement.className = "galaxy-webgl";
      this.renderer.domElement.setAttribute("aria-hidden", "true");
      this.renderer.domElement.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
      this.renderer.domElement.addEventListener(
        "webglcontextlost",
        this.onContextLost,
        { signal: this.events.signal },
      );
      this.renderer.domElement.addEventListener(
        "webglcontextrestored",
        this.onContextRestored,
        { signal: this.events.signal },
      );
      this.field = new StarField(this.uniforms);
      this.atmosphere = createAtmosphere(this.uniforms);
      this.scene.add(this.atmosphere, this.field.group);
      host.append(this.renderer.domElement);
      host.dataset.galaxyRenderer = "webgl";
    } catch {
      this.fallbackReason = "webgl-unavailable";
      this.releaseWebGL();
      host.dataset.galaxyRenderer = "static";
    }
    this.resize();
  }

  private onVisibilityChange = () => {
    if (!document.hidden) { this.dirty = true; return; }
    this.interaction.pause();
    this.pointerX = this.pointerY = 0;
    this.view.setPointer(0, 0);
  };

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.fallbackReason = "webgl-context-unavailable";
    this.fallback.hidden = false;
    if (this.renderer) this.renderer.domElement.hidden = true;
    this.host.dataset.galaxyRenderer = "static";
  };

  private onContextRestored = () => {
    if (this.disposed) return;
    this.contextLost = false;
    this.fallbackReason = null;
    if (this.renderer) this.renderer.domElement.hidden = false;
    this.dirty = true;
    this.host.dataset.galaxyRenderer = "webgl";
    this.resize();
  };

  private setDensity() {
    const compact = this.width < 700 ? 0.64 : 1;
    const performance = this.quality.scale <= 80 ? 0.67 : 1;
    this.field?.setDensity(compact * performance * (this.reduced ? 0.55 : 1) * (1 - this.adaptiveLevel * 0.22));
  }

  setPointer(x: number, y: number) {
    if (this.disposed || this.reduced) return;
    this.pointerX = Number.isFinite(x) ? THREE.MathUtils.clamp(x, -1, 1) : 0;
    this.pointerY = Number.isFinite(y) ? THREE.MathUtils.clamp(y, -1, 1) : 0;
    this.interaction.record(this.pointerX, this.pointerY, true);
    this.dirty = true;
  }

  setPointerClient(clientX: number, clientY: number, timeStamp?: number) {
    if (this.disposed || this.reduced) return;
    this.interaction.record(clientX, clientY, false, timeStamp);
    this.dirty = true;
  }

  leavePointer() {
    if (this.disposed) return;
    this.interaction.leave();
    this.pointerX = this.pointerY = 0;
    this.view.setPointer(0, 0);
    this.dirty = true;
  }

  setInteractionEnabled(enabled: boolean) {
    if (this.disposed || this.interactionEnabled === enabled) return;
    this.interactionEnabled = enabled;
    if (!enabled) this.interaction.pause();
    this.dirty = true;
  }

  setPortalProgress(progress: number) {
    if (this.disposed) return;
    this.view.setPortalProgress(progress);
    this.dirty = true;
  }

  /** Called only by the app's development diagnostics; never exposed as UI. */
  setCameraFrozen(frozen: boolean) {
    if (this.disposed || !import.meta.env.DEV) return;
    this.cameraFrozen = frozen;
    this.view.setFrozen(frozen);
    this.dirty = true;
  }

  setTimeFrozen(frozen: boolean) {
    if (this.disposed || !import.meta.env.DEV) return;
    this.timeFrozen = frozen;
    this.dirty = true;
  }

  sampleField(x: number, y: number) {
    return this.interaction.sample(x, y);
  }

  sampleFlow(x: number, y: number) { return this.interaction.sample(x, y); }

  sampleFlowSection(x: number, y: number, tx: number, ty: number) {
    return this.interaction.section(x, y, tx, ty);
  }

  particleSamples() { return this.field?.samples() ?? []; }

  resetFlow() {
    if (!import.meta.env.DEV || this.disposed) return;
    this.interaction.reset(); this.field?.reset();
    this.time = this.uniforms.uTime.value = 0;
    this.dirty = true;
  }

  setFocus(position: GalaxyPosition | null) {
    if (this.disposed) return;
    this.hasFocus = position !== null;
    if (position) this.interaction.pause();
    this.view.setFocus(position);
    this.dirty = true;
  }

  setReduced(reduced: boolean) {
    if (this.disposed || this.reduced === reduced) return;
    this.reduced = reduced;
    this.uniforms.uMotion.value = reduced ? 0 : 1;
    if (reduced) { this.interaction.reset(); this.field?.reset(); }
    this.setDensity();
    this.dirty = true;
  }

  setQuality(quality: RenderQuality) {
    if (this.disposed) return;
    this.quality = normalizeQuality(quality);
    this.resize();
  }

  resize() {
    if (this.disposed) return;
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.view.resize(this.width, this.height);
    this.uniforms.uAspect.value = this.width / this.height;
    this.interaction.setLowQuality(this.width < 700 || this.quality.scale <= 80 || this.adaptiveLevel > 0);
    if (this.renderer) {
      const budget = this.quality.scale <= 80 || this.adaptiveLevel > 0 ? 1_843_200 : 4_194_304;
      const dimensions = renderDimensions(
        this.quality,
        this.width,
        this.height,
        1,
        Math.min(window.devicePixelRatio || 1, 2),
        this.renderer.capabilities.maxTextureSize,
        budget,
      );
      this.ratio = Math.min(this.adaptiveLevel === 2 ? 0.8 : this.adaptiveLevel === 1 ? 1 : 2, dimensions.ratio);
      this.renderer.setPixelRatio(this.ratio);
      this.renderer.setSize(this.width, this.height, false);
      this.renderWidth = this.renderer.domElement.width;
      this.renderHeight = this.renderer.domElement.height;
      this.uniforms.uPixelRatio.value = this.ratio;
    }
    this.paintFallback();
    this.setDensity();
    this.dirty = true;
  }

  update(dt: number, elapsed: number) {
    if (this.disposed || document.hidden || (this.reduced && !this.dirty))
      return;
    const step = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0;
    const rect = this.host.getBoundingClientRect();
    this.interaction.resolve(rect);
    if (this.interaction.active) {
      this.pointerX = THREE.MathUtils.clamp(this.interaction.center.x / this.interaction.size.x * 2 - 1, -1, 1);
      this.pointerY = THREE.MathUtils.clamp(this.interaction.center.y / this.interaction.size.y * 2 - 1, -1, 1);
      this.view.setPointer(this.pointerX, this.pointerY);
    }
    this.view.update(step, this.reduced);
    this.uniforms.uPointer.value.set(this.view.pointer.x, this.view.pointer.y);
    this.uniforms.uFocus.value = this.view.focusAmount;
    this.uniforms.uTarget.value.set(this.view.focus.x, this.view.focus.y);
    const parallax = 1 - this.view.focusAmount * .86;
    this.uniforms.uParallaxOffset.value.set(this.view.pointer.x * .378 * parallax, -this.view.pointer.y * .2565 * parallax);
    const canSimulate = Boolean(this.renderer && !this.contextLost);
    this.interaction.update(canSimulate ? step : 0, rect, this.interactionEnabled && !this.hasFocus && canSimulate, this.reduced || !canSimulate,
      { pointer: this.view.pointer, focus: this.view.focusAmount, target: this.view.focus });
    if (!this.reduced && !this.timeFrozen) {
      // Local accumulated time avoids resuming with a large jump after a hidden tab.
      this.time += step;
      this.uniforms.uTime.value = this.time;
    }
    if (canSimulate) this.field?.update(step, this.interaction, this.view.camera, this.time, this.reduced);
    // Reduced motion becomes a genuinely static sky, with redraws only on changes.
    if (!this.renderer || this.contextLost) return;
    try {
      this.renderer.render(this.scene, this.view.camera);
      this.fallback.hidden = true;
      this.dirty = false;
      this.renderedFrames++;
      // Sample sustained foreground frame time, not startup or a single stall.
      // Only lower intensity in this session; avoid quality oscillation.
      if (!this.reduced && this.renderedFrames > 180 && dt > 0 && dt < 0.15 && this.adaptiveLevel < 2) {
        this.frameTime += dt;
        if (++this.frameSamples >= 120) {
          this.slowWindows = this.frameTime / this.frameSamples > 0.028 ? this.slowWindows + 1 : 0;
          this.frameSamples = 0;
          this.frameTime = 0;
          if (this.slowWindows >= 2) {
            this.adaptiveLevel++;
            this.slowWindows = 0;
            this.resize();
          }
        }
      }
    } catch {
      this.onContextLost(new Event("galaxy-render-error"));
    }
    // The root frame clock is accepted for a stable public contract, but movement
    // deliberately uses clamped delta time rather than an absolute wall clock.
    void elapsed;
  }

  private paintFallback() {
    const ratio = Math.min(
      1,
      Math.sqrt(1_843_200 / (this.width * this.height)),
    );
    this.fallback.width = Math.max(1, Math.floor(this.width * ratio));
    this.fallback.height = Math.max(1, Math.floor(this.height * ratio));
    const context = this.fallback.getContext("2d");
    if (!context) return;
    const w = this.fallback.width,
      h = this.fallback.height;
    try {
      const cloud = nebulaAtlas();
      const cover = Math.max(w / cloud.width, h / cloud.height) / 0.88;
      context.drawImage(cloud, (w - cloud.width * cover) / 2, (h - cloud.height * cover) / 2, cloud.width * cover, cloud.height * cover);
    } catch {
      // A failed atlas must not be requested forever or prevent the portal from
      // finishing. The lightweight sky still provides readable navigation.
      this.fallbackReason = "nebula-unavailable";
      const gradient = context.createLinearGradient(0, h, w, 0);
      gradient.addColorStop(0, "#070b18");
      gradient.addColorStop(0.45, "#172241");
      gradient.addColorStop(0.6, "#1b1e3b");
      gradient.addColorStop(1, "#070b18");
      context.fillStyle = gradient;
      context.fillRect(0, 0, w, h);
    }
    const random = seededRandom(901);
    for (let i = 0; i < (this.width < 700 ? 130 : 260); i++) {
      const x = random() * w,
        y = random() * h;
      const radius = (0.25 + random() * 0.65) * ratio;
      context.fillStyle = `rgba(182, 199, 236, ${0.15 + random() * 0.5})`;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  stats() {
    return {
      renderer: this.disposed
        ? "disposed"
        : this.renderer && !this.contextLost
          ? "webgl"
          : "static",
      reduced: this.reduced,
      fallbackReason: this.fallbackReason,
      field: {
        ...this.interaction.stats(),
        cameraFrozen: this.cameraFrozen,
        timeFrozen: this.timeFrozen,
      },
      flow: {
        ...this.interaction.stats(), cameraFrozen: this.cameraFrozen, timeFrozen: this.timeFrozen,
        persistentParticles: true, materialState: "advected-reference-map", simulationHz: 60,
        displayGain: this.uniforms.uFlowDisplayGain.value,
        uploadBytesPerStep: this.interaction.uniforms.uFlowState.value.image.data?.byteLength ?? 0,
      },
      depthLayers: 4,
      adaptiveLevel: this.adaptiveLevel,
      // Approximate horizontal displacement in CSS pixels, including aspect/cover.
      parallax: {
        nebula: this.view.pointer.x * 0.00405 * this.width / (Math.min(1, this.width / this.height / 1.6667) * (0.88 - this.view.focusAmount * 0.13)),
        far: this.view.camera.position.x * .28 * this.height / (0.8904574 * (this.view.camera.position.z + 12)),
        middle: this.view.camera.position.x * this.height / (0.8904574 * (this.view.camera.position.z + 2)),
        near: this.view.camera.position.x * this.height / (0.8904574 * (this.view.camera.position.z - 3)),
      },
      particles: this.field?.count ?? 0,
      drawCalls: this.renderer?.info.render.calls ?? 0,
      renderedFrames: this.renderedFrames,
      width: this.renderWidth,
      height: this.renderHeight,
      pixelRatio: this.ratio,
      focus: this.view.focusAmount,
      camera: {
        x: this.view.camera.position.x,
        y: this.view.camera.position.y,
        z: this.view.camera.position.z,
      },
      geometries: this.renderer?.info.memory.geometries ?? 0,
      textures: this.renderer?.info.memory.textures ?? 0,
    };
  }

  private releaseWebGL() {
    this.field?.dispose();
    this.atmosphere?.geometry.dispose();
    this.atmosphere?.material.uniforms.uNebula.value.dispose();
    this.atmosphere?.material.dispose();
    this.scene.clear();
    this.field = null;
    this.atmosphere = null;
    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.events.abort();
    this.interaction.dispose();
    this.releaseWebGL();
    this.fallback.remove();
    delete this.host.dataset.galaxyRenderer;
  }
}
