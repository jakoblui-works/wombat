// Items: a structure's settings (`_structure.yaml`, written by hand) and the items and proposals the service
// reads from the item files and its store. The settings schema is strict and refuses contradictions, since a
// structure's rules are what the service enforces on agents; the shapes read through the API are lenient
// (the app ignores unknown fields and kinds), like every response in `api.ts`.
//
// Every settings message starts with the key it's about and says what to write instead, so it reads alone:
// the loader puts the issue's path in `Problem.field` and the message, unchanged, beside it.
import { z } from "zod";

const Timestamp = z.iso.datetime({ offset: true });

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

/** A structure id: links (`to`) and the API name a structure by it, so it stays stable when the folder moves. */
const structureId = (key: string, example: string) =>
  z.string(takes(key, "a structure id", `${key}: ${example}`)).regex(/^[a-z][a-z0-9-]{0,39}$/, {
    error: `${key}: a structure id is a lowercase letter, then up to 39 lowercase letters, digits or -, like ${key}: ${example}`,
  });

export const Access = z.enum(["hidden", "read", "propose", "edit"]);
export type Access = z.infer<typeof Access>;

export const Naming = z.enum(["handle", "free"]);
export type Naming = z.infer<typeof Naming>;

export const Instructions = z.enum(["off", "full", "index"]);
export type Instructions = z.infer<typeof Instructions>;

/** Names an item's own fields take; a property can't use them. */
const RESERVED_NAMES = new Set(["id", "handle", "aliases", "title", "body"]);

/**
 * A glob relative to the structure's folder. Refuses the obvious escapes (absolute paths, `..`, backslashes)
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
    key === "locked" ? "locked: lock a property in the structure's top-level list, like locked: [repo]; remove it here" : undefined,
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
/** Values are the target item's id; `to` names the target's structure (the loader checks it exists). */
const LinkProperty = z.strictObject(
  { type: z.literal("link"), to: structureId("to", "backlog"), required },
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
/** `column`: a select property; a card's column is its value. */
const BoardView = z.strictObject(
  { ...viewFields, kind: z.literal("board"), column: z.string(takes("column", "a select property's name", "column: repo")) },
  keysOf("a board view", "name, kind, filter, sort and column", viewExample),
);
/** `parent`: a link property to the same structure; an item nests under the item it links to. */
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

const settingsKeys = "version, id, name, prefix, access, naming, include, instructions, locked, properties and views";

/**
 * A structure's `_structure.yaml`, written by hand (and by the platform migration); the service's loader
 * parses it and enforces it on agents, the app shows its views. Strict, and refuses settings that contradict
 * themselves, each with a message naming the key. Rules across files (unique ids and prefixes, `to` naming a
 * known structure, a file in two structures) are the loader's.
 */
export const StructureSettings = z
  .strictObject(
    {
      version: z.literal(1, takes("version", "1", "version: 1")),
      id: structureId("id", "bugs"),
      name: z.string(takes("name", "text", "name: Bugs")).min(1, { error: "name: give the structure a name to show in the app, like name: Bugs" }),
      /** The handle prefix: `BUG` in `BUG-14`. */
      prefix: z.string(takes("prefix", "a handle prefix", "prefix: BUG")).regex(/^[A-Z][A-Z0-9]{0,9}$/, {
        error: "prefix: an uppercase letter, then up to 9 uppercase letters or digits, like prefix: BUG",
      }),
      access: z.enum(Access.options, takes("access", "hidden, read, propose or edit", "access: propose")),
      /** `handle`: files the service creates are named `BUG-14-<slug>.md`; `free`: the structure's files are its `include` matches. */
      naming: z.enum(Naming.options, takes("naming", "handle or free", "naming: free")).default("handle"),
      /** Globs relative to the structure's folder; only with `naming: free`. */
      include: z
        .array(
          z.string(takes("include", "a list of globs", 'include: ["*.md"]')).refine(isRelativeGlob, {
            error: 'include: a glob is relative to the structure\'s folder, without "..", "\\", "{" or "}", like include: ["*.md"]',
          }),
          takes("include", "a list of globs", 'include: ["*.md"]'),
        )
        .min(1, { error: 'include: list at least one glob, like include: ["*.md"]' })
        .exactOptional(),
      /** Whether the structure's items are loaded into every agent at start: in full, or as an index. */
      instructions: z.enum(Instructions.options, takes("instructions", "off, full or index", "instructions: full")).default("off"),
      /** Fields agents can't change: `title`, `body` or property names. Only in a propose or edit structure. */
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
    keysOf("_structure.yaml", settingsKeys, "id: bugs"),
  )
  .superRefine((settings, ctx) => {
    const refuse = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const { access, properties } = settings;

    if (access === "hidden" && settings.instructions !== "off") {
      refuse(["instructions"], "instructions: a hidden structure never reaches agents; set instructions: off, or access: read or higher");
    }

    if (settings.locked.length > 0 && (access === "hidden" || access === "read")) {
      refuse(["locked"], `locked: a ${access} structure is closed to agent changes as a whole; remove locked, or set access: propose or edit`);
    } else {
      settings.locked.forEach((field, index) => {
        if (field !== "title" && field !== "body" && !Object.hasOwn(properties, field)) {
          refuse(["locked", index], `locked: "${field}" is not a field of this structure; name title, body or a property`);
        }
      });
    }

    if (settings.include !== undefined && settings.naming !== "free") {
      refuse(["include"], "include: only a structure with naming: free picks its files by include; set naming: free or remove include");
    }
    if (settings.naming === "free" && settings.include === undefined) {
      refuse(["naming"], 'naming: free needs include, the globs of the structure\'s files, like include: ["*.md"]');
    }

    for (const name of Object.keys(properties)) {
      if (RESERVED_NAMES.has(name)) {
        refuse(["properties", name], `properties: "${name}" is one of the item's own fields (id, handle, aliases, title, body); rename the property`);
      }
    }

    settings.views.forEach((view, index) => {
      const at = (key: string) => ["views", index, key];
      const named = `view "${view.name}"`;
      const unknown = (key: string, property: string) =>
        refuse(at(key), `${key}: ${named} names "${property}", which is not a property of this structure`);
      const known = (key: string, property: string) => {
        if (Object.hasOwn(properties, property)) return true;
        unknown(key, property);
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
          refuse(at("parent"), `parent: ${named} needs a link property to this structure (to: ${settings.id}), and "${view.parent}" isn't one`);
        }
      }
    });
  });
export type StructureSettings = z.infer<typeof StructureSettings>;

// Read through the API (lenient).

/** Where an item or structure breaks the rules; `field` or `line` says where. A valid one has none. */
export const Problem = z.object({
  field: z.string().exactOptional(),
  line: z.int().positive().exactOptional(),
  message: z.string(),
});
export type Problem = z.infer<typeof Problem>;

/** A link property's value as the API sends it; `handle` is null when the target can't be found. */
export const LinkValue = z.object({ id: z.string(), handle: z.string().nullable() });
export type LinkValue = z.infer<typeof LinkValue>;

const structureListing = {
  /** The structure's folder, relative to the items root, with `/`. */
  path: z.string(),
  /** Every listed file, invalid ones included. */
  itemCount: z.int().nonnegative(),
  invalidCount: z.int().nonnegative(),
  problems: z.array(Problem),
};

/**
 * A structure as the service lists it (`GET /structures`) for the app, hidden ones included. `id` is null
 * when its `_structure.yaml` fails to parse or validate: then only its path and problems are known, and its
 * files aren't listed.
 */
export const StructureSummary = z.union([
  z.object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
    access: Access,
    naming: Naming,
    instructions: Instructions,
    properties: z.record(z.string(), LenientProperty),
    views: knownItems(LenientView),
    ...structureListing,
  }),
  z.object({ id: z.null(), ...structureListing }),
]);
export type StructureSummary = z.infer<typeof StructureSummary>;

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
  problems: z.array(Problem),
};

