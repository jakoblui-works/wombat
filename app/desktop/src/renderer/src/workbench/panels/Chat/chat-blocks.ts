// How the chat lays out its parts, pure: consecutive tool calls share one list, a permission shows as one thing with
// the tool call it asks about (the card at the request's place, no row of its own for that call), everything else
// stands alone.
import type { ChatPart } from "../../../data/chat-model.ts";

type ToolPart = Extract<ChatPart, { kind: "tool" }>;
type PermissionPart = Extract<ChatPart, { kind: "permission" }>;

export type ChatBlock =
  | { kind: "tools"; key: string; parts: ToolPart[] }
  | { kind: "permission"; key: string; part: PermissionPart; tool?: ToolPart }
  | { kind: "part"; key: string; part: Exclude<ChatPart, ToolPart | PermissionPart> };

export const chatBlocks = (parts: readonly ChatPart[]): ChatBlock[] => {
  // Each asked-about tool call goes with its latest request (a call asked about twice shows with the later card).
  const askedBy = new Map<string, string>();
  const tools = new Map<string, ToolPart>();
  for (const part of parts) {
    if (part.kind === "permission") askedBy.set(part.toolCallId, part.requestId);
    else if (part.kind === "tool") tools.set(part.toolCallId, part);
  }
  const blocks: ChatBlock[] = [];
  for (const part of parts) {
    const last = blocks.at(-1);
    if (part.kind === "permission") {
      const tool = askedBy.get(part.toolCallId) === part.requestId ? tools.get(part.toolCallId) : undefined;
      blocks.push({ kind: "permission", key: part.key, part, ...(tool === undefined ? {} : { tool }) });
    } else if (part.kind !== "tool") blocks.push({ kind: "part", key: part.key, part });
    else if (askedBy.has(part.toolCallId)) continue;
    // A tool call joins the list before it only from the same session (a sub-agent's calls are marked apart).
    else if (last?.kind === "tools" && last.parts[0]?.sessionId === part.sessionId) last.parts.push(part);
    else blocks.push({ kind: "tools", key: part.key, parts: [part] });
  }
  return blocks;
};

export const streamingKey = (blocks: readonly ChatBlock[], turnActive: boolean): string | undefined => {
  const last = blocks.at(-1);
  return turnActive && last?.kind === "part" && last.part.kind === "agent" ? last.key : undefined;
};
