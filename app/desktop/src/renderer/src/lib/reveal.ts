// How fast streamed text is revealed, pure. `shown` is a position in characters and may be fractional, so a frame
// shorter than one character's time still moves it; the text shown is cut at its whole part.

/**
 * About 75 tokens a second at ~4 characters a token: as fast as Claude's larger models stream, so the reveal keeps
 * up with them at an even pace instead of falling behind and jumping. About 5 characters a frame at 60 Hz.
 */
export const CHARS_PER_SECOND = 300;

/**
 * Two seconds of reveal at CHARS_PER_SECOND. A burst bigger than this (a faster model, or text that arrived while
 * the window wasn't drawing) shows at once rather than keeping the reader waiting on the animation.
 */
export const MAX_LAG_CHARS = 600;

/** The position after `elapsedMs` of revealing from `shown` towards `target` (`shown <= target`). */
export const revealStep = (shown: number, target: number, elapsedMs: number): number =>
  target - shown > MAX_LAG_CHARS ? target : Math.min(target, shown + (elapsedMs * CHARS_PER_SECOND) / 1000);

export type Revealed = { text: string; shown: number };

/**
 * What stays revealed when the text becomes `text`: everything, when not paced; the same position, when the new
 * text only adds to what was shown; else (a text that shrank or changed in its shown part) all of the new text.
 */
export const followText = (before: Revealed, text: string, paced: boolean): Revealed => {
  if (!paced) return before.text === text && before.shown === text.length ? before : { text, shown: text.length };
  if (before.text === text) return before;
  return text.startsWith(before.text.slice(0, Math.floor(before.shown))) ? { text, shown: before.shown } : { text, shown: text.length };
};

/**
 * Where a message streaming from its first render starts. One that just arrived (`fromStart`) starts after its first
 * word, at most a tenth of a second of reveal, so the block's entrance moves the word rather than an empty block; one
 * already there (a chat opened mid-stream, a moved tab) starts with all of it, as the reader may have seen it.
 */
export const revealStart = (text: string, fromStart: boolean): number =>
  fromStart ? Math.min(/^\s*\S*/.exec(text)?.[0].length ?? 0, CHARS_PER_SECOND / 10) : text.length;
