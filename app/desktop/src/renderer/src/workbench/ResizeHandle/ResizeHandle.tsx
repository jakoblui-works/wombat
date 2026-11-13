import type { PointerEvent } from "react";

/** A vertical line between regions that reports how far it's dragged sideways, in pixels since the last report. */
export const ResizeHandle = ({ label, onDrag }: { label: string; onDrag: (dx: number) => void }) => {
  const start = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) onDrag(event.movementX);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      className="relative z-10 w-px shrink-0 bg-line transition-colors after:absolute after:inset-y-0 after:-left-1 after:w-3 hover:bg-line-strong"
      onPointerDown={start}
      onPointerMove={move}
    />
  );
};
