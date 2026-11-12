import { memo, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { ScrollArea } from "../../../components/ui/scroll-area";
import { type ChatItem, type ChatModel, chatModel } from "../../../data/chat-model.ts";
import { useAgentLog, useAgents, useConnection } from "../../../data/hooks.ts";
import type { Reveal, ViewProps } from "../../registry.ts";
import { useWorkbench } from "../../workbench-context.ts";
import { type EditRequest, editRequest } from "../Diff/edit-request.ts";
import { useAnswer } from "./answer.ts";
import { type ChatBlock, chatBlocks } from "./chat-blocks.ts";
import { ChatParams } from "./chat-params.ts";
import { type LiveState, liveState } from "./live-state.ts";
import { sameBlock } from "./same-item.ts";
import { ChatHeader } from "./ChatHeader/ChatHeader.tsx";
import { Composer } from "./Composer/Composer.tsx";
import { Markdown } from "./Markdown/Markdown.tsx";
import { Permission } from "./Permission/Permission.tsx";
import { Plan } from "./Plan/Plan.tsx";
import { Reasoning } from "./Reasoning/Reasoning.tsx";
import { ToolCalls } from "./ToolCall/ToolCall.tsx";

/** How close to the end (px) still counts as "at the bottom": new content then scrolls into view. */
const BOTTOM_SLACK_PX = 24;

const atBottom = (element: HTMLElement): boolean => element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX;

/** How far to scroll a viewport so `target` sits in its middle (its top, when it's taller than the viewport). */
const centreOffset = (viewport: DOMRect, target: DOMRect): number =>
  target.top - viewport.top - Math.max(0, (viewport.height - target.height) / 2);

/** The edit requests among the chat's permissions, by request id (`editRequest`: the one rule for what's an edit). */
const editRequests = (model: ChatModel, blocks: readonly ChatBlock[]): Map<string, EditRequest> => {
  const edits = new Map<string, EditRequest>();
  for (const block of blocks) {
    const edit = block.kind === "permission" ? editRequest(model, block.item.requestId) : undefined;
    if (edit !== undefined) edits.set(edit.requestId, edit);
  }
  return edits;
};

const STOP_REASONS: Readonly<Record<string, string>> = {
  cancelled: "Cancelled.",
  max_tokens: "The agent stopped: it reached its output limit.",
  max_turn_requests: "The agent stopped: it reached its limit of requests in one turn.",
  refusal: "The agent refused to go on.",
};

/** A sub-agent's item (another ACP session), marked apart from the agent's own. */
const SubAgent = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col gap-1 border-l-2 border-line pl-3">
    <span className="text-xs text-fg-tertiary">Sub-agent</span>
    {children}
  </div>
);

type StaticItem = Extract<ChatBlock, { kind: "item" }>["item"];

/** An item that shows only what the log says (everything but a permission, whose state is live). */
const StaticItemView = ({ item }: { item: StaticItem }): ReactNode => {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <Markdown text={item.text} className="max-w-3/4 rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-base text-fg-primary" />
        </div>
      );
    case "agent":
      return <Markdown text={item.text} className="text-base text-fg-primary" />;
    case "reasoning":
      return <Reasoning text={item.text} />;
    case "turn_end": {
      const said = STOP_REASONS[item.stopReason];
      return said === undefined ? null : <p className="text-sm text-fg-tertiary">{said}</p>;
    }
    case "unreadable":
      return <p className="text-sm text-fg-tertiary">One entry of this log couldn't be read.</p>;
  }
};

/** A block from the log alone, rendered again only when what it shows changed (`sameBlock`). */
const StaticBlock = memo(
  ({ block }: { block: Exclude<ChatBlock, { kind: "permission" }> }) => (block.kind === "tools" ? <ToolCalls items={block.items} /> : <StaticItemView item={block.item} />),
  (before, after) => sameBlock(before.block, after.block),
);
StaticBlock.displayName = "StaticBlock";

type BlockProps = {
  block: ChatBlock;
  live: LiveState;
  edits: Map<string, EditRequest>;
  connected: boolean;
  onOpenSideBySide: (requestId: string) => void;
  answers: ReturnType<typeof useAnswer>;
  cards: Map<string, HTMLElement>;
};

