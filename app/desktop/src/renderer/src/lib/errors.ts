/** A thrown value as an Error: itself when it is one, else an Error with its text. */
export const asError = (thrown: unknown): Error => (thrown instanceof Error ? thrown : new Error(String(thrown)));

/** The text ending in a full stop (or the ? or ! it ends with), so another sentence can follow it. */
export const asSentence = (text: string): string => (/[.!?]\s*$/.test(text) ? text.trimEnd() : `${text.trimEnd()}.`);
