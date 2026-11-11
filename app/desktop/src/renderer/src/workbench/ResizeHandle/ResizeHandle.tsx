import type { PointerEvent } from "react";

/** A vertical bar that reports how far it's dragged sideways, in pixels since the last report. */
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
      className="w-1 shrink-0 cursor-col-resize bg-border"
      onPointerDown={start}
      onPointerMove={move}
    />
  );
};
