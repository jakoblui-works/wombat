import { z } from "zod";

import { DESK_ACTIVITY } from "../../activity-ids.ts";
import type { ActivityStateOf } from "../../registry.ts";

export const DeskLayout = z.object({ binderId: z.string().exactOptional(), view: z.string().exactOptional(), openDrawers: z.array(z.string()) });

/** The Desk as the user left it: the binder (and view) shown in its navigator, and the open drawers' folders. */
export type DeskLayout = z.infer<typeof DeskLayout>;

/** The Desk until the user changes it: the tree, every drawer closed. */
export const DEFAULT_DESK: Readonly<DeskLayout> = { openDrawers: [] };

export const DESK_STATE: ActivityStateOf<DeskLayout> = { id: DESK_ACTIVITY, state: { schema: DeskLayout, initial: DEFAULT_DESK } };
