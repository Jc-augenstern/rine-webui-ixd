import { DataTexture, FloatType, RGBAFormat, NearestFilter, Vector2 } from "three";

const MAX_SPEED = 210;
const MAX_OFFSET = 115;
const STEP = 1 / 60;
const INPUT_CAPACITY = 512;
const SEGMENT_CAPACITY = 512;
const SEGMENT_STRIDE = 12;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
type Rect = { left: number; top: number; width: number; height: number };
type Mapping = { pointer: { x: number; y: number }; focus: number; target: { x: number; y: number } };
export type FieldUniforms = {
  uFieldSize: { value: Vector2 };
  uFlowState: { value: DataTexture };
  uFlowGrid: { value: Vector2 };
  uFlowEnabled: { value: number };
};

/** GPU channels remain velocity.xy / transported material displacement.zw.
 * Explicit interpolation also supports devices without float-linear filtering. */
export const GALAXY_FLOW_GLSL = /* glsl */ `
  uniform vec2 uFieldSize;
  uniform sampler2D uFlowState;
  uniform vec2 uFlowGrid;
  uniform float uFlowEnabled;
  vec4 galaxyFlow(vec2 materialUv) {
    vec2 p = clamp(materialUv * uFlowGrid - .5, vec2(0.), uFlowGrid - 1.);
    vec2 base = floor(p), f = fract(p);
    vec2 a = (base + .5) / uFlowGrid, b = (base + 1.5) / uFlowGrid;
    return mix(mix(texture2D(uFlowState, a), texture2D(uFlowState, vec2(b.x,a.y)), f.x),
      mix(texture2D(uFlowState, vec2(a.x,b.y)), texture2D(uFlowState,b), f.x),f.y) * uFlowEnabled;
  }
`;

/** One material solver, shared by the existing clouds and stars. Input segments
 * are consumed once against fixed simulation intervals. History is transported
 * with the velocity, not redrawn each frame as an expanding pointer brush.
 * CPU-only history channels: energy, energy*age, energy*birthWidth, signed shear.
 */
export class GalaxyInteraction {
  readonly center = new Vector2();
  readonly velocity = new Vector2();
  readonly size = new Vector2(1, 1);
  readonly scale = new Vector2(1, 1);
  readonly offset = new Vector2();
  readonly plane = new Vector2(1, 1);
  active = false;
  enabled = true;
  private cols = 192;
  private rows = 116;
  private state = new Float32Array(this.cols * this.rows * 4);
  private advected = new Float32Array(this.state.length);
  private history = new Float32Array(this.state.length);
  private historyAdvected = new Float32Array(this.state.length);
  private noise = new Float32Array(this.cols * this.rows);
  private texture = this.makeTexture();
  private accumulator = 0;
  private wallTime = NaN;
  private simulationTime = 0;
  private steps = 0;
  private injections = 0;
  private depositedLength = 0;
  private depositedImpulse = 0;
  private energy = 0;
  private maxSpeed = 0;
  private maxOffset = 0;
  private maxAge = 0;
  private hasMatter = false;
  private queue = new Float64Array(INPUT_CAPACITY * 4);
  private queued = 0;
  // u0,v0,u1,v1,t0,t1,birthWidthPx,birthSpeed,arcStart,consumedTime,tx,ty
  private segments = new Float64Array(SEGMENT_CAPACITY * SEGMENT_STRIDE);
  private segmentHead = 0;
  private segmentCount = 0;
  private completed = new Float64Array(24 * 8);
  private completedAt = 0;
  private completedCount = 0;
  private lastX = 0;
  private lastY = 0;
  private lastTime = 0;
  private lastNormalized = false;
  private previous = false;
  private hasSpeed = false;
  private smoothedSpeed = 0;
  private lastWidth = 80;
  private arc = 0;
  private rawX = 0;
  private rawY = 0;
  private normalized = false;
  private inputAge = 10;
  private resolvedRect: Rect = { left: 0, top: 0, width: 1, height: 1 };
  private scratch = new Float64Array(4);
  private neighbor = new Float64Array(4);
  private historySample = new Float64Array(4);
  private historyNeighbor = new Float64Array(4);

