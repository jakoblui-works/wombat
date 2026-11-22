/** The most UTF-16 code units an excerpt holds. */
export const EXCERPT_LENGTH = 200;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

const fold = (text: string) => text.replace(/\s+/g, " ");

/** `text` with whitespace runs folded to one space and trimmed; a lone surrogate in `text` becomes U+FFFD. */
const foldedText = (text: string) => fold(text.toWellFormed()).trim();

/** The start of `text` up to `length` code units, one fewer when the last would be the first half of a surrogate pair. */
const cutAt = (text: string, length: number) => text.slice(0, isHighSurrogate(text.charCodeAt(length - 1)) ? length - 1 : length);

/** `foldedText` of `text`; when longer than `length` code units, cut (`cutAt`) and trimmed so that with `tail` after it, it holds at most `length`. */
export const cutFolded = (text: string, length: number, tail: string) => {
  const folded = foldedText(text);
  return folded.length <= length ? folded : `${cutAt(folded, length - tail.length).trimEnd()}${tail}`;
};

/** `foldedText` of `text`, cut to at most EXCERPT_LENGTH code units (`cutAt`). */
export const excerpt = (text: string) => cutFolded(text, EXCERPT_LENGTH, "");

/**
 * Appends `more` to what is kept of a text that arrives in pieces, keeping only the part its excerpt depends on:
 * `excerpt` of the kept text equals `excerpt` of the whole, however long the whole gets.
 */
export const keepForExcerpt = (kept: string, more: string) =>
  fold(kept + more)
    .trimStart()
    .slice(0, EXCERPT_LENGTH + 1);
