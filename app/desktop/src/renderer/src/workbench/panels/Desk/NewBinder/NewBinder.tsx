import { type BinderSummary, type Problem, SETTINGS_FILE } from "@wombat/shared/items";
import { type FormEvent, useId, useRef, useState } from "react";

import { Button } from "../../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../../../../components/ui/dialog";
import { ServiceError } from "../../../../data/client.ts";
import { useCreateBinder } from "../../../../data/commands.ts";
import { asError } from "../../../../lib/errors.ts";
import { ProblemList } from "../ProblemList/ProblemList.tsx";
import { problemsByField } from "../view-model/problems.ts";
import { EMPTY_FORM, editForm, type NewBinderField, newBinderRequest } from "./new-binder.ts";

type Props = {
  open: boolean;
  /** The drawer it was opened from, root-relative; "" for the items folder. */
  drawer: string;
  onCancel: () => void;
  onCreated: (binder: BinderSummary) => void;
};

/** The service's problem field for each of the form's fields. */
const PROBLEM_FIELD: Record<NewBinderField, string> = { name: "name", prefix: "prefix", folder: "path" };

const Field = ({ label, hint, value, problems, onChange }: { label: string; hint?: string; value: string; problems: readonly Problem[]; onChange: (value: string) => void }) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="text-fg-secondary">
        {label}
      </label>
      <input
        id={id}
        className="focus-ring h-8 w-full min-w-0 rounded-md border border-line-strong bg-surface-1 px-2.5 text-sm text-fg-primary"
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={problems.length > 0}
        aria-describedby={hint === undefined ? `${id}-problems` : `${id}-hint ${id}-problems`}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-xs text-fg-tertiary">
          {hint}
        </p>
      )}
      <ProblemList id={`${id}-problems`} problems={problems} file={undefined} className="text-sm text-danger" />
    </div>
  );
};

const NewBinderForm = ({ drawer, onCancel, onCreated }: Omit<Props, "open">) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const create = useCreateBinder();
  const error = create.error;
  const problems = error instanceof ServiceError ? (error.problems ?? []) : [];
  const { at, rest } = problemsByField(problems, Object.values(PROBLEM_FIELD));
  const problemsAt = (field: NewBinderField) => at.get(PROBLEM_FIELD[field]) ?? [];
  const edit = (field: NewBinderField) => (value: string) => setForm((current) => editForm(current, field, value));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(newBinderRequest(drawer, form), { onSuccess: onCreated });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Field label="Name" value={form.name} problems={problemsAt("name")} onChange={edit("name")} />
      <Field label="Prefix" hint={`Items get handles like ${form.prefix === "" ? "BUG" : form.prefix}-1.`} value={form.prefix} problems={problemsAt("prefix")} onChange={edit("prefix")} />
      <Field
        label="Folder"
        hint={`${drawer === "" ? "In the items folder" : `In ${drawer}`}; a / makes new drawers.`}
        value={form.folder}
        problems={problemsAt("folder")}
        onChange={edit("folder")}
      />
      {error === null ? null : problems.length > 0 ? (
        <ProblemList problems={rest} file={undefined} className="text-sm text-danger" />
      ) : (
        <p role="alert" className="text-sm whitespace-pre-line text-danger">
          {asError(error).message}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          Create
        </Button>
      </DialogFooter>
    </form>
  );
};

/** Asks for a new binder's name, prefix and folder; the service writes its starter settings, which are then edited by hand. */
export const NewBinder = ({ open, drawer, onCancel, onCreated }: Props) => {
  const created = useRef(false);
  const folderName = drawer.slice(drawer.lastIndexOf("/") + 1);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      onOpenChangeComplete={(next) => {
        if (next) created.current = false;
      }}
    >
      {/* After a create, focus goes to the new binder's row, not back to the button that opened the dialog. */}
      <DialogContent finalFocus={() => !created.current}>
        <DialogTitle>{drawer === "" ? "New binder" : `New binder in ${folderName}`}</DialogTitle>
        <DialogDescription>A binder is a folder with a starter {SETTINGS_FILE}, which you edit by hand to add properties and views.</DialogDescription>
        <NewBinderForm
          drawer={drawer}
          onCancel={onCancel}
          onCreated={(binder) => {
            created.current = true;
            onCreated(binder);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
