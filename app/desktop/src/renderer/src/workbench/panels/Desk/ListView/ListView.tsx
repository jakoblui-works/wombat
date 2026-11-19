import type { LenientProperty, LenientView } from "@wombat/shared/items";
import { Plus } from "lucide-react";
import { useRef } from "react";

import { Button } from "../../../../components/ui/button";
import type { Reveal } from "../../../registry.ts";
import { useWorkbench } from "../../../workbench-context.ts";
import { RowTitle } from "../ItemRow/ItemRow.tsx";
import { ProposalLines } from "../ProposalLine/ProposalLine.tsx";
import { proposalProps, REVEALABLE, useReveal } from "../use-reveal.ts";
import { groupHeading, isItemRow, isOutsideFilter, listGroups, type NewItem, newItemLabel, offersNew, type Row, rowKey, shownGroups, viewContext } from "../view-model/view-model.ts";
import { OUTSIDE_FILTER, opensProposal } from "../view-model/with-proposals.ts";

type Props = {
  rows: readonly Row[];
  view: Extract<LenientView, { kind: "list" }>;
  properties: Record<string, LenientProperty>;
  onOpenItem?: ((itemId: string) => void) | undefined;
  onNewItem: NewItem;
  reveal?: Reveal | undefined;
  onRevealed?: (() => void) | undefined;
};

const ROW = "focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-base transition-colors select-none hover:bg-surface-2";

const ListRow = ({ row, view, properties, onOpenItem }: { row: Row; view: Props["view"]; properties: Props["properties"]; onOpenItem: Props["onOpenItem"] }) => {
  const { openProposal } = useWorkbench();
  const open = () => {
    if (isItemRow(row)) {
      if (row.item.id !== null) onOpenItem?.(row.item.id);
      return;
    }
    const id = opensProposal(row);
    if (id !== undefined) openProposal(id);
  };
  return (
    <div {...proposalProps(row)} className={REVEALABLE}>
      <RowTitle row={row} render={<button type="button" onClick={open} className={ROW} />} />
      <ProposalLines row={row} outside={isOutsideFilter(row, view, properties)} className="pr-2 pb-1 pl-2.5" />
    </div>
  );
};

const Rows = ({ rows, label, view, properties, onOpenItem }: { rows: readonly Row[]; label: string; view: Props["view"]; properties: Props["properties"]; onOpenItem: Props["onOpenItem"] }) => (
  <ul aria-label={label} className="flex flex-col gap-px">
    {rows.map((row) => (
      <li key={rowKey(row)}>
        <ListRow row={row} view={view} properties={properties} onOpenItem={onOpenItem} />
      </li>
    ))}
  </ul>
);

/** A binder's list view: its rows in the view's groups and order, the proposed creates its filter hides first. */
export const ListView = ({ rows, view, properties, onOpenItem, onNewItem, reveal, onRevealed }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(reveal, ref, onRevealed);
  const groups = shownGroups(listGroups(rows, view, properties));
  return (
    <div ref={ref} className="flex flex-col gap-1 px-1.5 pt-1 pb-3">
      {groups.length === 0 ? <p className="p-1.5 text-sm text-fg-tertiary">No items in this view.</p> : null}
      {groups.map((group) => {
        const name = groupHeading(group, view, properties);
        if (name === undefined) return <Rows key={group.key} rows={group.rows} label={group.kind === "outside" ? OUTSIDE_FILTER : "Items"} view={view} properties={properties} onOpenItem={onOpenItem} />;
        return (
          <section key={group.key} aria-label={name}>
            <div className="flex items-center gap-1 pt-1 pr-1">
              <h3 className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 pt-1 pb-1 text-xs font-medium text-fg-tertiary">
                <span className="truncate">{name}</span>
                <span className="tabular-nums">{group.rows.length}</span>
              </h3>
              {offersNew(view, group) ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-fg-tertiary"
                  aria-label={newItemLabel(name)}
                  title={newItemLabel(name)}
                  onClick={() => onNewItem(viewContext(view, group))}
                >
                  <Plus />
                </Button>
              ) : null}
            </div>
            <Rows rows={group.rows} label={name} view={view} properties={properties} onOpenItem={onOpenItem} />
          </section>
        );
      })}
    </div>
  );
};
