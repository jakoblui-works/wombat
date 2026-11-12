const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long the service has run, as text, in its two largest whole units: "under a minute", "4 min", "6 h 15 min",
 * "2 d 3 h". The one place the status bar and the launch notice format it.
 */
export const uptimeLabel = (startedAt: string, now: number | Date): string => {
  const elapsed = (typeof now === "number" ? now : now.getTime()) - Date.parse(startedAt);
  if (!(elapsed >= MINUTE_MS)) return "under a minute";
  if (elapsed < HOUR_MS) return `${String(Math.floor(elapsed / MINUTE_MS))} min`;
  if (elapsed < DAY_MS) {
    const minutes = Math.floor((elapsed % HOUR_MS) / MINUTE_MS);
    return `${String(Math.floor(elapsed / HOUR_MS))} h${minutes === 0 ? "" : ` ${String(minutes)} min`}`;
  }
  const hours = Math.floor((elapsed % DAY_MS) / HOUR_MS);
  return `${String(Math.floor(elapsed / DAY_MS))} d${hours === 0 ? "" : ` ${String(hours)} h`}`;
};

/** The local clock time the service started, "11:34"; the status bar's panel and the launch notice both show it. */
export const startedClock = (startedAt: string): string => new Date(startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
