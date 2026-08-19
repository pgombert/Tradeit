/**
 * The standard Stage 1 screen set and a helper to run them all. Keeping the list
 * in one place means the backend service, tests, and any future caller screen
 * with the same battery — add a screen here and it is live everywhere.
 */
import { breakoutScreen } from './breakout.js';
import { momentumScreen } from './momentum.js';
import { meanReversionScreen } from './mean-reversion.js';
import { sectorRotationScreen } from './sector-rotation.js';
import type { Screen, ScreenContext, ScreenFinding } from './types.js';

export const ALL_SCREENS: readonly Screen[] = [
  breakoutScreen,
  momentumScreen,
  meanReversionScreen,
  sectorRotationScreen,
];

/** Run every standard screen over one context and flatten their findings. */
export function runScreens(ctx: ScreenContext): ScreenFinding[] {
  return ALL_SCREENS.flatMap((screen) => screen(ctx));
}