  readonly uniforms: FieldUniforms = {
    uFieldSize: { value: this.size },
    uFlowState: { value: this.texture },
    uFlowGrid: { value: new Vector2(this.cols, this.rows) },
    uFlowEnabled: { value: 1 },
  };

  constructor() { this.fillNoise(); }

  private correlatedNoise(u: number, v: number) {
    return Math.sin(u * 31.7 + v * 9.3 + 2.61) * Math.cos(v * 26.1 - u * 7.2) * .62
      + Math.sin(u * 19.1 - v * 33.7 + 9.01) * .38;
  }
  private fillNoise() {
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++)
      this.noise[y * this.cols + x] = this.correlatedNoise((x + .5) / this.cols, (y + .5) / this.rows);
  }
  private makeTexture() {
    const texture = new DataTexture(this.state, this.cols, this.rows, RGBAFormat, FloatType);
    texture.minFilter = texture.magFilter = NearestFilter;
    texture.generateMipmaps = false; texture.needsUpdate = true;
    return texture;
  }

  setLowQuality(low: boolean) {
    const cols = low ? 128 : 192;
    if (cols === this.cols) return;
    const old = this.state, oldHistory = this.history, oldCols = this.cols, oldRows = this.rows;
    this.cols = cols; this.rows = low ? 78 : 116;
    this.state = new Float32Array(this.cols * this.rows * 4);
    this.history = new Float32Array(this.state.length);
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const u = (x + .5) / this.cols, v = (y + .5) / this.rows, i = (y * this.cols + x) * 4;
      this.read(old, u, v, this.scratch, oldCols, oldRows); this.state.set(this.scratch, i);
      this.read(oldHistory, u, v, this.scratch, oldCols, oldRows); this.history.set(this.scratch, i);
    }
    this.advected = new Float32Array(this.state.length);
    this.historyAdvected = new Float32Array(this.state.length);
    this.noise = new Float32Array(this.cols * this.rows); this.fillNoise();
    this.texture.dispose(); this.texture = this.makeTexture();
    this.uniforms.uFlowState.value = this.texture;
    this.uniforms.uFlowGrid.value.set(this.cols, this.rows);
  }

  /** timeStamp is a DOMHighResTimeStamp in milliseconds, including coalesced events. */
  record(x: number, y: number, normalized = false, timeStamp = performance.now()) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!Number.isFinite(timeStamp)) timeStamp = performance.now();
    // Older engines may expose epoch timestamps. Normalize to performance origin.
    if (timeStamp > 1e12) timeStamp -= performance.timeOrigin;
    this.rawX = x; this.rawY = y; this.normalized = normalized; this.active = true;
    if (this.queued === INPUT_CAPACITY) { this.queued = 0; this.previous = false; }
    const at = this.queued++ * 4;
    this.queue[at] = x; this.queue[at + 1] = y;
    this.queue[at + 2] = timeStamp / 1000; this.queue[at + 3] = normalized ? 1 : 0;
  }

  leave(timeStamp = performance.now()) {
    // A leave can arrive in the same task as the last coalesced pointer samples.
    // Commit those real samples once before invalidating the sampling baseline.
    // No future frame replays them, and no infinite simulation age is introduced.
    this.ingest(this.resolvedRect, this.enabled);
    const time = Number.isFinite(timeStamp) ? timeStamp / 1000 : this.lastTime;
    const before = this.injections;
    this.consume(Math.max(time, this.lastTime));
    if (this.injections !== before) this.texture.needsUpdate = true;
    this.active = false; this.queued = 0; this.previous = false; this.hasSpeed = false;
    this.segmentCount = 0; this.segmentHead = 0;
    this.velocity.set(0, 0); this.inputAge = 10;
    // Existing velocity, age and matter continue evolving at their old positions.
  }
  pause() { this.leave(); this.wallTime = NaN; this.accumulator = 0; }

  resolve(rect: Rect) {
    this.resolvedRect.left = rect.left; this.resolvedRect.top = rect.top;
    this.resolvedRect.width = rect.width; this.resolvedRect.height = rect.height;
    this.size.set(Math.max(1, rect.width), Math.max(1, rect.height));
    if (this.active) this.center.set(this.normalized ? (this.rawX + 1) * this.size.x / 2 : this.rawX - rect.left,
      this.normalized ? (this.rawY + 1) * this.size.y / 2 : this.rawY - rect.top);
  }

  update(dt: number, rect: Rect, enabled: boolean, reduced: boolean, mapping: Mapping, nowMs = performance.now()) {
    this.resolve(rect);
    const on = enabled && !reduced;
    if (on !== this.enabled) { this.previous = false; this.hasSpeed = false; this.segmentCount = 0; }
    this.enabled = on; this.uniforms.uFlowEnabled.value = reduced ? 0 : 1;
    const aspect = this.size.x / this.size.y, zoom = .88 - mapping.focus * .13;
    this.scale.set(Math.min(1, aspect / (5 / 3)) * zoom, Math.min(1, (5 / 3) / aspect) * zoom);
    this.offset.set(mapping.pointer.x * .00405 + (mapping.target.x - .5) * mapping.focus * .075,
      mapping.pointer.y * .00405 + (mapping.target.y - .5) * mapping.focus * .075);
    this.plane.set(this.size.x / this.scale.x, this.size.y / this.scale.y);
    const now = nowMs / 1000;
    if (!Number.isFinite(this.wallTime)) this.wallTime = now - Math.min(.0667, dt);
    if (now - this.wallTime > .15) { this.wallTime = now - Math.min(.0667, dt); this.accumulator = 0; }
    this.inputAge += dt;
    this.ingest(rect, on);
    if (this.inputAge > .075) this.velocity.set(0, 0);
    if (reduced) return;
    this.accumulator = Math.min(.0667, this.accumulator + Math.max(0, dt));
    let changed = false;
    while (this.accumulator + 1e-9 >= STEP) {
      this.consume(this.wallTime + STEP);
      const evolving = this.hasMatter;
      this.advance(STEP);
      this.wallTime += STEP; this.simulationTime += STEP;
      this.accumulator = Math.max(0, this.accumulator - STEP); changed ||= evolving;
    }
    if (changed) { this.texture.image.data = this.state; this.texture.needsUpdate = true; }
  }

  private ingest(rect: Rect, on: boolean) {
    for (let n = 0; n < this.queued; n++) {
      const i = n * 4, x = this.queue[i], y = this.queue[i + 1], time = this.queue[i + 2], normalized = this.queue[i + 3] === 1;
      if (this.previous && normalized === this.lastNormalized && on && time >= this.lastTime) {
        const x0 = normalized ? (this.lastX + 1) * this.size.x / 2 : this.lastX - rect.left;
        const y0 = normalized ? (this.lastY + 1) * this.size.y / 2 : this.lastY - rect.top;
        const x1 = normalized ? (x + 1) * this.size.x / 2 : x - rect.left;
        const y1 = normalized ? (y + 1) * this.size.y / 2 : y - rect.top;
        const dx = x1 - x0, dy = y1 - y0, distance = Math.hypot(dx, dy);
        const seconds = time - this.lastTime;
        // Do not discard subpixel distances per event: all real arc length counts.
        if (seconds > .00001 && seconds < .25 && distance > .00001) {
          const speed = Math.min(2400, distance / seconds);
          this.smoothedSpeed = this.hasSpeed ? this.smoothedSpeed + (speed - this.smoothedSpeed) * (1 - Math.exp(-seconds / .055)) : speed;
          this.hasSpeed = true;
          const width = Math.max(3 * Math.max(this.plane.x / this.cols, this.plane.y / this.rows),
            80 - 44 * smooth(120, 1100, this.smoothedSpeed));
          this.lastWidth = width;
          this.velocity.set(dx / distance * this.smoothedSpeed, dy / distance * this.smoothedSpeed);
          if (speed >= 3 && this.segmentCount < SEGMENT_CAPACITY) {
            const slot = (this.segmentHead + this.segmentCount) % SEGMENT_CAPACITY * SEGMENT_STRIDE;
            const u0 = (x0 / this.size.x - .5) * this.scale.x + .5 + this.offset.x;
            const v0 = (y0 / this.size.y - .5) * this.scale.y + .5 + this.offset.y;
            const u1 = (x1 / this.size.x - .5) * this.scale.x + .5 + this.offset.x;
            const v1 = (y1 / this.size.y - .5) * this.scale.y + .5 + this.offset.y;
            this.segments.set([u0, v0, u1, v1, this.lastTime, time, width, this.smoothedSpeed, this.arc, this.lastTime, dx / distance, dy / distance], slot);
            this.segmentCount++; this.arc += distance; this.inputAge = 0;
          }
        } else if (seconds >= .25) this.hasSpeed = false;
      }
      this.lastX = x; this.lastY = y; this.lastTime = time; this.lastNormalized = normalized; this.previous = on;
    }
    this.queued = 0;
  }

  private consume(until: number) {
    while (this.segmentCount) {
      const at = this.segmentHead * SEGMENT_STRIDE, s = this.segments;
      const from = s[at + 9], end = s[at + 5], to = Math.min(end, until);
      if (to <= from + 1e-10) break;
      const duration = Math.max(.00001, end - s[at + 4]);
      const a = (from - s[at + 4]) / duration, b = (to - s[at + 4]) / duration;
      const du = s[at + 2] - s[at], dv = s[at + 3] - s[at + 1];
      const totalLength = Math.hypot(du * this.plane.x, dv * this.plane.y);
      this.deposit(s[at] + du * a, s[at + 1] + dv * a, s[at] + du * b, s[at + 1] + dv * b,
        s[at + 6], s[at + 7], s[at + 8] + totalLength * a, Math.max(0, until - (from + to) / 2));
      s[at + 9] = to;
      if (to < end - 1e-9) break;
      const h = this.completedAt * 8;
      this.completed.set([s[at + 2], s[at + 3], s[at + 5], s[at + 6], s[at + 7], s[at + 10], s[at + 11], totalLength], h);
      this.completedAt = (this.completedAt + 1) % 24; this.completedCount = Math.min(24, this.completedCount + 1);
      this.segmentHead = (this.segmentHead + 1) % SEGMENT_CAPACITY; this.segmentCount--;
    }
  }

  private deposit(u0: number, v0: number, u1: number, v1: number, width: number, speed: number, arcStart: number, age: number) {
    const dx = (u1 - u0) * this.plane.x, dy = (v1 - v0) * this.plane.y, distance = Math.hypot(dx, dy);
    if (distance < 1e-8) return;
    this.hasMatter = true;
    const tx = dx / distance, ty = dy / distance, nx = -ty, ny = tx;
    // Width is the initial 80%-energy cross-section, not a circular radius.
    const sigma = width / 2.5631;
    const longitudinal = Math.max(8, Math.max(this.plane.x / this.cols, this.plane.y / this.rows));
    const count = Math.max(1, Math.ceil(distance / Math.min(6, longitudinal * .5)));
    const ds = distance / count;
    const peak = 128 + 26 * smooth(150, 1100, speed);
    const impulse = peak * ds / (longitudinal * Math.sqrt(2 * Math.PI));
    const normalWidth = width / Math.sqrt(this.plane.x * this.plane.y);
    for (let sample = 0; sample < count; sample++) {
      const t = (sample + .5) / count, u = u0 + (u1 - u0) * t, v = v0 + (v1 - v0) * t;
      const n = this.correlatedNoise(u, v);
      const extentX = (Math.abs(tx) * longitudinal + Math.abs(nx) * sigma * 1.1) * 3 / this.plane.x;
      const extentY = (Math.abs(ty) * longitudinal + Math.abs(ny) * sigma * 1.1) * 3 / this.plane.y;
      const x0 = Math.max(1, Math.floor((u - extentX) * this.cols)), x1 = Math.min(this.cols - 2, Math.ceil((u + extentX) * this.cols));
      const y0 = Math.max(1, Math.floor((v - extentY) * this.rows)), y1 = Math.min(this.rows - 2, Math.ceil((v + extentY) * this.rows));
      const phase = Math.sin((arcStart + distance * t) / 93 + 2.61);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = ((x + .5) / this.cols - u) * this.plane.x;
        const py = ((y + .5) / this.rows - v) * this.plane.y;
        const along = (px * tx + py * ty) / longitudinal;
        const side = (px * nx + py * ny) / (sigma * (1 + Math.sign(px * nx + py * ny) * n * .08));
        const r2 = along * along + side * side;
        if (r2 > 9) continue;
        const weight = Math.exp(-.5 * r2);
        const shear = side * (.24 + phase * .055) + n * .085;
        const force = impulse * weight;
        const i = (y * this.cols + x) * 4;
        this.state[i] += (tx + nx * shear) * force / this.plane.x;
        this.state[i + 1] += (ty + ny * shear) * force / this.plane.y;
        const e = force / 154;
        this.history[i] += e; this.history[i + 1] += e * age;
        this.history[i + 2] += e * normalWidth; this.history[i + 3] += e * phase;
        if (this.history[i] > 3) {
          const bound = 3 / this.history[i];
          for (let channel = 0; channel < 4; channel++) this.history[i + channel] *= bound;
        }
      }
    }
    this.injections++; this.depositedLength += distance; this.depositedImpulse += peak * distance;
  }

  private read(data: Float32Array, u: number, v: number, out: Float64Array, cols = this.cols, rows = this.rows) {
    const px = Math.max(0, Math.min(cols - 1.001, u * cols - .5)), py = Math.max(0, Math.min(rows - 1.001, v * rows - .5));
    const x = Math.floor(px), y = Math.floor(py), fx = px - x, fy = py - y;
    const a = (y * cols + x) * 4, b = a + 4, c = a + cols * 4, d = c + 4;
    for (let k = 0; k < 4; k++) out[k] = (data[a + k] * (1 - fx) + data[b + k] * fx) * (1 - fy)
      + (data[c + k] * (1 - fx) + data[d + k] * fx) * fy;
  }

  private advance(dt: number) {
    if (!this.hasMatter) { this.steps++; return; }
    const h = Math.max(this.plane.x / this.cols, this.plane.y / this.rows);
    // Advection transports both the matter coordinates and its local age/width.
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const i = (y * this.cols + x) * 4, u = (x + .5) / this.cols, v = (y + .5) / this.rows;
      if (this.history[i] === 0 && this.state[i] === 0 && this.state[i + 1] === 0 && this.state[i + 2] === 0 && this.state[i + 3] === 0) {
        for (let c = 0; c < 4; c++) { this.advected[i + c] = 0; this.historyAdvected[i + c] = 0; }
        continue;
      }
      const speed = Math.hypot(this.state[i] * this.plane.x, this.state[i + 1] * this.plane.y);
      const cap = Math.min(1, MAX_SPEED / Math.max(1, speed));
      const backU = u - this.state[i] * cap * dt, backV = v - this.state[i + 1] * cap * dt;
      this.read(this.state, backU, backV, this.scratch);
      this.read(this.history, backU, backV, this.historySample);
      for (let c = 0; c < 4; c++) { this.advected[i + c] = this.scratch[c]; this.historyAdvected[i + c] = this.historySample[c]; }
      this.historyAdvected[i + 1] += this.historySample[0] * dt;
    }
    let energy = 0, speedMax = 0, offsetMax = 0, ageMax = 0;
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const i = (y * this.cols + x) * 4, u = (x + .5) / this.cols, v = (y + .5) / this.rows;
      const a = this.advected, hist = this.historyAdvected;
      let ageEnergy = hist[i], ageMass = hist[i + 1];
      let dirX = a[i] * this.plane.x, dirY = a[i + 1] * this.plane.y;
      // Neighbor moments let the *old* wake reach previously still material.
      // No force is applied again from stored pointer segments.
      for (let neighborIndex = 0; neighborIndex < 4; neighborIndex++) {
        const j = neighborIndex === 0 ? i - (x > 0 ? 4 : 0) : neighborIndex === 1 ? i + (x < this.cols - 1 ? 4 : 0)
          : neighborIndex === 2 ? i - (y > 0 ? this.cols * 4 : 0) : i + (y < this.rows - 1 ? this.cols * 4 : 0);
        ageEnergy += hist[j] * .25; ageMass += hist[j + 1] * .25;
        dirX += a[j] * this.plane.x * .25; dirY += a[j + 1] * this.plane.y * .25;
      }
      if (ageEnergy === 0 && a[i] === 0 && a[i + 1] === 0 && a[i + 2] === 0 && a[i + 3] === 0) {
        for (let c = 0; c < 4; c++) { this.state[i + c] = 0; this.history[i + c] = 0; }
        continue;
      }
      const age = ageEnergy > 1e-5 ? ageMass / ageEnergy : 0;
      const direction = Math.hypot(dirX, dirY);
      const tx = direction > .0001 ? dirX / direction : 1, ty = direction > .0001 ? dirY / direction : 0;
      const growth = smooth(.055, .5, age) * (1 - smooth(1.5, 2.4, age));
      const modulation = 1 + this.noise[y * this.cols + x] * .18;
      let perpendicular = 420 * growth * modulation * dt / (h * h);
      let parallel = 75 * growth * modulation * dt / (h * h);
      // Positive interpolation weights bound diffusion at every grid/viewport size.
      const stability = Math.min(1, .22 / Math.max(.0001, perpendicular + parallel));
      perpendicular *= stability; parallel *= stability;
      const retained = 1 - 2 * perpendicular - 2 * parallel;
      let vx = a[i] * retained, vy = a[i + 1] * retained;
      for (let c = 0; c < 4; c++) this.historySample[c] = hist[i + c] * retained;
      for (let side = 0; side < 4; side++) {
        const normal = side < 2, sign = side % 2 ? 1 : -1;
        const sx = normal ? -ty : tx, sy = normal ? tx : ty;
        const coefficient = normal ? perpendicular : parallel;
        this.read(a, u + sx * sign * h / this.plane.x, v + sy * sign * h / this.plane.y, this.neighbor);
        this.read(hist, u + sx * sign * h / this.plane.x, v + sy * sign * h / this.plane.y, this.historyNeighbor);
        vx += this.neighbor[0] * coefficient; vy += this.neighbor[1] * coefficient;
        for (let c = 0; c < 4; c++) this.historySample[c] += this.historyNeighbor[c] * coefficient;
      }
      const damping = Math.exp(-dt * (1.25 + 1.1 * smooth(.8, 1.8, age)));
      vx *= damping; vy *= damping;
      const speed = Math.hypot(vx * this.plane.x, vy * this.plane.y);
      const limit = Math.min(1, MAX_SPEED / Math.max(1, speed)); vx *= limit; vy *= limit;
      const recovery = Math.exp(-dt * (.72 + .33 * smooth(.7, 1.9, age)));
      let dx = (a[i + 2] + vx * dt) * recovery, dy = (a[i + 3] + vy * dt) * recovery;
      const displacement = Math.hypot(dx * this.plane.x, dy * this.plane.y);
      const bound = Math.min(1, MAX_OFFSET / Math.max(1, displacement)); dx *= bound; dy *= bound;
      this.state[i] = vx; this.state[i + 1] = vy; this.state[i + 2] = dx; this.state[i + 3] = dy;
      const fade = Math.exp(-dt * .75);
      for (let c = 0; c < 4; c++) this.history[i + c] = this.historySample[c] * fade;
      if (this.history[i] < 1e-6) for (let c = 0; c < 4; c++) this.history[i + c] = 0;
      energy += (speed * limit) ** 2;
      speedMax = Math.max(speedMax, speed * limit); offsetMax = Math.max(offsetMax, displacement * bound);
      if (this.history[i] > .002) ageMax = Math.max(ageMax, age);
    }
    this.energy = energy / (this.cols * this.rows); this.maxSpeed = speedMax; this.maxOffset = offsetMax; this.maxAge = ageMax; this.steps++;
    if (speedMax < .0001 && offsetMax < .0001) {
      this.hasMatter = false; this.state.fill(0); this.history.fill(0);
      this.energy = this.maxSpeed = this.maxOffset = this.maxAge = 0;
    }
  }

  /** No allocations in the existing star loop. Coordinates are CSS px, Y down. */
  sampleInto(x: number, y: number, out: Float64Array) {
    const u = (x / this.size.x - .5) * this.scale.x + .5 + this.offset.x;
    const v = (y / this.size.y - .5) * this.scale.y + .5 + this.offset.y;
    this.read(this.state, u, v, out);
    out[0] *= this.plane.x; out[1] *= this.plane.y; out[2] *= this.plane.x; out[3] *= this.plane.y;
  }
  sample(x: number, y: number) {
    this.sampleInto(x, y, this.scratch);
    const u = (x / this.size.x - .5) * this.scale.x + .5 + this.offset.x;
    const v = (y / this.size.y - .5) * this.scale.y + .5 + this.offset.y;
    this.read(this.history, u, v, this.historySample);
    const e = this.historySample[0];
    return { x: this.scratch[2], y: this.scratch[3], velocity: { x: this.scratch[0], y: this.scratch[1] },
      materialUV: { x: u, y: v }, wakeEnergy: e, age: e > 1e-6 ? this.historySample[1] / e : 0,
      birthWidthPx: e > 1e-6 ? this.historySample[2] / e * Math.sqrt(this.plane.x * this.plane.y) : 0 };
  }
  section(x: number, y: number, tx: number, ty: number, span = 180, spacing = 3) {
    const length = Math.max(.0001, Math.hypot(tx, ty)), nx = -ty / length, ny = tx / length;
    const result = [];
    for (let normal = -Math.min(300, span); normal <= Math.min(300, span); normal += Math.max(2, spacing))
      result.push({ normal, ...this.sample(x + nx * normal, y + ny * normal) });
    return result;
  }
  reset(nowMs = performance.now()) {
    this.leave(nowMs); this.state.fill(0); this.advected.fill(0); this.history.fill(0); this.historyAdvected.fill(0);
    this.accumulator = 0; this.wallTime = nowMs / 1000; this.simulationTime = 0;
    this.steps = this.injections = this.energy = this.maxSpeed = this.maxOffset = this.maxAge = 0;
    this.hasMatter = false;
    this.depositedLength = this.depositedImpulse = this.arc = this.completedCount = this.completedAt = 0;
    this.texture.image.data = this.state; this.texture.needsUpdate = true;
  }
  stats() {
    const segments = [];
    for (let n = 0; n < this.completedCount; n++) {
      const i = ((this.completedAt - this.completedCount + n + 24) % 24) * 8;
      segments.push({ materialUV: { x: this.completed[i], y: this.completed[i + 1] }, timeMs: this.completed[i + 2] * 1000,
        birthWidthPx: this.completed[i + 3], birthSpeedPx: this.completed[i + 4],
        direction: { x: this.completed[i + 5], y: this.completed[i + 6] }, lengthPx: this.completed[i + 7] });
    }
    return {
      cssPointer: { x: this.center.x, y: this.center.y }, cssSize: { width: this.size.x, height: this.size.y },
      radiusPx: this.lastWidth / 2, inputBandWidthPx: this.lastWidth, bandWidthMeasure: "normal cross-section 80%-energy width",
      active: this.active, enabled: this.enabled, inputActive: this.active && this.enabled && this.inputAge < .075,
      velocity: { x: this.velocity.x, y: this.velocity.y }, inputVelocity: { x: this.velocity.x, y: this.velocity.y },
      coordinateSpace: "atlas-material-uv; probes in css-pixels-y-down", resolution: { width: this.cols, height: this.rows },
      steps: this.steps, simulationTime: this.simulationTime, injectionCount: this.injections, energy: this.energy,
      depositedArcLengthPx: this.depositedLength, depositedImpulse: this.depositedImpulse,
      pendingSegments: this.segmentCount, segmentCapacity: SEGMENT_CAPACITY, recentSegments: segments,
      gridCellCss: { x: this.plane.x / this.cols, y: this.plane.y / this.rows }, maxWakeAge: this.maxAge,
      maxSpeedPx: this.maxSpeed, maxDisplacementPx: this.maxOffset, velocityLimitPx: MAX_SPEED, displacementLimitPx: MAX_OFFSET,
      diffusionPx2PerSecond: { perpendicular: 420, parallel: 75, modulation: .18 },
      oldRefraction: false, decorativeTrails: false, solver: "timestamped-ribbon-with-advected-age-and-anisotropic-diffusion", seed: 26121,
      mapping: { scale: { x: this.scale.x, y: this.scale.y }, offset: { x: this.offset.x, y: this.offset.y } },
    };
  }
  dispose() { this.leave(); this.texture.dispose(); }
}
