// What a read gives to show, and what the app says when no item has the ref read, pure.
import { ItemsErrorCode } from "@wombat/shared/api";

import { ServiceError } from "../../data/client.ts";
import { asError } from "../../lib/errors.ts";

/** A query as TanStack gives it: `data` may be stale beside an `error`. */
export type Read<T> = { data: T | undefined; error: unknown };

/** Whether the service answered that no item has the ref read. */
export const isItemNotFound = (error: unknown): boolean => error instanceof ServiceError && error.code === ItemsErrorCode.enum.item_not_found;

/** What the app says when no item has the ref read; `name` calls the item by its handle, never its id ("This item"). */
export const itemNotFound = (name: string): string =>
  `${name} can't be found: it may have been deleted or its handle changed. Check the link or handle that named it, or look for the item in its binder's views.`;

/** Whether the service answered the read with an error (a read the bridge refused, while disconnected, didn't reach it). */
const answeredWithError = (read: Read<unknown>): boolean => read.error instanceof ServiceError;

/**
 * A query's data as the service last gave it: kept through a read the bridge refused (the panel dims meanwhile),
 * dropped once the service answered with an error.
 */
export const usable = <T>(read: Read<T>): T | undefined => (answeredWithError(read) ? undefined : read.data);

/** The read's error when it leaves no data to show; undefined while it's loading or has data. */
export const unshown = (read: Read<unknown>): string | undefined =>
  usable(read) === undefined && read.error !== null && read.error !== undefined ? asError(read.error).message : undefined;
