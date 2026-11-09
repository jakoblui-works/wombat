// STUB from the test-writer (step 5b, S1): the interface of interface-S1.md "Service modules" (T3) so the tests
// compile and fail on their own assertions. The T3 builder replaces this file. `openWriter` is the test-writer's
// assumption for how the three write functions get their root and store (the interface lists only the functions).
import type { Log } from "../agents/manager.ts";
import type { Store } from "../store/store.ts";
import type { LoadedItem, Problem } from "./catalog.ts";

export type ItemWriteErrorCode = "stale_version" | "invalid_fields" | "item_not_found" | "field_not_writable";

/** Why a write was refused; nothing on disk changed. */
export class ItemWriteError extends Error {
  readonly code: ItemWriteErrorCode;
  readonly problems: Problem[];

  constructor(code: ItemWriteErrorCode, message: string, problems: Problem[] = []) {
    super(message);
    this.name = "ItemWriteError";
    this.code = code;
    this.problems = problems;
  }
}

export type NewItem = {
  title: string;
  body: string;
  properties: Record<string, unknown>;
  /** Free naming only: the file's path in the structure. */
  file?: string;
};

export type Writer = {
  createItem(structureId: string, item: NewItem): Promise<LoadedItem>;
  /** One or more fields, title and body included; refused when the file changed since `baseVersion`. */
  updateItem(handle: string, fields: Record<string, unknown>, baseVersion: string): Promise<LoadedItem>;
  deleteItem(handle: string, baseVersion: string): Promise<void>;
};

export type WriterOptions = { root: string; store: Store; log?: Log };

export const openWriter = (opts: WriterOptions): Writer => {
  // Opening succeeds so the catalog's tests can open both; every write is refused until the writer exists.
  const notYet = () => Promise.reject(new Error(`not implemented (items root ${opts.root})`));
  return { createItem: notYet, updateItem: notYet, deleteItem: notYet };
};
