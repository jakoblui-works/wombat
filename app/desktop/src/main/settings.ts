// The app's settings: `<userData>/settings.json`, private to the user, written atomically so a crash never leaves half
// a file. A field that doesn't parse falls back to its default alone; a file that isn't settings at all is moved aside,
// never overwritten. Version 2 holds no folder: the service keeps the workspaces. A version 1 file (it named the
// workspaces) is read once, its workspaces handed to the service (upgradeSettings), then rewritten as version 2.
import { readFileSync, renameSync } from "node:fs";
import path from "node:path";
import type { AddWorkspaceRequest } from "@wombat/shared/api";
import { writePrivateFile } from "@wombat/shared/private-file";
import { z } from "zod";
import type { RendererSettings } from "../shared/bridge.ts";
import { clampZoom } from "./zoom.ts";

const VERSION = 2;

const AbsolutePath = z.string().refine((value) => path.isAbsolute(value), "must be an absolute path");

/** The fields version 1 and 2 share. */
const SHARED = {
  /** False: a quit with agent processes applies `quitAnswer` without asking (decideQuit). */
  askOnQuit: z.boolean().default(true),
  /** The quit answer remembered with "Don't ask again"; unset with askOnQuit false (an older file) reads as "leave". */
  quitAnswer: z.enum(["stop", "leave"]).optional(),
  /** Main's alone: the page changes it only through the zoom commands. */
  zoomLevel: z.number().transform(clampZoom).default(0),
};

/** The page's saved shell: JSON only, since a value that can't be held would block every later read. */
const Shell = z.json();

export const Settings = z.object({ version: z.literal(VERSION).default(VERSION), ...SHARED, shell: Shell.optional() });
export type Settings = z.infer<typeof Settings>;

/** One workspace root's settings in a version 1 file. */
const WorkspaceSettingsV1 = z.object({ itemsRoot: AbsolutePath.optional(), layout: z.unknown().optional() });

/** A version 1 file: the workspaces by root, the open one, and the page's last folder. Read only to upgrade it. */
export const SettingsV1 = z.object({
  version: z.literal(1).default(1),
  workspace: AbsolutePath.optional(),
  workspaces: z.record(z.string(), WorkspaceSettingsV1).default({}),
  lastAgentFolder: z.string().optional(),
  ...SHARED,
});
export type SettingsV1 = z.infer<typeof SettingsV1>;

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
const parseWorkspacesV1 = (raw: unknown, log: (line: string) => void): SettingsV1["workspaces"] => {
  if (raw === undefined) return {};
  if (!isObject(raw)) {
    logInvalid(log, "workspaces");
    return {};
  }
  const workspaces: SettingsV1["workspaces"] = {};
  for (const [root, entry] of Object.entries(raw)) {
    if (isObject(entry)) workspaces[root] = WorkspaceSettingsV1.parse(validFields(WorkspaceSettingsV1.shape, entry, log, "workspaces."));
    else logInvalid(log, "workspaces");
  }
  return workspaces;
};

/** Each field on its own, so one bad field costs only itself; the log names the field, never its value. */
const parseV1 = (raw: Record<string, unknown>, log: (line: string) => void): SettingsV1 => {
  // Fields that failed are left out, so their defaults apply here.
  const fields = validFields(SettingsV1.omit({ workspaces: true, version: true }).shape, raw, log);
  return SettingsV1.parse({ ...fields, workspaces: parseWorkspacesV1(raw["workspaces"], log) });
};

const parseV2 = (raw: Record<string, unknown>, log: (line: string) => void): Settings =>
  Settings.parse(validFields(Settings.omit({ version: true }).shape, raw, log));

/** A newer app's settings: this one can't tell which fields it would lose by rewriting them. */
const isNewer = (raw: Record<string, unknown>): boolean => typeof raw["version"] === "number" && raw["version"] > VERSION;

/**
 * The settings at `file`; version 2 defaults when it's missing. A file without a version or at version 1 is read as
 * version 1, for upgradeSettings. A file that can't be read, isn't a JSON object or comes from a newer app is renamed
 * to `settings.json.bad` (replacing an older one) and the defaults are returned, so the next save doesn't lose it.
 */
export const loadSettings = (file: string, log: (line: string) => void = console.warn): Settings | SettingsV1 => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaults();
    raw = undefined;
  }
  if (isObject(raw) && !isNewer(raw)) return raw["version"] === VERSION ? parseV2(raw, log) : parseV1(raw, log);
  const aside = `${file}.bad`;
  try {
    renameSync(file, aside);
    log(`${file} couldn't be read as settings of this Wombat version; it's kept as ${aside} and Wombat starts with default settings.`);
  } catch {
    log(`${file} couldn't be read as settings, nor moved aside; Wombat starts with default settings. Fix or remove the file.`);
  }
  return defaults();
};

/** Writes `settings` to `file` as version 2, private to the user and atomically; a field left out is saved as its default. */
export const saveSettings = (file: string, settings: z.input<typeof Settings>): void =>
  writePrivateFile(file, `${JSON.stringify(Settings.parse(settings), null, 2)}\n`);

/**
 * Writes `settings` to `file` as version 1, with `pending`'s workspaces: a change saved before the upgrade has run
 * keeps the workspaces it still has to hand over.
 */
export const saveSettingsV1 = (file: string, pending: SettingsV1, { askOnQuit, quitAnswer, zoomLevel }: Settings): void =>
  writePrivateFile(file, `${JSON.stringify(SettingsV1.parse({ ...pending, askOnQuit, quitAnswer, zoomLevel }), null, 2)}\n`);

