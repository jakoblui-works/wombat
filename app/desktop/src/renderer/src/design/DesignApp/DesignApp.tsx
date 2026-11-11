import { type ReactNode, useSyncExternalStore } from "react";

import { AgentList } from "../AgentList/AgentList.tsx";
import { Chat } from "../Chat/Chat.tsx";
import { EmptyFiles } from "../EmptyFiles/EmptyFiles.tsx";
import { EmptyState } from "../EmptyState/EmptyState.tsx";
import { NeedsMe } from "../NeedsMe/NeedsMe.tsx";
import { Reconnecting } from "../Reconnecting/Reconnecting.tsx";
import { EditorGroup } from "../Shell/EditorGroup.tsx";
import { Shell } from "../Shell/Shell.tsx";

const EmptyGroup = () => <EmptyState title="No tab open" body="Open an agent from the list, or drag a tab here." />;

/** The editor area split in two: the checkout agent's chat beside an empty group. */
const SplitEditor = () => (
  <>
    <EditorGroup tabs={["a1", "a4"]} active="a1" wide>
      <Chat />
    </EditorGroup>
    <EditorGroup tabs={[]}>
      <EmptyGroup />
    </EditorGroup>
  </>
);

const ChatEditor = () => (
  <EditorGroup tabs={["a1", "a4"]} active="a1">
    <Chat />
  </EditorGroup>
);

const SCREENS: Record<string, () => ReactNode> = {
  shell: () => <Shell activity="agents" sidebar={<AgentList selected="a1" />} editor={<SplitEditor />} />,
  agents: () => (
    <Shell
      activity="agents"
      sidebar={<AgentList />}
      editor={
        <EditorGroup tabs={[]}>
          <EmptyState title="No agent open" body="Open an agent from the list to see its chat, or start a new one." />
        </EditorGroup>
      }
    />
  ),
  chat: () => <Shell activity="agents" sidebar={<AgentList selected="a1" />} editor={<ChatEditor />} />,
  "needs-me": () => <Shell activity="agents" sidebar={<AgentList selected="a1" />} editor={<ChatEditor />} needsMe={<NeedsMe />} />,
  reconnecting: () => (
    <Shell activity="agents" sidebar={<AgentList selected="a1" />} editor={<SplitEditor />} connection="reconnecting" blocker={<Reconnecting />} />
  ),
  "empty-files": () => <Shell activity="files" sidebar={<EmptyFiles />} editor={<SplitEditor />} />,
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
