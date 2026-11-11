// The app's settings: `<userData>/settings.json`, private to the user (it names their folders), written atomically
// so a crash never leaves half a file. A field that doesn't parse falls back to its default alone; a file that isn't
// settings at all is moved aside, never overwritten.
import { readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { writePrivateFile } from "@wombat/shared/private-file";
import { z } from "zod";
import type { RendererSettings } from "../shared/bridge.ts";

const VERSION = 1;

const AbsolutePath = z.string().refine((value) => path.isAbsolute(value), "must be an absolute path");

export const Settings = z.object({
  version: z.literal(VERSION).default(VERSION),
  /** The workspace root the service runs for; unset until the user picks one. */
  workspace: AbsolutePath.optional(),
  /** Per workspace root. */
  workspaces: z.record(z.string(), z.object({ itemsRoot: AbsolutePath.optional(), layout: z.unknown().optional() })).default({}),
  askOnQuit: z.boolean().default(true),
  lastAgentFolder: z.string().optional(),
});
export type Settings = z.infer<typeof Settings>;

export const SETTINGS_FILE = "settings.json";

/** `<userData>/settings.json`. */
export const settingsPath = (userData: string): string => path.join(userData, SETTINGS_FILE);

const defaults = (): Settings => Settings.parse({});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Each field on its own, so one bad field costs only itself; the log names the field, never its value. */
const parseFields = (raw: Record<string, unknown>, log: (line: string) => void): Settings => {
  const fields: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(Settings.shape)) {
    const parsed = field.safeParse(raw[key]);
    if (parsed.success) {
      fields[key] = parsed.data;
      continue;
    }
    log(`The setting "${key}" in settings.json isn't valid; using its default. Set it again in the app.`);
  }
  // Fields that failed are left out above, so their defaults apply here.
  return Settings.parse(fields);
};

/** A newer app's settings: this one can't tell which fields it would lose by rewriting them. */
const isNewer = (raw: Record<string, unknown>): boolean => typeof raw["version"] === "number" && raw["version"] > VERSION;

/**
 * The settings at `file`; defaults when it's missing. A file that can't be read, isn't a JSON object or comes from a
 * newer app is renamed to `settings.json.bad` (replacing an older one) and the defaults are returned, so the next
 * save doesn't lose it.
 */
export const loadSettings = (file: string, log: (line: string) => void = console.warn): Settings => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaults();
    raw = undefined;
  }
  if (isObject(raw) && !isNewer(raw)) return parseFields(raw, log);
  const aside = `${file}.bad`;
  try {
    renameSync(file, aside);
    log(`${file} couldn't be read as settings of this Wombat version; it's kept as ${aside} and Wombat starts with default settings.`);
  } catch {
    log(`${file} couldn't be read as settings, nor moved aside; Wombat starts with default settings. Fix or remove the file.`);
  }
  return defaults();
};

/** Writes `settings` to `file`, private to the user and atomically. */
export const saveSettings = (file: string, settings: Settings): void =>
  writePrivateFile(file, `${JSON.stringify(Settings.parse(settings), null, 2)}\n`);

/** What the page may change: the patch `settings.set` takes. */
export const RendererSettingsPatch = z.strictObject({
  askOnQuit: Settings.shape.askOnQuit.unwrap().exactOptional(),
  lastAgentFolder: z.string().exactOptional(),
  // JSON only: a value that can't be written would block every later save.
  layout: z.json().exactOptional(),
});

/** The settings the page sees: no workspace paths but the current workspace's layout. */
export const rendererSettings = (settings: Settings): RendererSettings => {
  const layout = settings.workspace === undefined ? undefined : settings.workspaces[settings.workspace]?.layout;
  return {
    askOnQuit: settings.askOnQuit,
    ...(settings.lastAgentFolder === undefined ? {} : { lastAgentFolder: settings.lastAgentFolder }),
    ...(layout === undefined ? {} : { layout }),
  };
};

/** A change from the page that doesn't fit; its message is safe to show the page. */
export class SettingsChangeRefused extends Error {}

/** `settings` with the page's `patch` applied; throws SettingsChangeRefused when it doesn't fit RendererSettingsPatch. */
export const withRendererPatch = (settings: Settings, patch: unknown): Settings => {
  const parsed = RendererSettingsPatch.safeParse(patch);
  if (!parsed.success) throw new SettingsChangeRefused(`The settings change isn't valid (${z.prettifyError(parsed.error)}); send only askOnQuit, lastAgentFolder and layout.`);
  const { layout, ...rest } = parsed.data;
  const next: Settings = { ...settings, ...rest };
  if (layout === undefined) return next;
  const { workspace } = settings;
  if (workspace === undefined) throw new SettingsChangeRefused("There's no workspace yet to keep a layout for; choose one first.");
  return { ...next, workspaces: { ...settings.workspaces, [workspace]: { ...settings.workspaces[workspace], layout } } };
};

/**
 * Applies the page's `patch` through `update` (the workspace control's). A save that fails is logged here in full and
 * rejected with a message that names no path: the error itself names the settings file.
 */
export const savePageSettings = (
  update: (change: (current: Settings) => Settings) => void,
  patch: unknown,
  log: (line: string) => void = console.error,
): void => {
  try {
    update((current) => withRendererPatch(current, patch));
  } catch (error) {
    if (error instanceof SettingsChangeRefused) throw error;
    log(`Wombat couldn't save the settings: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error("Wombat couldn't save the settings. Check that its settings folder is yours and writable, then try again.", { cause: error });
  }
};
