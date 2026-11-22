import { Plus } from "lucide-react";

import { Button } from "../../../../components/ui/button";

const ROW_ACTION = "absolute top-0.5 right-1 bg-surface-1 text-fg-tertiary opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100";

/** A "+" at a tree row's end, shown on hover or focus within the row (`group/row`); `label` names it and is its tooltip. */
export const RowAction = ({ label, tabIndex, onClick }: { label: string; tabIndex: number; onClick: () => void }) => (
  <Button variant="ghost" size="icon-xs" tabIndex={tabIndex} className={ROW_ACTION} aria-label={label} title={label} onClick={onClick}>
    <Plus />
  </Button>
);
