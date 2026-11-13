import { zoomFactor } from "../shared/zoom-factor.ts";

/** What the window controls' overlay is drawn with, at zoom level 0. */
export type TitleBarOverlay = { color: string; symbolColor: string; height: number };

// The overlay is drawn by the system, so main can't read the page's CSS: these mirror the title bar's tokens in
// src/renderer/src/styles/tokens.css (--surface-0, --fg-secondary, --size-titlebar).
export const TITLE_BAR_OVERLAY: TitleBarOverlay = { color: "#0b0b0d", symbolColor: "#b4b5bb", height: 36 };

/** The title bar's bottom border, in the page's pixels: the last row of its height. */
const TITLE_BAR_BORDER = 1;

/**
 * The overlay for the page at zoom `level`: the page's title bar scales with the zoom, so the overlay's height must.
 * It ends above the title bar's bottom border, which the system would otherwise paint over beside the window controls.
 */
export const titleBarOverlayAt = (level: number): TitleBarOverlay => ({
  ...TITLE_BAR_OVERLAY,
  height: Math.round((TITLE_BAR_OVERLAY.height - TITLE_BAR_BORDER) * zoomFactor(level)),
});
