// The app's settings: `<userData>/settings.json`, private to the user (it names their folders), written atomically
// so a crash never leaves half a file. A field that doesn't parse falls back to its default alone; a file that isn't
// settings at all is moved aside, never overwritten.
import { readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { writePrivateFile } from "@wombat/shared/private-file";
import { z } from "zod";
import type { RendererSettings } from "../shared/bridge.ts";
import { clampZoom } from "./zoom.ts";

const VERSION = 1;

const AbsolutePath = z.string().refine((value) => path.isAbsolute(value), "must be an absolute path");

/** One workspace root's settings. */
const WorkspaceSettings = z.object({ itemsRoot: AbsolutePath.optional(), layout: z.unknown().optional() });

export const Settings = z.object({
  version: z.literal(VERSION).default(VERSION),
  /** The workspace root the service runs for; unset until the user picks one. */
  workspace: AbsolutePath.optional(),
  /** Per workspace root. */
  workspaces: z.record(z.string(), WorkspaceSettings).default({}),
  /** False: a quit with agent processes applies `quitAnswer` without asking (decideQuit). */
  askOnQuit: z.boolean().default(true),
  /** The quit answer remembered with "Don't ask again"; unset with askOnQuit false (an older file) reads as "leave". */
  quitAnswer: z.enum(["stop", "leave"]).optional(),
  lastAgentFolder: z.string().optional(),
  /** Main's alone: the page changes it only through the zoom commands. */
  zoomLevel: z.number().transform(clampZoom).default(0),
});
export type Settings = z.infer<typeof Settings>;

export const SETTINGS_FILE = "settings.json";

/** `<userData>/settings.json`. */
export const settingsPath = (userData: string): string => path.join(userData, SETTINGS_FILE);

const defaults = (): Settings => Settings.parse({});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The log line for a setting that doesn't parse: it names the field, never its value. */
const logInvalid = (log: (line: string) => void, key: string): void =>
  log(`The setting "${key}" in settings.json isn't valid; using its default. Set it again in the app.`);

/** The fields of `shape` in `raw` that parse, each on its own; a field that doesn't is logged as `<prefix><key>`. */
const validFields = (shape: Record<string, z.ZodType>, raw: Record<string, unknown>, log: (line: string) => void, prefix = ""): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    const parsed = field.safeParse(raw[key]);
    if (parsed.success) fields[key] = parsed.data;
    else logInvalid(log, `${prefix}${key}`);
  }
  return fields;
};

/** Each workspace and each of its fields on its own; the log names the field, never the workspace's folder. */
const parseWorkspaces = (raw: unknown, log: (line: string) => void): Settings["workspaces"] => {
  if (raw === undefined) return {};
  if (!isObject(raw)) {
    logInvalid(log, "workspaces");
    return {};
  }
  const workspaces: Settings["workspaces"] = {};
  for (const [root, entry] of Object.entries(raw)) {
    if (isObject(entry)) workspaces[root] = WorkspaceSettings.parse(validFields(WorkspaceSettings.shape, entry, log, "workspaces."));
    else logInvalid(log, "workspaces");
  }
  return workspaces;
};

/** Each field on its own, so one bad field costs only itself; the log names the field, never its value. */
const parseFields = (raw: Record<string, unknown>, log: (line: string) => void): Settings => {
  // Fields that failed are left out, so their defaults apply here.
  const fields = validFields(Settings.omit({ workspaces: true }).shape, raw, log);
  return Settings.parse({ ...fields, workspaces: parseWorkspaces(raw["workspaces"], log) });
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

/** Writes `settings` to `file`, private to the user and atomically; a field left out is saved as its default. */
export const saveSettings = (file: string, settings: z.input<typeof Settings>): void =>
  writePrivateFile(file, `${JSON.stringify(Settings.parse(settings), null, 2)}\n`);

/** What the page may change: the patch `settings.set` takes. */
export const RendererSettingsPatch = z.strictObject({
  askOnQuit: Settings.shape.askOnQuit.unwrap().exactOptional(),
  lastAgentFolder: Settings.shape.lastAgentFolder.unwrap().exactOptional(),
  // JSON only: a value that can't be written would block every later save.
  layout: z.json().exactOptional(),
});

/**
 * True when `Patch` has exactly the fields of `Page`, each with a value `Page` takes. The bridge's RendererSettings
 * can't import this schema (the page's build has no Node), so RENDERER_PATCH_MATCHES ties the two at compile time.
 */
export type PatchMatches<Page, Patch> = [keyof Page] extends [keyof Patch]
  ? [keyof Patch] extends [keyof Page]
    ? Patch extends Partial<Page>
      ? true
      : false
    : false
  : false;

/** Fails to compile when RendererSettings and RendererSettingsPatch drift apart. */
export const RENDERER_PATCH_MATCHES: PatchMatches<RendererSettings, z.infer<typeof RendererSettingsPatch>> = true;

/** The settings the page sees: no workspace paths but the current workspace's layout. */
export const rendererSettings = (settings: Settings): RendererSettings => {
  const layout = settings.workspace === undefined ? undefined : settings.workspaces[settings.workspace]?.layout;
  return {
    askOnQuit: settings.askOnQuit,
    ...(settings.lastAgentFolder === undefined ? {} : { lastAgentFolder: settings.lastAgentFolder }),
    ...(layout === undefined ? {} : { layout }),
  };
};

/** "askOnQuit, lastAgentFolder and layout": the fields the page may change, for the refusal. */
const PATCH_FIELDS = new Intl.ListFormat("en-GB", { type: "conjunction" }).format(Object.keys(RendererSettingsPatch.shape));

/** A change from the page that doesn't fit; its message is safe to show the page. */
export class SettingsChangeRefused extends Error {}

/**
 * `settings` with the page's `patch` applied; throws SettingsChangeRefused when it doesn't fit RendererSettingsPatch.
 * With `keepLayout` false the patch's layout is checked but not kept.
 */
export const withRendererPatch = (settings: Settings, patch: unknown, keepLayout = true): Settings => {
  const parsed = RendererSettingsPatch.safeParse(patch);
  if (!parsed.success) throw new SettingsChangeRefused(`The settings change isn't valid (${z.prettifyError(parsed.error)}); send only ${PATCH_FIELDS}.`);
  const { layout, ...rest } = parsed.data;
  const next: Settings = { ...settings, ...rest };
  if (layout === undefined || !keepLayout) return next;
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
  keepLayout = true,
): void => {
  try {
    update((current) => withRendererPatch(current, patch, keepLayout));
  } catch (error) {
    if (error instanceof SettingsChangeRefused) throw error;
    log(`Wombat couldn't save the settings: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error("Wombat couldn't save the settings. Check that its settings folder is yours and writable, then try again.", { cause: error });
  }
};
