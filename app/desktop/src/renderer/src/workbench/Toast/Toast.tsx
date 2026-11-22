import { useEffect, useSyncExternalStore } from "react";

import { zoomFactor } from "../../../../shared/zoom-factor.ts";

const BRIEF_MS = 1500;
const MS_PER_WORD = 300;

/** How long a message shows: a moment for a short one ("Zoom 120%"), long enough to read for a longer one. */
export const shownFor = (message: string): number => Math.max(BRIEF_MS, message.trim().split(/\s+/).length * MS_PER_WORD);

// A new object each time, so the same message told twice still shows again.
let shown: { message: string } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const change = (next: { message: string } | undefined): void => {
  shown = next;
  for (const listener of listeners) listener();
};

/** Shows `message` for a while (`shownFor`) in the page's one toast, in place of the one it shows. */
export const tell = (message: string): void => {
  clearTimeout(timer);
  change({ message });
  timer = setTimeout(() => change(undefined), shownFor(message));
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** An Electron zoom level as a percentage. */
const percent = (level: number): number => Math.round(100 * zoomFactor(level));

/** The page's one toast: the last message told (`tell`), and "Zoom 120%" after each zoom change. */
export const Toast = () => {
  const current = useSyncExternalStore(subscribe, () => shown);
  useEffect(() => window.wombat.onZoom((level) => tell(`Zoom ${String(percent(level))}%`)), []);
  // The status element is always there, empty between messages: a screen reader announces a change inside it, and may
  // miss one that arrives together with the element.
  return (
    <div role="status" className="pointer-events-none fixed top-titlebar left-1/2 mt-2 z-50 -translate-x-1/2">
      {current === undefined ? null : <div className="rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-fg-primary tabular-nums">{current.message}</div>}
    </div>
  );
};
