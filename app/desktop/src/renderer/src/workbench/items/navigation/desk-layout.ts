import { z } from "zod";

export const DeskLayout = z.object({ binderId: z.string().exactOptional(), view: z.string().exactOptional(), openDrawers: z.array(z.string()) });

/** The Desk as the user left it: the binder (and view) shown in its navigator, and the open drawers' folders. */
export type DeskLayout = z.infer<typeof DeskLayout>;

/** The Desk until the user changes it: the tree, every drawer closed. */
export const DEFAULT_DESK: Readonly<DeskLayout> = { openDrawers: [] };
