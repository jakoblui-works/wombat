// A tab's identity, the rules a tab's open and close follow, and the reveal requests tabs and navigators read.
import { getPanel, type PanelDescriptor, paramsFit, type Reveal } from "./registry.ts";

/** `value` as JSON with every object's keys sorted, so the same params always give the same text. */
const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  ) ?? "null";

/** A tab's identity: its panel and its params. */
export const tabKey = (panelId: string, params: unknown): string => `${panelId}:${stableJson(params)}`;

/** The tab a temporary tab opened in a strip replaces: the strip's temporary tab, unless it has unsaved edits. */
export const tabToReplace = (tabs: { key: string; temporary: boolean; unsaved: boolean }[]): string | undefined => {
  const temporary = tabs.find((tab) => tab.temporary);
  return temporary === undefined || temporary.unsaved ? undefined : temporary.key;
};

/** The questions tabs with unsaved work ask before they close, by tab key: the page's one record (`closeGuards`). */
const closeAsks = new Map<string, () => void>();

/**
 * The panel a tab on (panel, params) shows; throws for a panel that isn't registered, isn't registered for a tab, or
 * whose params don't fit it.
 */
export const openablePanel = (panelId: string, params: unknown): PanelDescriptor => {
  const panel = getPanel(panelId);
  if (panel === undefined) throw new Error(`There's no panel "${panelId}" to open; register it in workbench/activities.ts.`);
  if (!panel.locations.includes("tab")) throw new Error(`The panel "${panelId}" doesn't open as a tab; open it where it's registered to show.`);
  if (!paramsFit(panel, params)) {
    throw new Error(`The params for the panel "${panelId}" don't match its paramsSchema; pass what the panel registered.`);
  }
  return panel;
};

/**
 * How tabs with unsaved work ask before they close: a panel registers its question by tab key while it holds such
 * work, and a close the user asks for runs the question instead of closing. One for the page, over `closeAsks`.
 */
const guardListeners = new Set<(key: string) => void>();

const pageCloseGuards = {
  /** Registers `ask` for the tab `key` and tells the watchers (the shell keeps the tab); returns its unregistration. */
  guard: (key: string, ask: () => void): (() => void) => {
    closeAsks.set(key, ask);
    for (const listener of guardListeners) listener(key);
    return () => {
      if (closeAsks.get(key) === ask) closeAsks.delete(key);
    };
  },
  /** Calls `listener` with a tab's key each time a question is registered for it; returns its removal. */
  watch: (listener: (key: string) => void): (() => void) => {
    guardListeners.add(listener);
    return () => guardListeners.delete(listener);
  },
  /** Whether the tab `key` holds unsaved work: its question is registered. */
  unsaved: (key: string): boolean => closeAsks.has(key),
  /** A close of the tab `key` the user asked for: its question when it has one, else `close`. */
  request: (key: string, close: () => void): void => {
    const ask = closeAsks.get(key);
    if (ask === undefined) close();
    else ask();
  },
};

/** The page's close guards: every call gives the same one. */
export const closeGuards = (): typeof pageCloseGuards => pageCloseGuards;

/** The key an activity's navigator's reveal requests are kept under, apart from every tab's. */
export const navigatorRevealKey = (activityId: string): string => `navigator:${activityId}`;

/** What each tab and navigator was last asked to reveal; tab contents read it by their tab's key. */
export type Reveals = {
  get: (key: string) => Reveal | undefined;
  forget: (key: string) => void;
  subscribe: (listener: () => void) => () => void;
};

/** The reveal requests, and their setter. */
export const revealStore = (): Reveals & { set: (key: string, reveal: Reveal | undefined) => void } => {
  const reveals = new Map<string, Reveal>();
  const listeners = new Set<() => void>();
  const set = (key: string, reveal: Reveal | undefined): void => {
    if (reveal === undefined) reveals.delete(key);
    else reveals.set(key, reveal);
    for (const listener of listeners) listener();
  };
  return {
    get: (key) => reveals.get(key),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    forget: (key) => set(key, undefined),
  };
};
