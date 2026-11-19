import { useEffect } from "react";

import { useBinders } from "../../../../data/hooks.ts";
import type { PanelProps } from "../../../registry.ts";
import { EmptyState } from "../../EmptyState/EmptyState.tsx";
import { BoardParams } from "../board-params.ts";

/** A binder's board view as a tab; until boards are built it says so. */
export const BoardPlaceholder = ({ params, setTitle }: PanelProps) => {
  const parsed = BoardParams.safeParse(params);
  const binders = useBinders();
  const binderId = parsed.data?.binderId;
  const view = parsed.data?.view;
  const binder = binders.data?.binders.find(({ id }) => id === binderId);
  const name = binder?.id === null || binder === undefined ? undefined : binder.name;
  useEffect(() => {
    if (name !== undefined && view !== undefined) setTitle?.(`${name} · ${view}`);
  }, [name, view, setTitle]);
  return <EmptyState title="Boards arrive later" body="This tab will show the binder's items as cards in columns." />;
};
