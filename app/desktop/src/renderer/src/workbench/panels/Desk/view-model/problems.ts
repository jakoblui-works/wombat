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
