import { z } from "zod";

/** The Desk as the user left it: the binder (and view) shown in its navigator, and the open drawers' folders. */
export type DeskLayout = { binderId?: string; view?: string; openDrawers: string[] };

/** The Desk until the user changes it: the tree, every drawer closed. */
export const DEFAULT_DESK: Readonly<DeskLayout> = { openDrawers: [] };

export const DeskLayout = z.object({ binderId: z.string().exactOptional(), view: z.string().exactOptional(), openDrawers: z.array(z.string()) });

/**
 * The Desk's slot holds only what the shell's restore (which parses it) and the Desk wrote, so it's trusted as it is;
 * an empty slot is `DEFAULT_DESK`.
 */
export const deskOf = (slot: unknown): DeskLayout => (slot === undefined ? DEFAULT_DESK : (slot as DeskLayout));
