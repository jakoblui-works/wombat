// The board tab's params (the registry and openBinder read them).
import { z } from "zod";

export const BoardParams = z.object({ binderId: z.string(), view: z.string() });
export type BoardParams = z.infer<typeof BoardParams>;

/** The board panel's id: its registration and every tab opened on it. */
export const BOARD_PANEL = "board";

/** The tab's title until its panel has read the binder. */
export const BOARD_TITLE = "Board";
