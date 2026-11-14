import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { canDraft, type ProposalDetail } from "@wombat/shared/proposals";
import { useDraft } from "../../../data/commands.ts";
import { keys } from "../../../data/keys.ts";
import { proposalVersionQuery } from "../../../data/query-client.ts";
import { asError } from "../../../lib/errors.ts";
import { type DraftEvent, type DraftSave, draftSave, type DraftState, draftStep, type ReviseNotice, type SaveError, type SaveOutcome, shownVersion } from "./draft-state.ts";

/** How long after the last change my text is saved. */
export const SAVE_DELAY_MS = 800;

type FileDetail = Extract<ProposalDetail, { target: "file" }>;

export type DraftEditor = {
  /** The text the editor shows when it (re)mounts, undefined until the proposal is read. */
  text: string | undefined;
  notice: ReviseNotice | undefined;
  /** The editor's whole right-side text, after each change. */
  onChange: (text: string) => void;
  /**
   * Saves my pending text now, after any save under way, and answers the version to approve: my draft's after a
   * save, else the current one. Undefined when the save failed (`error` says why) or the agent revised meanwhile.
   */
  flush: (byApprove: boolean) => Promise<number | undefined>;
  error: SaveError | undefined;
};

/** A file proposal's editable text: what the editor shows, my edits saved as my draft, and the reads that may replace them. */
export const useDraftEditor = (proposalId: string, proposal: FileDetail | undefined): DraftEditor => {
  const queryClient = useQueryClient();
  const { mutateAsync } = useDraft();
  // The saves read the state between their awaits, so it lives in a ref; the copy in React state renders it.
  const state = useRef<DraftState | undefined>(undefined);
  const [rendered, setRendered] = useState<DraftState>();
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const dispatch = useCallback((event: DraftEvent) => {
    state.current = draftStep(state.current, event);
    setRendered(state.current);
  }, []);

  const stopTimer = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  useEffect(() => {
    if (proposal === undefined) return;
    if (!canDraft(proposal.status)) stopTimer();
    dispatch({ type: "read", read: proposal });
  }, [proposal, dispatch]);

  /** The text of the agent's version my text goes on; undefined when that version isn't a file's. */
  const agentText = useCallback(
    async (at: DraftState): Promise<string | undefined> => {
      if (at.loaded.version === at.base) return at.loaded.text;
      const version = await queryClient.fetchQuery(proposalVersionQuery(proposalId, at.base));
      return version.target === "file" ? version.text : undefined;
    },
    [queryClient, proposalId],
  );

  const send = useCallback(
    async (save: DraftSave, at: DraftState, byApprove: boolean): Promise<SaveOutcome> => {
      if (save.action === "none") return { version: shownVersion(at) };
      try {
        const after = await mutateAsync(save.action === "save" ? { proposalId, action: "save", onVersion: save.onVersion, text: save.text } : { proposalId, action: "clear" });
        return after === "changed" ? after : { version: after.version };
      } catch (failed) {
        return { error: asError(failed), byApprove };
      }
    },
    [proposalId, mutateAsync],
  );

  const save = useCallback(
    async (byApprove: boolean): Promise<number | undefined> => {
      const read = queryClient.getQueryData<ProposalDetail>(keys.proposal(proposalId));
      const at = state.current;
      if (at === undefined || read?.target !== "file") return read?.version;
      if (at.unsaved === undefined || !canDraft(read.status)) return shownVersion(at);
      let theirs: string | undefined;
      try {
        theirs = await agentText(at);
      } catch (failed) {
        dispatch({ type: "failed", error: { error: asError(failed), byApprove } });
        return undefined;
      }
      const now = state.current;
      if (now?.generation !== at.generation || theirs === undefined) return undefined;
      const next = draftSave(now, theirs, read.kind === "create" ? "" : (read.current ?? ""));
      if (next === undefined) return shownVersion(now);
      dispatch({ type: "sent", save: next });
      const outcome = await send(next, now, byApprove);
      dispatch({ type: "answered", save: next, outcome });
      return typeof outcome === "object" && "version" in outcome && state.current?.generation === next.generation ? outcome.version : undefined;
    },
    [queryClient, proposalId, agentText, send, dispatch],
  );

  const flush = useCallback(
    (byApprove: boolean): Promise<number | undefined> => {
      stopTimer();
      const run = chain.current.then(() => save(byApprove));
      chain.current = run;
      return run;
    },
    [save],
  );

  const onChange = useCallback(
    (text: string) => {
      dispatch({ type: "typed", text });
      stopTimer();
      timer.current = window.setTimeout(() => void flush(false), SAVE_DELAY_MS);
    },
    [dispatch, flush],
  );

  // Closing the tab saves what's still waiting for the delay.
  useEffect(
    () => () => {
      if (timer.current !== undefined) void flush(false);
    },
    [flush],
  );

  return { text: rendered?.seed, notice: rendered?.notice, onChange, flush, error: rendered?.error };
};
