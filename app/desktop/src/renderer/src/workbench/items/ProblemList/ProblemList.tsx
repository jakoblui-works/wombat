import type { Problem } from "@wombat/shared/items";

import { cn } from "../../../lib/utils";
import { problemLocation } from "../problems.ts";

type Props = {
  problems: readonly Problem[];
  /** The file a problem's line is in; undefined for an item with no file yet. */
  file: string | undefined;
  id?: string | undefined;
  /** Colour and size only. */
  className?: string | undefined;
};

/** Problems as the service words them, each with its location apart when it has one. */
export const ProblemList = ({ problems, file, id, className }: Props) =>
  problems.length === 0 ? null : (
    <ul id={id} className={cn("flex flex-col gap-1", className)}>
      {problems.map((problem, index) => {
        const location = problemLocation(problem, file);
        return (
          <li key={index} className="flex min-w-0 flex-col">
            <span className="whitespace-pre-wrap break-words">{problem.message}</span>
            {location === undefined ? null : <span className="text-xs text-fg-tertiary">{location}</span>}
          </li>
        );
      })}
    </ul>
  );
