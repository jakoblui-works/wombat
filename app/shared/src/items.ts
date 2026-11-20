// Items: a binder's settings (`_binder.yaml`, written by hand) and the items the service reads from the
// item files. The settings schema is strict and refuses contradictions, since a binder's rules are what the
// service enforces on agents; the shapes read through the API are lenient (the app ignores unknown fields and
// kinds), like every response in `api.ts`.
//
// Every settings message starts with the key it's about and says what to write instead, so it reads alone: the
// loader puts the issue's path in `Problem.field` and the message, unchanged, beside it.
import { z } from "zod";

/** Keeps the items that match `item` and drops the rest (newer kinds we don't know). */
export const knownItems = <T extends z.ZodType>(item: T) =>
  z.array(z.unknown()).transform((items) =>
    items.flatMap((value) => {
      const result = item.safeParse(value);
      return result.success ? [result.data] : [];
    }),
  );

/** The error map of a settings key: required when missing, otherwise the shape it takes. */
const takes = (key: string, shape: string, example: string) => ({
  error: (issue: { input?: unknown }) =>
    issue.input === undefined ? `${key} is required, like ${example}` : `${key} takes ${shape}, like ${example}`,
});

/** The error map of a settings object (`what`): an unknown key lists the keys it takes; anything else isn't a map. */
const keysOf = (what: string, keys: string, example: string, unknownKey?: (key: string) => string | undefined) => ({
  error: (issue: z.core.$ZodRawIssue) => {
    if (issue.code !== "unrecognized_keys") return `${what} takes a map, like ${example}`;
    const [key = ""] = issue.keys;
    return unknownKey?.(key) ?? `${issue.keys.join(", ")}: not a key of ${what}; it takes ${keys}`;
  },
});

/** A binder id: links (`to`) and the API name a binder by it, so it stays stable when the folder moves. */
const binderId = (key: string, example: string) =>
  z.string(takes(key, "a binder id", `${key}: ${example}`)).regex(/^[a-z][a-z0-9-]{0,39}$/, {
    error: `${key}: a binder id is a lowercase letter, then up to 39 lowercase letters, digits or -, like ${key}: ${example}`,
  });

export const Access = z.enum(["hidden", "read", "propose", "edit"]);
export type Access = z.infer<typeof Access>;

export const Naming = z.enum(["handle", "free"]);
export type Naming = z.infer<typeof Naming>;

export const Instructions = z.enum(["off", "full", "index"]);
export type Instructions = z.infer<typeof Instructions>;

/** The frontmatter keys that name an item, which the service sets; every other frontmatter key is a property. */
export const OWN_KEYS: ReadonlySet<string> = new Set(["id", "handle", "aliases"]);

/** An item's fields that live in its markdown, not its frontmatter: the `# ` heading and the text after it. */
export const ITEM_FIELDS: ReadonlySet<string> = new Set(["title", "body"]);

/** Names an item's own fields take; a property can't use them. */
const RESERVED_NAMES: ReadonlySet<string> = new Set([...OWN_KEYS, ...ITEM_FIELDS]);

const SLUG_LENGTH = 50;

/**
 * Lowercase ASCII words of the title joined by `-`, cut at a word to at most 50 characters: the name part of an item's
 * file, and a new binder's id and suggested folder.
 */
export const slugOf = (title: string) => {
  const words = title.normalize("NFKD").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let slug = "";
  for (const word of words) {
    const next = slug === "" ? word : `${slug}-${word}`;
    if (next.length > SLUG_LENGTH) return slug === "" ? word.slice(0, SLUG_LENGTH) : slug;
    slug = next;
  }
  return slug;
};

/** The longest a handle prefix may be. */
export const HANDLE_PREFIX_MAX = 10;

/** The pattern of a handle prefix (`BUG` in `BUG-14`), as regex source to build the prefix's and a handle's regex from. */
export const HANDLE_PREFIX_PATTERN = `[A-Z][A-Z0-9]{0,${String(HANDLE_PREFIX_MAX - 1)}}`;

/**
 * A glob relative to the binder's folder. Refuses the obvious escapes (absolute paths, `..`, backslashes)
 * and brace sets, which could hide them; the loader checks that what a glob matches stays inside the folder.
 */
const isRelativeGlob = (glob: string) =>
  glob !== "" &&
  !glob.startsWith("/") &&
  !/[\\{}]/.test(glob) &&
  glob.split("/").every((segment) => segment !== "..");

// Properties: one strict object per type; `.strip()` gives the lenient form the API reads.

