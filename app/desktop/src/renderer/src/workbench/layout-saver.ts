// Saves the layout a while after it last changed, and never once the page is unloading: a switch of workspace reloads
// the page after main has moved on, so a late save would land under the new workspace.
import type { SavedLayout } from "./layout.ts";

/** How long the layout must stay unchanged before it's saved. */
export const LAYOUT_SAVE_DELAY_MS = 500;

/**
 * Who changed the layout: the user (a tab opened, moved or closed, a sidebar resized, another activity), or nothing
 * the user did (dockview laying the panes out again to a new size).
 */
export type LayoutChange = "user" | "passive";

export type LayoutSaver = {
  /**
   * Saves the layout `read` gives once nothing has changed for the delay. A passive change is saved only once the
   * saver is armed; a user change arms it.
   */
  schedule: (change: LayoutChange) => void;
  /** Lets passive changes save too: the layout in effect is the user's own (restored, or nothing was saved). */
  arm: () => void;
  /** Drops any pending save and makes every later `schedule` a no-op (the page is unloading). */
  stop: () => void;
};

/**
 * Starts unarmed: after a restore that fell back to the default, the saved layout (perhaps one a newer app wrote)
 * must stay as it is until the user changes the default.
 */
export const layoutSaver = (read: () => SavedLayout, write: (layout: SavedLayout) => void, delayMs = LAYOUT_SAVE_DELAY_MS): LayoutSaver => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let armed = false;
  let stopped = false;
  return {
    schedule: (change) => {
      if (change === "user") armed = true;
      if (stopped || !armed) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        // Plain JSON: dockview's objects may carry prototypes and undefined fields IPC won't clone as they are.
        write(JSON.parse(JSON.stringify(read())) as SavedLayout);
      }, delayMs);
    },
    arm: () => {
      armed = true;
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
};

/** A dockview layout change is the user's unless it only changed sizes (dockview fitting the panes to its box). */
export const dockviewChange = (reasons: ReadonlySet<string>): LayoutChange => ([...reasons].every((reason) => reason === "geometry") ? "passive" : "user");

/**
 * Marks the dockview changes the page makes itself (closing tabs that no longer apply, new titles) as passive, so they
 * never arm the saver. Dockview reports layout changes on a later microtask, coalesced: a change run through `run` is
 * reported before the microtask `run` queues to end the mark.
 */
export const pageChanges = () => {
  let marked = false;
  return {
    run: (change: () => void): void => {
      marked = true;
      try {
        change();
      } finally {
        queueMicrotask(() => {
          marked = false;
        });
      }
    },
    /** What a dockview layout event counts as. */
    classify: (reasons: ReadonlySet<string>): LayoutChange => (marked ? "passive" : dockviewChange(reasons)),
  };
};
