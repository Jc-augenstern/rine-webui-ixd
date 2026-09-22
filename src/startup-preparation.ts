import { BootLettering } from "./boot-lettering";

// Initial HTML/CSS and the application read this one authored duration.
const preparationStyle = getComputedStyle(document.documentElement);
export const PREPARATION_DURATION = parseFloat(preparationStyle.getPropertyValue("--ixd-preparation-duration")) / 1000;
const revealPortion = parseFloat(preparationStyle.getPropertyValue("--ixd-preparation-reveal"));
const phrase = "ACCESS PERMISSION REQUIRED";
const reveal = [1, 1, 3, 4, 5, 6, 9, 11, 12, 14, 17, 18, 19, 20, 22, 23, 25, 26];

/** Uses the application's clock; the progress is a visual sequence, not network telemetry. */
export class StartupPreparation {
  private lettering: BootLettering;
  private bar: HTMLElement;
  private lastUpdateAt = performance.now();
  elapsed = 0;
  completedDuration = 0;
  constructor(private element: HTMLElement) {
    this.elapsed = Math.max(0, Math.min(PREPARATION_DURATION, (performance.now() - Number(element.dataset.startedAt || performance.now())) / 1000));
    element.dataset.bound = "true";
    this.clearRecovery();
    this.lettering = new BootLettering(element.querySelector(".preparation-access")!, ["access"]);
    this.bar = element.querySelector(".preparation-track i")!;
    this.bar.style.animation = "none";
    this.update(0);
  }
  update(dt: number) {
    const now = performance.now();
    // rAF timestamps precede its callbacks. Mixing those deltas with the
    // constructor's performance.now() would count module setup time twice.
    // The existing frame loop supplies dt=0 when resuming a hidden page.
    if (dt > 0) this.elapsed += Math.min(.1, Math.max(0, (now - this.lastUpdateAt) / 1000));
    this.lastUpdateAt = now;
    const progress = Math.min(1, this.elapsed / PREPARATION_DURATION);
    this.lettering.setText(phrase.slice(0, reveal[Math.min(reveal.length - 1, Math.floor(progress / revealPortion * reveal.length))]));
    this.bar.style.transform = `scaleX(${progress})`;
    if (this.elapsed >= PREPARATION_DURATION) {
      this.completedDuration = this.elapsed;
      this.element.hidden = true;
      return true;
    }
    return false;
  }
  restart() {
    this.elapsed = 0;
    this.completedDuration = 0;
    this.clearRecovery();
    this.element.hidden = false;
    this.update(0);
  }
  private clearRecovery() {
    this.element.querySelector(".preparation-state")!.textContent = "";
    this.element.querySelector<HTMLButtonElement>(".preparation-retry")!.hidden = true;
  }
  hide() { this.element.hidden = true; }
}