/** Whether `settings` is a version 1 file still to upgrade. */
export const isV1 = (settings: Settings | SettingsV1): settings is SettingsV1 => settings.version === 1;

/**
 * The POST /workspaces calls that carry a version 1 file's workspaces to the service, in order: the open workspace
 * first, adopting the rows stored before the service listed workspaces, then the others, each with its items root.
 * A root the service would refuse (`usable`: usableFolder, the rule it refuses by) is left out, and so is such an items root: a
 * refusal would keep the file at version 1 for good.
 */
export const workspacesToAdd = (v1: SettingsV1, usable: (at: string) => boolean): AddWorkspaceRequest[] => {
  const roots = [...new Set([...(v1.workspace === undefined ? [] : [v1.workspace]), ...Object.keys(v1.workspaces)])];
  return roots
    .filter((root) => usable(root))
    .map((root) => {
      const itemsRoot = v1.workspaces[root]?.itemsRoot;
      return {
        root,
        ...(itemsRoot !== undefined && usable(itemsRoot) ? { itemsRoot } : {}),
        ...(root === v1.workspace ? { adopt: true } : {}),
      };
    });
};

/** A version 1 file's settings as version 2: what both share, without folders, the last agent folder or the layouts. */
export const asVersion2 = ({ askOnQuit, quitAnswer, zoomLevel }: SettingsV1): Settings => ({
  version: VERSION,
  askOnQuit,
  ...(quitAnswer === undefined ? {} : { quitAnswer }),
  zoomLevel,
});

/**
 * A version 1 file's open workspace when the service would refuse its folder (`usable`); undefined when it wouldn't or
 * the file names none. The rows stored before the service listed workspaces are adopted only by adding that folder, so
 * the file stays at version 1 until it's back.
 */
export const missingCurrent = (v1: SettingsV1, usable: (at: string) => boolean): string | undefined =>
  v1.workspace !== undefined && !usable(v1.workspace) ? v1.workspace : undefined;

/**
 * Adds a version 1 file's workspaces through `addWorkspace` (workspacesToAdd's order, one at a time). Resolves with
 * missingCurrent's folder, when the file must stay at version 1 for it; otherwise undefined, and the caller saves the
 * settings as version 2 (asVersion2). Rejects at the first add that fails, so the caller leaves the file at version 1
 * and the next start tries again (an add of a listed root changes nothing).
 */
export const upgradeSettings = async (
  v1: SettingsV1,
  addWorkspace: (request: AddWorkspaceRequest) => Promise<unknown>,
  usable: (at: string) => boolean,
): Promise<string | undefined> => {
  for (const request of workspacesToAdd(v1, usable)) await addWorkspace(request);
  return missingCurrent(v1, usable);
};

/** What the page may change: the patch `settings.set` takes. */
export const RendererSettingsPatch = z.strictObject({
  askOnQuit: Settings.shape.askOnQuit.unwrap().exactOptional(),
  lastAgentFolder: z.string().exactOptional(),
  shell: Shell.exactOptional(),
});
export type RendererSettingsPatch = z.infer<typeof RendererSettingsPatch>;

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

/**
 * The page's own settings that version 2 doesn't save (no folder): main holds them while it runs, so a reloaded page
 * gets them back, and they're gone at the next start.
 */
export type PageMemory = Pick<RendererSettings, "lastAgentFolder">;

/** The settings the page sees. */
export const rendererSettings = (settings: Settings, memory: PageMemory): RendererSettings => ({
  askOnQuit: settings.askOnQuit,
  ...(memory.lastAgentFolder === undefined ? {} : { lastAgentFolder: memory.lastAgentFolder }),
  ...(settings.shell === undefined ? {} : { shell: settings.shell }),
});

/** "askOnQuit, lastAgentFolder and shell": the fields the page may change, for the refusal. */
const PATCH_FIELDS = new Intl.ListFormat("en-GB", { type: "conjunction" }).format(Object.keys(RendererSettingsPatch.shape));

/** A change from the page that doesn't fit; its message is safe to show the page. */
export class SettingsChangeRefused extends Error {}

/** The page's `patch`, parsed; throws SettingsChangeRefused when it doesn't fit RendererSettingsPatch. */
export const parseRendererPatch = (patch: unknown): RendererSettingsPatch => {
  const parsed = RendererSettingsPatch.safeParse(patch);
  if (!parsed.success) throw new SettingsChangeRefused(`The settings change isn't valid (${z.prettifyError(parsed.error)}); send only ${PATCH_FIELDS}.`);
  return parsed.data;
};

/**
 * Applies the page's `patch`: its askOnQuit and shell saved through `update` (the workspace control's), the rest kept
 * in `memory`. A save that fails is logged here in full and rejected with a message that names no path (the error
 * itself names the settings file); `memory` changes only once the save went through.
 */
export const savePageSettings = (
  update: (change: (current: Settings) => Settings) => void,
  memory: PageMemory,
  patch: unknown,
  log: (line: string) => void = console.error,
): PageMemory => {
  const { askOnQuit, shell, ...rest } = parseRendererPatch(patch);
  const saved = { ...(askOnQuit === undefined ? {} : { askOnQuit }), ...(shell === undefined ? {} : { shell }) };
  if (Object.keys(saved).length > 0) {
    try {
      update((current) => ({ ...current, ...saved }));
    } catch (error) {
      log(`Wombat couldn't save the settings: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error("Wombat couldn't save the settings. Check that its settings folder is yours and writable, then try again.", { cause: error });
    }
  }
  return { ...memory, ...rest };
};
