const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long before `now` the ISO time `at` was, in its largest whole unit: "now" (under a minute), "4m", "3h", "2d". */
export const ago = (at: string, now: number | Date): string => {
  const elapsed = (typeof now === "number" ? now : now.getTime()) - Date.parse(at);
  if (!(elapsed >= MINUTE_MS)) return "now";
  if (elapsed < HOUR_MS) return `${String(Math.floor(elapsed / MINUTE_MS))}m`;
  if (elapsed < DAY_MS) return `${String(Math.floor(elapsed / HOUR_MS))}h`;
  return `${String(Math.floor(elapsed / DAY_MS))}d`;
};
