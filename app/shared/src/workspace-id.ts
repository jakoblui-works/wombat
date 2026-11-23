import { z } from "zod";

const WORKSPACE_ID = /^ws-[a-z0-9]{10}$/;
const WORKSPACE_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A workspace's id: `ws-` and ten lowercase letters and digits, made by `newWorkspaceId`. */
export const WorkspaceId = z.string().regex(WORKSPACE_ID);
export type WorkspaceId = z.infer<typeof WorkspaceId>;

export const newWorkspaceId = (): WorkspaceId => {
  let id = "";
  while (id.length < 10) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      // 252 is the largest multiple of 36 a byte holds; the bytes above it would make the first letters likelier.
      if (byte < 252 && id.length < 10) id += WORKSPACE_ID_ALPHABET[byte % WORKSPACE_ID_ALPHABET.length];
    }
  }
  return `ws-${id}`;
};
