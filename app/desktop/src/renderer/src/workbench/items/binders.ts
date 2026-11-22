import { type BinderSummary, SETTINGS_FILE } from "@wombat/shared/items";

export type Binder = Extract<BinderSummary, { id: string }>;
export type BrokenBinder = Extract<BinderSummary, { id: null }>;

/** A broken binder's settings file, relative to the items root. */
export const settingsPath = ({ path }: BrokenBinder): string => (path === "" || path === "." ? SETTINGS_FILE : `${path}/${SETTINGS_FILE}`);

export const isBroken = (binder: BinderSummary): binder is BrokenBinder => binder.id === null;

/** Why a binder isn't listed by id: some binders are broken (one of them may be it), or none is. */
export type NoBinder = { kind: "binder-missing"; broken: BrokenBinder[] } | { kind: "binder-gone" };

export const withoutBinder = (binders: readonly BinderSummary[]): NoBinder => {
  const broken = binders.filter(isBroken);
  return broken.length > 0 ? { kind: "binder-missing", broken } : { kind: "binder-gone" };
};

/** The binder listed with `binderId`, else why it isn't (`NoBinder`). */
export const binderOf = (binderId: string, binders: readonly BinderSummary[]): { kind: "binder"; binder: Binder } | NoBinder => {
  const binder = binders.find((each): each is Binder => each.id === binderId);
  return binder === undefined ? withoutBinder(binders) : { kind: "binder", binder };
};
