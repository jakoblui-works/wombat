import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAgents, useWorkspaces } from "../../../data/hooks.ts";
import { useOpenAgentChat } from "../../agents/open-agent-chat.ts";
import { readBinders, readItemAfresh, startNavigation, useItemNavigation } from "../../items/navigation/item-navigation.ts";
import { useOpenProposal } from "../../proposals/use-open-proposal.ts";
import { hideNavigator, showWorkspace } from "../../shell/shell-state.ts";
import { useShell, useShownWorkspace } from "../../shell/ShellProvider.tsx";
import type { NeedsMeRow } from "./needs-me-rows.ts";
import { type ItemOpen, itemOpen, lateOpen, type RowTarget, rowTarget } from "./row-target.ts";

type Open = ReturnType<typeof itemOpen>;

type Pending = { isLatest: () => boolean; open: Open };

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
 * back, only while that workspace is still shown and no later navigation started.
 */
export const useOpenRow = (): ((row: NeedsMeRow) => void) => {
  const queryClient = useQueryClient();
  const { change } = useShell();
  const shown = useShownWorkspace()?.id;
  const agents = useAgents().data?.agents;
  const workspaces = useWorkspaces().data?.workspaces;
  const { showItem } = useItemNavigation();
  const openProposal = useOpenProposal();
  const openAgentChat = useOpenAgentChat();
  const settled = useRef<Pending>(undefined);
  const [pending, setPending] = useState<Pending>();

  const openItem = useCallback(
    (open: ItemOpen) => {
      change((state) => hideNavigator(state, open.workspace, false));
      showItem({ ws: open.workspace, binderId: open.binderId, itemId: open.itemId }, open.proposalId);
    },
    [change, showItem],
  );

  useEffect(() => {
    if (pending === undefined || settled.current === pending || !pending.isLatest()) return;
    const { open } = pending;
    const step = lateOpen(open.workspace, shown);
    if (step === "wait") return;
    settled.current = pending;
    if (step === "drop") return;
    if (open.open === "item") openItem(open);
    else openProposal(open.proposalId, { workspace: open.workspace });
  }, [pending, shown, openItem, openProposal]);

  return useCallback(
    (row: NeedsMeRow) => {
      const target = rowTarget(row);
      const isLatest = startNavigation();
      if (target.open === "chat") {
        openAgentChat(target.agentId, target.requestId);
        return;
      }
      change((state) => showWorkspace(state, target.workspace, agents, workspaces));
      if (target.open === "proposal") {
        openProposal(target.proposalId, { workspace: target.workspace });
        return;
      }
      void readItemTarget(queryClient, target).then((open) => {
        if (isLatest()) setPending({ isLatest, open });
      });
    },
    [queryClient, change, agents, workspaces, openAgentChat, openProposal],
  );
};
