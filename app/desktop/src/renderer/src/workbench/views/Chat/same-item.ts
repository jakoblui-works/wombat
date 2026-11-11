// Whether a chat item shows the same as before, pure: chatModel builds new item objects on every append, but the
// values in them (texts, a tool's input and output, its content) are the log entries' own, so a shallow look tells
// an unchanged item from a changed one without comparing big texts or outputs deeply.
import type { ChatItem } from "../../../data/chat-model.ts";
import type { ChatBlock } from "./chat-blocks.ts";

/** Equal, or arrays whose elements are (one level deep, so `options` rebuilt from the same entry counts as equal). */
const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value: unknown, index) => {
    const other: unknown = b[index];
    if (value === other) return true;
    if (typeof value !== "object" || typeof other !== "object" || value === null || other === null) return false;
    const keys = Object.keys(value);
    return (
      keys.length === Object.keys(other).length &&
      keys.every((key) => (value as Record<string, unknown>)[key] === (other as Record<string, unknown>)[key])
    );
  });
};

export const sameItem = (a: ChatItem, b: ChatItem): boolean => {
  if (a === b) return true;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key as keyof ChatItem], b[key as keyof ChatItem]));
};

/** Whether a block (a tool list or one item) shows the same as before. */
export const sameBlock = (a: ChatBlock, b: ChatBlock): boolean => {
  if (a.kind === "tools" && b.kind === "tools")
    return a.items.length === b.items.length && a.items.every((item, index) => {
      const other = b.items[index];
      return other !== undefined && sameItem(item, other);
    });
  return a.kind === "item" && b.kind === "item" && sameItem(a.item, b.item);
};