const propertyTypes = "select, text, date, number or link";
const propertyExample = "repo: { type: select, options: [site-web, api] }";
const required = z.boolean(takes("required", "true or false", "required: true")).default(false);
/** Properties are locked in the top-level `locked` list (one list for every field), never on the property. */
const propertyKeys = (type: string, keys: string) =>
  keysOf(`a ${type} property`, keys, propertyExample, (key) =>
    key === "locked" ? "locked: lock a property in the binder's top-level list, like locked: [repo]; remove it here" : undefined,
  );

const SelectProperty = z.strictObject(
  {
    type: z.literal("select"),
    options: z
      .array(
        z.string(takes("options", "a list of values", "options: [site-web, api]")).min(1, { error: "options: an option can't be empty" }),
        takes("options", "a list of values", "options: [site-web, api]"),
      )
      .min(1, { error: "options: a select property needs at least one option, like options: [site-web, api]" })
      .superRefine((options, ctx) => {
        const repeated = options.filter((option, index) => options.indexOf(option) !== index);
        for (const option of new Set(repeated)) {
          ctx.addIssue({ code: "custom", message: `options: "${option}" is listed twice; list each option once` });
        }
      }),
    required,
  },
  propertyKeys("select", "type, options and required"),
);
const TextProperty = z.strictObject({ type: z.literal("text"), required }, propertyKeys("text", "type and required"));
/** Values are `"YYYY-MM-DD"` strings. */
const DateProperty = z.strictObject({ type: z.literal("date"), required }, propertyKeys("date", "type and required"));
const NumberProperty = z.strictObject({ type: z.literal("number"), required }, propertyKeys("number", "type and required"));
/** Values are the target item's id; `to` names the target's binder (the loader checks it exists). */
const LinkProperty = z.strictObject(
  { type: z.literal("link"), to: binderId("to", "backlog"), required },
  propertyKeys("link", "type, to and required"),
);

const Property = z.discriminatedUnion("type", [SelectProperty, TextProperty, DateProperty, NumberProperty, LinkProperty], {
  error: (issue) =>
    issue.code === "invalid_union"
      ? `type: a property's type is ${propertyTypes}, like ${propertyExample}`
      : `properties: each property takes a map with its type, like ${propertyExample}`,
});
export type Property = z.infer<typeof Property>;

const propertyTypeNames = new Set<unknown>(["select", "text", "date", "number", "link"]);
/** A property type this app doesn't know (newer service): kept, with its fields, so the app can show it as unknown. */
const UnknownProperty = z
  .looseObject({ type: z.string().refine((type) => !propertyTypeNames.has(type)) })
  .transform(({ type, ...fields }) => ({ ...fields, type: "unknown" as const, original: type }));

/** A property as the API sends it: a known type, or an unknown one kept as `{ type: "unknown", original }`. */
export const LenientProperty = z.union([
  z.discriminatedUnion("type", [
    SelectProperty.strip(),
    TextProperty.strip(),
    DateProperty.strip(),
    NumberProperty.strip(),
    LinkProperty.strip(),
  ]),
  UnknownProperty,
]);
export type LenientProperty = z.infer<typeof LenientProperty>;

// Views: list, board and tree, each naming the properties it uses.

const viewExample = "{ name: Board, kind: board, column: repo }";
const FilterValue = z.union([z.string(), z.number(), z.boolean()], {
  error: "filter: a value is text, a number or true or false, like filter: { repo: api }",
});
const viewFields = {
  name: z.string(takes("name", "text", "name: Board")).min(1, { error: "name: a view needs a name, like name: Board" }),
  /** Property name → the value an item must have to show. */
  filter: z.record(z.string(), FilterValue, takes("filter", "a map of property to value", "filter: { repo: api }")).exactOptional(),
  /** Property names, the first sorting first. */
  sort: z
    .array(z.string(takes("sort", "a list of property names", "sort: [noted]")), takes("sort", "a list of property names", "sort: [noted]"))
    .exactOptional(),
};
const ListView = z.strictObject(
  { ...viewFields, kind: z.literal("list"), group: z.string(takes("group", "a property name", "group: repo")).exactOptional() },
  keysOf("a list view", "name, kind, filter, sort and group", viewExample),
);
/** `column`: a select property; the app groups a list by its value. */
const BoardView = z.strictObject(
  { ...viewFields, kind: z.literal("board"), column: z.string(takes("column", "a select property's name", "column: repo")) },
  keysOf("a board view", "name, kind, filter, sort and column", viewExample),
);
/** `parent`: a link property to the same binder; an item nests under the item it links to. */
const TreeView = z.strictObject(
  { ...viewFields, kind: z.literal("tree"), parent: z.string(takes("parent", "a link property's name", "parent: parent")) },
  keysOf("a tree view", "name, kind, filter, sort and parent", viewExample),
);

