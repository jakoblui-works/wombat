import { FilePen, SquarePen } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useState } from "react";

import { type ProposalDetail, ProposalErrorCode } from "@wombat/shared/proposals";
import { Button } from "../../../components/ui/button";
import { ServiceError } from "../../../data/client.ts";
import { useDecide } from "../../../data/commands.ts";
import { useAgents, useConnection, useProposal } from "../../../data/hooks.ts";
import { keys } from "../../../data/keys.ts";
import { refresh } from "../../../data/refresh.ts";
import { useActiveTab } from "../../workbench-context.ts";
import type { ViewProps } from "../../registry.ts";
import { AnswerError, DecisionSlot, OutcomeMark, Waiting } from "../approvals/Answer/Answer.tsx";
import { Note } from "../approvals/Note/Note.tsx";
import { FileProposal } from "./FileProposal/FileProposal.tsx";
import { ItemProposal } from "./ItemProposal/ItemProposal.tsx";
import { proposalActions } from "./proposal-actions.ts";
import { isOutsideWorkspace, proposalAgentTitle, proposalKindWord, proposalLabel } from "./proposal-label.ts";
import { OutsideWorkspace } from "./OutsideWorkspace.tsx";
import { isProposalTab, ProposalParams } from "./proposal-params.ts";
import { PathText } from "./PathText.tsx";
import { proposalTabState } from "./proposal-tab-state.ts";
import type { ReviseNotice } from "./draft-state.ts";
import { useDraftEditor } from "./use-draft.ts";
import { VersionPicker } from "./VersionPicker.tsx";

const ReadError = ({ error }: { error: Error }) =>
  error instanceof ServiceError && error.code === ProposalErrorCode.enum.proposal_not_found ? (
    <Note>This proposal no longer exists; close this tab.</Note>
  ) : (
    <p role="alert" className="p-5 text-sm text-danger">
      Couldn't read this proposal: {error.message}
    </p>
  );

/** A line above the body: a problem, or the file changed since the proposal. */
const Notice = ({ tone, children }: { tone: "danger" | "plain"; children: string }) => (
  <p className={tone === "danger" ? "border-b border-line px-3 py-1.5 text-sm whitespace-pre-wrap text-danger" : "border-b border-line px-3 py-1.5 text-sm text-fg-secondary"}>
    {children}
  </p>
);

const revisedLine = ({ draft, lost }: ReviseNotice): string => {
  if (draft === undefined) return "Revised by the agent before your edits were saved; they were made on the previous version and aren't kept.";
  return lost
    ? `Revised by the agent; your saved edits are in v${String(draft)}, and your last edits weren't saved and aren't kept.`
    : `Revised by the agent; your edits are in v${String(draft)}.`;
};

/** Reject's reason, asked for before anything is sent; an empty one sends none. */
const RejectField = ({ disabled, onSend, onCancel }: { disabled: boolean; onSend: (reason: string | undefined) => void; onCancel: () => void }) => {
  const id = useId();
  const [reason, setReason] = useState("");
  const send = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    onSend(trimmed === "" ? undefined : trimmed);
  };
  return (
    <form onSubmit={send} className="flex items-center gap-2 border-b border-line px-3 py-2">
      <label htmlFor={id} className="shrink-0 text-sm text-fg-secondary">
        Reason (optional)
      </label>
      <input
        id={id}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        // The field opens on the user's click on Reject, to be typed into.
        autoFocus
        className="focus-ring h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-surface-1 px-2 text-sm text-fg-primary"
      />
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" variant="secondary" size="sm" disabled={disabled}>
        Send
      </Button>
    </form>
  );
};

/**
 * One proposal: what it changes, whose it is and why, with Approve and Reject, and its earlier versions. A pending
 * file proposal's text is editable; my edits are saved as my version. Approve first saves what's still waiting and
 * names the version that leaves current; a newer one comes back as a refresh, shown here, never approved unseen.
 */
