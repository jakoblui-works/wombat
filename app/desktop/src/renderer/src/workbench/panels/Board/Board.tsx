import { type ItemSummary, type Problem, SETTINGS_FILE } from "@wombat/shared/items";
import { type DragEvent as ReactDragEvent, type FocusEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

import { useSaveItem } from "../../../data/commands.ts";
import { useBinderItems, useBinders } from "../../../data/hooks.ts";
import { refusedByService, writeFailure } from "../../../data/write-failure.ts";
import { lastPathPart } from "../../../lib/path.ts";
import type { PanelProps, Reveal } from "../../registry.ts";
import { useWorkbench } from "../../workbench-context.ts";
import { Note } from "../approvals/Note/Note.tsx";
import { ProblemList } from "../Desk/ProblemList/ProblemList.tsx";
import { useItemProposals } from "../Desk/use-item-proposals.ts";
import { useItemsOf } from "../Desk/use-link-lists.ts";
import { useReveal } from "../Desk/use-reveal.ts";
import { isOutsideFilter, isPending, offersNew, rowKey, viewContext } from "../Desk/view-model/view-model.ts";
import { type ItemProposalRead, withProposals } from "../Desk/view-model/with-proposals.ts";
import { BinderNotice, READ_FAILED } from "../Item/ItemNotice/ItemNotice.tsx";
import { itemName } from "../Item/item-params.ts";
import type { Binder } from "../Item/item-state.ts";
import { BoardCard, PendingCard } from "./BoardCard/BoardCard.tsx";
import { BoardColumn, COLUMN_SELECTOR } from "./BoardColumn/BoardColumn.tsx";
import { BoardParams } from "./board-params.ts";
import { boardColumns, type BoardView, columnLabel, columnValue, dropOutcome, liveMoves, type Move, NO_VALUE, versionToSend, withMoves } from "./board-columns.ts";
import { canMove, drag, pressOnlyEndsHold, type DragEvent, dropSentence, type Held, heldOver, highlighted, pickedUp, putBack, shownCards, takesFocus } from "./board-drag.ts";
import { boardShown } from "./board-state.ts";

/** The drag data type only a board's card carries, so a column ignores anything else dragged over it. */
const CARD_TYPE = "application/x-wombat-card";

/** Why the last drop didn't land, shown on the board until the next drop. */
type Refusal =
  | { kind: "stale"; title: string; column: string }
  | { kind: "refused" | "failed"; title: string; column: string; problems: Problem[]; file: string }
  | { kind: "required"; title: string; column: string; property: string };

const RefusalNote = ({ refusal }: { refusal: Refusal }) => (
  <div role="alert" className="mx-3 mt-3 shrink-0 rounded-md border border-state-waiting/40 bg-surface-2 px-3 py-2.5 text-sm text-fg-secondary">
    {refusal.kind === "stale" ? (
      <p>
        {refusal.title} stays in {refusal.column}: its file changed since the board read it, so nothing was written. Drag it again.
      </p>
    ) : refusal.kind === "required" ? (
      <p>
        {refusal.title} stays in {refusal.column}: {refusal.property} is required, so it can't go to {NO_VALUE}.
      </p>
    ) : (
      <>
        <p>
          {refusal.title} stays in {refusal.column}:{" "}
          {refusal.kind === "refused" ? "the move was refused, so nothing was written." : "the move couldn't be saved. Drag it again."}
        </p>
        <ProblemList problems={refusal.problems} file={refusal.file} className="mt-1 text-sm text-danger" />
      </>
    )}
  </div>
);

/**
 * A binder's board view: a column per option of its column property, cards moved between them by drag; the open item
 * proposals as cards (a create) or on their cards.
 */
const BoardContent = ({
  binder,
  view,
  items,
  proposals,
  reveal,
}: {
  binder: Binder;
  view: BoardView;
  items: readonly ItemSummary[];
  proposals: readonly ItemProposalRead[];
  reveal: Reveal | undefined;
}) => {
  const { openItem, openNewItem, openProposal } = useWorkbench();
  const save = useSaveItem();
  const properties = binder.properties;

  const [moves, setMoves] = useState<Move[]>([]);
  const live = liveMoves(moves, items);
  if (live.length !== moves.length) setMoves(live);

  const heldRef = useRef<Held>(undefined);
  const [held, setHeld] = useState<Held>();
  const apply = (event: DragEvent): Held | undefined => {
    const next = drag(heldRef.current, event);
    heldRef.current = next;
    setHeld(next);
    return next;
  };
  const [said, setSaid] = useState("");
  const [endedOn, setEndedOn] = useState<string>();
  const [refusal, setRefusal] = useState<Refusal>();
  const pill = useRef<HTMLDivElement>(null);
  const swallowClick = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  useReveal(reveal, boardRef);

  const itemsOf = useItemsOf(binder.id, properties, items);
  const rowsWith = (shown: readonly Move[]) => withProposals(withMoves(items, view, shown), proposals, binder.id, itemsOf);
  const base = boardColumns(rowsWith(live), view, properties);
  const columnOf = (key: string) => base.find((column) => column.key === key);
  const labelOf = (key: string): string => {
    const column = columnOf(key);
    return column === undefined ? NO_VALUE : columnLabel(column, view, properties);
  };
  const overColumn = held === undefined || held.over === held.from ? undefined : columnOf(held.over);
  const preview =
    held === undefined || overColumn === undefined ? base : boardColumns(rowsWith([...live, { path: held.id, value: columnValue(overColumn), version: "" }]), view, properties);

  const [lastItems, setLastItems] = useState(items);
  if (lastItems !== items) {
    setLastItems(items);
    if (heldRef.current !== undefined) apply({ type: "cards", columns: base });
  }

  const mouseHeld = held?.byMouse === true;
  useEffect(() => {
    if (!mouseHeld) return;
    const outside = (event: globalThis.DragEvent) => {
      if (!(event.target instanceof Element) || event.target.closest(COLUMN_SELECTOR) === null) apply({ type: "outside" });
    };
    document.addEventListener("dragover", outside);
    return () => document.removeEventListener("dragover", outside);
  }, [mouseHeld]);

  const commit = (drop: Held): "moved" | "stayed" => {
    setRefusal(undefined);
    const item = items.find(({ path }) => path === drop.id);
    const from = columnOf(drop.from);
    const to = columnOf(drop.over);
    if (item === undefined || item.id === null || from === undefined || to === undefined) return "stayed";
    const version = versionToSend(item, live);
    const outcome = dropOutcome({ path: item.path, version }, from, to, view, properties);
    const title = itemName(item);
    if (outcome.kind === "stay") return "stayed";
    if (outcome.kind === "required") {
      setRefusal({ kind: "required", title, column: labelOf(drop.from), property: outcome.property });
      return "stayed";
    }
    const { move } = outcome;
    const back = labelOf(drop.from);
    setMoves((now) => [...now, move]);
    save.mutateAsync({ ref: item.id, version, fields: outcome.fields }).then(
      (written) => setMoves((now) => now.map((each) => (each === move ? { ...each, answered: written.version } : each))),
      (error: unknown) => {
        setMoves((now) => now.filter((each) => each !== move));
        const failure = writeFailure(error);
        setRefusal(
          failure === "stale"
            ? { kind: "stale", title, column: back }
            : { kind: refusedByService(error) ? "refused" : "failed", title, column: back, problems: failure, file: lastPathPart(item.path) },
        );
      },
    );
    return "moved";
  };

  const swallowed = (): boolean => {
    if (!swallowClick.current) return false;
    swallowClick.current = false;
    return true;
  };

  const pick = (item: ItemSummary, from: string, byMouse: boolean) => {
    setEndedOn(undefined);
    apply({ type: "pick", id: item.path, from, byMouse });
  };

  const onDragStart = (item: ItemSummary, from: string) => (event: ReactDragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(CARD_TYPE, item.path);
    event.dataTransfer.effectAllowed = "move";
    if (pill.current !== null) {
      pill.current.textContent = itemName(item);
      event.dataTransfer.setDragImage(pill.current, -12, -12);
    }
    pick(item, from, true);
  };
  const onDragEnd = () => {
    const drop = heldRef.current;
    apply({ type: "end" });
    if (drop?.dropped === true) commit(drop);
  };

  const onKeyDown = (item: ItemSummary, from: string) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const now = heldRef.current;
    const title = itemName(item);
    const pickOrDrop = event.key === " " || event.key === "Enter";
    if (now === undefined) {
      if (!pickOrDrop || !canMove({ item })) return;
      event.preventDefault();
      pick(item, from, false);
      setSaid(pickedUp(title, labelOf(from)));
      return;
    }
    if (now.byMouse || now.id !== item.path) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = apply({ type: "step", by: event.key === "ArrowLeft" ? -1 : 1, columns: base.map(({ key }) => key) });
      if (next !== undefined && next.over !== now.over) setSaid(heldOver(title, labelOf(next.over)));
    } else if (pickOrDrop) {
      event.preventDefault();
      apply({ type: "end" });
      setEndedOn(item.path);
      setSaid(dropSentence(commit(now), now, title, labelOf));
    } else if (event.key === "Escape") {
      event.preventDefault();
      apply({ type: "end" });
      setEndedOn(item.path);
      setSaid(putBack(title, labelOf(now.from)));
    }
  };

  const onBlur = (item: ItemSummary) => (event: FocusEvent<HTMLButtonElement>) => {
    // A held card moving to another column is unmounted, which may blur it; that isn't the card losing focus.
    if (!event.currentTarget.isConnected) return;
    if (item.path === endedOn) setEndedOn(undefined);
    const now = heldRef.current;
    if (apply({ type: "blur", id: item.path }) === undefined && now !== undefined) setSaid(putBack(itemName(item), labelOf(now.from)));
  };

  const columnDrag = (key: string) => ({
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(CARD_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      apply({ type: "over", column: key });
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(CARD_TYPE)) return;
      event.preventDefault();
      apply({ type: "over", column: key });
      apply({ type: "drop" });
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {refusal === undefined ? null : <RefusalNote refusal={refusal} />}
      <div
        ref={boardRef}
        className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3"
        onPointerDownCapture={() => {
          swallowClick.current = pressOnlyEndsHold(heldRef.current);
        }}
      >
        {base.map((column) => {
          const label = columnLabel(column, view, properties);
          const cards = shownCards(column.key, base, preview, held);
          return (
            <BoardColumn
              key={column.key}
              label={label}
              count={cards.filter(({ mode }) => mode !== "hidden").length}
              over={highlighted(column.key, held)}
              onNewItem={offersNew(view, column) ? () => openNewItem(binder.id, viewContext(view, column)) : undefined}
              {...columnDrag(column.key)}
            >
              {cards.map(({ row, mode }) => (
                <div key={rowKey(row)} hidden={mode === "hidden"}>
                  {isPending(row) ? (
                    <PendingCard
                      row={row}
                      outside={isOutsideFilter(row, view, properties)}
                      onOpen={() => {
                        if (!swallowed() && heldRef.current === undefined) openProposal(row.pending.id);
                      }}
                      swallowed={swallowed}
                    />
                  ) : (
                    <BoardCard
                      row={row}
                      mode={mode}
                      movable={canMove(row)}
                      focus={takesFocus(row.item.path, mode, held, endedOn)}
                      onOpen={() => {
                        if (!swallowed() && heldRef.current === undefined && row.item.id !== null) openItem(binder.id, row.item.id);
                      }}
                      swallowed={swallowed}
                      onDragStart={onDragStart(row.item, column.key)}
                      onDragEnd={onDragEnd}
                      onBlur={onBlur(row.item)}
                      onKeyDown={onKeyDown(row.item, column.key)}
                    />
                  )}
                </div>
              ))}
            </BoardColumn>
          );
        })}
      </div>
      <div aria-live="assertive" className="sr-only">
        {said}
      </div>
      <div ref={pill} aria-hidden className="pointer-events-none fixed -top-24 left-0 max-w-64 truncate rounded-md border border-primary bg-surface-0 px-2.5 py-1 text-sm text-fg-primary" />
    </div>
  );
};

