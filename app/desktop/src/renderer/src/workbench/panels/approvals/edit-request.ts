// What an edit request is, pure: the one owner of "is this permission an edit" and of the change it asks to make. The
// chat's edit card and the diff tab both read it from the same chat model, so they show the same request.
import type { ChatPart, ChatModel } from "../../../data/chat-model.ts";

type PermissionPart = Extract<ChatPart, { kind: "permission" }>;

/** One `diff` content of the request's tool call: a whole file, or one hunk of it (an edit of every match). */
export type EditDiff = { oldText: string | null | undefined; newText: string };

/**
 * An edit request as the chat's edit card and the diff tab show it: the permission part (its options and answer, as
 * the chat has them), the file, and every diff its tool call holds, in order. `diffs` is empty once the agent replaced
 * them (after the answer, a large write's content becomes text).
 */
export type EditRequest = PermissionPart & { path: string; diffs: EditDiff[] };

/**
 * The edit request `requestId` names; undefined when there's none, or its tool call isn't an edit. A tool call is an
 * edit while it holds a diff, and stays one when its diffs are replaced: then its kind ("edit") and its first location
 * still name the file. (The chat model keeps a tool call's latest content only.)
 */
export const editRequest = (model: ChatModel, requestId: string): EditRequest | undefined => {
  const request = model.parts.find((part): part is PermissionPart => part.kind === "permission" && part.requestId === requestId);
  if (request === undefined) return undefined;
  const tool = model.parts.find((part) => part.kind === "tool" && part.toolCallId === request.toolCallId);
  if (tool?.kind !== "tool") return undefined;
  const diffs = tool.content.flatMap((content) => (content.type === "diff" ? [content] : []));
  const path = diffs[0]?.path ?? (tool.toolKind === "edit" ? tool.locations[0]?.path : undefined);
  if (path === undefined) return undefined;
  return { ...request, path, diffs: diffs.map(({ oldText, newText }) => ({ oldText, newText })) };
};
