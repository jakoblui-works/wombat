import { FilePen, SquarePen } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useState } from "react";

import { ServerErrorCode } from "@wombat/shared/api";
import type { Problem } from "@wombat/shared/items";
import { canDraft, myDraft, type ProposalDetail, ProposalErrorCode, sameAsAgents } from "@wombat/shared/proposals";
import { Button } from "../../../components/ui/button";
import { ServiceError } from "../../../data/client.ts";
import { useDecide } from "../../../data/commands.ts";
import { useAgents, useConnection, useProposal } from "../../../data/hooks.ts";
import { keys } from "../../../data/keys.ts";
import { refresh } from "../../../data/refresh.ts";
import { useHarnessFeatures } from "../../../data/harness-features.ts";
import { setReference } from "../Chat/Composer/unsent.ts";
import { useActiveTab, useWorkbench } from "../../workbench-context.ts";
import type { PanelProps } from "../../registry.ts";
import { AnswerError, DecisionSlot, OutcomeMark, Waiting } from "../../approvals/Answer/Answer.tsx";
import { Note } from "../../approvals/Note/Note.tsx";
import { FileProposal } from "./FileProposal/FileProposal.tsx";
import { ItemProposal } from "./ItemProposal/ItemProposal.tsx";
import { proposalActions } from "../../proposals/proposal-actions.ts";
import { isOutsideWorkspace, proposalAgentTitle, proposalKindWord, proposalTabLabel } from "../../proposals/proposal-label.ts";
import { OutsideWorkspace } from "../../proposals/OutsideWorkspace/OutsideWorkspace.tsx";
import { isProposalTab, ProposalParams } from "./proposal-params.ts";
import { PathText } from "../../proposals/PathText/PathText.tsx";
import { proposalTabState, type ProposalTabState } from "./proposal-tab-state.ts";
import type { ReviseNotice, SaveError } from "./draft-state.ts";
import { useDraftEditor, useItemDraft } from "./use-draft.ts";
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

/** The service's problems with a draft it refused, by field; none for any other failure. */
const refusedProblems = (error: SaveError | undefined): readonly Problem[] =>
  error?.error instanceof ServiceError && error.error.code === ServerErrorCode.enum.invalid_request ? (error.error.problems ?? []) : [];

const revisedLine = (notice: ReviseNotice): string => {
  if ("version" in notice) return `A new version, v${String(notice.version)}, is shown.`;
  const { draft, lost } = notice;
  if (draft === undefined) return "Revised by the agent before your edits were saved; they were made on the previous version and aren't kept.";
  return lost
    ? `Revised by the agent; your saved edits are in v${String(draft)}, and your last edits weren't saved and aren't kept.`
    : `Revised by the agent; your edits are in v${String(draft)}.`;
};

