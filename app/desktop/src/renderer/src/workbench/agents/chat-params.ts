import { z } from "zod";

export const ChatParams = z.object({ agentId: z.string() });

/** The chat's panel id: its reveal requests are kept under it (`chatRevealKey`). */
export const CHAT_PANEL = "chat";

const MESSAGE_BOX_ATTRIBUTE = "data-message-box";

/** Marks the chat's message box, for `MESSAGE_BOX` to find. */
export const messageBoxMark = { [MESSAGE_BOX_ATTRIBUTE]: "" };

export const MESSAGE_BOX = `[${MESSAGE_BOX_ATTRIBUTE}]`;

