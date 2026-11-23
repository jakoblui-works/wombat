import { createContext, useContext } from "react";

/** The workspace of the surface (a chat, a tab, the Desk) its references, previews and follows resolve in. */
export const SurfaceWorkspaceContext = createContext<string | undefined>(undefined);

/** The workspace of the surface the caller is in; undefined outside one, or while the surface doesn't know it yet. */
export const useSurfaceWorkspace = (): string | undefined => useContext(SurfaceWorkspaceContext);