/** An item as a structure's list sends it (`GET /structures/:id/items`), invalid ones included; no body. */
export const ItemSummary = z.object(itemFields);
export type ItemSummary = z.infer<typeof ItemSummary>;

/** One item (`GET /items/:handle`, by handle or alias): the summary plus its body, everything after the title line. */
export const Item = z.object({ ...itemFields, body: z.string().nullable() });
export type Item = z.infer<typeof Item>;

export const ProposalKind = z.enum(["create", "update", "delete"]);
export type ProposalKind = z.infer<typeof ProposalKind>;

export const ProposalStatus = z.enum(["pending", "approved", "rejected", "conflict"]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

/**
 * A change an agent proposed to a `propose` structure, kept in the service's store until the user approves
 * or rejects it in the app (`GET /proposals`). Approving writes the file; `conflict` means the file changed
 * since `baseVersion`.
 */
export const Proposal = z.object({
  id: z.string(),
  /** The target structure's id. */
  structure: z.string(),
  kind: ProposalKind,
  /** The target item; null for a pending create (it gets a handle when approved). */
  handle: z.string().nullable(),
  /** Field name → proposed value: `title`, `body` or property names, link values as ids. */
  fields: z.record(z.string(), z.unknown()),
  reason: z.string(),
  /** The item's version the change is based on; null for a create. */
  baseVersion: z.string().nullable(),
  status: ProposalStatus,
  agentId: z.string(),
  at: Timestamp,
  decidedAt: Timestamp.exactOptional(),
  /** Why the proposal couldn't be applied (a conflict, or fields no longer valid). */
  problem: Problem.exactOptional(),
});
export type Proposal = z.infer<typeof Proposal>;
