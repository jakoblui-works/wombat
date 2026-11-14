import { cn } from "../../../lib/utils";

/**
 * A proposal's path (or label) with its last part kept whole: the folders are cut from their start, the DOM text stays
 * complete. `className` sets the text's look.
 */
export const PathText = ({ path, className }: { path: string; className?: string }) => {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <span title={path} className={cn("flex min-w-0", className)}>
      {/* Right to left, so the cut and its ellipsis fall at the folder's start; the isolated span keeps its order. */}
      <span className="min-w-0 truncate text-left [direction:rtl]">
        <span className="[direction:ltr] [unicode-bidi:isolate]">{path.slice(0, cut)}</span>
      </span>
      <span className="shrink-0">{path.slice(cut)}</span>
    </span>
  );
};
