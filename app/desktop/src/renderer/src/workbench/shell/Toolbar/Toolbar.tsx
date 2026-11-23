import { GripHorizontal } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type RefObject, useId, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { activities } from "../../registry.ts";
import { activeToolbarButton, pressToolbarButton } from "../shell-state.ts";
import { useShell } from "../ShellProvider.tsx";
import { movedPill, PILL_GAP, type PillBounds, pillBounds, pillKeyMove, pillTop } from "./pill-position.ts";

const GRIP_HINT = "The Up and Down arrow keys move the toolbar.";

const BUTTON = "focus-ring flex items-center justify-center rounded-sm text-fg-tertiary transition-colors hover:bg-surface-2 hover:text-fg-secondary";

const sameBounds = (a: PillBounds | undefined, b: PillBounds): boolean => a !== undefined && a.min === b.min && a.max === b.max;

/**
 * The pill's room in `area`, below its first header row (the chat's), followed as the area resizes. Measured again on
 * every render too: the toolbar renders whenever the shell changes, which is when the middle's header comes or goes.
 */
const usePillBounds = (area: RefObject<HTMLElement | null>, pill: RefObject<HTMLElement | null>): PillBounds | undefined => {
  const [bounds, setBounds] = useState<PillBounds>();
  const measure = useRef(() => {});
  measure.current = () => {
    const element = area.current;
    if (element === null || pill.current === null) return;
    const top = element.getBoundingClientRect().top;
    const header = element.querySelector("header");
    const next = pillBounds({
      height: element.clientHeight,
      headerBottom: header === null ? 0 : header.getBoundingClientRect().bottom - top,
      pillHeight: pill.current.offsetHeight,
    });
    setBounds((current) => (sameBounds(current, next) ? current : next));
  };
  useLayoutEffect(() => measure.current());
  useLayoutEffect(() => {
    const element = area.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => measure.current());
    observer.observe(element);
    return () => observer.disconnect();
  }, [area]);
  return bounds;
};

/**
 * One button per activity, choosing what the shown workspace's right sidebar shows, in a pill floating over `area`'s
 * top-right corner; its grip moves it up and down the right edge. With no workspace shown there is no pill.
 */
export const Toolbar = ({ workspace, area }: { workspace: string | undefined; area: RefObject<HTMLElement | null> }) => {
  const { state, change } = useShell();
  const pill = useRef<HTMLDivElement>(null);
  const bounds = usePillBounds(area, pill);
  // Not saved: the pill starts in the corner each time the window opens.
  const [offset, setOffset] = useState(0);
  const drag = useRef<{ y: number; offset: number }>(undefined);
  const gripHint = useId();
  if (workspace === undefined) return null;
  const active = activeToolbarButton(state, workspace);

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, offset };
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const from = drag.current;
    if (from === undefined || bounds === undefined || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setOffset(movedPill(from.offset, event.clientY - from.y, bounds));
  };
  const endDrag = () => {
    drag.current = undefined;
  };
  const moveByKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const dy = pillKeyMove(event.key);
    if (dy === undefined || bounds === undefined) return;
    event.preventDefault();
    setOffset((current) => movedPill(current, dy, bounds));
  };

  return (
    <div
      ref={pill}
      role="toolbar"
      aria-label="Toolbar"
      aria-orientation="vertical"
      className={cn("absolute z-10 flex flex-col items-center gap-0.5 rounded-md border border-line bg-surface-1 p-0.5", bounds === undefined && "invisible")}
      style={{ right: PILL_GAP, top: bounds === undefined ? 0 : pillTop(offset, bounds) }}
    >
      <span id={gripHint} className="sr-only">
        {GRIP_HINT}
      </span>
      <button
        type="button"
        title="Move the toolbar"
        aria-label="Move the toolbar"
        aria-describedby={gripHint}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={moveByKey}
        className={cn(BUTTON, "size-6 cursor-grab touch-none active:cursor-grabbing")}
      >
        <GripHorizontal className="size-3" strokeWidth={2} />
      </button>
      {activities().map(({ id, title, icon: Icon }) => (
        <button
          key={id}
          type="button"
          title={title}
          aria-label={title}
          aria-pressed={id === active}
          onClick={() => change((current) => pressToolbarButton(current, workspace, id))}
          className={cn(BUTTON, "size-6", id === active && "bg-surface-3 text-fg-primary hover:bg-surface-3 hover:text-fg-primary")}
        >
          <Icon className="size-3.5" strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
};
