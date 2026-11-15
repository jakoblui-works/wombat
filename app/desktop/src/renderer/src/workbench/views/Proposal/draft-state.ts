import { draftBase, myDraft, type ProposalVersion, sameAsAgents } from "@wombat/shared/proposals";

import { contentAction, draftAction, type DraftComparable } from "./draft-action.ts";
import { keepLineEndings } from "./line-endings.ts";

/** A draft's value by its kind: a file's whole text, or an item's fields (field name → value, links as ids). */
export type DraftValues = { text: string; fields: Record<string, unknown> };
export type DraftKey = keyof DraftValues;
/** A version's content as the service holds and a draft saves it: `{ text }` or `{ fields }`. */
export type DraftContent<K extends DraftKey> = Pick<DraftValues, K>;

/**
 * After the agent revised what I was editing: `draft`, the version holding my saved edits, now a previous one
 * (undefined when there is none); `lost`, whether edits past it (typed, or on their way to be saved) were dropped. With
 * no edits of mine to keep or lose, `version`: the agent's new version the editor now shows.
 */
export type ReviseNotice = { draft: number | undefined; lost: boolean } | { version: number };

/** Who asked for the save that failed: Approve, which then approved nothing, or the save as I type (or close the tab). */
export type SaveError = { error: Error; byApprove: boolean };

export type DraftRead<K extends DraftKey = "text"> = { version: number; versions: readonly Pick<ProposalVersion, "n" | "by">[] } & DraftContent<K>;

type Value<K extends DraftKey> = DraftValues[K];

/** The draft editor's state; a file's texts the editor gives are in its own line endings, texts saved in the file's. */
export type DraftState<K extends DraftKey = "text"> = {
  /** What the editor shows when it (re)mounts: my latest value, else the value last loaded. */
  seed: Value<K>;
  /** The version last loaded into the editor: a file's saved text takes its line endings from it. */
  loaded: { version: number; value: Value<K> };
  /** The agent's version the editor's value goes on. */
  base: number;
  /** My draft on `base` as the service holds it. */
  saved: { version: number; value: Value<K> } | undefined;
  /** The editor's value sent to be saved and not answered yet (`raw`), and the value sent for it. */
  inFlight: { raw: Value<K>; value: Value<K> } | undefined;
  /** The editor's value changed since the last send. */
  unsaved: Value<K> | undefined;
  /** The highest version number read or answered: a read up to it holds nothing new. */
  seen: number;
  /** Bumped by each load: a save answering after it no longer speaks for the editor's value. */
  generation: number;
  notice: ReviseNotice | undefined;
  error: SaveError | undefined;
};

/** One save of my value: "save" puts the content on `onVersion`, "clear" drops my draft, "none" sends nothing. */
export type DraftSave<K extends DraftKey = "text"> = {
  generation: number;
  raw: Value<K>;
  action: "save" | "clear" | "none";
  onVersion: number;
} & DraftContent<K>;

export type SaveOutcome = { version: number } | "changed" | SaveError;

export type DraftEvent<K extends DraftKey = "text"> =
  | { type: "read"; read: DraftRead<K> }
  | ({ type: "typed" } & DraftContent<K>)
  | { type: "sent"; save: DraftSave<K> }
  | { type: "answered"; save: DraftSave<K>; outcome: SaveOutcome }
  /** A save that failed before anything was sent. */
  | { type: "failed"; error: SaveError };

/** The version the editor's value stands for: my saved draft's, else the agent's it goes on. */
export const shownVersion = (state: Pick<DraftState<DraftKey>, "saved" | "base">): number => state.saved?.version ?? state.base;

/** The value of the agent's version my value goes on, when it is the one last loaded; undefined otherwise. */
export const agentsLoaded = <K extends DraftKey>(state: DraftState<K>): Value<K> | undefined =>
  state.loaded.version === state.base ? state.loaded.value : undefined;

/** Whether the editor holds a value not saved yet: typed since the last send, or sent and not answered. */
export const hasUnsent = (state: Pick<DraftState<DraftKey>, "unsaved" | "inFlight">): boolean => state.unsaved !== undefined || state.inFlight !== undefined;

export const contentOf = <K extends DraftKey>(key: K, value: Value<K>): DraftContent<K> => ({ [key]: value }) as DraftContent<K>;

export const valueIn = <K extends DraftKey>(key: K, content: DraftContent<K>): Value<K> => content[key];

/** Whether two values of one kind are the same content, as the service compares a draft with the agent's version. */
const same = <K extends DraftKey>(key: K, a: Value<K>, b: Value<K>): boolean =>
  sameAsAgents(contentOf(key, a) as unknown as DraftComparable, contentOf(key, b) as unknown as DraftComparable);

/** What a save does: from the agent's value, mine, and my saved one (undefined while I have none). */
type ActionOf<V> = (theirs: V, mine: V, saved: V | undefined) => DraftSave["action"];

