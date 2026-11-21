import { createContext, type ReactNode, useContext, useMemo } from "react";

export type References = { prefixes: readonly string[]; render: (handle: string) => ReactNode };

const ReferenceContext = createContext<References | undefined>(undefined);

/**
 * How the Markdown below renders references to items: the binders' prefixes, and what a reference renders as. Every
 * Markdown below renders again when the value changes, so it changes only when the prefixes' content or `render` does.
 */
export const ReferenceProvider = ({ prefixes, render, children }: References & { children: ReactNode }) => {
  const key = JSON.stringify(prefixes);
  const value = useMemo((): References => ({ prefixes: JSON.parse(key) as string[], render }), [key, render]);
  return <ReferenceContext value={value}>{children}</ReferenceContext>;
};

/** The references the nearest `ReferenceProvider` supplies; none outside one. */
export const useReferences = (): References | undefined => useContext(ReferenceContext);
