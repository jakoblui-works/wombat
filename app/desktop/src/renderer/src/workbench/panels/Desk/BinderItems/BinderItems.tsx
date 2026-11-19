import type { BinderSummary, LenientView } from "@wombat/shared/items";
import { CircleAlert } from "lucide-react";

import { useBinderItems } from "../../../../data/hooks.ts";
import { EmptyState } from "../../EmptyState/EmptyState.tsx";
import { ListView } from "../ListView/ListView.tsx";
import { TreeView } from "../TreeView/TreeView.tsx";

type Props = {
  binder: Extract<BinderSummary, { id: string }>;
  view: LenientView | undefined;
  onOpenItem?: ((itemId: string) => void) | undefined;
};

/** A binder's items in its list or tree view; without one, as a plain list: handle and title, an invalid one marked. */
export const BinderItems = ({ binder, view, onOpenItem }: Props) => {
  const [read] = useBinderItems([binder.id]);
  const items = read?.data?.items;
  if (items === undefined) {
    return read?.error ? (
      <p role="alert" className="px-3 pt-3 text-sm text-danger">
        Couldn't read the binder's items: {read.error.message}
      </p>
    ) : (
      <p className="p-3 text-sm text-fg-tertiary">Loading…</p>
    );
  }
  if (items.length === 0) return <EmptyState title="No items yet" body="Items are the Markdown files in the binder's folder." />;
  if (view?.kind === "list") return <ListView items={items} view={view} properties={binder.properties} onOpenItem={onOpenItem} />;
  if (view?.kind === "tree") return <TreeView key={view.name} items={items} view={view} properties={binder.properties} onOpenItem={onOpenItem} />;
  return (
    <ul aria-label="Items" className="flex flex-col gap-px px-1.5 pt-1 pb-3">
      {items.map((item) => (
        <li key={item.path} className="flex items-center gap-2 rounded-md px-2.5 py-1 text-base">
          <span className="w-16 shrink-0 truncate font-mono text-xs text-fg-tertiary">{item.handle}</span>
          <span className="min-w-0 flex-1 truncate text-fg-primary">{item.title ?? item.path}</span>
          {item.problems.length > 0 ? <CircleAlert aria-label="Invalid" className="size-3.5 shrink-0 text-danger" /> : null}
        </li>
      ))}
    </ul>
  );
};
