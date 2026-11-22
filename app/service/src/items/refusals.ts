// The refusals an agent's call can get, and the checks of a change that need no read of the root: its level and
// its locked fields. The not_found texts name only what the agent typed, so a hidden name reads exactly like a
// missing one.
import { AccessErrorCode } from "@wombat/shared/api";
import { ITEM_FIELDS, type Problem } from "@wombat/shared/items";

import type { LoadedItem, ValidBinder } from "./catalog.ts";
import { TOOL } from "./tools.ts";
import { listed, type NewItem } from "./write.ts";

/** Why an agent's call was refused; the message says what to do next. */
export class AccessError extends Error {
  readonly code: AccessErrorCode;
  readonly problems: Problem[];

  constructor(code: AccessErrorCode, message: string, problems: Problem[] = []) {
    super(message);
    this.name = "AccessError";
    this.code = code;
    this.problems = problems;
  }
}

export type ItemInput = { title: string; body?: string; properties?: Record<string, unknown>; file?: string };

/** The tool of each family for each change. */
const CHANGE_TOOLS = {
  create: { edit: TOOL.createItem, propose: TOOL.proposeCreate },
  update: { edit: TOOL.updateItem, propose: TOOL.proposeUpdate },
  delete: { edit: TOOL.deleteItem, propose: TOOL.proposeDelete },
} as const;
export type Change = keyof typeof CHANGE_TOOLS;
export type Family = "edit" | "propose";

export const noItem = (handle: string) =>
  new AccessError(AccessErrorCode.enum.not_found, `No item has the handle ${handle}. Check it, or find the item with ${TOOL.search} or ${TOOL.listItems}.`);

export const noBinder = (id: string) =>
  new AccessError(AccessErrorCode.enum.not_found, `No binder has the id ${id}. Call ${TOOL.describeBinder} without a binder to see the ones you can use.`);

export const stale = (handle: string) =>
  new AccessError(AccessErrorCode.enum.stale_version, `${handle} changed since you read it (by hand or by another write). Re-read it with ${TOOL.getItem} and try again.`);

export const invalidFields = (message: string, problems: Problem[] = []) => new AccessError(AccessErrorCode.enum.invalid_fields, message, problems);

/** The one message of an `invalid_fields` refusal for its problems, so a scrubbed one can't be told apart by its shape. */
export const nothingChanged = (problems: Problem[]) => `Nothing was changed: ${listed(problems)}. Fix what's named, or ask the user to, and try again.`;

/** Refuses a change of the wrong family, or any change in a read binder, naming what to use instead. */
export const checkLevel = (binder: ValidBinder, family: Family, change: Change) => {
  const { access } = binder.settings;
  if (access === "read") {
    throw new AccessError(AccessErrorCode.enum.read_only, `${binder.id} is read-only for agents: its items can be read, never changed. Ask the user if it needs this change.`);
  }
  if (access === family) return;
  if (access === "propose") {
    throw new AccessError(
      AccessErrorCode.enum.use_propose,
      `${binder.id} takes proposals, not direct changes: use ${CHANGE_TOOLS[change].propose} with a reason, and the user approves or rejects it.`,
    );
  }
  throw new AccessError(AccessErrorCode.enum.use_edit, `${binder.id} is open to direct changes, so there's nothing to propose: use ${CHANGE_TOOLS[change].edit} instead.`);
};

/** The locked fields among those a change sets; a create always sets the title and body, so they never count. */
export const lockedNames = (binder: ValidBinder, kind: Change, names: string[]) =>
  names.filter((name) => (kind !== "create" || !ITEM_FIELDS.has(name)) && binder.settings.locked.includes(name));

/** Refuses a change touching a locked field, naming it. */
export const checkLocks = (binder: ValidBinder, kind: Change, names: string[]) => {
  const locked = lockedNames(binder, kind, names);
  if (locked.length === 0) return;
  const one = locked.length === 1;
  throw new AccessError(
    AccessErrorCode.enum.locked,
    `${locked.join(", ")} ${one ? "is" : "are"} locked in ${binder.id}: agents can't change ${one ? "it" : "them"}. Leave ${one ? "it" : "them"} out, or ask the user to make the change.`,
  );
};

/** The item to create from an agent's input, with `properties` as the writer takes them. */
export const newItem = (input: ItemInput, properties: Record<string, unknown>): NewItem => ({
  title: input.title,
  body: input.body ?? "",
  properties,
  ...(input.file === undefined ? {} : { file: input.file }),
});

/**
 * Refuses deleting an item without an id: a proposal names its item by id, so one without could never be
 * approved, and a direct delete answers the same. The writer refuses everything else a delete can't touch.
 */
export const checkHasId = (item: LoadedItem, handle: string) => {
  if (item.id !== null) return;
  const problems = [{ field: "id", message: "id: none yet; the service gives one once the file's problems are fixed" }];
  throw invalidFields(`${handle} has no id yet, so it can't be deleted. Ask the user to fix ${handle} by hand.`, problems);
};
