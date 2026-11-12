/** The last part of a path, either separator (a file's or folder's name); the path itself when it has no parts. */
export const lastPathPart = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
