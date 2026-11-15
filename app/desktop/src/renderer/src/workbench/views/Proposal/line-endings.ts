// Monaco gives a model one line ending and drops a leading byte order mark; a proposal's text may mix line endings and
// start with a mark, and the service writes exactly what it gets.
import { lineDiffWithin } from "@wombat/shared/line-diff";

const BREAK = /\r\n|\r|\n/;
const BOM = "\uFEFF";

const withoutBom = (text: string): string => (text.startsWith(BOM) ? text.slice(BOM.length) : text);

/** `text` as the editor gives it back: every line break a "\n", no leading byte order mark. */
export const asEditorText = (text: string): string => withoutBom(text).replace(new RegExp(BREAK, "g"), "\n");

type Line = { text: string; end: string };

const linesOf = (text: string): Line[] => {
  const lines: Line[] = [];
  let rest = text;
  for (let found = BREAK.exec(rest); found !== null; found = BREAK.exec(rest)) {
    lines.push({ text: rest.slice(0, found.index), end: found[0] });
    rest = rest.slice(found.index + found[0].length);
  }
  lines.push({ text: rest, end: "" });
  return lines;
};

// Past this many lines removed and added, lines are paired on the lines each side holds once, and past that by position.
const MAX_MATCH_CHANGES = 2_000;

/** `edited`'s lines paired with `source`'s by position, except that its equal last lines pair with `source`'s last. */
const byPosition = (source: readonly string[], edited: readonly string[]): number[] => {
  let tail = 0;
  while (tail < source.length && tail < edited.length && source[source.length - 1 - tail] === edited[edited.length - 1 - tail]) tail += 1;
  return edited.map((_, index) => (index >= edited.length - tail ? index - edited.length + source.length : index < source.length ? index : -1));
};

/** The lines each side holds exactly once, as [source index, edited index] in order: the most such pairs that keep it. */
const uniqueAnchors = (source: readonly string[], edited: readonly string[]): [number, number][] => {
  const onceAt = (lines: readonly string[]) => {
    const at = new Map<string, number>();
    lines.forEach((line, index) => at.set(line, at.has(line) ? -1 : index));
    return at;
  };
  const inSource = onceAt(source);
  const inEdited = onceAt(edited);
  const pairs = edited.flatMap((line, j): [number, number][] => {
    const i = inSource.get(line) ?? -1;
    return i >= 0 && inEdited.get(line) === j ? [[i, j]] : [];
  });
  // The longest run of pairs whose source indices rise too (patience sorting): `ends[k]` ends the best run of k + 1.
  const ends: number[] = [];
  const before = pairs.map(() => -1);
  pairs.forEach(([i], index) => {
    let low = 0;
    let high = ends.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((pairs[ends[middle] ?? 0]?.[0] ?? 0) < i) low = middle + 1;
      else high = middle;
    }
    before[index] = low === 0 ? -1 : (ends[low - 1] ?? -1);
    ends[low] = index;
  });
  const run: [number, number][] = [];
  for (let index = ends.at(-1) ?? -1; index >= 0; index = before[index] ?? -1) {
    const pair = pairs[index];
    if (pair !== undefined) run.push(pair);
  }
  return run.reverse();
};

/** For each line of `edited`, the index of the `source` line it keeps (equal text, in order), or -1 for a new line. */
const matchLines = (source: readonly string[], edited: readonly string[]): number[] => {
  // No line holds a break, so one "\n" after each splits back into exactly these lines.
  const diff = lineDiffWithin(source.map((line) => `${line}\n`).join(""), edited.map((line) => `${line}\n`).join(""), MAX_MATCH_CHANGES);
  const matched = edited.map(() => -1);
  if (diff !== undefined) {
    for (const line of diff) if (line.kind === "context") matched[line.newLine - 1] = line.oldLine - 1;
    return matched;
  }
  const anchors = uniqueAnchors(source, edited);
  if (anchors.length === 0) return byPosition(source, edited);
  let fromSource = 0;
  let fromEdited = 0;
  for (const [i, j] of [...anchors, [source.length, edited.length] as const]) {
    matchLines(source.slice(fromSource, i), edited.slice(fromEdited, j)).forEach((at, k) => {
      if (at >= 0) matched[fromEdited + k] = fromSource + at;
    });
    if (j < edited.length) matched[j] = i;
    fromSource = i + 1;
    fromEdited = j + 1;
  }
  return matched;
};

