/** A thrown value as an Error: itself when it is one, else an Error with its text. */
export const asError = (thrown: unknown): Error => (thrown instanceof Error ? thrown : new Error(String(thrown)));
