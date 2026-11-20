/** The most UTF-16 code units an excerpt holds. */
export const EXCERPT_LENGTH = 200;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

const fold = (text: string) => text.replace(/\s+/g, " ");

/**
 * `text` with whitespace runs folded to one space, trimmed, and cut to at most EXCERPT_LENGTH code units, never
 * between the halves of a surrogate pair; a lone surrogate in `text` becomes U+FFFD.
 */
export const excerpt = (text: string) => {
  const folded = fold(text.toWellFormed()).trim();
  if (folded.length <= EXCERPT_LENGTH) return folded;
  const end = isHighSurrogate(folded.charCodeAt(EXCERPT_LENGTH - 1)) ? EXCERPT_LENGTH - 1 : EXCERPT_LENGTH;
  return folded.slice(0, end).trimEnd();
};

/**
 * Appends `more` to what is kept of a text that arrives in pieces, keeping only the part its excerpt depends on:
 * `excerpt` of the kept text equals `excerpt` of the whole, however long the whole gets.
 */
export const keepForExcerpt = (kept: string, more: string) =>
  fold(kept + more)
    .trimStart()
    .slice(0, EXCERPT_LENGTH + 1);