// Past this many cells a run is paired by position instead of by how alike its lines are.
const MAX_PAIR_CELLS = 250_000;

/** How alike two lines are, from 0 to 1: their common start and end against the longer one's length. */
const likeness = (a: string, b: string): number => {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  return (start + end) / longest;
};

/**
 * For each `edited` line, the index of the `source` line it pairs with, in order, or -1: as many pairs as the shorter
 * side has lines, and of those pairings the one whose lines are most alike.
 */
const pairInOrder = (source: readonly string[], edited: readonly string[]): number[] => {
  if (source.length === edited.length || source.length * edited.length > MAX_PAIR_CELLS) return edited.map((_, index) => (index < source.length ? index : -1));
  // Each pair is worth more than the likeness of all pairs together, so the most pairs always win.
  const pairWorth = Math.min(source.length, edited.length) + 1;
  const width = source.length + 1;
  const best = new Float64Array((edited.length + 1) * width);
  const paired = (i: number, j: number) => pairWorth + likeness(edited[i] ?? "", source[j] ?? "") + (best[(i + 1) * width + j + 1] ?? 0);
  for (let i = edited.length - 1; i >= 0; i -= 1) {
    for (let j = source.length - 1; j >= 0; j -= 1) best[i * width + j] = Math.max(best[(i + 1) * width + j] ?? 0, best[i * width + j + 1] ?? 0, paired(i, j));
  }
  const pairs = edited.map(() => -1);
  let i = 0;
  let j = 0;
  while (i < edited.length && j < source.length) {
    const here = best[i * width + j] ?? 0;
    if (here === paired(i, j)) {
      pairs[i] = j;
      i += 1;
      j += 1;
    } else if (here === (best[(i + 1) * width + j] ?? 0)) i += 1;
    else j += 1;
  }
  return pairs;
};

/**
 * Each run of `edited` lines that `matched` leaves out, paired with the `source` lines left out between the same
 * neighbours: an edited line stands in for the line it was typed on.
 */
const pairRuns = (matched: readonly number[], source: readonly string[], edited: readonly string[]): number[] => {
  const paired = [...matched];
  let index = 0;
  let lastSource = -1;
  while (index < matched.length) {
    const at = matched[index] ?? -1;
    if (at >= 0) {
      lastSource = at;
      index += 1;
      continue;
    }
    let end = index;
    while (end < matched.length && (matched[end] ?? -1) < 0) end += 1;
    const nextSource = end < matched.length ? (matched[end] ?? source.length) : source.length;
    const runStart = index;
    pairInOrder(source.slice(lastSource + 1, nextSource), edited.slice(runStart, end)).forEach((pair, k) => {
      if (pair >= 0) paired[runStart + k] = lastSource + 1 + pair;
    });
    index = end;
  }
  return paired;
};

/**
 * `edited` (the editor's text, its line endings normalised) with the endings put back, for each line the first of:
 * the ending of the same line in `source` (the text the editor loaded); of the same line in `file` (the file's text,
 * which a dropped hunk brings back); of the `source` line it was typed on; of the line above it (the first line:
 * `source`'s first ending, else "\n"). Whether the text ends with a line ending is `edited`'s, whether it starts with
 * a byte order mark `source`'s.
 */
export const keepLineEndings = (source: string, edited: string, file = ""): string => {
  const from = linesOf(withoutBom(source));
  const onFile = linesOf(withoutBom(file));
  const to = linesOf(withoutBom(edited));
  const texts = to.map(({ text }) => text);
  const sourceTexts = from.map(({ text }) => text);
  const kept = matchLines(sourceTexts, texts);
  const fromFile = matchLines(
    onFile.map(({ text }) => text),
    texts,
  );
  const typedOn = pairRuns(kept, sourceTexts, texts);
  let previous = from.find(({ end }) => end !== "")?.end ?? "\n";
  const bom = source.startsWith(BOM) ? BOM : "";
  return bom + to
    .map((line, index) => {
      if (index === to.length - 1) return line.text;
      const candidates = [from[kept[index] ?? -1]?.end, onFile[fromFile[index] ?? -1]?.end, from[typedOn[index] ?? -1]?.end];
      const end = candidates.find((candidate) => candidate !== undefined && candidate !== "") ?? previous;
      previous = end;
      return line.text + end;
    })
    .join("");
};