const Block = ({ block, live, edits, connected, answers, cards, onOpenSideBySide }: BlockProps) => {
  let shown: ReactNode;
  if (block.kind === "permission") {
    const item = block.item;
    const { pending, error } = answers.stateOf(item.requestId);
    const edit = edits.get(item.requestId);
    shown = (
      <Permission
        item={item}
        answer={live.answerOf(item)}
        edit={edit ?? false}
        tool={block.tool}
        onOpenSideBySide={edit === undefined ? undefined : () => onOpenSideBySide(item.requestId)}
        disabled={!connected || pending || !live.canAnswer(item)}
        error={error}
        onAnswer={(kind) => answers.answer(item.requestId, kind)}
        cardRef={(element) => {
          if (element === null) cards.delete(item.requestId);
          else cards.set(item.requestId, element);
        }}
      />
    );
  } else shown = <StaticBlock block={block} />;
  const session: ChatItem["sessionId"] = block.kind === "tools" ? block.items[0]?.sessionId : block.item.sessionId;
  return session === undefined ? shown : <SubAgent>{shown}</SubAgent>;
};

/** One agent's chat: the plan pinned on top, the conversation, the message box at the bottom. */
const AgentChat = ({ agentId, reveal }: { agentId: string; reveal: Reveal | undefined }) => {
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
  const blocks = useMemo(() => (model === undefined ? [] : chatBlocks(model.items)), [model]);
  const edits = useMemo(() => (model === undefined ? new Map<string, EditRequest>() : editRequests(model, blocks)), [model, blocks]);
  const workbench = useWorkbench();
  const openSideBySide = (requestId: string) => workbench.openBeside("diff", { agentId, requestId }, { viewId: "chat", params: { agentId } });
  const live = useMemo(() => (model === undefined ? undefined : liveState(model, agent)), [model, agent]);

  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const cards = useRef(new Map<string, HTMLElement>());
  const revealed = useRef<Reveal>(undefined);

  // Scrolled to the bottom, the chat follows new content (new items, and parts that grow: an expanded tool call,
  // a longer message); scrolled up, it stays where it is.
  useEffect(() => {
    const element = viewport.current;
    const inner = content.current;
    if (element === null || inner === null) return;
    const onScroll = () => {
      following.current = atBottom(element);
    };
    const follow = new ResizeObserver(() => {
      if (following.current) element.scrollTop = element.scrollHeight;
    });
    element.addEventListener("scroll", onScroll, { passive: true });
    follow.observe(inner);
    // The viewport itself shrinks or grows too (the window, the plan, the message box).
    follow.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll);
      follow.disconnect();
    };
    // The viewport is there once the log has loaded.
  }, [model === undefined]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element !== null && following.current) element.scrollTop = element.scrollHeight;
  }, [model]);

  // A reveal (a new object each time it's asked) scrolls its permission into view and moves the focus to its card,
  // once the card is there.
  useEffect(() => {
    if (reveal === undefined || reveal === revealed.current) return;
    const card = cards.current.get(reveal.target);
    if (card === undefined) return;
    revealed.current = reveal;
    const element = viewport.current;
    if (element !== null) {
      // Only the chat's own viewport scrolls (scrollIntoView would also move dockview's clipped containers).
      element.scrollTop += centreOffset(element.getBoundingClientRect(), card.getBoundingClientRect());
      // Revealed above the end, the chat stays at the card until scrolled back down.
      following.current = atBottom(element);
    }
    card.focus({ preventScroll: true });
  }, [reveal, model]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader agentId={agentId} agent={agent} connected={connected} />
      {model?.plan === undefined || model.plan.length === 0 ? null : <Plan entries={model.plan} />}
      {log.error && model === undefined ? (
        <p role="alert" className="p-5 text-sm text-danger">
          Couldn't read this agent's log: {log.error.message}
        </p>
      ) : model === undefined ? (
        <p className="p-5 text-sm text-fg-tertiary">Loading…</p>
      ) : (
        <ScrollArea viewportRef={viewport} className="min-h-0 flex-1">
          <div ref={content} className="mx-auto flex max-w-chat flex-col gap-3 px-5 pt-2 pb-4">
            {log.data?.truncated ? <p className="text-sm text-fg-tertiary">Earlier history wasn't kept.</p> : null}
            {blocks.map((block) => (
              <Block
                key={block.key}
                block={block}
                live={live ?? liveState(model, agent)}
                edits={edits}
                connected={connected}
                answers={answers}
                cards={cards.current}
                onOpenSideBySide={openSideBySide}
              />
            ))}
          </div>
        </ScrollArea>
      )}
      <Composer agentId={agentId} turnActive={live?.turnActive ?? false} connected={connected && model !== undefined} />
    </div>
  );
};

export const Chat = ({ params, reveal }: ViewProps) => {
  const parsed = ChatParams.safeParse(params);
  return parsed.success ? <AgentChat agentId={parsed.data.agentId} reveal={reveal} /> : <p className="p-5 text-sm">This tab names no agent; close it.</p>;
};
