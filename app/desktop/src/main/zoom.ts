// The app's zoom level: an Electron zoom level (0 is 100%, each step scales by 1.2), one for every window.

/** The bounds keep the window usable: about 40% to 250%. */
export const ZOOM_MIN = -5;
export const ZOOM_MAX = 5;
/** One zoom in or out, a whole level as in VS Code. */
export const ZOOM_STEP = 1;

/** `level` within ZOOM_MIN…ZOOM_MAX. */
export const clampZoom = (level: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
