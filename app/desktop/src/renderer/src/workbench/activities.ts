// Importing this module registers the activities and the tabs' panels, in the toolbar's order.
import { LibraryBig } from "lucide-react";

import "../harnesses/claude/claude-ui.ts";
import { DESK_ACTIVITY } from "./activity-ids.ts";
import { registerOnce } from "../lib/register-once.ts";
import { registerActivity, registerPanel } from "./registry.ts";
import { NAVIGATOR_WIDTH } from "./shell/shell-state.ts";
import { Diff } from "./panels/Diff/Diff.tsx";
import { DIFF_TITLE, DIFF_PANEL, DiffParams, diffResolves, diffRestores } from "./panels/Diff/diff-params.ts";
import { Proposal } from "./panels/Proposal/Proposal.tsx";
import { PROPOSAL_TITLE, PROPOSAL_PANEL, ProposalParams, proposalResolves, proposalRestores } from "./proposals/proposal-params.ts";
import { Desk } from "./panels/Desk/Desk.tsx";
import { Item } from "./panels/Item/Item.tsx";
import { ITEM_PANEL, ITEM_TITLE, ItemParams, itemTabSaved } from "./items/item-params.ts";
import { DEFAULT_DESK, DeskLayout } from "./items/navigation/desk-layout.ts";

const register = (): void => {
  registerPanel({
    id: DIFF_PANEL,
    // The panel reports "<file name> (diff)" once it has read the request (the agents list doesn't name the file).
    title: DIFF_TITLE,
    wants: 800,
    component: Diff,
    paramsSchema: DiffParams,
    resolves: diffResolves,
    restores: diffRestores,
  });

  registerPanel({
    id: PROPOSAL_PANEL,
    // The panel reports the proposal's label once it has read the proposal.
    title: PROPOSAL_TITLE,
    wants: 800,
    component: Proposal,
    paramsSchema: ProposalParams,
    resolves: proposalResolves,
    restores: proposalRestores,
  });

  registerActivity({
    id: DESK_ACTIVITY,
    title: "Desk",
    icon: LibraryBig,
    navigator: { component: Desk, wants: 280 },
    state: { schema: DeskLayout, initial: DEFAULT_DESK },
  });
  registerPanel({
    id: ITEM_PANEL,
    // The panel reports the item's handle and title once it has read the item.
    title: ITEM_TITLE,
    activity: DESK_ACTIVITY,
    wants: NAVIGATOR_WIDTH + 280,
    component: Item,
    paramsSchema: ItemParams,
    saves: itemTabSaved,
  });
};

registerOnce(import.meta.hot, register);
