// Reading the errno code of a failed file operation, the one place it is done.
const codeOf = (error: unknown) => {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
};

/** The errno code (EEXIST, EACCES, …), else the error's name, else "unknown error". */
export const errorCode = (error: unknown): string => codeOf(error) ?? (error instanceof Error ? error.name : "unknown error");

/** Whether the file or folder doesn't exist. */
export const isMissing = (error: unknown) => codeOf(error) === "ENOENT";