const ProposalTab = ({ proposalId, setTitle }: ProposalParams & { setTitle: ViewProps["setTitle"] }) => {
  const read = useProposal(proposalId);
  // An earlier version shown in place of the current one; undefined for the current.
  const [viewing, setViewing] = useState<number>();
  const earlier = useProposal(proposalId, viewing);
  const [saving, setSaving] = useState(false);
  const agents = useAgents();
  const connection = useConnection();
  const decide = useDecide();
  const [rejecting, setRejecting] = useState(false);
  const queryClient = useQueryClient();
  const active = isProposalTab(useActiveTab(), proposalId);
  // Nothing announces a hand edit of the file, so the tab reads the proposal again each time it's brought to the front.
  useEffect(() => {
    if (active) void refresh(queryClient, keys.proposal(proposalId));
  }, [active, queryClient, proposalId]);
  const proposal: ProposalDetail | undefined = read.data;
  const draft = useDraftEditor(proposalId, proposal?.target === "file" ? proposal : undefined);
  const label = proposal === undefined ? undefined : proposalLabel(proposal);
  useEffect(() => {
    if (label !== undefined) setTitle?.(label);
  }, [label, setTitle]);

  if (proposal === undefined || label === undefined) return read.error ? <ReadError error={read.error} /> : <Note>Loading…</Note>;

  const agent = agents.data?.agents.find(({ id }) => id === proposal.agentId);
  const by = agents.data === undefined ? undefined : proposalAgentTitle(proposal, agents.data.agents);
  const state = proposalTabState(proposal);
  const actions = proposalActions(proposal, agent, connection.state);
  const busy = decide.isPending || saving;
  const viewingEarlier = viewing !== undefined && viewing !== proposal.version;
  const shown = viewingEarlier ? earlier.data : proposal;
  const editable = actions.draft && !viewingEarlier && proposal.target === "file" && draft.text !== undefined;
  const kind = proposalKindWord(proposal);
  // Waits for my text to be saved: Approve never sends a version older than the text on screen.
  const saved = async (byApprove: boolean): Promise<number | undefined> => {
    if (proposal.target !== "file") return proposal.version;
    setSaving(true);
    try {
      return await draft.flush(byApprove);
    } finally {
      setSaving(false);
    }
  };
  const approve = async () => {
    const version = await saved(true);
    if (version !== undefined) decide.mutate({ proposalId, decision: "approve", version });
  };
  const pick = async (version: number) => {
    if (version === proposal.version) {
      setViewing(undefined);
      return;
    }
    if (!viewingEarlier && (await saved(false)) === undefined) return;
    setRejecting(false);
    setViewing(version);
  };
  const reject = (reason: string | undefined) =>
    decide.mutate({ proposalId, decision: "reject", ...(reason === undefined ? {} : { reason }) }, { onSuccess: () => setRejecting(false) });
  const Icon = proposal.target === "file" ? FilePen : SquarePen;

  return (
    <section aria-label="Proposal" className="flex h-full min-h-0 flex-col bg-surface-1">
      <header className="flex flex-col gap-1 border-b border-line px-3 py-2">
        <div className="flex min-h-7 items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-fg-secondary" />
          <PathText path={label} className="font-mono text-xs text-fg-primary" />
          {kind === undefined ? null : <span className="shrink-0 text-xs text-fg-tertiary">{kind}</span>}
          {isOutsideWorkspace(proposal) ? <OutsideWorkspace /> : null}
          {proposal.versions.length > 1 ? (
            <VersionPicker versions={proposal.versions} current={proposal.version} shown={viewingEarlier ? viewing : proposal.version} agentTitle={by ?? "agent"} onPick={(version) => void pick(version)} />
          ) : null}
          <DecisionSlot
            waiting={viewingEarlier ? null : <Waiting>{state.mark ?? "Waits for your decision"}</Waiting>}
            outcome={state.outcome === undefined ? undefined : <OutcomeMark allowed={state.outcome.allowed}>{state.outcome.label}</OutcomeMark>}
          >
            <span className="ml-auto flex shrink-0 gap-2">
              {state.reject && !viewingEarlier ? (
                <Button variant="secondary" size="sm" aria-expanded={rejecting} disabled={!actions.reject || busy} onClick={() => setRejecting(true)}>
                  Reject
                </Button>
              ) : null}
              {state.approve && !viewingEarlier ? (
                <Button size="sm" disabled={!actions.approve || busy} onClick={() => void approve()}>
                  Approve
                </Button>
              ) : null}
            </span>
          </DecisionSlot>
        </div>
        <p className="text-sm text-fg-secondary">
          {by === undefined ? null : <span className="font-medium text-fg-primary">{by}: </span>}
          {proposal.reason}
        </p>
        {state.reason === undefined ? null : <p className="text-sm text-fg-secondary">Your reason: {state.reason}</p>}
      </header>
      {rejecting && state.reject && !viewingEarlier ? <RejectField disabled={!actions.reject || busy} onSend={reject} onCancel={() => setRejecting(false)} /> : null}
      <AnswerError error={decide.error ?? undefined} className="border-b" />
      {draft.error === undefined ? null : (
        <p role="alert" className="border-b border-line px-3 py-1.5 text-sm text-danger">
          {draft.error.byApprove
            ? `Couldn't save your edits, so nothing was approved: ${draft.error.error.message}`
            : `Couldn't save your edits: ${draft.error.error.message.replace(/\.$/, "")}. They're saved again when you type, or press Approve to retry.`}
        </p>
      )}
      {draft.notice === undefined || state.outcome !== undefined ? null : <Notice tone="plain">{revisedLine(draft.notice)}</Notice>}
      {viewingEarlier ? (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm text-fg-secondary">
          <span>An earlier version, v{viewing}, read-only.</span>
          <Button variant="secondary" size="xs" onClick={() => void pick(proposal.version)}>
            Back to the current version
          </Button>
        </div>
      ) : null}
      {decide.data === "changed" ? <Notice tone="plain">This proposal has a new version; look it over before you approve.</Notice> : null}
      {state.problem === undefined ? null : <Notice tone="danger">{state.problem.message}</Notice>}
      {state.changedSince ? <Notice tone="plain">The file changed since the proposal. Approve applies the agent's edits to it again.</Notice> : null}
      {shown === undefined ? (
        earlier.error ? <ReadError error={earlier.error} /> : <Note>Loading…</Note>
      ) : state.fileUnreadable && !viewingEarlier ? (
        <Note>
          {state.outcome === undefined
            ? "The file can't be read now: it's gone, or it isn't text the app can show. Restore the file to compare and approve, or reject the proposal."
            : "The file can't be read now, so there's no diff to show."}
        </Note>
      ) : shown.target === "file" ? (
        <FileProposal
          path={shown.path}
          kind={shown.kind}
          current={shown.current}
          text={viewingEarlier ? shown.text : (draft.text ?? shown.text)}
          edit={editable ? draft : undefined}
        />
      ) : shown.kind === "delete" ? (
        <Note>This proposal deletes the item.</Note>
      ) : (
        <ItemProposal fields={shown.fields} />
      )}
    </section>
  );
};

export const Proposal = ({ params, setTitle }: ViewProps) => {
  const parsed = ProposalParams.safeParse(params);
  return parsed.success ? <ProposalTab {...parsed.data} setTitle={setTitle} /> : <Note>This tab names no proposal; close it.</Note>;
};