const View = z.discriminatedUnion("kind", [ListView, BoardView, TreeView], {
  error: (issue) =>
    issue.code === "invalid_union"
      ? `kind: a view's kind is list, board or tree, like ${viewExample}`
      : `views: each view takes a map, like ${viewExample}`,
});
export type View = z.infer<typeof View>;

/** A view as the API sends it; a list of them drops kinds this app doesn't know (knownItems). */
export const LenientView = z.discriminatedUnion("kind", [ListView.strip(), BoardView.strip(), TreeView.strip()]);
export type LenientView = z.infer<typeof LenientView>;

/** The file that makes a folder a binder. */
export const SETTINGS_FILE = "_binder.yaml";

const settingsKeys = "version, id, name, prefix, access, naming, include, instructions, locked, properties and views";

/**
 * A binder's `_binder.yaml`, written by hand (and by the platform migration); the service's loader
 * parses it and enforces it on agents, the app shows its views. Strict, and refuses settings that contradict
 * themselves, each with a message naming the key. Rules across files (unique ids and prefixes, `to` naming a
 * known binder, a file in two binders) are the loader's.
 */
export const BinderSettings = z
  .strictObject(
    {
      version: z.literal(1, takes("version", "1", "version: 1")),
      id: binderId("id", "bugs"),
      name: z.string(takes("name", "text", "name: Bugs")).min(1, { error: "name: give the binder a name to show in the app, like name: Bugs" }),
      /** The handle prefix: `BUG` in `BUG-14`. */
      prefix: z.string(takes("prefix", "a handle prefix", "prefix: BUG")).regex(new RegExp(`^${HANDLE_PREFIX_PATTERN}$`), {
        error: "prefix: an uppercase letter, then up to 9 uppercase letters or digits, like prefix: BUG",
      }),
      access: z.enum(Access.options, takes("access", "hidden, read, propose or edit", "access: propose")),
      /** `handle`: files the service creates are named `BUG-14-<slug>.md`; `free`: the binder's files are its `include` matches. */
      naming: z.enum(Naming.options, takes("naming", "handle or free", "naming: free")).default("handle"),
      /** Globs relative to the binder's folder; only with `naming: free`. */
      include: z
        .array(
          z.string(takes("include", "a list of globs", 'include: ["*.md"]')).refine(isRelativeGlob, {
            error: 'include: a glob is relative to the binder\'s folder, without "..", "\\", "{" or "}", like include: ["*.md"]',
          }),
          takes("include", "a list of globs", 'include: ["*.md"]'),
        )
        .min(1, { error: 'include: list at least one glob, like include: ["*.md"]' })
        .exactOptional(),
      /** Whether the binder's items are loaded into every agent at start: in full, or as an index. */
      instructions: z.enum(Instructions.options, takes("instructions", "off, full or index", "instructions: full")).default("off"),
      /** Fields agents can't change: `title`, `body` or property names. Only in a propose or edit binder. */
      locked: z
        .array(z.string(takes("locked", "a list of field names", "locked: [title]")), takes("locked", "a list", "locked: [title]"))
        .default([]),
      properties: z
        .record(z.string().min(1), Property, {
          error: (issue) =>
            issue.code === "invalid_key"
              ? "properties: a property needs a name, like repo: { type: text }"
              : takes("properties", "a map of name to property", `properties: { ${propertyExample} }`).error(issue),
        })
        .default({}),
      views: z.array(View, takes("views", "a list of views", `views: [${viewExample}]`)).default([]),
    },
    keysOf(SETTINGS_FILE, settingsKeys, "id: bugs"),
  )
  .superRefine((settings, ctx) => {
    const refuse = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const { access, properties } = settings;

    if (access === "hidden" && settings.instructions !== "off") {
      refuse(["instructions"], "instructions: a hidden binder never reaches agents; set instructions: off, or access: read or higher");
    }
    // Instructions reach every later agent's system prompt; an edit binder would let one agent change them
    // without the user's approval.
    if (access === "edit" && settings.instructions !== "off") {
      refuse(["instructions"], "instructions: agents could change every later agent's instructions without your approval; set access: propose, or instructions: off");
    }

    if (settings.locked.length > 0 && (access === "hidden" || access === "read")) {
      refuse(["locked"], `locked: a ${access} binder is closed to agent changes as a whole; remove locked, or set access: propose or edit`);
    } else {
      settings.locked.forEach((field, index) => {
        if (!ITEM_FIELDS.has(field) && !Object.hasOwn(properties, field)) {
          refuse(["locked", index], `locked: "${field}" is not a field of this binder; name title, body or a property`);
        }
      });
    }

    if (settings.include !== undefined && settings.naming !== "free") {
      refuse(["include"], "include: only a binder with naming: free picks its files by include; set naming: free or remove include");
    }
    if (settings.naming === "free" && settings.include === undefined) {
      refuse(["naming"], 'naming: free needs include, the globs of the binder\'s files, like include: ["*.md"]');
    }

    for (const name of Object.keys(properties)) {
      if (RESERVED_NAMES.has(name)) {
        refuse(["properties", name], `properties: "${name}" is one of the item's own fields (id, handle, aliases, title, body); rename the property`);
      }
    }

    settings.views.forEach((view, index) => {
      const at = (key: string) => ["views", index, key];
      const named = `view "${view.name}"`;
      const known = (key: string, property: string) => {
        if (Object.hasOwn(properties, property)) return true;
        refuse(at(key), `${key}: ${named} names "${property}", which is not a property of this binder`);
        return false;
      };

      for (const property of Object.keys(view.filter ?? {})) known("filter", property);
      for (const property of view.sort ?? []) known("sort", property);
      if (view.kind === "list" && view.group !== undefined) known("group", view.group);
      if (view.kind === "board" && known("column", view.column) && properties[view.column]?.type !== "select") {
        refuse(at("column"), `column: ${named} needs a select property for its columns, and "${view.column}" isn't one`);
      }
      if (view.kind === "tree" && known("parent", view.parent)) {
        const parent = properties[view.parent];
        if (parent?.type !== "link" || parent.to !== settings.id) {
          refuse(at("parent"), `parent: ${named} needs a link property to this binder (to: ${settings.id}), and "${view.parent}" isn't one`);
        }
      }
    });
  });
