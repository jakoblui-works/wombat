// Monaco gives a model one line ending; a proposal's text may mix them, and the service writes exactly what it gets.

const BREAK = /\r\n|\r|\n/;

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

// Past this many cells the changed middle is paired by position instead of by its longest common run of lines.
const MAX_MATCH_CELLS = 4_000_000;

/** For each line of `edited`, the index of the `source` line it keeps (equal text, in order), or -1 for a new line. */
const matchLines = (source: readonly string[], edited: readonly string[]): number[] => {
  const matched = edited.map(() => -1);
  let head = 0;
  while (head < source.length && head < edited.length && source[head] === edited[head]) {
    matched[head] = head;
    head += 1;
  }
  let tail = 0;
  while (tail < source.length - head && tail < edited.length - head && source[source.length - 1 - tail] === edited[edited.length - 1 - tail]) {
    matched[edited.length - 1 - tail] = source.length - 1 - tail;
    tail += 1;
  }
  const from = source.slice(head, source.length - tail);
  const to = edited.slice(head, edited.length - tail);
  if (from.length * to.length > MAX_MATCH_CELLS) {
    to.forEach((_, index) => {
      if (index < from.length) matched[head + index] = head + index;
    });
    return matched;
  }
  const width = to.length + 1;
  const table = new Uint32Array((from.length + 1) * width);
  for (let i = from.length - 1; i >= 0; i -= 1) {
    for (let j = to.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = from[i] === to[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  while (i < from.length && j < to.length) {
    if (from[i] === to[j]) {
      matched[head + j] = head + i;
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i += 1;
    else j += 1;
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
 * `source`'s first ending, else "\n"). Whether the text ends with a line ending is `edited`'s.
 */
export const keepLineEndings = (source: string, edited: string, file = ""): string => {
  const from = linesOf(source);
  const onFile = linesOf(file);
  const to = linesOf(edited);
  const texts = to.map(({ text }) => text);
  const sourceTexts = from.map(({ text }) => text);
  const kept = matchLines(sourceTexts, texts);
  const fromFile = matchLines(
    onFile.map(({ text }) => text),
    texts,
  );
  const typedOn = pairRuns(kept, sourceTexts, texts);
  let previous = from.find(({ end }) => end !== "")?.end ?? "\n";
  return to
    .map((line, index) => {
      if (index === to.length - 1) return line.text;
      const candidates = [from[kept[index] ?? -1]?.end, onFile[fromFile[index] ?? -1]?.end, from[typedOn[index] ?? -1]?.end];
      const end = candidates.find((candidate) => candidate !== undefined && candidate !== "") ?? previous;
      previous = end;
      return line.text + end;
    })
    .join("");
};
