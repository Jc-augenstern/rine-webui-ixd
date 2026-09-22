import * as THREE from "three";
import { GalaxyInteraction, type FieldUniforms } from "./galaxy-interaction";
import { nebulaAtlas } from "./nebula-texture";

export type StarUniforms = FieldUniforms & {
  uTime: { value: number };
  uMotion: { value: number };
  uFlowDisplayGain: { value: number };
  uAspect: { value: number };
  uPixelRatio: { value: number };
  uPointer: { value: THREE.Vector2 };
  uFocus: { value: number };
  uTarget: { value: THREE.Vector2 };
  uParallaxOffset: { value: THREE.Vector2 };
};

/** Small deterministic generator keeps the same sky across resize and quality changes. */
export function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aAlpha;
  attribute vec3 aColor;
  attribute vec2 aFlowOffset;
  uniform float uTime;
  uniform float uMotion;
  uniform float uFlowDisplayGain;
  uniform float uAspect;
  uniform float uPixelRatio;
  uniform vec2 uPointer;
  uniform float uFocus;
  uniform float uNear;
  uniform float uLayerParallax;
  uniform vec2 uParallaxOffset;
  varying vec3 vColor;
  varying float vAlpha;
  uniform vec2 uFieldSize;
  void main() {
    float distance = 10.0 - position.z;
    vec3 point = vec3(position.x * 0.4452287 * distance * uAspect,
                      position.y * 0.4452287 * distance, position.z);
    float depth = clamp((position.z + 13.0) / 17.0, 0.0, 1.0);
    point.xy += uMotion * vec2(sin(uTime * 0.023 + aPhase),
                               cos(uTime * 0.017 + aPhase)) * (0.009 + depth * 0.018);
    point.xy += uParallaxOffset * (1. - uLayerParallax);
    vec4 projected = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
    projected.xy += aFlowOffset / uFieldSize * vec2(2., -2.) * projected.w * uMotion * uFlowDisplayGain;
    gl_Position = projected;
    gl_PointSize = clamp(aSize * uPixelRatio * 10.0 / max(4.0, - (modelViewMatrix * vec4(point, 1.0)).z),
                         1.0, 30.0 * uPixelRatio);
    float twinkle = 0.91 + sin(uTime * (0.27 + aPhase * 0.015) + aPhase) * 0.09 * uMotion;
    vColor = aColor;
    vAlpha = aAlpha * twinkle * (1.0 - uFocus * 0.28);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uNear;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 point = gl_PointCoord - 0.5;
    float r = dot(point, point);
    if (r > 0.25) discard;
    float core = exp(-r * 36.0) + exp(-r * 9.0) * .12;
    float flare = exp(-abs(point.x) * 70.0) * exp(-abs(point.y) * 8.0)
                + exp(-abs(point.y) * 70.0) * exp(-abs(point.x) * 8.0);
    float edge = 1.0 - smoothstep(0.16, 0.25, r);
    gl_FragColor = vec4(vColor, (core + flare * uNear * .4) * edge * vAlpha);
    #include <colorspace_fragment>
  }
