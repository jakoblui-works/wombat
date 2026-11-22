/** Where the toolbar's pill may sit: its top, in pixels from the top of the area it floats in. */
export type PillBounds = { min: number; max: number };

export const PILL_GAP = 8;
export const PILL_STEP = 16;

/** The pill's room in an area `height` tall whose header row ends at `headerBottom`: below the header, inside the area. */
export const pillBounds = ({ height, headerBottom, pillHeight }: { height: number; headerBottom: number; pillHeight: number }): PillBounds => {
  const min = headerBottom + PILL_GAP;
  return { min, max: Math.max(min, height - pillHeight - PILL_GAP) };
};

/**
 * The pill's top for an offset below its start (the top of its bounds), kept inside the bounds. The offset is kept as
 * moved, not clamped to the area, so a window shrunk and regrown puts the pill back where it was.
 */
export const pillTop = (offset: number, { min, max }: PillBounds): number => Math.min(max, Math.max(min, min + offset));

/** The offset after moving the pill `dy` from where it's drawn: it stops at the bounds, so a move back starts at once. */
export const movedPill = (offset: number, dy: number, bounds: PillBounds): number => pillTop(pillTop(offset, bounds) + dy - bounds.min, bounds) - bounds.min;

export const pillKeyMove = (key: string): number | undefined => (key === "ArrowDown" ? PILL_STEP : key === "ArrowUp" ? -PILL_STEP : undefined);
