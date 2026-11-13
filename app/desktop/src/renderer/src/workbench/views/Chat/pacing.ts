// Which agent messages reveal their text at an even pace, pure: the one still being written (`streamingKey`), and
// each one that stopped being written (a tool call followed, the turn ended) until its reveal has caught up. Only then
// does it show as static text.

export type Pacing = {
  /** The block still being written, as of the last render. */
  streaming: string | undefined;
  /** Blocks no longer being written whose reveal hasn't caught up yet. */
  trailing: ReadonlySet<string>;
};

export const NO_PACING: Pacing = { streaming: undefined, trailing: new Set() };

/** The pacing once `streaming` is the block being written: the same object when nothing changed, so it can sit in state. */
export const followStreaming = (before: Pacing, streaming: string | undefined): Pacing => {
  if (before.streaming === streaming) return before;
  const trailing = new Set(before.trailing);
  if (before.streaming !== undefined) trailing.add(before.streaming);
  if (streaming !== undefined) trailing.delete(streaming);
  return { streaming, trailing };
};

/** The pacing once block `key` shows all of its text. */
export const caughtUp = (before: Pacing, key: string): Pacing => {
  if (!before.trailing.has(key)) return before;
  const trailing = new Set(before.trailing);
  trailing.delete(key);
  return { ...before, trailing };
};

/** Whether block `key` still reveals its text at a pace. */
export const stillReveals = (pacing: Pacing, key: string): boolean => key === pacing.streaming || pacing.trailing.has(key);

/** Whether a paced message is done: it is no longer being written and shows all of its text. */
export const revealDone = (streaming: boolean, shown: string, text: string): boolean => !streaming && shown.length === text.length;