/** A binder's board view as a tab, titled with the binder's and the view's names; says so when it can't be shown. */
export const Board = ({ params, reveal, setTitle }: PanelProps) => {
  const parsed = BoardParams.safeParse(params);
  const binderId = parsed.data?.binderId ?? "";
  const viewName = parsed.data?.view ?? "";
  const binders = useBinders();
  const [items] = useBinderItems(parsed.success ? [binderId] : []);
  const proposals = useItemProposals(binderId);
  const shown = boardShown(binderId, viewName, { data: binders.data?.binders, error: binders.error }, { data: items?.data?.items, error: items?.error });

  const name = shown.kind === "board" || shown.kind === "no-view" ? shown.binder.name : undefined;
  useEffect(() => {
    if (name !== undefined) setTitle?.(`${name} · ${viewName}`);
  }, [name, viewName, setTitle]);

  if (!parsed.success) return <Note>This tab names no board; close it.</Note>;
  switch (shown.kind) {
    case "loading":
      return <Note>Loading…</Note>;
    case "error":
      return (
        <p role="alert" className="p-5 text-sm text-danger">
          {READ_FAILED[shown.what]}: {shown.message}
        </p>
      );
    case "binder-missing":
    case "binder-gone":
      return (
        <div className="p-5">
          <BinderNotice shown={shown} tab="board" />
        </div>
      );
    case "no-view":
      return <Note>{`${shown.binder.name} has no board view named ${viewName}: it was renamed or removed in its ${SETTINGS_FILE}. Open the binder again, or close this tab.`}</Note>;
    case "board":
      return <BoardContent key={`${shown.binder.id}:${shown.view.name}`} binder={shown.binder} view={shown.view} items={shown.items} proposals={proposals} reveal={reveal} />;
  }
};
