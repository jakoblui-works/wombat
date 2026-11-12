// The overlay's colours and height are copies of the title bar's tokens (main can't read CSS); this reads the tokens
// and checks the copies.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

import { TITLE_BAR_OVERLAY, titleBarOverlayAt } from "./title-bar.ts";

const tokens = readFileSync(path.join(import.meta.dirname, "../renderer/src/styles/tokens.css"), "utf8");

const token = (name: string): string => {
  const value = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "m").exec(tokens)?.[1];
  if (value === undefined) throw new Error(`tokens.css has no --${name}; the title bar's overlay mirrors it.`);
  return value.trim();
};

/** An `oklch(L C h)` colour as sRGB hex (Oklab to linear sRGB to gamma-encoded, clipped to the gamut). */
const oklchToHex = (value: string): string => {
  const parts = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (parts === null) throw new Error(`Expected a plain oklch(L C h) colour, got "${value}".`);
  const [lightness, chroma, hue] = parts.slice(1).map(Number) as [number, number, number];
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  const channel = (x: number): string => {
    const clipped = Math.min(1, Math.max(0, x));
    const encoded = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255).toString(16).padStart(2, "0");
  };
  return `#${linear.map(channel).join("")}`;
};

test("the overlay's colours and height are the title bar's tokens", () => {
  expect(TITLE_BAR_OVERLAY).toEqual({
    color: oklchToHex(token("surface-0")),
    symbolColor: oklchToHex(token("fg-secondary")),
    height: Number.parseFloat(token("size-titlebar")),
  });
});

test("the overlay's height follows the zoom, as the page's title bar does", () => {
  expect(titleBarOverlayAt(0).height).toBe(TITLE_BAR_OVERLAY.height);
  expect(titleBarOverlayAt(1).height).toBe(Math.round(TITLE_BAR_OVERLAY.height * 1.2));
  expect(titleBarOverlayAt(-1).height).toBeLessThan(TITLE_BAR_OVERLAY.height);
  expect(titleBarOverlayAt(2).color).toBe(TITLE_BAR_OVERLAY.color);
});
