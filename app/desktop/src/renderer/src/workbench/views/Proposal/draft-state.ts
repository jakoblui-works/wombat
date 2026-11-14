import { draftBase, myDraft, type ProposalVersion } from "@wombat/shared/proposals";

import { draftAction } from "./draft-action.ts";
import { keepLineEndings } from "./line-endings.ts";

/**
 * After the agent revised what I was editing: `draft`, the version holding my saved edits, now a previous one
 * (undefined when there is none); `lost`, whether edits past it (typed, or on their way to be saved) were dropped.
 */
export type ReviseNotice = { draft: number | undefined; lost: boolean };

/** Who asked for the save that failed: Approve, which then approved nothing, or the save as I type (or close the tab). */
export type SaveError = { error: Error; byApprove: boolean };

export type DraftRead = { version: number; text: string; versions: readonly Pick<ProposalVersion, "n" | "by">[] };

/** The draft editor's state; texts the editor gives are in its own line endings, texts saved in the file's. */
export type DraftState = {
  /** What the editor shows when it (re)mounts: my latest text, else the text last loaded. */
  seed: string;
  /** The version last loaded into the editor: saved text takes its line endings from it. */
  loaded: { version: number; text: string };
  /** The agent's version the editor's text goes on. */
  base: number;
  /** My draft on `base` as the service holds it. */
  saved: { version: number; text: string } | undefined;
  /** The editor's text sent to be saved and not answered yet (`raw`), and the text sent for it. */
  inFlight: { raw: string; text: string } | undefined;
  /** The editor's text typed since the last send. */
  unsaved: string | undefined;
  /** The highest version number read or answered: a read up to it holds nothing new. */
  seen: number;
  /** Bumped by each load: a save answering after it no longer speaks for the editor's text. */
  generation: number;
  notice: ReviseNotice | undefined;
  error: SaveError | undefined;
};

/** One save of my text: "save" puts `text` on `onVersion`, "clear" drops my draft, "none" sends nothing. */
export type DraftSave = { generation: number; raw: string; text: string; action: "save" | "clear" | "none"; onVersion: number };

export type SaveOutcome = { version: number } | "changed" | SaveError;

export type DraftEvent =
  | { type: "read"; read: DraftRead }
  | { type: "typed"; text: string }
  | { type: "sent"; save: DraftSave }
  | { type: "answered"; save: DraftSave; outcome: SaveOutcome }
  /** A save that failed before anything was sent. */
  | { type: "failed"; error: SaveError };

/** The version the editor's text stands for: my saved draft's, else the agent's it goes on. */
export const shownVersion = (state: DraftState): number => state.saved?.version ?? state.base;

/**
 * The save my unsaved text needs, undefined when nothing is unsaved. `theirs` is the text of the agent's version
 * `state.base`; `file` the file's text now (a dropped hunk brings its line endings back).
 */
export const draftSave = (state: DraftState, theirs: string, file: string): DraftSave | undefined => {
  if (state.unsaved === undefined) return undefined;
  const text = keepLineEndings(state.loaded.text, state.unsaved, file);
  return { generation: state.generation, raw: state.unsaved, text, action: draftAction(theirs, text, state.saved?.text), onVersion: state.base };
};

const load = (state: DraftState | undefined, read: DraftRead, notice: ReviseNotice | undefined): DraftState => ({
  seed: read.text,
  loaded: { version: read.version, text: read.text },
  base: draftBase(read.versions) ?? read.version,
  saved: myDraft(read.versions) === undefined ? undefined : { version: read.version, text: read.text },
  inFlight: undefined,
  unsaved: undefined,
  seen: Math.max(state?.seen ?? 0, read.version),
  generation: (state?.generation ?? 0) + 1,
  notice,
  error: undefined,
});

/**
 * What a revise drops. A draft of mine past every version seen is my text in flight, saved before the revise; text
 * in flight with no such draft reached the service after the revise, which refuses it.
 */
const reviseNotice = (state: DraftState, read: DraftRead): ReviseNotice | undefined => {
  const kept = read.versions.findLast(({ n, by }) => by === "me" && n > state.base && n < read.version);
  const landed = kept !== undefined && kept.n > state.seen;
  const lost = state.unsaved !== undefined || (state.inFlight !== undefined && !landed);
  return kept === undefined && !lost ? undefined : { draft: kept?.n, lost };
};

/**
 * A read older than what's known changes nothing. A new agent version replaces the editor's text, with a notice of
 * what's kept. A new version of mine (another tab's save, or mine read before its answer) never replaces text not
 * saved yet, and is loaded only when it isn't the text the editor holds.
 */
const onRead = (state: DraftState | undefined, read: DraftRead): DraftState => {
  if (state === undefined) return load(undefined, read, undefined);
  if (read.version <= state.seen) return state;
  if (read.versions.find(({ n }) => n === read.version)?.by === "agent") return load(state, read, reviseNotice(state, read));
  const mine = { version: read.version, text: read.text };
  if (state.inFlight?.text === read.text) return { ...state, inFlight: undefined, saved: mine, seen: read.version };
  if (state.unsaved !== undefined || state.inFlight !== undefined) return state;
  if (state.saved?.text === read.text) return { ...state, saved: mine, seen: read.version };
  return load(state, read, undefined);
};

const onAnswered = (state: DraftState, save: DraftSave, outcome: SaveOutcome): DraftState => {
  if (save.generation !== state.generation) {
    return outcome === "changed" && state.notice !== undefined ? { ...state, notice: { ...state.notice, lost: true } } : state;
  }
  const notSaved = state.unsaved ?? state.inFlight?.raw;
  if (outcome === "changed") return { ...state, inFlight: undefined, unsaved: notSaved, error: undefined };
  if ("error" in outcome) return { ...state, inFlight: undefined, unsaved: notSaved, error: outcome };
  const saved = save.action === "save" ? { version: outcome.version, text: save.text } : save.action === "clear" ? undefined : state.saved;
  return {
    ...state,
    inFlight: undefined,
    saved,
    seen: Math.max(state.seen, outcome.version),
    notice: save.action === "none" ? state.notice : undefined,
    error: undefined,
  };
};

/** The draft editor's next state; undefined until the proposal is first read. */
export const draftStep = (state: DraftState | undefined, event: DraftEvent): DraftState | undefined => {
  if (event.type === "read") return onRead(state, event.read);
  if (state === undefined) return state;
  switch (event.type) {
    case "typed":
      return { ...state, unsaved: event.text, seed: event.text };
    case "sent":
      if (event.save.generation !== state.generation) return state;
      return { ...state, inFlight: { raw: event.save.raw, text: event.save.text }, unsaved: state.unsaved === event.save.raw ? undefined : state.unsaved };
    case "answered":
      return onAnswered(state, event.save, event.outcome);
    case "failed":
      return { ...state, error: event.error };
  }
};
