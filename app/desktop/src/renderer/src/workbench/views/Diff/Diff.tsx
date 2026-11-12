import { FilePen } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { Button } from "../../../components/ui/button";
import { useConnection } from "../../../data/hooks.ts";
import type { ViewProps } from "../../registry.ts";
import { useAnswer } from "../approvals/answer.ts";
import { liveState } from "../approvals/live-state.ts";
import { useChatModel } from "../approvals/use-chat-model.ts";
import { CHANGE_GONE, NO_CHANGE } from "../approvals/EditDiff/EditDiff.tsx";
import { LogError } from "../approvals/LogError/LogError.tsx";
import { AnswerButtons, AnswerError, EditTarget, Outcome, Waiting } from "../approvals/Answer/Answer.tsx";
import { DiffParams, diffTitle } from "./diff-params.ts";
import { editRequest } from "../approvals/edit-request.ts";

// Monaco loads with the first diff tab, not with the page.
const MonacoDiff = lazy(() => import("./MonacoDiff/MonacoDiff.tsx").then(({ MonacoDiff: component }) => ({ default: component })));

const Note = ({ children }: { children: string }) => <p className="p-5 text-sm text-fg-tertiary">{children}</p>;

/**
 * One edit request side by side: the request's diff in Monaco, with the chat's answer buttons. It reads the same
 * chat model item as the chat's card (`editRequest`) and its outcome by the same rule (`liveState`), so both show the
 * same; an answered request shows its outcome until the tab is closed.
 */
const EditDiff = ({ agentId, requestId, setTitle }: DiffParams & { setTitle: ViewProps["setTitle"] }) => {
  const { model, agent, log } = useChatModel(agentId);
  const connected = useConnection().state === "connected";
  const answers = useAnswer(agentId);
  const request = model === undefined ? undefined : editRequest(model, requestId);
  const path = request?.path;
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    if (path !== undefined) setTitle?.(diffTitle(path));
  }, [path, setTitle]);

  if (model === undefined) return log.error ? <LogError error={log.error} /> : <Note>Loading…</Note>;
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
        <EditTarget path={request.path} />
        {answer === undefined ? (
          <>
            <span className="ml-3 flex min-w-0 flex-1 items-center gap-2">
              <Waiting />
            </span>
            <AnswerButtons
              options={request.options}
              disabled={!live.answerable(request, { connected, pending })}
              onAnswer={(kind) => answers.answer(requestId, kind)}
            />
          </>
        ) : (
          <Outcome answer={answer} />
        )}
      </header>
      <AnswerError error={error} className="border-b" />
      {shownDiff === undefined ? (
        <Note>{answer === undefined ? NO_CHANGE : CHANGE_GONE}</Note>
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
