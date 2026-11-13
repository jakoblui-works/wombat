/** How much an Electron zoom level scales the page: 1 at level 0, 1.2 times more with each level. */
export const zoomFactor = (level: number): number => 1.2 ** level;
