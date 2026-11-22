import type { Problem } from "@wombat/shared/items";

/** Problems split by the row they belong to: `at` for a field among `names`, `rest` for the others. */
export const problemsByField = (problems: readonly Problem[], names: readonly string[]): { at: ReadonlyMap<string, Problem[]>; rest: Problem[] } => {
  const at = new Map<string, Problem[]>();
  const rest: Problem[] = [];
  for (const problem of problems) {
    if (problem.field === undefined || !names.includes(problem.field)) {
      rest.push(problem);
      continue;
    }
    at.set(problem.field, [...(at.get(problem.field) ?? []), problem]);
  }
  return { at, rest };
};

/** Where a problem is in `file`, "_binder.yaml, line 4"; undefined when the problem names no line or there is no file yet. */
export const problemLocation = ({ line }: Problem, file: string | undefined): string | undefined =>
  line === undefined || file === undefined ? undefined : `${file}, line ${String(line)}`;
