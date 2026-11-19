import type { BinderSummary, LenientView } from "@wombat/shared/items";
import { ArrowLeft, Kanban, List, ListTree, Plus } from "lucide-react";

import { Button } from "../../../../components/ui/button";
import { ScrollArea } from "../../../../components/ui/scroll-area";
import { cn } from "../../../../lib/utils";
import type { Reveal } from "../../../registry.ts";
import { BinderItems } from "../BinderItems/BinderItems.tsx";
import { type NewItem, paneView, viewContext } from "../view-model/view-model.ts";

type Props = {
  binder: Extract<BinderSummary, { id: string }>;
  view: LenientView | undefined;
  onBack: () => void;
  onView: (view: string) => void;
  onOpenItem?: ((itemId: string) => void) | undefined;
  onNewItem: NewItem;
  reveal?: Reveal | undefined;
  onRevealed?: (() => void) | undefined;
};

const VIEW_ICON = { list: List, tree: ListTree, board: Kanban } as const;

/** One binder in the Desk's sidebar: a way back to the tree, its views, and the view shown. */
export const BinderPane = ({ binder, view, onBack, onView, onOpenItem, onNewItem, reveal, onRevealed }: Props) => (
  <div className="flex h-full min-h-0 flex-col">
    <header className="flex h-tab-strip shrink-0 items-center gap-1 border-b border-line pr-3 pl-1.5">
      <Button variant="ghost" size="icon-sm" aria-label="Back to the Desk" title="Back to the Desk" onClick={onBack}>
        <ArrowLeft />
      </Button>
      <h2 className="min-w-0 truncate text-sm font-semibold text-fg-primary">{binder.name}</h2>
      <span className="text-sm text-fg-tertiary tabular-nums">{binder.itemCount}</span>
      <Button variant="ghost" size="xs" className="ml-auto shrink-0 text-fg-secondary" aria-label="New item" title="New item" onClick={() => onNewItem(viewContext(paneView(view)))}>
        <Plus />
        New
      </Button>
    </header>
    {binder.views.length === 0 ? null : (
      <nav aria-label="Views" className="flex shrink-0 flex-wrap gap-1 border-b border-line px-1.5 py-1.5">
        {binder.views.map(({ name, kind }) => {
          const Icon = VIEW_ICON[kind];
          const current = name === view?.name;
          return (
            <Button
              key={name}
              variant="ghost"
              size="xs"
              aria-current={current ? "true" : undefined}
              className={cn("text-fg-secondary", current && "bg-surface-2 text-fg-primary")}
              onClick={() => onView(name)}
            >
              <Icon />
              {name}
            </Button>
          );
        })}
      </nav>
    )}
    <ScrollArea className="min-h-0 flex-1">
      <BinderItems binder={binder} view={view} onOpenItem={onOpenItem} onNewItem={onNewItem} reveal={reveal} onRevealed={onRevealed} />
    </ScrollArea>
  </div>
);
