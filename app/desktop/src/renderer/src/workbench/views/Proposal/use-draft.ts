import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { canDraft, type ProposalDetail } from "@wombat/shared/proposals";
import { type DraftBody, useDraft } from "../../../data/commands.ts";
import { keys } from "../../../data/keys.ts";
import { proposalVersionQuery } from "../../../data/query-client.ts";
import { asError } from "../../../lib/errors.ts";
import { fileSide } from "./proposal-label.ts";
import {
  contentOf,
  type DraftEvent,
  type DraftKey,
  draftSave,
  draftStep,
  itemDraft,
  type DraftRead,
  type DraftSave,
  type DraftState,
  type DraftValues,
  type ReviseNotice,
  type SaveError,
  type SaveOutcome,
  shownVersion,
  valueIn,
} from "./draft-state.ts";

/** How long after the last change my text is saved. */
export const SAVE_DELAY_MS = 800;

/** What a draft of one kind takes from the proposal it edits, and its reducer and save from draft-state.ts. */
type DraftSource<K extends DraftKey> = {
  key: K;
  /** The content of a detail of this kind; undefined for another target. */
  valueOf: (detail: ProposalDetail) => DraftValues[K] | undefined;
  step: (state: DraftState<K> | undefined, event: DraftEvent<K>) => DraftState<K> | undefined;
  /** The save of my unsaved value on `theirs`; undefined when nothing is unsaved or `detail` isn't of this kind. */
  save: (state: DraftState<K>, theirs: DraftValues[K], detail: ProposalDetail) => DraftSave<K> | undefined;
  body: (value: DraftValues[K]) => DraftBody;
};

const FILE: DraftSource<"text"> = {
  key: "text",
  valueOf: (detail) => (detail.target === "file" ? detail.text : undefined),
  step: draftStep,
  save: (state, theirs, detail) => (detail.target === "file" ? draftSave(state, theirs, fileSide(detail)) : undefined),
  body: (text) => ({ text }),
};

const ITEM: DraftSource<"fields"> = {
  key: "fields",
  valueOf: (detail) => (detail.target === "item" ? detail.fields : undefined),
  step: itemDraft.step,
  save: (state, theirs, detail) => (detail.target === "item" ? itemDraft.save(state, theirs) : undefined),
  body: (fields) => ({ fields }),
};

export type DraftEditor<V> = {
  /** The value the editor shows when it (re)mounts, undefined until the proposal is read. */
  value: V | undefined;
  notice: ReviseNotice | undefined;
  /** The editor's whole value, after each change. */
  onChange: (value: V) => void;
  /**
   * Saves my pending value now, after any save under way, and answers the version to approve: my draft's after a
   * save, else the current one. Undefined when the save failed (`error` says why) or the agent revised meanwhile.
   */
  flush: (byApprove: boolean) => Promise<number | undefined>;
  error: SaveError | undefined;
};

const useDraftOf = <K extends DraftKey>(source: DraftSource<K>, proposalId: string, proposal: ProposalDetail | undefined): DraftEditor<DraftValues[K]> => {
  const { key, valueOf, step, body } = source;
  const queryClient = useQueryClient();
  const { mutateAsync } = useDraft();
  // The saves read the state between their awaits, so it lives in a ref; the copy in React state renders it.
  const state = useRef<DraftState<K> | undefined>(undefined);
  const [rendered, setRendered] = useState<DraftState<K>>();
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const dispatch = useCallback(
    (event: DraftEvent<K>) => {
      state.current = step(state.current, event);
      setRendered(state.current);
    },
    [step],
  );

  const stopTimer = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  useEffect(() => {
    const value = proposal === undefined ? undefined : valueOf(proposal);
    if (proposal === undefined || value === undefined) return;
    if (!canDraft(proposal.status)) stopTimer();
    const read = { version: proposal.version, versions: proposal.versions, ...contentOf(key, value) } as DraftRead<K>;
    dispatch({ type: "read", read });
  }, [proposal, dispatch, key, valueOf]);

  /** The value of the agent's version my value goes on; undefined when that version isn't of this kind. */
  const agentValue = useCallback(
    async (at: DraftState<K>): Promise<DraftValues[K] | undefined> => {
      if (at.loaded.version === at.base) return at.loaded.value;
      return valueOf(await queryClient.fetchQuery(proposalVersionQuery(proposalId, at.base)));
    },
    [queryClient, proposalId, valueOf],
  );

  const send = useCallback(
    async (save: DraftSave<K>, at: DraftState<K>, byApprove: boolean): Promise<SaveOutcome> => {
      if (save.action === "none") return { version: shownVersion(at) };
      try {
        const after = await mutateAsync(
          save.action === "save" ? { proposalId, action: "save", onVersion: save.onVersion, body: body(valueIn(key, save)) } : { proposalId, action: "clear" },
        );
        return after === "changed" ? after : { version: after.version };
      } catch (failed) {
        return { error: asError(failed), byApprove };
      }
    },
    [proposalId, mutateAsync, key, body],
  );

  const save = useCallback(
    async (byApprove: boolean): Promise<number | undefined> => {
      const read = queryClient.getQueryData<ProposalDetail>(keys.proposal(proposalId));
      const at = state.current;
      if (at === undefined || read === undefined || valueOf(read) === undefined) return read?.version;
      if (at.unsaved === undefined || !canDraft(read.status)) return shownVersion(at);
      let theirs: DraftValues[K] | undefined;
      try {
        theirs = await agentValue(at);
      } catch (failed) {
        dispatch({ type: "failed", error: { error: asError(failed), byApprove } });
        return undefined;
      }
      const now = state.current;
      if (now?.generation !== at.generation || theirs === undefined) return undefined;
      const next = source.save(now, theirs, read);
      if (next === undefined) return shownVersion(now);
      dispatch({ type: "sent", save: next });
      const outcome = await send(next, now, byApprove);
      dispatch({ type: "answered", save: next, outcome });
      return typeof outcome === "object" && "version" in outcome && state.current?.generation === next.generation ? outcome.version : undefined;
    },
    [queryClient, proposalId, agentValue, send, dispatch, valueOf, source],
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
    (value: DraftValues[K]) => {
      dispatch({ type: "typed", ...contentOf(key, value) });
      stopTimer();
      timer.current = window.setTimeout(() => void flush(false), SAVE_DELAY_MS);
    },
    [dispatch, flush, key],
  );

  // Closing the tab saves what's still waiting for the delay.
  useEffect(
    () => () => {
      if (timer.current !== undefined) void flush(false);
    },
    [flush],
  );

  return { value: rendered?.seed, notice: rendered?.notice, onChange, flush, error: rendered?.error };
};

/** A file proposal's editable text: what the editor shows, my edits saved as my draft, and the reads that may replace them. */
export const useDraftEditor = (proposalId: string, proposal: ProposalDetail | undefined): DraftEditor<string> =>
  useDraftOf(FILE, proposalId, proposal?.target === "file" ? proposal : undefined);

/** An item proposal's editable fields, saved as my draft like a file's text. */
export const useItemDraft = (proposalId: string, proposal: ProposalDetail | undefined): DraftEditor<Record<string, unknown>> =>
  useDraftOf(ITEM, proposalId, proposal?.target === "item" ? proposal : undefined);
