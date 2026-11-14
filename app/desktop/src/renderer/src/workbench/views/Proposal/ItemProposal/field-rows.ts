import type { Item } from "@wombat/shared/items";
import type { ItemProposalKind } from "@wombat/shared/proposals";

type Fields = Readonly<Record<string, unknown>>;

/** One field of an item proposal as its tab shows it. */
export type FieldRow = {
  /** `title`, `body` or a property's name. */
  name: string;
  /** The item's value now (a link as its `{ id, handle }`); undefined on a create or where the item has none. */
  old: unknown;
  /** The agent's version's value (a link as its id); undefined on a delete. */
  proposed: unknown;
  /** My draft's value, when my draft holds the field. */
  mine?: unknown;
  editable: boolean;
  /** The agent's version sets it and my draft leaves it out. */
  dropped: boolean;
};

/** Title first and body last, the properties between in the order given. */
const ordered = (names: readonly string[]): string[] => {
  const properties = names.filter((name) => name !== "title" && name !== "body");
  return [...(names.includes("title") ? ["title"] : []), ...properties, ...(names.includes("body") ? ["body"] : [])];
};

const valueIn = (item: Item | null, name: string): unknown => {
  if (item === null) return undefined;
  if (name === "title") return item.title;
  if (name === "body") return item.body;
  return Object.hasOwn(item.properties, name) ? item.properties[name] : undefined;
};

/**
 * The rows of an item proposal: `item` as it is now (null for a create), `versionFields` the agent's version's fields,
 * `draftFields` my draft's while it holds any change of mine. A delete's rows are the item's own fields, read-only;
 * without `kind`, a proposal with an item and no fields is taken for one.
 */
export const fieldRows = (item: Item | null, versionFields: Fields, draftFields: Fields | undefined, kind?: ItemProposalKind): FieldRow[] => {
  const isDelete = kind === undefined ? item !== null && Object.keys(versionFields).length === 0 : kind === "delete";
  if (isDelete) {
    if (item === null) return [];
    return ordered(["title", "body", ...Object.keys(item.properties)]).map((name) => ({ name, old: valueIn(item, name), proposed: undefined, editable: false, dropped: false }));
  }
  const extra = draftFields === undefined ? [] : Object.keys(draftFields).filter((name) => !Object.hasOwn(versionFields, name));
  return ordered([...Object.keys(versionFields), ...extra]).map((name) => {
    const proposed = Object.hasOwn(versionFields, name) ? versionFields[name] : undefined;
    const held = draftFields !== undefined && Object.hasOwn(draftFields, name);
    return {
      name,
      old: valueIn(item, name),
      proposed,
      ...(held ? { mine: draftFields[name] } : {}),
      editable: true,
      dropped: draftFields !== undefined && Object.hasOwn(versionFields, name) && !held,
    };
  });
};
