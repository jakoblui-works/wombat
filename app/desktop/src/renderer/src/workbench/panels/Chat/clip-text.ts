// How much of one long text the chat shows. Pure; no DOM or CSS imports (the e2e imports MAX_SHOWN_CHARS).

/** How many characters of one text (a tool call's input, output or text content) the chat shows. */
export const MAX_SHOWN_CHARS = 20_000;

/** The first `max` characters of `text`, and how many were left out (0 when it fits). */
export const clipText = (text: string, max: number = MAX_SHOWN_CHARS): { shown: string; omitted: number } =>
  text.length <= max ? { shown: text, omitted: 0 } : { shown: text.slice(0, max), omitted: text.length - max };

/** What a clipped text shows: all of it once the user asked for all, else `clipText`'s cut. */
export const shownText = (text: string, all: boolean, max: number = MAX_SHOWN_CHARS): { shown: string; omitted: number } =>
  all ? { shown: text, omitted: 0 } : clipText(text, max);
