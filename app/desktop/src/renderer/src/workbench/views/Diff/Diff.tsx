import { FilePen } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { Button } from "../../../components/ui/button";
import { chatModel } from "../../../data/chat-model.ts";
import { useAgentLog, useAgents, useConnection } from "../../../data/hooks.ts";
import type { ViewProps } from "../../registry.ts";
import { useAnswer } from "../Chat/answer.ts";
import { liveState } from "../Chat/live-state.ts";
import { CHANGE_GONE } from "../Chat/EditDiff/EditDiff.tsx";
import { AnswerButtons, Outcome, Waiting } from "../Chat/Permission/Permission.tsx";
import { DiffParams, diffTitle } from "./diff-params.ts";
import { editRequest } from "./edit-request.ts";

// Monaco loads with the first diff tab, not with the page.
const MonacoDiff = lazy(() => import("./MonacoDiff/MonacoDiff.tsx").then(({ MonacoDiff: component }) => ({ default: component })));

const Note = ({ children }: { children: string }) => <p className="p-5 text-sm text-fg-tertiary">{children}</p>;

/**
 * One edit request side by side: the request's diff in Monaco, with the chat's answer buttons. It reads the same
 * chat model item as the chat's card (`editRequest`) and its outcome by the same rule (`liveState`), so both show the
 * same; an answered request shows its outcome until the tab is closed.
 */
const EditDiff = ({ agentId, requestId, setTitle }: DiffParams & { setTitle: ViewProps["setTitle"] }) => {
  const log = useAgentLog(agentId);
  const agents = useAgents();
  const connected = useConnection().state === "connected";
  const answers = useAnswer(agentId);
  const agent = agents.data?.agents.find(({ id }) => id === agentId);
  const mainSessionId = agent?.sessionId;
  const entries = log.data?.entries;
  const model = useMemo(
    () => (entries === undefined ? undefined : chatModel(entries, mainSessionId === undefined ? {} : { mainSessionId })),
    [entries, mainSessionId],
  );
  const request = model === undefined ? undefined : editRequest(model, requestId);
  const path = request?.path;
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    if (path !== undefined) setTitle?.(diffTitle(path));
  }, [path, setTitle]);

  if (model === undefined) {
    return log.error ? (
      <p role="alert" className="p-5 text-sm text-danger">
        Couldn't read this agent's log: {log.error.message}
      </p>
    ) : (
      <Note>Loading…</Note>
    );
  }
  if (request === undefined) return <Note>This edit request isn't in the agent's log; close this tab.</Note>;

  // The first change by default; a pick past the end (the diffs were replaced) falls back to the first.
  const shown = picked < request.diffs.length ? picked : 0;
  const shownDiff = request.diffs[shown];
  const live = liveState(model, agent);
  const answer = live.answerOf(request);
  const { pending, error } = answers.stateOf(requestId);
  return (
    <section aria-label="Edit approval" className="flex h-full min-h-0 flex-col bg-surface-1">
      <header className="flex h-10 items-center gap-2 border-b border-line pr-1.5 pl-3">
        <FilePen className="size-3.5 shrink-0 text-fg-secondary" />
        <span className="shrink-0 text-sm font-medium text-fg-primary">Edit</span>
        <code className="min-w-0 truncate font-mono text-xs text-fg-secondary">{request.path}</code>
        {answer === undefined ? (
          <>
            <span className="ml-3 flex min-w-0 flex-1 items-center gap-2">
              <Waiting />
            </span>
            <AnswerButtons
              options={request.options}
              disabled={!connected || pending || !live.canAnswer(request)}
              onAnswer={(kind) => answers.answer(requestId, kind)}
            />
          </>
        ) : (
          <Outcome answer={answer} />
        )}
      </header>
      {error === undefined ? null : (
        <p role="alert" className="border-b border-line px-3 py-1.5 text-sm text-danger">
          Couldn't send the answer: {error.message}
        </p>
      )}
      {shownDiff === undefined ? (
        <Note>{CHANGE_GONE}</Note>
      ) : (
        <>
          {request.diffs.length > 1 ? (
            <nav aria-label="Changes" className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-1">
              {request.diffs.map((_, index) => (
                <Button key={index} variant="ghost" size="xs" aria-pressed={index === shown} onClick={() => setPicked(index)} className="aria-pressed:bg-surface-3">
                  Change {index + 1}
                </Button>
              ))}
            </nav>
          ) : null}
          <Suspense fallback={<Note>Loading the diff…</Note>}>
            <MonacoDiff path={request.path} oldText={shownDiff.oldText ?? ""} newText={shownDiff.newText} className="min-h-0 flex-1" />
          </Suspense>
        </>
      )}
    </section>
  );
};

export const Diff = ({ params, setTitle }: ViewProps) => {
  const parsed = DiffParams.safeParse(params);
  return parsed.success ? <EditDiff {...parsed.data} setTitle={setTitle} /> : <Note>This tab names no edit request; close it.</Note>;
};
