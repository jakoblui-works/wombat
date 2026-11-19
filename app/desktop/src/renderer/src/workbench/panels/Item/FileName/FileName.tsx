import type { Problem } from "@wombat/shared/items";
import { useId } from "react";

import { ProblemList } from "../../Desk/ProblemList/ProblemList.tsx";

/** A free-named binder's draft: the file the item is written to, the service's refusal of it under the input. */
export const FileName = ({ value, onChange, problems }: { value: string; onChange: (value: string) => void; problems: readonly Problem[] }) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="text-fg-tertiary">
        File name
      </label>
      <input
        id={id}
        className="focus-ring h-8 w-full min-w-0 rounded-md border border-line-strong bg-surface-1 px-2.5 font-mono text-sm text-fg-primary"
        value={value}
        aria-invalid={problems.length > 0}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <ProblemList problems={problems} file={value} className="text-sm text-danger" />
    </div>
  );
};
