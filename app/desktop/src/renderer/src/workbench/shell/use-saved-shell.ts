import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { ListAgentsResponse } from "@wombat/shared/api";
import type { ListProposalsResponse } from "@wombat/shared/proposals";
import type { ConnectionState } from "../../../../shared/bridge.ts";
import { useAgents, useProposals } from "../../data/hooks.ts";
import { keys } from "../../data/keys.ts";
import { isRestorable, isSaved } from "../registry.ts";
import { readAnswered, type ShellSaver, shellSaver } from "./shell-saver.ts";
import { restoredShell, type SavedShell, savedShell } from "./shell-state.ts";
import { useShell } from "./ShellProvider.tsx";

/** The settings' saved shell once read; `readable: false` when they couldn't be read (nothing is saved then). */
type SavedRead = { raw: unknown; readable: boolean };

/**
 * Restores the saved shell once, after the agents and proposals reads were answered (so tabs of deleted agents and
 * decided proposals stay out), and saves it after each change from then on. True once restored.
 */
export const useSavedShell = (connection: ConnectionState["state"]): boolean => {
  const queryClient = useQueryClient();
  const { state, change } = useShell();
  const agents = useAgents();
  const proposals = useProposals();
  const [read, setRead] = useState<SavedRead>();
  const [restored, setRestored] = useState<SavedShell>();

  useEffect(() => {
    let live = true;
    window.wombat.settings.get().then(
      (settings) => live && setRead({ raw: settings.shell, readable: true }),
      (error: unknown) => {
        console.warn("Wombat couldn't read its settings; the window opens as the default and isn't saved:", error);
        if (live) setRead({ raw: undefined, readable: false });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (read === undefined || restored !== undefined) return;
    // The cache's state, not the render's: a re-read starts the moment the connection is back.
    const agentsState = queryClient.getQueryState<ListAgentsResponse>(keys.agents);
    const proposalsState = queryClient.getQueryState<ListProposalsResponse>(keys.proposals);
    if (!readAnswered(agentsState, connection) || !readAnswered(proposalsState, connection)) return;
    const shell = restoredShell(read.raw, isRestorable({ agents: agentsState?.data?.agents, proposals: proposalsState?.data?.proposals }));
    change(() => shell);
    setRestored(savedShell(shell, isSaved));
  }, [read, restored, queryClient, connection, change, agents.status, agents.fetchStatus, proposals.status, proposals.fetchStatus]);

  const saver = useRef<ShellSaver | undefined>(undefined);
  useEffect(() => {
    if (restored === undefined || read?.readable !== true) return;
    const current = shellSaver(restored, (shell) => {
      window.wombat.settings.set({ shell }).catch(() => {
        console.warn("Wombat couldn't save the window's layout.");
      });
    });
    saver.current = current;
    // A quit or reload unloads the page: the pending save is written now, and none from then on.
    const unloading = () => current.flush();
    window.addEventListener("beforeunload", unloading);
    return () => {
      window.removeEventListener("beforeunload", unloading);
      current.stop();
      if (saver.current === current) saver.current = undefined;
    };
  }, [restored, read]);

  useEffect(() => saver.current?.offer(savedShell(state, isSaved)), [state]);

  return restored !== undefined;
};