/** The draft reducer and save builder for one kind of content. */
const draftKind = <K extends DraftKey>(key: K, actionOf: ActionOf<Value<K>>) => {
  const load = (state: DraftState<K> | undefined, read: DraftRead<K>, notice: ReviseNotice | undefined): DraftState<K> => ({
    seed: valueIn(key, read),
    loaded: { version: read.version, value: valueIn(key, read) },
    base: draftBase(read.versions) ?? read.version,
    saved: myDraft(read.versions) === undefined ? undefined : { version: read.version, value: valueIn(key, read) },
    inFlight: undefined,
    unsaved: undefined,
    seen: Math.max(state?.seen ?? 0, read.version),
    generation: (state?.generation ?? 0) + 1,
    notice,
    error: undefined,
  });

  /**
   * What a revise drops. A draft of mine past every version seen is my value in flight, saved before the revise; a
   * value in flight with no such draft reached the service after the revise, which refuses it.
   */
  const reviseNotice = (state: DraftState<K>, read: DraftRead<K>): ReviseNotice | undefined => {
    const kept = read.versions.findLast(({ n, by }) => by === "me" && n > state.base && n < read.version);
    const landed = kept !== undefined && kept.n > state.seen;
    const lost = state.unsaved !== undefined || (state.inFlight !== undefined && !landed);
    return kept === undefined && !lost ? { version: read.version } : { draft: kept?.n, lost };
  };

  /**
   * A read older than what's known changes nothing. A new agent version replaces the editor's value, with a notice
   * of what's kept. A new version of mine (another tab's save, or mine read before its answer) never replaces a value
   * not saved yet, and is loaded only when it isn't the value the editor holds.
   */
  const onRead = (state: DraftState<K> | undefined, read: DraftRead<K>): DraftState<K> => {
    if (state === undefined) return load(undefined, read, undefined);
    if (read.version <= state.seen) return state;
    if (read.versions.find(({ n }) => n === read.version)?.by === "agent") return load(state, read, reviseNotice(state, read));
    const mine = { version: read.version, value: valueIn(key, read) };
    if (state.inFlight !== undefined && same(key, state.inFlight.value, valueIn(key, read))) return { ...state, inFlight: undefined, saved: mine, seen: read.version };
    if (state.unsaved !== undefined || state.inFlight !== undefined) return state;
    if (state.saved !== undefined && same(key, state.saved.value, valueIn(key, read))) return { ...state, saved: mine, seen: read.version };
    return load(state, read, undefined);
  };

  const onAnswered = (state: DraftState<K>, save: DraftSave<K>, outcome: SaveOutcome): DraftState<K> => {
    if (save.generation !== state.generation) {
      return outcome === "changed" && state.notice !== undefined && "lost" in state.notice ? { ...state, notice: { ...state.notice, lost: true } } : state;
    }
    const notSaved = state.unsaved ?? state.inFlight?.raw;
    if (outcome === "changed") return { ...state, inFlight: undefined, unsaved: notSaved, error: undefined };
    if ("error" in outcome) return { ...state, inFlight: undefined, unsaved: notSaved, error: outcome };
    const saved = save.action === "save" ? { version: outcome.version, value: valueIn(key, save) } : save.action === "clear" ? undefined : state.saved;
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
  const step = (state: DraftState<K> | undefined, event: DraftEvent<K>): DraftState<K> | undefined => {
    if (event.type === "read") return onRead(state, event.read);
    if (state === undefined) return state;
    switch (event.type) {
      case "typed":
        return { ...state, unsaved: valueIn(key, event), seed: valueIn(key, event), notice: state.notice !== undefined && "version" in state.notice ? undefined : state.notice };
      case "sent":
        if (event.save.generation !== state.generation) return state;
        return { ...state, inFlight: { raw: event.save.raw, value: valueIn(key, event.save) }, unsaved: state.unsaved === event.save.raw ? undefined : state.unsaved };
      case "answered":
        return onAnswered(state, event.save, event.outcome);
      case "failed":
        return { ...state, error: event.error };
    }
  };

  /**
   * The save my unsaved value needs, undefined when nothing is unsaved. `theirs` is the value of the agent's version
   * `state.base`; `toSave` turns the editor's value into the one saved (a file's keeps its line endings).
   */
  const save = (state: DraftState<K>, theirs: Value<K>, toSave: (loaded: Value<K>, typed: Value<K>) => Value<K>): DraftSave<K> | undefined => {
    if (state.unsaved === undefined) return undefined;
    const value = toSave(state.loaded.value, state.unsaved);
    const action = actionOf(theirs, value, state.saved?.value);
    return { generation: state.generation, raw: state.unsaved, action, onVersion: state.base, ...contentOf(key, value) };
  };

  return { step, save };
};

const fileDraft = draftKind("text", draftAction);

/** A file draft's next state. */
export const draftStep = fileDraft.step;

/**
 * The save my unsaved text needs, undefined when nothing is unsaved. `theirs` is the text of the agent's version
 * `state.base`; `file` the file's text now (a dropped hunk brings its line endings back).
 */
export const draftSave = (state: DraftState, theirs: string, file: string): DraftSave | undefined =>
  fileDraft.save(state, theirs, (loaded, typed) => keepLineEndings(loaded, typed, file));

const fieldsDraft = draftKind("fields", (theirs, mine, saved) => contentAction({ fields: theirs }, { fields: mine }, saved === undefined ? undefined : { fields: saved }));

/** An item draft's reducer and save: my fields are saved as they are. */
export const itemDraft = {
  step: fieldsDraft.step,
  save: (state: DraftState<"fields">, theirs: DraftValues["fields"]): DraftSave<"fields"> | undefined => fieldsDraft.save(state, theirs, (_loaded, typed) => typed),
};
