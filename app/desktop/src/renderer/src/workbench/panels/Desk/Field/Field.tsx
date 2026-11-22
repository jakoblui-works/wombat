import type { Problem } from "@wombat/shared/items";
import { type ReactNode, useId } from "react";

import { cn } from "../../../../lib/utils";
import { ProblemList } from "../ProblemList/ProblemList.tsx";

/** A text input's look in a field. */
export const FIELD_INPUT = "focus-ring h-8 w-full min-w-0 rounded-md border border-line-strong bg-surface-1 px-2.5 text-sm text-fg-primary";

/** A field's control's props: its id (the label's `htmlFor`), its state and its description. */
export type FieldControl = { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined };

type Props = {
  label: string;
  /** False for a control named through `aria-labelledby={labelId}` (a select) rather than the label's `htmlFor`. */
  labelsInput?: boolean;
  /** The label is for screen readers only (the Title, whose input is its own heading). */
  hideLabel?: boolean;
  hint?: string | undefined;
  problems: readonly Problem[];
  /** The file a problem's line is in. */
  file: string | undefined;
  /** "row": a `<dt>` and `<dd>` in a description list's grid. */
  layout?: "stack" | "row";
  /** The control, given its props and the label's id (for `aria-labelledby`). */
  children: (control: FieldControl, labelId: string) => ReactNode;
};

/** A label, its control, a hint and the control's problems, the hint and problems tied to it by aria-describedby. */
export const Field = ({ label, labelsInput = true, hideLabel = false, hint, problems, file, layout = "stack", children }: Props) => {
  const id = useId();
  const [labelId, hintId, problemsId] = [`${id}-label`, `${id}-hint`, `${id}-problems`];
  const described = [...(hint === undefined ? [] : [hintId]), ...(problems.length === 0 ? [] : [problemsId])].join(" ");
  const labelElement = (
    <label id={labelId} htmlFor={labelsInput ? id : undefined} className={cn(hideLabel ? "sr-only" : layout === "stack" && "text-fg-secondary")}>
      {label}
    </label>
  );
  const rest = (
    <>
      {children({ id, "aria-invalid": problems.length > 0, "aria-describedby": described === "" ? undefined : described }, labelId)}
      {hint === undefined ? null : (
        <p id={hintId} className="text-xs text-fg-tertiary">
          {hint}
        </p>
      )}
      <ProblemList id={problemsId} problems={problems} file={file} className="text-sm text-danger" />
    </>
  );
  if (layout === "row") {
    return (
      <div className="contents">
        <dt className="flex h-8 items-center text-fg-tertiary">{labelElement}</dt>
        <dd className="flex min-w-0 flex-col gap-1">{rest}</dd>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      {labelElement}
      {rest}
    </div>
  );
};