const CHANGED_SINCE: Record<NonNullable<ProposalTabState["changedSince"]>, string> = {
  agent: "The file changed since the proposal. Approve applies the agent's edits to it again where they still fit, as a new version to look over; where they don't, it ends in a conflict.",
  mine: "The file changed since the version your edits are on, and your version holds no edits to apply to it again, so Approve ends in a conflict. Keep a copy of your text, then reject the proposal or ask for changes.",
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
const ProposalTab = ({ proposalId, setTitle }: ProposalParams & { setTitle: PanelProps["setTitle"] }) => {
  const read = useProposal(proposalId);
  // An earlier version shown in place of the current one; undefined for the current.
  const [viewing, setViewing] = useState<number>();
  const earlier = useProposal(proposalId, viewing);
  const [saving, setSaving] = useState(false);
  const agents = useAgents();
  const connection = useConnection();
  const decide = useDecide();
  const features = useHarnessFeatures(agents.data?.agents.find(({ id }) => id === read.data?.agentId)?.harness);
  const workbench = useWorkbench();
  const [rejecting, setRejecting] = useState(false);
  const queryClient = useQueryClient();
  const active = isProposalTab(useActiveTab(), proposalId);
  // A hand edit of the proposal's target sends no proposal alert (and a plain file outside the items root no alert at
  // all), so the tab reads the proposal, with the target as it is now, again each time it's brought to the front.
  useEffect(() => {
    if (!active) return;
    void refresh(queryClient, keys.proposal(proposalId));
  }, [active, queryClient, proposalId]);
  const proposal: ProposalDetail | undefined = read.data;
  const fileDraft = useDraftEditor(proposalId, proposal);
  const itemDraft = useItemDraft(proposalId, proposal);
  // While my draft is current, the agent's version it edits is another read.
  const theirs = useProposal(proposalId, proposal === undefined ? undefined : myDraft(proposal.versions)?.theirs.n);
  const label = proposal === undefined ? undefined : proposalTabLabel(proposal);
  useEffect(() => {
    if (label !== undefined) setTitle?.(label);
  }, [label, setTitle]);

  if (proposal === undefined || label === undefined) return read.error ? <ReadError error={read.error} /> : <Note>Loading…</Note>;

  const agent = agents.data?.agents.find(({ id }) => id === proposal.agentId);
  const by = agents.data === undefined ? undefined : proposalAgentTitle(proposal, agents.data.agents);
  const state = proposalTabState(proposal);
  const actions = proposalActions(proposal, agent, connection.state, features);
  const busy = decide.isPending || saving;
  const viewingEarlier = viewing !== undefined && viewing !== proposal.version;
  const shown = viewingEarlier ? earlier.data : proposal;
  const draft = proposal.target === "file" ? fileDraft : itemDraft;
  // Read-only while a save or a decision is under way: typing then would be left out of what Approve sends.
  const editable = actions.draft && !viewingEarlier && draft.value !== undefined && !busy;
  // Once the proposal takes no draft, the editor's unsent value was never written: the tab shows what the service holds.
  const takesDraft = canDraft(proposal.status);
  const kind = proposalKindWord(proposal);
  const draftProblems = refusedProblems(draft.error);
  // Waits for my text to be saved: Approve never sends a version older than the text on screen.
  const saved = async (byApprove: boolean): Promise<number | undefined> => {
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
  const askForChanges = () => {
    if (agent === undefined) return;
    setReference(agent.id, proposalId);
    workbench.openAgentChat(agent.id);
  };
  const Icon = proposal.target === "file" ? FilePen : SquarePen;

  return (
    <section aria-label="Proposal" className="flex h-full min-h-0 flex-col bg-surface-1">
      <header className="flex flex-col gap-1 border-b border-line px-3 py-2">
        <div className="flex min-h-7 items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-fg-secondary" />
          <PathText path={label} className="font-mono text-xs text-fg-primary" />
          {kind === undefined ? null : <span className="shrink-0 text-xs text-fg-tertiary">{kind}</span>}
          {isOutsideWorkspace(proposal) ? <OutsideWorkspace /> : null}
        </div>
        {/* Their own row: the path takes the first, so the picker, the status and three buttons keep their width. */}
        <div className="flex min-h-7 items-center gap-2">
          {proposal.versions.length > 1 ? (
            <VersionPicker versions={proposal.versions} current={proposal.version} shown={viewingEarlier ? viewing : proposal.version} agentTitle={by ?? "agent"} onPick={(version) => void pick(version)} />
          ) : null}
          <DecisionSlot
            waiting={viewingEarlier ? null : <Waiting>{state.mark ?? "Waits for your decision"}</Waiting>}
            outcome={state.outcome === undefined ? undefined : <OutcomeMark allowed={state.outcome.allowed}>{state.outcome.label}</OutcomeMark>}
          >
            <span className="ml-auto flex shrink-0 gap-2">
              {state.reject && !viewingEarlier ? (
                <Button variant="secondary" size="sm" disabled={!actions.revise || busy} onClick={askForChanges}>
                  Ask for changes
                </Button>
              ) : null}
              {state.reject && !viewingEarlier ? (
                <Button variant="secondary" size="sm" aria-expanded={rejecting} disabled={!actions.reject || busy} onClick={() => setRejecting(true)}>
                  Reject
                </Button>
              ) : null}
              {state.approve && !viewingEarlier ? (
                <Button size="sm" disabled={!actions.approve || busy || draftProblems.length > 0} onClick={() => void approve()}>
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
          {draftProblems.length > 0
            ? "Your edits can't be saved until the problems shown at their fields are fixed; your version saved before stays, and Approve waits."
            : draft.error.byApprove
            ? `Couldn't save your edits, so nothing was approved: ${draft.error.error.message}`
            : `Couldn't save your edits: ${draft.error.error.message.replace(/\.$/, "")}. They're saved again when you type, or press Approve to retry.`}
        </p>
      )}
      {draft.notice === undefined || state.outcome !== undefined || decide.data === "changed" ? null : <Notice tone="plain">{revisedLine(draft.notice)}</Notice>}
      {viewingEarlier ? (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm text-fg-secondary">
          <span>An earlier version, v{viewing}, read-only.</span>
          <Button variant="secondary" size="xs" onClick={() => void pick(proposal.version)}>
            Back to the current version
          </Button>
        </div>
      ) : null}
      {decide.data === "changed" ? <Notice tone="plain">This proposal has a new version; look it over before you approve.</Notice> : null}
      {state.problem === undefined || proposal.target === "item" ? null : <Notice tone="danger">{state.problem.message}</Notice>}
      {state.changedSince === undefined ? null : <Notice tone="plain">{CHANGED_SINCE[state.changedSince]}</Notice>}
      {takesDraft || !draft.unsent || viewingEarlier ? null : <Notice tone="plain">Your last edits weren't saved before the proposal could no longer be edited, so they aren't in it.</Notice>}
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
          text={viewingEarlier || !takesDraft ? shown.text : (fileDraft.value ?? shown.text)}
          edit={editable ? fileDraft : undefined}
        />
      ) : (
        <ItemTab
          proposalId={proposalId}
          shown={shown}
          viewingEarlier={viewingEarlier}
          theirs={theirs.data}
          draft={itemDraft}
          showsDraft={takesDraft}
          editable={editable}
          problems={[...(state.problem === undefined || viewingEarlier ? [] : [state.problem]), ...(viewingEarlier ? [] : draftProblems)]}
        />
      )}
    </section>
  );
};

