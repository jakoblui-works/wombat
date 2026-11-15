// What Monaco does to a model's text: one line ending, no leading byte order mark.
export const BREAK = /\r\n|\r|\n/;
export const BOM = "\uFEFF";

export const withoutBom = (text: string): string => (text.startsWith(BOM) ? text.slice(BOM.length) : text);

/** `text` as the editor gives it back: every line break a "\n", no leading byte order mark. */
export const asEditorText = (text: string): string => withoutBom(text).replace(new RegExp(BREAK, "g"), "\n");
