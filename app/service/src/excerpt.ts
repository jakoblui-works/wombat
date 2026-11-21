/** The most UTF-16 code units an excerpt holds. */
export const EXCERPT_LENGTH = 200;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

const fold = (text: string) => text.replace(/\s+/g, " ");

/** `text` with whitespace runs folded to one space and trimmed; a lone surrogate in `text` becomes U+FFFD. */
export const foldedText = (text: string) => fold(text.toWellFormed()).trim();

/** The start of `text` up to `length` code units, one fewer when the last would be the first half of a surrogate pair. */
export const cutAt = (text: string, length: number) => text.slice(0, isHighSurrogate(text.charCodeAt(length - 1)) ? length - 1 : length);

/** `foldedText` of `text`, cut to at most EXCERPT_LENGTH code units (`cutAt`). */
export const excerpt = (text: string) => {
  const folded = foldedText(text);
  return folded.length <= EXCERPT_LENGTH ? folded : cutAt(folded, EXCERPT_LENGTH).trimEnd();
};

/**
 * Appends `more` to what is kept of a text that arrives in pieces, keeping only the part its excerpt depends on:
 * `excerpt` of the kept text equals `excerpt` of the whole, however long the whole gets.
 */
export const keepForExcerpt = (kept: string, more: string) =>
  fold(kept + more)
    .trimStart()
    .slice(0, EXCERPT_LENGTH + 1);
