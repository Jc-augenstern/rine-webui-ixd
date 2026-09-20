import * as THREE from "three";
import {
  normalizeQuality,
  renderDimensions,
  type RenderQuality,
} from "../render-quality";
import { GalaxyCamera, type GalaxyPosition } from "./galaxy-camera";
import { createAtmosphere, GalaxyTrails } from "./galaxy-atmosphere";
import { StarField, seededRandom, type StarUniforms } from "./star-field";

export type GalaxyOptions = { reduced: boolean; quality: RenderQuality };

/** Owns only the sky. Navigation, focusable stars and the shared frame loop stay with the app. */
export class GalaxyScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private view = new GalaxyCamera();
  private field: StarField | null = null;
  private trails: GalaxyTrails | null = null;
  private atmosphere: ReturnType<typeof createAtmosphere> | null = null;
  private fallback: HTMLCanvasElement;
  private events = new AbortController();
  private quality: RenderQuality;
  private reduced: boolean;
  private disposed = false;
  private contextLost = false;
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
  private uniforms: StarUniforms = {
    uTime: { value: 0 },
    uMotion: { value: 1 },
    uAspect: { value: 1 },
    uPixelRatio: { value: 1 },
    uPointer: { value: new THREE.Vector2() },
    uFocus: { value: 0 },
  };

  constructor(
    private host: HTMLElement,
    options: GalaxyOptions,
  ) {
    this.quality = normalizeQuality(options.quality);
    this.reduced = options.reduced;
    this.uniforms.uMotion.value = this.reduced ? 0 : 1;
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
      this.trails = new GalaxyTrails(this.uniforms);
      this.atmosphere = createAtmosphere(this.uniforms);
      this.scene.add(this.atmosphere, this.field.group, this.trails.points);
      host.append(this.renderer.domElement);
      host.dataset.galaxyRenderer = "webgl";
    } catch {
      this.releaseWebGL();
      host.dataset.galaxyRenderer = "static";
    }
    this.resize();
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.fallback.hidden = false;
    if (this.renderer) this.renderer.domElement.hidden = true;
    this.host.dataset.galaxyRenderer = "static";
  };

  private onContextRestored = () => {
    if (this.disposed) return;
    this.contextLost = false;
    if (this.renderer) this.renderer.domElement.hidden = false;
    this.dirty = true;
    this.host.dataset.galaxyRenderer = "webgl";
    this.resize();
  };

  private setDensity() {
    const compact = this.width < 700 ? 0.64 : 1;
    const performance = this.quality.scale <= 80 ? 0.67 : 1;
    this.field?.setDensity(compact * performance * (this.reduced ? 0.4 : 0.8));
  }

  setPointer(x: number, y: number) {
    if (this.disposed) return;
    this.pointerX = Number.isFinite(x) ? THREE.MathUtils.clamp(x, -1, 1) : 0;
    this.pointerY = Number.isFinite(y) ? THREE.MathUtils.clamp(y, -1, 1) : 0;
    this.view.setPointer(this.pointerX, this.pointerY);
  }

  setFocus(position: GalaxyPosition | null) {
    if (this.disposed) return;
    this.view.setFocus(position);
    this.dirty = true;
  }

  setReduced(reduced: boolean) {
    if (this.disposed || this.reduced === reduced) return;
    this.reduced = reduced;
    this.uniforms.uMotion.value = reduced ? 0 : 1;
    this.trails?.clear();
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
    if (this.renderer) {
      const budget = this.quality.scale <= 80 ? 1_843_200 : 4_194_304;
      const dimensions = renderDimensions(
        this.quality,
        this.width,
        this.height,
        1,
        Math.min(window.devicePixelRatio || 1, 2),
        this.renderer.capabilities.maxTextureSize,
        budget,
      );
      this.ratio = Math.min(2, dimensions.ratio);
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
    this.view.update(step, this.reduced);
    this.uniforms.uPointer.value.set(this.view.pointer.x, this.view.pointer.y);
    this.uniforms.uFocus.value = this.view.focusAmount;
    if (!this.reduced) {
      // Local accumulated time avoids resuming with a large jump after a hidden tab.
      this.time += step;
      this.uniforms.uTime.value = this.time;
    }
    this.trails?.update(
      this.pointerX,
      this.pointerY,
      step,
      this.time,
      this.reduced,
    );
    // Reduced motion becomes a genuinely static sky, with redraws only on changes.
    if (!this.renderer || this.contextLost) return;
    try {
      this.renderer.render(this.scene, this.view.camera);
      this.fallback.hidden = true;
      this.dirty = false;
      this.renderedFrames++;
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
    context.fillStyle = "#070b18";
    context.fillRect(0, 0, w, h);
    const glow = context.createRadialGradient(
      w * 0.38,
      h * 0.35,
      0,
      w * 0.38,
      h * 0.35,
      w * 0.65,
    );
    glow.addColorStop(0, "#11142c");
    glow.addColorStop(1, "#070b18");
    context.fillStyle = glow;
    context.fillRect(0, 0, w, h);
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
    this.trails?.dispose();
    this.atmosphere?.geometry.dispose();
    this.atmosphere?.material.dispose();
    this.scene.clear();
    this.field = null;
    this.trails = null;
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
    this.releaseWebGL();
    this.fallback.remove();
    delete this.host.dataset.galaxyRenderer;
  }
}