/**
 * An item proposal's rows: an earlier version as it was; the current one against the agent's version, with my fields
 * beside it while they differ (the agent's version it edits is read apart while my draft is current).
 */
const ItemTab = ({
  proposalId,
  shown,
  viewingEarlier,
  theirs,
  draft,
  showsDraft,
  editable,
  problems,
}: {
  proposalId: string;
  shown: Extract<ProposalDetail, { target: "item" }>;
  viewingEarlier: boolean;
  theirs: ProposalDetail | undefined;
  draft: ReturnType<typeof useItemDraft>;
  /** The proposal takes a draft: my fields as typed show, saved or not. */
  showsDraft: boolean;
  editable: boolean;
  problems: readonly Problem[];
}) => {
  const mineCurrent = myDraft(shown.versions) !== undefined;
  const agents = viewingEarlier || !mineCurrent ? shown.fields : theirs?.target === "item" ? theirs.fields : draft.agents;
  if (agents === undefined) return <Note>Loading…</Note>;
  const mine = viewingEarlier ? undefined : showsDraft && draft.value !== undefined ? draft.value : mineCurrent ? shown.fields : undefined;
  const differs = mine !== undefined && !sameAsAgents({ fields: mine }, { fields: agents });
  return (
    <ItemProposal
      proposalId={proposalId}
      binderId={shown.binder}
      kind={shown.kind}
      current={shown.current}
      fields={agents}
      mine={differs ? mine : undefined}
      edit={
        editable && draft.value !== undefined
          ? {
              value: draft.value,
              change: (fields, now) => {
                draft.onChange(fields);
                if (now) void draft.flush(false);
              },
            }
          : undefined
      }
      problems={problems}
    />
  );
};

export const Proposal = ({ params, setTitle }: PanelProps) => {
  const parsed = ProposalParams.safeParse(params);
  return parsed.success ? <ProposalTab {...parsed.data} setTitle={setTitle} /> : <Note>This tab names no proposal; close it.</Note>;
};
