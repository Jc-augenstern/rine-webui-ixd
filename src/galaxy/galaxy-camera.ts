import { PerspectiveCamera } from "three";

export type GalaxyPosition = { x: number; y: number };

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, Number.isFinite(value) ? value : 0));

/** Screen coordinates use the DOM convention: top left is (0, 0). */
export class GalaxyCamera {
  readonly camera = new PerspectiveCamera(48, 1, 0.1, 80);
  readonly pointer = { x: 0, y: 0 };
  readonly focus = { x: 0.5, y: 0.5 };
  focusAmount = 0;
  private pointerTarget = { x: 0, y: 0 };
  private focusTarget = { x: 0.5, y: 0.5 };
  private focusTargetAmount = 0;
  private aspect = 1;

  constructor() {
    this.camera.position.z = 10;
  }

  resize(width: number, height: number) {
    this.aspect = width / Math.max(1, height);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  setPointer(x: number, y: number) {
    this.pointerTarget.x = clamp(x, -1, 1);
    this.pointerTarget.y = clamp(y, -1, 1);
  }

  setFocus(position: GalaxyPosition | null) {
    this.focusTargetAmount = position ? 1 : 0;
    this.focusTarget.x = position ? clamp(position.x, 0, 1) : 0.5;
    this.focusTarget.y = position ? clamp(position.y, 0, 1) : 0.5;
  }

  update(dt: number, reduced: boolean) {
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 4.2);
    const pointerEase = reduced ? 1 : 1 - Math.exp(-dt * 3.4);
    this.focusAmount += (this.focusTargetAmount - this.focusAmount) * ease;
    this.focus.x += (this.focusTarget.x - this.focus.x) * ease;
    this.focus.y += (this.focusTarget.y - this.focus.y) * ease;
    this.pointer.x +=
      ((reduced ? 0 : this.pointerTarget.x) - this.pointer.x) * pointerEase;
    this.pointer.y +=
      ((reduced ? 0 : this.pointerTarget.y) - this.pointer.y) * pointerEase;
    // Keep the camera parallel to the map plane. No orbit or perspective roll.
    const halfHeight = Math.tan((24 * Math.PI) / 180) * 10;
    const focusTravel = reduced ? 0 : this.focusAmount * 0.78;
    this.camera.position.set(
      (this.focus.x - 0.5) * halfHeight * 2 * this.aspect * focusTravel +
        this.pointer.x * 0.045,
      (0.5 - this.focus.y) * halfHeight * 2 * focusTravel -
        this.pointer.y * 0.045,
      10 - (reduced ? 0 : this.focusAmount * 1.7),
    );
    this.camera.updateMatrixWorld();
  }
}
