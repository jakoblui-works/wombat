import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import { startAgentVars, useStartAgent } from "../../../data/commands.ts";
import { useAgents, useConnection, useHarnesses, useRepos, useWorkspaces } from "../../../data/hooks.ts";
import { asError } from "../../../lib/errors.ts";
import { messageBoxMark } from "../../agents/chat-params.ts";
import { useOpenAgent } from "../../agents/open-agent-chat.ts";
import { newChatFocusTaken, useNewChatFocusWanted } from "../../commands/new-chat-focus.ts";
import { newChat, sameView, shownView } from "../../shell/shell-state.ts";
import { useShell, useShownWorkspace } from "../../shell/ShellProvider.tsx";
import { pickOf, repoChoices } from "./ComposerBar/bar-picks.ts";
import { ComposerBar } from "./ComposerBar/ComposerBar.tsx";
import { canSend, keyAction } from "./Composer/composer-state.ts";
import { composerEvent, handOverUnsent, NEW_CHAT_BOX, pickNewChatHarness, pickNewChatRepo, useComposerEntry, useNewChatPicks } from "./Composer/unsent.ts";

/** The repo the last start used (main keeps it while the app runs); undefined until read, or when none was. */
const useLastRepo = (): string | undefined => {
  const [last, setLast] = useState<string>();
  useEffect(() => {
    let live = true;
    window.wombat.settings.get().then(
      ({ lastAgentFolder }) => live && setLast(lastAgentFolder),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return last;
};

/** The empty chat: the composer bar and the message box; the first message starts the agent where the bar points. */
export const NewChat = () => {
  const { state, change } = useShell();
  const agents = useAgents();
  const workspaces = useWorkspaces();
  const workspace = useShownWorkspace();
  const repos = useRepos(workspace?.id);
  const harnesses = useHarnesses();
  const start = useStartAgent();
  const openAgent = useOpenAgent();
  const connected = useConnection().state === "connected";
  const { composer } = useComposerEntry(NEW_CHAT_BOX);
  const lastRepo = useLastRepo();
  const picks = useNewChatPicks();
  const box = useRef<HTMLTextAreaElement>(null);
  const focusWanted = useNewChatFocusWanted();
  useEffect(() => {
    if (!focusWanted) return;
    box.current?.focus();
    newChatFocusTaken();
  }, [focusWanted]);

  const offeredRepos = repoChoices(repos.data?.repos, workspace);
  const repo = pickOf(
    offeredRepos.map(({ path }) => path),
    workspace === undefined ? undefined : picks.repos[workspace.id],
    lastRepo,
  );
  const listedHarnesses = harnesses.data ?? [];
  const harness = pickOf(
    listedHarnesses.map(({ id }) => id),
    picks.harness,
  );
  const target =
    workspace !== undefined && repo !== undefined && harness !== undefined && canSend(composer, { turnActive: false, connected })
      ? { workspace: workspace.id, repo, harness }
      : undefined;

  const send = () => {
    if (target === undefined) return;
    const text = composer.text;
    const agentList = agents.data?.agents;
    const workspaceList = workspaces.data?.workspaces;
    const atSend = shownView(state, agentList, workspaceList);
    composerEvent(NEW_CHAT_BOX, { type: "send" });
    // Settled through the promise, not mutate's callbacks: those skip a chat that stopped showing meanwhile.
    start.mutateAsync(startAgentVars({ ...target, text })).then(
      ({ agent, sendError }) => {
        // The agent exists now, so the text mustn't start another: a first message it didn't take goes to its own box.
        if (sendError !== undefined) handOverUnsent(agent.id, text, sendError);
        composerEvent(NEW_CHAT_BOX, { type: "sent", about: undefined });
        window.wombat.settings.set({ lastAgentFolder: target.repo }).catch(() => undefined);
        openAgent(agent.id, undefined, (now) => sameView(atSend, shownView(now, agentList, workspaceList)));
      },
      (error: unknown) => composerEvent(NEW_CHAT_BOX, { type: "failed", message: asError(error).message }),
    );
  };

  const error = composer.error ?? workspaces.error?.message ?? harnesses.error?.message;
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end">
      <div className="shrink-0 px-5 pt-3 pb-2.5">
        <div className="mx-auto max-w-chat">
          <ComposerBar
            workspaces={workspaces.data?.workspaces ?? []}
            workspace={workspace}
            onWorkspace={(id) => change((current) => newChat(current, id))}
            repos={offeredRepos}
            repo={repo}
            onRepo={(path) => workspace !== undefined && pickNewChatRepo(workspace.id, path)}
            harnesses={listedHarnesses}
            harness={harness}
            onHarness={pickNewChatHarness}
          />
          <div className="flex items-end gap-2 rounded-lg border border-line-strong bg-surface-2 py-1.5 pr-1.5 pl-3 transition-colors focus-within:border-focus">
            <textarea
              {...messageBoxMark}
              ref={box}
              aria-label="Message"
              rows={1}
              placeholder="What should the agent do?"
              value={composer.text}
              onChange={(event) => composerEvent(NEW_CHAT_BOX, { type: "edit", text: event.target.value })}
              onKeyDown={(event) => {
                if (keyAction({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing }) !== "send") return;
                event.preventDefault();
                send();
              }}
              className="max-h-48 min-w-0 flex-1 resize-none self-center bg-transparent text-base text-fg-primary outline-none field-sizing-content placeholder:text-fg-tertiary"
            />
            <Button variant="secondary" size="sm" disabled={target === undefined} onClick={send}>
              <ArrowUp />
              Send
            </Button>
          </div>
          {error === undefined ? null : (
            <p role="alert" className="px-3 pt-1.5 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
