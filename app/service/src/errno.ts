// Reading the errno code of a failed file operation, the one place it is done.
const codeOf = (error: unknown) => {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
};

/** The errno code (EEXIST, EACCES, …), else the error's name, else "unknown error". */
export const errorCode = (error: unknown): string => codeOf(error) ?? (error instanceof Error ? error.name : "unknown error");

/** Whether the file or folder doesn't exist. */
export const isMissing = (error: unknown) => codeOf(error) === "ENOENT";

/** Whether a path doesn't exist, or runs through a file where a folder should be. */
export const isMissingPath = (error: unknown) => ["ENOENT", "ENOTDIR"].includes(codeOf(error) ?? "");

/** Whether a file that must be new already exists. */
export const isAlreadyThere = (error: unknown) => codeOf(error) === "EEXIST";

/** Whether a /proc read failed because the process is gone (or went while it was read). */
export const isProcessGone = (error: unknown) => ["ENOENT", "ESRCH"].includes(codeOf(error) ?? "");
