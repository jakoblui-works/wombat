import type { BinderSummary } from "@wombat/shared/items";

import { binderOf } from "../../items/binders.ts";
import { sameView, type ShownView } from "../../shell/shell-state.ts";
import type { NeedsMeRow } from "./needs-me-rows.ts";

export type RowTarget =
  | { open: "chat"; workspace: string; agentId: string; requestId: string | undefined }
  | { open: "item"; workspace: string; binderId: string; handle: string; proposalId: string }
  | { open: "proposal"; workspace: string; proposalId: string };

/** Where a row opens: a request at its agent's chat, a change or delete of an item at the item, any other proposal in its tab. */
export const rowTarget = (row: NeedsMeRow): RowTarget => {
  if (row.type === "request") return { open: "chat", workspace: row.workspace, agentId: row.agentId, requestId: row.requestId };
  const { proposal } = row;
  if (proposal.target === "item" && proposal.kind !== "create" && proposal.handle !== null) {
    return { open: "item", workspace: row.workspace, binderId: proposal.binder, handle: proposal.handle, proposalId: proposal.id };
  }
  return { open: "proposal", workspace: row.workspace, proposalId: proposal.id };
};

/**
 * What an open waiting on its reads does once they're back: wait while no workspace is shown, open while the shell
 * shows what the click left (`clicked`), else drop.
 */
export const lateOpen = (clicked: ShownView, now: ShownView): "wait" | "open" | "drop" =>
  now.workspace === undefined ? "wait" : sameView(clicked, now) ? "open" : "drop";

export type ItemOpen = { open: "item"; workspace: string; binderId: string; itemId: string; proposalId: string };

/**
 * An item target once its workspace's binders and the item are read: the item, or its proposal's tab when the binder
 * isn't usable or the item can't be found (undefined: not read).
 */
export const itemOpen = (
  target: Extract<RowTarget, { open: "item" }>,
  binders: readonly BinderSummary[] | undefined,
  itemId: string | undefined,
): ItemOpen | Extract<RowTarget, { open: "proposal" }> =>
  binders === undefined || itemId === undefined || binderOf(target.binderId, binders).kind !== "binder"
    ? { open: "proposal", workspace: target.workspace, proposalId: target.proposalId }
    : { open: "item", workspace: target.workspace, binderId: target.binderId, itemId, proposalId: target.proposalId };
