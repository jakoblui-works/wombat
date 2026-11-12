// An edit's lines, old against new, pure: what the chat's edit card shows. Myers' diff (the fewest lines removed and
// added), after the lines both texts start and end with are set aside.

/** One line of a diff: unchanged (both numbers), removed (its old number) or added (its new number); numbers from 1. */
export type DiffLine =
  | { kind: "context"; text: string; oldLine: number; newLine: number }
  | { kind: "removed"; text: string; oldLine: number }
  | { kind: "added"; text: string; newLine: number };

/** A text's lines: split on "\n", where a trailing "\n" ends the last line rather than starting an empty one. */
const linesOf = (text: string): string[] => {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

type Step = "same" | "removed" | "added";

/**
 * The fewest steps from `a` to `b` (Myers, "An O(ND) difference algorithm"), in order; undefined once more than
 * `maxChanges` lines would be removed and added. Keeps each round's furthest reach to walk back from the end.
 */
const shortestSteps = (a: readonly string[], b: readonly string[], maxChanges: number): Step[] | undefined => {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n + m, maxChanges);
  // reach[d] holds, for each diagonal k in -d..d (at index k + d), how far along `a` round d got.
  const reach: Int32Array[] = [];
  let previous = new Int32Array(1);
  const from = (round: Int32Array, d: number, k: number): number => round[k + d] ?? 0;
  for (let d = 0; d <= limit; d += 1) {
    const current = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k += 2) {
      // Down (an added line) from diagonal k + 1, or right (a removed line) from k - 1: whichever reached further.
      const down = k === -d || (k !== d && from(previous, d - 1, k - 1) < from(previous, d - 1, k + 1));
      let x = d === 0 ? 0 : down ? from(previous, d - 1, k + 1) : from(previous, d - 1, k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      current[k + d] = x;
      if (x >= n && y >= m) {
        reach.push(current);
        return walkBack(reach, n, m);
      }
    }
    reach.push(current);
    previous = current;
  }
  return undefined;
};

/** The steps that led to (n, m), from the rounds' reaches, in order from the start. */
const walkBack = (reach: readonly Int32Array[], n: number, m: number): Step[] => {
  const steps: Step[] = [];
  let x = n;
  let y = m;
  for (let d = reach.length - 1; d > 0; d -= 1) {
    const before = reach[d - 1] ?? new Int32Array(0);
    const at = (k: number): number => before[k + d - 1] ?? 0;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const fromK = down ? k + 1 : k - 1;
    const fromX = at(fromK);
    const fromY = fromX - fromK;
    while (x > (down ? fromX : fromX + 1) && y > (down ? fromY + 1 : fromY)) {
      steps.push("same");
      x -= 1;
      y -= 1;
    }
    steps.push(down ? "added" : "removed");
    x = fromX;
    y = fromY;
  }
  while (x > 0 && y > 0) {
    steps.push("same");
    x -= 1;
    y -= 1;
  }
  return steps.reverse();
};

/**
 * The lines of `oldText` and `newText` as a line diff; undefined once more than `maxChanges` lines would be removed
 * and added (so a card that shows a few changes doesn't diff a rewritten file to the end).
 */
export const lineDiffWithin = (oldText: string, newText: string, maxChanges: number): DiffLine[] | undefined => {
  const a = linesOf(oldText);
  const b = linesOf(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  const steps = shortestSteps(a.slice(start, a.length - end), b.slice(start, b.length - end), maxChanges);
  if (steps === undefined) return undefined;

  const lines: DiffLine[] = [];
  let oldAt = 0;
  let newAt = 0;
  const same = () => {
    lines.push({ kind: "context", text: a[oldAt] ?? "", oldLine: oldAt + 1, newLine: newAt + 1 });
    oldAt += 1;
    newAt += 1;
  };
  for (let i = 0; i < start; i += 1) same();
  for (const step of steps) {
    if (step === "same") same();
    else if (step === "removed") {
      lines.push({ kind: "removed", text: a[oldAt] ?? "", oldLine: oldAt + 1 });
      oldAt += 1;
    } else {
      lines.push({ kind: "added", text: b[newAt] ?? "", newLine: newAt + 1 });
      newAt += 1;
    }
  }
  for (let i = 0; i < end; i += 1) same();
  return lines;
};

/** The lines of `oldText` and `newText` (split on "\n"; a trailing "\n" ends the last line) as a line diff. */
export const lineDiff = (oldText: string, newText: string): DiffLine[] => lineDiffWithin(oldText, newText, Number.POSITIVE_INFINITY) ?? [];
