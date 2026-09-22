/** Measured from IXD网页原视频.mp4, native 30 fps presentation frames 505–514.
 * Times are relative to ring completion, never to page load or rendered frames.
 * Intermediate colors are theme-relative ink/paper mixes, not full-page flashes. */
export const WELCOME_FLASH_DURATION_MS = 300;

export const WELCOME_FLASH_STATES = [
  { at: 0, panel: 1, ink: 0, sourceFrame: 505 },
  { at: 100 / 3, panel: 0, ink: 0, sourceFrame: 506 },
  { at: 200 / 3, panel: .28, ink: .2, sourceFrame: 507 },
  { at: 100, panel: 0, ink: 1, sourceFrame: 508 },
  { at: 500 / 3, panel: 1, ink: 0, sourceFrame: 510 },
  { at: 200, panel: 0, ink: 0, sourceFrame: 511 },
  { at: 700 / 3, panel: 0, ink: .25, sourceFrame: 512 },
  { at: WELCOME_FLASH_DURATION_MS, panel: 0, ink: 1, sourceFrame: 514 },
] as const;

export function welcomeFlashState(elapsedMs: number) {
  for (let i = WELCOME_FLASH_STATES.length - 1; i >= 0; i--) {
    if (elapsedMs + 1e-6 >= WELCOME_FLASH_STATES[i].at) return WELCOME_FLASH_STATES[i];
  }
  return WELCOME_FLASH_STATES[0];
}

/** B-only visibility cuts measured from ixd-bate0.2.mp4 at native 60 fps.
 * Company begins at source frame 1236 (20.600s); database begins at 1280,
 * with two observed off-pairs at 1282–1283 and 1288–1289. The archived
 * strip expansion is reused separately; this does not alter A or C. */
export function welcomeTextState(elapsedSeconds: number) {
  const frame = Math.floor(elapsedSeconds * 60 + 1e-6);
  return {
    companyVisible: frame >= 0 && !(frame >= 2 && frame < 4),
    companyMask: frame >= 6 && frame < 8,
    databaseVisible: frame >= 44 && !(frame >= 46 && frame < 48) && !(frame >= 52 && frame < 54),
  };
}