`;

type LayerConfig = {
  count: number;
  zMin: number;
  zMax: number;
  size: number;
  alpha: number;
  near?: boolean;
  seed: number;
};

const layers: LayerConfig[] = [
  { count: 1900, zMin: -16, zMax: -9, size: 4.2, alpha: 0.75, seed: 901 },
  { count: 620, zMin: -5, zMax: 0, size: 4.6, alpha: 0.77, near: true, seed: 2026 },
  { count: 80, zMin: 1, zMax: 3, size: 8.4, alpha: 0.53, near: true, seed: 719 },
];

export class StarField {
  readonly group = new THREE.Group();
  private entries: {
    points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    count: number;
    materialUv: Float32Array;
    offset: Float32Array;
    velocity: Float32Array;
    baseline: Float32Array;
    response: number;
    parallax: number;
  }[] = [];
  private activeCount = 0;
  private aspect = 0;
  private planeX = 0;
  private planeY = 0;
  private point = new THREE.Vector3();
  private sample = new Float64Array(4);

  constructor(uniforms: StarUniforms) {
    // One initialization read establishes a distribution related to the actual
    // blue/cyan/violet cloud atlas. No canvas/GPU readback occurs in update().
    const atlas = nebulaAtlas();
    const atlasPixels = atlas.getContext("2d")!.getImageData(0, 0, atlas.width, atlas.height).data;
    const colors = [
      new THREE.Color("#d4ddff"),
      new THREE.Color("#bfc1ff"),
      new THREE.Color("#a4ccdf"),
      new THREE.Color("#edf2ff"),
      new THREE.Color("#f1c3a6"),
    ];
    for (const layer of layers) {
      const random = seededRandom(layer.seed);
      const position = new Float32Array(layer.count * 3);
      const color = new Float32Array(layer.count * 3);
      const size = new Float32Array(layer.count);
      const phase = new Float32Array(layer.count);
      const alpha = new Float32Array(layer.count);
      const materialUv = new Float32Array(layer.count * 2);
      const offset = new Float32Array(layer.count * 2);
      const velocity = new Float32Array(layer.count * 2);
      const baseline = new Float32Array(layer.count * 2);
      for (let i = 0; i < layer.count; i++) {
        let u = random(), v = random(), pixel = 0;
        for (let attempt = 0; attempt < 18; attempt++) {
          u = random(); v = random();
          pixel = (Math.floor(v * atlas.height) * atlas.width + Math.floor(u * atlas.width)) * 4;
          if (random() < .10 + (atlasPixels[pixel] + atlasPixels[pixel + 1] + atlasPixels[pixel + 2]) / 210) break;
        }
        materialUv[i * 2] = u; materialUv[i * 2 + 1] = v;
        position[i * 3] = (u - .5) * 2 / .88;
        position[i * 3 + 1] = (.5 - v) * 2 / .88;
        position[i * 3 + 2] = layer.zMin + random() * (layer.zMax - layer.zMin);
        const tint = colors[Math.floor(random() * colors.length)];
        color[i * 3] = tint.r;
        color[i * 3 + 1] = tint.g;
        color[i * 3 + 2] = tint.b;
        size[i] = layer.size * (0.65 + random() * 0.8);
        phase[i] = random() * Math.PI * 2;
        alpha[i] = layer.alpha * (0.35 + random() * 0.65);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
      geometry.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
      geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
      geometry.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
      geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
      geometry.setAttribute("aFlowOffset", new THREE.BufferAttribute(offset, 2).setUsage(THREE.DynamicDrawUsage));
      const material = new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uNear: { value: layer.near ? 1 : 0 },
          uLayerParallax: { value: layer.zMax < -8 ? .28 : 1 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      this.group.add(points);
      this.entries.push({ points, count: layer.count, materialUv, offset, velocity, baseline,
        response: layer.zMax < -8 ? .74 : layer.zMax < 1 ? 1 : 1.18,
        parallax: layer.zMax < -8 ? .28 : 1 });
    }
  }

  setDensity(factor: number) {
    this.activeCount = 0;
    for (const entry of this.entries) {
      const count = Math.max(1, Math.round(entry.count * factor));
      entry.points.geometry.setDrawRange(0, count);
      this.activeCount += count;
    }
  }

  get count() {
    return this.activeCount;
  }

  update(dt: number, flow: GalaxyInteraction, camera: THREE.PerspectiveCamera, time: number, reduced: boolean) {
    const aspect = camera.aspect, size = flow.size;
    const coverX = Math.min(1, aspect / (5 / 3)) * .88, coverY = Math.min(1, (5 / 3) / aspect) * .88;
    const changedAspect = this.aspect !== aspect;
    this.aspect = aspect;
    const rescaleX = this.planeX ? flow.plane.x / this.planeX : 1;
    const rescaleY = this.planeY ? flow.plane.y / this.planeY : 1;
    this.planeX = flow.plane.x; this.planeY = flow.plane.y;
    const blend = 1 - Math.exp(-dt * 8);
    for (const entry of this.entries) {
      const positions = entry.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      const phase = entry.points.geometry.getAttribute("aPhase").array;
      for (let i = 0; i < entry.count; i++) {
        const j = i * 2, k = i * 3;
        // The cloud stores UV state. Keep the particles' CSS state continuous
        // with that same material plane during resize, zoom and focus changes.
        entry.offset[j] *= rescaleX; entry.offset[j + 1] *= rescaleY;
        entry.velocity[j] *= rescaleX; entry.velocity[j + 1] *= rescaleY;
        if (changedAspect) {
          positions.array[k] = (entry.materialUv[j] - .5) * 2 / coverX;
          positions.array[k + 1] = (.5 - entry.materialUv[j + 1]) * 2 / coverY;
        }
        const z = positions.array[k + 2], distance = 10 - z;
        const depth = Math.max(0, Math.min(1, (z + 13) / 17));
        this.point.set(positions.array[k] * .4452287 * distance * aspect,
          positions.array[k + 1] * .4452287 * distance, z);
        if (!reduced) {
          this.point.x += Math.sin(time * .023 + phase[i]) * (.009 + depth * .018);
          this.point.y += Math.cos(time * .017 + phase[i]) * (.009 + depth * .018);
        }
        const parallax = entry.points.material.uniforms.uParallaxOffset.value as THREE.Vector2;
        this.point.x += parallax.x * (1 - entry.parallax);
        this.point.y += parallax.y * (1 - entry.parallax);
        this.point.project(camera);
        const x = (this.point.x * .5 + .5) * size.x, y = (.5 - this.point.y * .5) * size.y;
        entry.baseline[j] = x; entry.baseline[j + 1] = y;
        if (reduced) continue;
        flow.sampleInto(x + entry.offset[j], y + entry.offset[j + 1], this.sample);
        const targetX = this.sample[0] * entry.response - entry.offset[j] * 1.05;
        const targetY = this.sample[1] * entry.response - entry.offset[j + 1] * 1.05;
        entry.velocity[j] += (targetX - entry.velocity[j]) * blend;
        entry.velocity[j + 1] += (targetY - entry.velocity[j + 1]) * blend;
        const speedLimit = Math.min(1, 250 / Math.max(1, Math.hypot(entry.velocity[j], entry.velocity[j + 1])));
        entry.velocity[j] *= speedLimit; entry.velocity[j + 1] *= speedLimit;
        entry.offset[j] += entry.velocity[j] * dt;
        entry.offset[j + 1] += entry.velocity[j + 1] * dt;
        const limit = Math.min(1, 125 / Math.max(1, Math.hypot(entry.offset[j], entry.offset[j + 1])));
        entry.offset[j] *= limit; entry.offset[j + 1] *= limit;
      }
      if (changedAspect) positions.needsUpdate = true;
      if (!reduced) entry.points.geometry.getAttribute("aFlowOffset").needsUpdate = true;
    }
  }

  reset() {
    for (const entry of this.entries) {
      entry.offset.fill(0); entry.velocity.fill(0);
      entry.points.geometry.getAttribute("aFlowOffset").needsUpdate = true;
    }
  }

  samples() {
    // Stable existing IDs, chosen by initial position rather than by motion.
    const result: { id: string; baseline: { x: number; y: number }; position: { x: number; y: number }; velocity: { x: number; y: number } }[] = [];
    for (let layer = 0; layer < this.entries.length; layer++) {
      const e = this.entries[layer];
      for (let i = 0; i < Math.min(80, e.count); i++) {
        const j = i * 2;
        result.push({ id: `${layer}:${i}`, baseline: { x: e.baseline[j], y: e.baseline[j + 1] },
          position: { x: e.baseline[j] + e.offset[j], y: e.baseline[j + 1] + e.offset[j + 1] },
          velocity: { x: e.velocity[j], y: e.velocity[j + 1] } });
      }
    }
    return result;
  }

  dispose() {
    for (const entry of this.entries) {
      entry.points.geometry.dispose();
      entry.points.material.dispose();
    }
    this.entries.length = 0;
    this.group.clear();
  }
}
