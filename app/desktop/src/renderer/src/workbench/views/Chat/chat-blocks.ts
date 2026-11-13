// How the chat lays out its items, pure: consecutive tool calls share one list, a permission shows as one thing with
// the tool call it asks about (the card at the request's place, no row of its own for that call), everything else
// stands alone.
import type { ChatItem } from "../../../data/chat-model.ts";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;
type PermissionItem = Extract<ChatItem, { kind: "permission" }>;

export type ChatBlock =
  | { kind: "tools"; key: string; items: ToolItem[] }
  | { kind: "permission"; key: string; item: PermissionItem; tool?: ToolItem }
  | { kind: "item"; key: string; item: Exclude<ChatItem, ToolItem | PermissionItem> };

export const chatBlocks = (items: readonly ChatItem[]): ChatBlock[] => {
  // Each asked-about tool call goes with its latest request (a call asked about twice shows with the later card).
  const askedBy = new Map<string, string>();
  const tools = new Map<string, ToolItem>();
  for (const item of items) {
    if (item.kind === "permission") askedBy.set(item.toolCallId, item.requestId);
    else if (item.kind === "tool") tools.set(item.toolCallId, item);
  }
  const blocks: ChatBlock[] = [];
  for (const item of items) {
    const last = blocks.at(-1);
    if (item.kind === "permission") {
      const tool = askedBy.get(item.toolCallId) === item.requestId ? tools.get(item.toolCallId) : undefined;
      blocks.push({ kind: "permission", key: item.key, item, ...(tool === undefined ? {} : { tool }) });
    } else if (item.kind !== "tool") blocks.push({ kind: "item", key: item.key, item });
    else if (askedBy.has(item.toolCallId)) continue;
    // A tool call joins the list before it only from the same session (a sub-agent's calls are marked apart).
    else if (last?.kind === "tools" && last.items[0]?.sessionId === item.sessionId) last.items.push(item);
    else blocks.push({ kind: "tools", key: item.key, items: [item] });
  }
  return blocks;
};

/** The key of the agent message still being written: the last block, when it is an agent's text and its turn runs. */
export const streamingKey = (blocks: readonly ChatBlock[], turnActive: boolean): string | undefined => {
  const last = blocks.at(-1);
  return turnActive && last?.kind === "item" && last.item.kind === "agent" ? last.key : undefined;
};
