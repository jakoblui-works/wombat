// Which of a permission request's options the chat offers as Approve, as Reject and as the rest, and how an answer
// reads once given. Pure: the chat's cards and the diff tab both use it.
import type { ChatItem } from "../../../data/chat-model.ts";

type PermissionItem = Extract<ChatItem, { kind: "permission" }>;

export type PermissionOption = PermissionItem["options"][number];

/** The request's options as buttons: the one Approve, the one Reject, and the rest (secondary) by name. */
export type PermissionButtons = { approve?: PermissionOption; reject?: PermissionOption; others: PermissionOption[] };

/** The narrowest option of a side: its `_once` kind, else the first of that side. */
const narrowest = (options: readonly PermissionOption[], side: "allow" | "reject"): PermissionOption | undefined =>
  options.find(({ kind }) => kind === `${side}_once`) ?? options.find(({ kind }) => kind.startsWith(`${side}_`));

export const permissionButtons = (options: readonly PermissionOption[]): PermissionButtons => {
  const approve = narrowest(options, "allow");
  const reject = narrowest(options, "reject");
  const others = options.filter((option) => option !== approve && option !== reject).sort((a, b) => a.name.localeCompare(b.name));
  return { ...(approve === undefined ? {} : { approve }), ...(reject === undefined ? {} : { reject }), others };
};

/** How an answered or cancelled request reads in place of its buttons. */
export const ANSWER_LABELS: Readonly<Record<NonNullable<PermissionItem["answer"]>, string>> = {
  allow_once: "Approved once",
  allow_always: "Approved always",
  reject_once: "Rejected",
  reject_always: "Rejected always",
  cancelled: "Cancelled",
};
