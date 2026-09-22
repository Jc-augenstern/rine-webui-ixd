import "./theme.css";
import { palette } from "./palette";
let previous = -1;
export let themeAmount = 0;
function rgb(hex: string) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
export function paintTheme(amount: number) {
  if (Math.abs(amount - previous) < .0001) return;
  previous = themeAmount = amount;
  const root = document.documentElement;
  root.dataset.darkSurface = String(amount > .0001);
  root.style.colorScheme = amount > .5 ? "dark" : "light";
  for (const [name, values] of Object.entries(palette)) {
    const from = rgb(values[0]), to = rgb(values[1]);
    const value = from.map((v, i) => Math.round(v + (to[i] - v) * amount)).join(", ");
    root.style.setProperty(`--theme-${name}`, `rgb(${value})`);
    root.style.setProperty(`--theme-${name}-rgb`, value);
    if (name === 'paper') document.querySelector('meta[name="theme-color"]')?.setAttribute('content', `rgb(${value})`);
  }
}
export function themeSettingsMarkup(dark: boolean, description = "玻璃阵列随配色逐张过渡") {
  return `<div class="theme-settings"><div><strong>界面配色</strong><span>${description}</span></div><div class="theme-choices" role="group" aria-label="界面配色"><button data-color-theme="light" aria-pressed="${!dark}">亮色</button><button data-color-theme="dark" aria-pressed="${dark}">暗色</button><button data-action="reset-theme" title="仅恢复界面配色为默认深色">恢复默认</button></div></div>`;
}
