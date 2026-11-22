import type { Problem } from "@wombat/shared/items";

import { cn } from "../../../../lib/utils";
import { Field, FIELD_INPUT } from "../../Desk/Field/Field.tsx";

/** A free-named binder's draft: the file the item is written to, the service's refusal of it under the input. */
export const FileName = ({ value, onChange, problems }: { value: string; onChange: (value: string) => void; problems: readonly Problem[] }) => (
  <Field label="File name" problems={problems} file={value}>
    {(control) => <input {...control} className={cn(FIELD_INPUT, "font-mono")} value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} />}
  </Field>
);
