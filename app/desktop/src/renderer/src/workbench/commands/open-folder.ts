import type { QueryClient } from "@tanstack/react-query";

import { openFolder } from "../../data/shown-workspace.ts";
import { asError, asSentence } from "../../lib/errors.ts";
import { tell } from "../Toast/Toast.tsx";

/** Open Folder…: the folder picker; the picked folder's workspace (added, or already listed) goes to `show`. Tells its own failure. */
export const openFolderOrTell = (queryClient: QueryClient, show: (id: string) => void): Promise<void> =>
  openFolder(queryClient, show).catch((error: unknown) => tell(`Wombat couldn't open the folder: ${asSentence(asError(error).message)}`));
