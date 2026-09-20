import * as THREE from "three";

export type StarUniforms = {
  uTime: { value: number };
  uMotion: { value: number };
  uAspect: { value: number };
  uPixelRatio: { value: number };
  uPointer: { value: THREE.Vector2 };
  uFocus: { value: number };
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
  uniform float uTime;
  uniform float uMotion;
  uniform float uAspect;
  uniform float uPixelRatio;
  uniform vec2 uPointer;
  uniform float uFocus;
  uniform float uDust;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float distance = 10.0 - position.z;
    vec3 point = vec3(position.x * 0.4452287 * distance * uAspect,
                      position.y * 0.4452287 * distance, position.z);
    float depth = clamp((position.z + 13.0) / 17.0, 0.0, 1.0);
    point.xy += uMotion * vec2(sin(uTime * 0.023 + aPhase),
                               cos(uTime * 0.017 + aPhase)) * (0.009 + depth * 0.018);
    vec4 projected = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
    vec2 screen = projected.xy / projected.w;
    vec2 delta = (screen - vec2(uPointer.x, -uPointer.y)) * vec2(uAspect, 1.0);
    float proximity = exp(-dot(delta, delta) * 23.0) * uMotion;
    projected.xy += delta * proximity * 0.0028 * projected.w * depth;
    gl_Position = projected;
    gl_PointSize = clamp(aSize * uPixelRatio * 10.0 / max(4.0, - (modelViewMatrix * vec4(point, 1.0)).z),
                         1.0, 38.0 * uPixelRatio);
    float twinkle = 0.91 + sin(uTime * (0.27 + aPhase * 0.015) + aPhase) * 0.09 * uMotion;
    vColor = aColor;
    vAlpha = aAlpha * twinkle * (1.0 + proximity * 0.3) * (1.0 - uFocus * 0.56);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uDust;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 point = gl_PointCoord - 0.5;
    float r = dot(point, point);
    if (r > 0.25) discard;
    float core = exp(-r * mix(24.0, 13.0, uDust));
    float edge = 1.0 - smoothstep(0.16, 0.25, r);
    gl_FragColor = vec4(vColor, core * edge * vAlpha);
    #include <colorspace_fragment>
  }
`;

type LayerConfig = {
  count: number;
  zMin: number;
  zMax: number;
  size: number;
  alpha: number;
  dust?: boolean;
  seed: number;
};

const layers: LayerConfig[] = [
  { count: 1800, zMin: -13, zMax: -7, size: 2.5, alpha: 0.43, seed: 901 },
  { count: 620, zMin: -5, zMax: 0, size: 2.4, alpha: 0.49, seed: 2026 },
  { count: 100, zMin: 1, zMax: 3, size: 2.1, alpha: 0.35, seed: 719 },
  {
    count: 220,
    zMin: -1,
    zMax: 3,
    size: 13,
    alpha: 0.047,
    dust: true,
    seed: 1001,
  },
];

export class StarField {
  readonly group = new THREE.Group();
  private entries: {
    points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    count: number;
  }[] = [];
  private activeCount = 0;

  constructor(uniforms: StarUniforms) {
    const colors = [
      new THREE.Color("#d4ddff"),
      new THREE.Color("#bfc1ff"),
      new THREE.Color("#a4ccdf"),
      new THREE.Color("#edf2ff"),
    ];
    for (const layer of layers) {
      const random = seededRandom(layer.seed);
      const position = new Float32Array(layer.count * 3);
      const color = new Float32Array(layer.count * 3);
      const size = new Float32Array(layer.count);
      const phase = new Float32Array(layer.count);
      const alpha = new Float32Array(layer.count);
      for (let i = 0; i < layer.count; i++) {
        // Overscan prevents empty edges during the modest camera focus movement.
        position[i * 3] = (random() - 0.5) * 3.35;
        position[i * 3 + 1] = (random() - 0.5) * 3.15;
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
      const material = new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uDust: { value: layer.dust ? 1 : 0 } },
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
      this.entries.push({ points, count: layer.count });
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

  dispose() {
    for (const entry of this.entries) {
      entry.points.geometry.dispose();
      entry.points.material.dispose();
    }
    this.entries.length = 0;
    this.group.clear();
  }
}
