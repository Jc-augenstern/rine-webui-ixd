import { ixdMark, IxdMotion } from './ixd-mark';
import { palette } from './palette';

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
$('#mark').innerHTML = ixdMark('preview');
const motion = new IxdMotion(document.querySelector<SVGSVGElement>('.ixd-mark')!);
const seek = $<HTMLInputElement>('#seek');
const play = $<HTMLButtonElement>('#play');
const screen = $('.screen');
const timeLabel = $('#time');
const status = $('#status');
const guide = $('.guide');
const steps = [...document.querySelectorAll('.step')];
const speed = $<HTMLSelectElement>('#speed');
const loop = $('#loop');
const phases = ['ESTABLISHING CONNECTION', 'CONNECTING THE DOTS', 'IDENTITY CONFIRMED', 'SYSTEM READY'];
function paintPreview() {
  const mode = screen.classList.contains('dark') ? 1 : 0;
  for (const [name, colors] of Object.entries(palette)) screen.style.setProperty(`--theme-${name}`, colors[mode]);
}
paintPreview();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let playing = !reduced.matches, time = reduced.matches ? 3.2 : 0, last = 0, looping = true;
const duration = 4.8;
let frame: number | undefined;
let renderedTime = NaN, renderedLabel = '', renderedPlaying: boolean | undefined;
let renderedPhase = -1, renderedGuideOpacity = NaN;
function render() {
  motion.render(time);
  if (time !== renderedTime) {
    seek.value = String(time);
    renderedTime = time;
  }
  const label = `${time.toFixed(2)} / 4.80 s`;
  if (label !== renderedLabel) {
    timeLabel.textContent = label;
    renderedLabel = label;
  }
  if (playing !== renderedPlaying) {
    play.textContent = playing ? '暂停' : '播放';
    play.setAttribute('aria-label', playing ? '暂停动效' : '播放动效');
    renderedPlaying = playing;
  }
  const phase = time < 1.05 ? 0 : time < 2.06 ? 1 : time < 2.95 ? 2 : 3;
  if (phase !== renderedPhase) {
    steps.forEach((el, i) => el.classList.toggle('active', i === phase));
    status.textContent = phases[phase];
    renderedPhase = phase;
  }
  const guideOpacity = Math.sin(Math.min(1, time / 2.6) * Math.PI) * .55;
  if (guideOpacity !== renderedGuideOpacity) {
    guide.style.opacity = String(guideOpacity);
    renderedGuideOpacity = guideOpacity;
  }
  schedule();
}
function toggle() { if (!playing && time >= duration) time = 0; playing = !playing; render(); }
play.onclick = toggle;
$('#replay').onclick = () => { time = 0; playing = true; render(); };
seek.oninput = () => { time = Number(seek.value); playing = false; render(); };
loop.onclick = () => { looping = !looping; loop.setAttribute('aria-pressed', String(looping)); };
for (const [id, className] of [['theme', 'dark'], ['pure', 'pure']]) {
  const button = $(`#${id}`);
  button.onclick = () => {
    button.setAttribute('aria-pressed', String(screen.classList.toggle(className)));
    if (className === 'dark') paintPreview();
  };
}
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); toggle(); }
});
reduced.addEventListener('change', e => { if (e.matches) { playing = false; time = 3.2; render(); } });
document.addEventListener('visibilitychange', () => { last = 0; schedule(); });
function schedule() {
  if (playing && !document.hidden) {
    if (frame === undefined) frame = requestAnimationFrame(tick);
  } else {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    last = 0;
  }
}
function tick(now: number) {
  frame = undefined;
  if (playing && !document.hidden && last) {
    time += Math.min((now - last) / 1000, .1) * Number(speed.value);
    if (time >= duration) { if (looping) time %= duration; else { time = duration; playing = false; } }
    render();
  }
  last = now;
  schedule();
}
render();
