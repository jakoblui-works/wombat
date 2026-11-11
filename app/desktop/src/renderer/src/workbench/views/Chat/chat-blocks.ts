// How the chat lays out its items, pure: consecutive tool calls share one list, everything else stands alone.
import type { ChatItem } from "../../../data/chat-model.ts";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

export type ChatBlock = { kind: "tools"; key: string; items: ToolItem[] } | { kind: "item"; key: string; item: Exclude<ChatItem, ToolItem> };

export const chatBlocks = (items: readonly ChatItem[]): ChatBlock[] => {
  const blocks: ChatBlock[] = [];
  for (const item of items) {
    const last = blocks.at(-1);
    if (item.kind !== "tool") blocks.push({ kind: "item", key: item.key, item });
    // A tool call joins the list before it only from the same session (a sub-agent's calls are marked apart).
    else if (last?.kind === "tools" && last.items[0]?.sessionId === item.sessionId) last.items.push(item);
    else blocks.push({ kind: "tools", key: item.key, items: [item] });
  }
  return blocks;
};
