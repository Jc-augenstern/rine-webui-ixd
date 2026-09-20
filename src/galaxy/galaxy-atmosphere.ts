import * as THREE from "three";
import type { StarUniforms } from "./star-field";

/** A single full-screen pass; no blur, texture fetches, render targets or bloom. */
export function createAtmosphere(uniforms: StarUniforms) {
  const material = new THREE.ShaderMaterial({
    uniforms,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.99, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uAspect;
      uniform vec2 uPointer;
      uniform float uFocus;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
                   mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
      }
      void main() {
        vec2 p = (vUv - .5) * vec2(uAspect, 1.0);
        p += vec2(uPointer.x, -uPointer.y) * 0.008;
        float texture = noise(p * 4.0 + 8.1) * .66 + noise(p * 10.0 + 2.8) * .34;
        float violet = exp(-dot((p - vec2(-.36, .14)) * vec2(.75, 2.5),
                                (p - vec2(-.36, .14)) * vec2(.75, 2.5)) * 3.1);
        float blue = exp(-dot((p - vec2(.26, -.2)) * vec2(1.0, 2.0),
                              (p - vec2(.26, -.2)) * vec2(1.0, 2.0)) * 2.9);
        float cyan = exp(-dot(p - vec2(.64, .04), p - vec2(.64, .04)) * 6.5);
        vec3 color = vec3(.0013, .0019, .0050);
        color += vec3(.010, .004, .024) * violet * texture * .54;
        color += vec3(.002, .011, .020) * blue * texture * .48;
        color += vec3(.001, .009, .013) * cyan * texture * .3;
        color *= 1.0 - uFocus * .12;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

const TRAIL_COUNT = 14;

/** Fixed-size GPU trail pool. Pointer movement never allocates new particles. */
export class GalaxyTrails {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private trails = Array.from(
    { length: TRAIL_COUNT },
    () => new THREE.Vector4(0, 0, -100, 0),
  );
  private next = 0;
  private lastEmission = -10;
  private previousX = 0;
  private previousY = 0;
  private initialized = false;

  constructor(uniforms: StarUniforms) {
    const geometry = new THREE.BufferGeometry();
    const indexes = new Float32Array(TRAIL_COUNT);
    for (let i = 0; i < TRAIL_COUNT; i++) indexes[i] = i;
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(TRAIL_COUNT * 3), 3),
    );
    geometry.setAttribute("aIndex", new THREE.BufferAttribute(indexes, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uTrails: { value: this.trails } },
      vertexShader: /* glsl */ `
        attribute float aIndex;
        uniform vec4 uTrails[14];
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec4 trail = uTrails[int(aIndex)];
          float age = max(0.0, uTime - trail.z);
          vAlpha = max(0.0, 1.0 - age / .52) * trail.w * .2;
          gl_Position = vec4(trail.x, -trail.y + age * .008, 0.0, 1.0);
          gl_PointSize = (2.0 + age * 2.0) * uPixelRatio;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - .5);
          gl_FragColor = vec4(.53, .64, 1.0, exp(-r * r * 22.0) * vAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  update(x: number, y: number, dt: number, elapsed: number, reduced: boolean) {
    const speed = this.initialized
      ? Math.hypot(x - this.previousX, y - this.previousY) / Math.max(0.008, dt)
      : 0;
    this.previousX = x;
    this.previousY = y;
    this.initialized = true;
    this.points.visible = !reduced;
    if (!reduced && speed > 1.4 && elapsed - this.lastEmission > 0.035) {
      this.trails[this.next].set(x, y, elapsed, Math.min(0.8, speed * 0.13));
      this.next = (this.next + 1) % TRAIL_COUNT;
      this.lastEmission = elapsed;
    }
    if (reduced) this.clear();
  }

  clear() {
    for (const trail of this.trails) trail.z = -100;
    this.initialized = false;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
