import { type BinderSummary, type Problem, SETTINGS_FILE } from "@wombat/shared/items";
import { type FormEvent, useRef, useState } from "react";

import { Button } from "../../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../../../../components/ui/dialog";
import { useCreateBinder } from "../../../../data/commands.ts";
import { writeProblems } from "../../../../data/write-failure.ts";
import { Field, FIELD_INPUT } from "../../../items/Field/Field.tsx";
import { ProblemList } from "../../../items/ProblemList/ProblemList.tsx";
import { problemsByField } from "../../../items/problems.ts";
import { ADOPT, EMPTY_FORM, editForm, type NewBinderField, newBinderRequest } from "./new-binder.ts";

type Props = {
  open: boolean;
  /** The drawer it was opened from, root-relative; "" for the items folder. */
  drawer: string;
  onCancel: () => void;
  onCreated: (binder: BinderSummary) => void;
};

/** The service's problem field for each of the form's fields. */
const PROBLEM_FIELD: Record<NewBinderField, string> = { name: "name", prefix: "prefix", folder: "path" };

const TextField = ({ label, hint, value, problems, onChange }: { label: string; hint?: string; value: string; problems: readonly Problem[]; onChange: (value: string) => void }) => (
  <Field label={label} hint={hint} problems={problems} file={undefined}>
    {(control) => <input {...control} className={FIELD_INPUT} value={value} spellCheck={false} autoComplete="off" onChange={(event) => onChange(event.target.value)} />}
  </Field>
);

const NewBinderForm = ({ drawer, onCancel, onCreated }: Omit<Props, "open">) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [askedFor, setAskedFor] = useState<string>();
  const create = useCreateBinder();
  const error = create.error;
  const problems = error === null ? [] : writeProblems(error);
  const { at, rest } = problemsByField(problems, Object.values(PROBLEM_FIELD));
  const problemsAt = (field: NewBinderField) => at.get(PROBLEM_FIELD[field]) ?? [];
  const edit = (field: NewBinderField) => (value: string) => setForm((current) => editForm(current, field, value));

  const request = newBinderRequest(drawer, form, askedFor);
  const adopting = request.adopt === true;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(request, {
      onSuccess: onCreated,
      onError: (failure) => setAskedFor(adopting || writeProblems(failure).some((problem) => problem.field === ADOPT) ? request.path : undefined),
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <TextField label="Name" value={form.name} problems={problemsAt("name")} onChange={edit("name")} />
      <TextField label="Prefix" hint={`Items get handles like ${form.prefix === "" ? "BUG" : form.prefix}-1.`} value={form.prefix} problems={problemsAt("prefix")} onChange={edit("prefix")} />
      <TextField
        label="Folder"
        hint={`${drawer === "" ? "In the items folder" : `In ${drawer}`}; a / makes new drawers.`}
        value={form.folder}
        problems={problemsAt("folder")}
        onChange={edit("folder")}
      />
      <div role="alert">
        <ProblemList problems={rest} file={undefined} className="text-sm text-danger" />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {adopting ? "Create anyway" : "Create"}
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
