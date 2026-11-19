import type { ItemSummary, LenientProperty, LenientView } from "@wombat/shared/items";

import { ItemRow } from "../ItemRow/ItemRow.tsx";
import { groupHeading, listGroups, type Row, shownGroups } from "../view-model/view-model.ts";

type Props = {
  items: readonly ItemSummary[];
  view: Extract<LenientView, { kind: "list" }>;
  properties: Record<string, LenientProperty>;
  onOpenItem?: ((itemId: string) => void) | undefined;
};

const Rows = ({ rows, label, onOpenItem }: { rows: readonly Row[]; label: string; onOpenItem: Props["onOpenItem"] }) => (
  <ul aria-label={label} className="flex flex-col gap-px">
    {rows.map(({ item }) => (
      <li key={item.path}>
        <ItemRow
          item={item}
          render={
            <button
              type="button"
              onClick={() => {
                if (item.id !== null) onOpenItem?.(item.id);
              }}
              className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-base transition-colors select-none hover:bg-surface-2"
            />
          }
        />
      </li>
    ))}
  </ul>
);

/** A binder's list view: its items in the view's groups and order. */
export const ListView = ({ items, view, properties, onOpenItem }: Props) => {
  const groups = shownGroups(listGroups(items, view, properties));
  if (groups.length === 0) return <p className="p-3 text-sm text-fg-tertiary">No items in this view.</p>;
  return (
    <div className="flex flex-col gap-1 px-1.5 pt-1 pb-3">
      {groups.map((group) => {
        const name = groupHeading(group, view, properties);
        if (name === undefined) return <Rows key={group.key} rows={group.rows} label="Items" onOpenItem={onOpenItem} />;
        return (
          <section key={group.key} aria-label={name}>
            <h3 className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-xs font-medium text-fg-tertiary">
              <span className="truncate">{name}</span>
              <span className="tabular-nums">{group.rows.length}</span>
            </h3>
            <Rows rows={group.rows} label={name} onOpenItem={onOpenItem} />
          </section>
        );
      })}
    </div>
  );
};