export type BinderSettings = z.infer<typeof BinderSettings>;

// Read through the API (lenient).

/** Where an item or binder breaks the rules; `field` or `line` says where. A valid one has none. */
export const Problem = z.object({
  field: z.string().exactOptional(),
  line: z.int().positive().exactOptional(),
  message: z.string(),
});
export type Problem = z.infer<typeof Problem>;

/** A link property's value as the API sends it; `handle` is null when the target can't be found. */
export const LinkValue = z.object({ id: z.string(), handle: z.string().nullable() });
export type LinkValue = z.infer<typeof LinkValue>;

const binderListing = {
  /** The binder's folder, relative to the items root, with `/`. */
  path: z.string(),
  /** Every listed file, invalid ones included. */
  itemCount: z.int().nonnegative(),
  invalidCount: z.int().nonnegative(),
  problems: z.array(Problem),
};

/**
 * A binder as the service lists it (`GET /binders`) for the app, hidden ones included. `id` is null
 * when its `_binder.yaml` fails to parse or validate: then only its path and problems are known, and its
 * files aren't listed.
 */
export const BinderSummary = z.union([
  z.object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
    access: Access,
    naming: Naming,
    instructions: Instructions,
    properties: z.record(z.string(), LenientProperty),
    views: knownItems(LenientView),
    ...binderListing,
  }),
  z.object({ id: z.null(), ...binderListing }),
]);
export type BinderSummary = z.infer<typeof BinderSummary>;

const itemFields = {
  /** The item's UUIDv7, which never changes; null when the file can't be parsed. */
  id: z.string().nullable(),
  /** `BUG-14`; null when the file can't be parsed. */
  handle: z.string().nullable(),
  /** Old handles, which still find the item. */
  aliases: z.array(z.string()),
  /** The first `# ` heading; null when the file can't be parsed or has none. */
  title: z.string().nullable(),
  /**
   * Property name → value. In a valid item: select, text and date (`"YYYY-MM-DD"`) values are strings,
   * numbers are numbers, links are LinkValues. An invalid item carries what its file holds.
   */
  properties: z.record(z.string(), z.unknown()),
  /** Relative to the items root, with `/`. */
  path: z.string(),
  /** sha256 (hex) of the file's bytes; a write names the version it's based on. */
  version: z.string(),
  /** The id of the binder the item belongs to. */
  binder: z.string(),
  problems: z.array(Problem),
};

/** An item as a binder's list sends it (`GET /binders/:id/items`), invalid ones included; no body. */
export const ItemSummary = z.object(itemFields);
export type ItemSummary = z.infer<typeof ItemSummary>;

/** One item (`GET /items/:ref`, by id, handle or alias): the summary plus its body, everything after the title line. */
export const Item = z.object({ ...itemFields, body: z.string().nullable() });
export type Item = z.infer<typeof Item>;
