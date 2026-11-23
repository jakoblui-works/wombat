import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAgents, useWorkspaces } from "../../../data/hooks.ts";
import { useOpenAgentChat } from "../../agents/open-agent-chat.ts";
import { readBinders, readItemAfresh, useItemNavigation } from "../../items/navigation/item-navigation.ts";
import { useOpenProposal } from "../../proposals/use-open-proposal.ts";
import { hideNavigator, showWorkspace, shownView, type ShownView } from "../../shell/shell-state.ts";
import { useShell } from "../../shell/ShellProvider.tsx";
import type { NeedsMeRow } from "./needs-me-rows.ts";
import { type ItemOpen, itemOpen, lateOpen, type RowTarget, rowTarget } from "./row-target.ts";

type Open = ReturnType<typeof itemOpen>;

type Click = { clicked: ShownView };

type Pending = { click: Click; open: Open };

/** An item target once its workspace's binders and the item (read afresh by handle) are read. */
const readItemTarget = async (queryClient: QueryClient, target: Extract<RowTarget, { open: "item" }>): Promise<Open> => {
  const [binders, item] = await Promise.all([
    readBinders(queryClient, target.workspace),
    readItemAfresh(queryClient, target.workspace, target.handle).catch(() => undefined),
  ]);
  return itemOpen(target, binders, item?.id ?? undefined);
};

/**
 * Opens a row where it is decided (`rowTarget`), showing its workspace first. An item target opens once its reads are
 * back, only if it is still the latest row clicked and the shell still shows what the click left (`lateOpen`).
 */
export const useOpenRow = (): ((row: NeedsMeRow) => void) => {
  const queryClient = useQueryClient();
  const { state, change } = useShell();
  const agents = useAgents().data?.agents;
  const workspaces = useWorkspaces().data?.workspaces;
  const { showItem } = useItemNavigation();
  const openProposal = useOpenProposal();
  const openAgentChat = useOpenAgentChat();
  const stateRef = useRef(state);
  stateRef.current = state;
  const latest = useRef<Click>(undefined);
  const settled = useRef<Pending>(undefined);
  const [pending, setPending] = useState<Pending>();

  const openItem = useCallback(
    (open: ItemOpen) => {
      change((current) => hideNavigator(current, open.workspace, false));
      showItem({ ws: open.workspace, binderId: open.binderId, itemId: open.itemId }, open.proposalId);
    },
    [change, showItem],
  );

  useEffect(() => {
    if (pending === undefined || settled.current === pending) return;
    const step = pending.click === latest.current ? lateOpen(pending.click.clicked, shownView(state, agents, workspaces)) : "drop";
    if (step === "wait") return;
    settled.current = pending;
    if (step === "drop") return;
    const { open } = pending;
    if (open.open === "item") openItem(open);
    else openProposal(open.proposalId, { workspace: open.workspace });
  }, [pending, state, agents, workspaces, openItem, openProposal]);

  return useCallback(
    (row: NeedsMeRow) => {
      const target = rowTarget(row);
      if (target.open === "chat") {
        latest.current = undefined;
        openAgentChat(target.agentId, target.requestId);
        return;
      }
      change((current) => showWorkspace(current, target.workspace, agents, workspaces));
      if (target.open === "proposal") {
        latest.current = undefined;
        openProposal(target.proposalId, { workspace: target.workspace });
        return;
      }
      // The click's own update applies on the next render: the snapshot is what it will leave shown.
      const click: Click = { clicked: shownView(showWorkspace(stateRef.current, target.workspace, agents, workspaces), agents, workspaces) };
      latest.current = click;
      void readItemTarget(queryClient, target).then((open) => {
        if (latest.current === click) setPending({ click, open });
      });
    },
    [queryClient, change, agents, workspaces, openAgentChat, openProposal],
  );
};
