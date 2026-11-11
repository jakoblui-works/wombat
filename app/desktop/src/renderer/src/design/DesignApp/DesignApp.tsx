import { type ReactNode, useSyncExternalStore } from "react";

import { Chat } from "../Chat/Chat.tsx";
import { NeedsMe } from "../NeedsMe/NeedsMe.tsx";

/** The S7 views on their own, until S7 builds them into the workbench. */
const SCREENS: Record<string, () => ReactNode> = {
  chat: () => (
    <div className="flex h-screen bg-surface-1">
      <Chat />
    </div>
  ),
  "needs-me": () => (
    <div className="flex h-screen w-80 flex-col bg-surface-0">
      <NeedsMe />
    </div>
  ),
};

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const currentScreen = (): string => location.hash.replace(/^#design\/?/, "");

/** The static design screens, one per `#design/<screen>` (design builds only). */
export const DesignApp = () => {
  const render = SCREENS[useSyncExternalStore(subscribeToHash, currentScreen)];
  if (!render) {
    return (
      <nav className="flex flex-col gap-1 p-6 text-base">
        {Object.keys(SCREENS).map((name) => (
          <a key={name} href={`#design/${name}`} className="text-fg-secondary hover:text-fg-primary">
            #design/{name}
          </a>
        ))}
      </nav>
    );
  }
  return <div data-testid="design-ready">{render()}</div>;
};
