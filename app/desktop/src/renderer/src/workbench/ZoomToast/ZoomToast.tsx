import { useEffect, useState } from "react";

import { zoomFactor } from "../../../../shared/zoom-factor.ts";

const SHOWN_MS = 1500;

/** An Electron zoom level as a percentage. */
const percent = (level: number): number => Math.round(100 * zoomFactor(level));

/** "Zoom 120%" for a moment after each zoom change, so a key press that zoomed says by how much. */
export const ZoomToast = () => {
  const [shown, setShown] = useState<{ level: number }>();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.wombat.onZoom((level) => {
      // A new object each time, so the same level heard twice still shows again.
      setShown({ level });
      clearTimeout(timer);
      timer = setTimeout(() => setShown(undefined), SHOWN_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  if (shown === undefined) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed top-titlebar left-1/2 mt-2 z-50 -translate-x-1/2 rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-fg-primary tabular-nums"
    >
      Zoom {percent(shown.level)}%
    </div>
  );
};
