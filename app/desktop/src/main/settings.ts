// The app's settings: `<userData>/settings.json`, private to the user (it names their folders), written atomically
// so a crash never leaves half a file. A field that doesn't parse falls back to its default alone; a file that isn't
// settings at all is moved aside, never overwritten.
import { readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { writePrivateFile } from "@wombat/shared/private-file";
import { z } from "zod";

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
