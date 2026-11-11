// Invented content for the design screens: a made-up bakery's workspace, its repos and its agents.
import type { AgentState } from "../lib/agent-state.ts";

export const WORKSPACE = "bakery";

export type DesignAgent = {
  readonly id: string;
  readonly title: string;
  /** The agent's folder, relative to the workspace: "." for the workspace itself, else a repo. */
  readonly repo: string;
  readonly branch?: string;
  readonly state: AgentState;
  readonly excerpt: string;
  /** Time since I last interacted with it. */
  readonly ago: string;
};

export const AGENTS: readonly DesignAgent[] = [
  {
    id: "a1",
    title: "Fix rounding in checkout totals",
    repo: "bakery-site",
    branch: "fix/checkout-rounding",
    state: "waiting",
    excerpt: "The total drifts by a cent because each discounted line is rounded before summing. I'd like to change sumLineItems to round once, at the end.",
    ago: "now",
  },
  {
    id: "a2",
    title: "Add opening hours to the footer",
    repo: "bakery-site",
    branch: "feat/opening-hours",
    state: "waiting",
    excerpt: "The footer component is ready; I need to run the snapshot tests to update them.",
    ago: "4m",
  },
  {
    id: "a3",
    title: "Tidy the workspace README",
    repo: ".",
    state: "waiting",
    excerpt: "I moved the seeding steps under Getting started and cut the outdated deploy notes; the edit is ready.",
    ago: "12m",
  },
  {
    id: "a4",
    title: "Paginate the orders endpoint",
    repo: "order-service",
    branch: "feat/orders-pagination",
    state: "working",
    excerpt: "Adding a cursor to GET /orders and updating the three callers in the admin pages.",
    ago: "2m",
  },
  {
    id: "a6",
    title: "Write the allergen labels doc",
    repo: ".",
    state: "done",
    excerpt: "Done: docs/allergens.md lists the fourteen labels, where each is set and how the menu shows them.",
    ago: "1h",
  },
  {
    id: "a7",
    title: "Migrate the newsletter signup",
    repo: "bakery-api",
    branch: "feat/newsletter-v2",
    state: "error",
    excerpt: "The agent stopped: the migration needs a database the sandbox doesn't have yet.",
    ago: "3h",
  },
];

export const agentById = (id: string): DesignAgent => {
  const agent = AGENTS.find((candidate) => candidate.id === id);
  if (!agent) throw new Error(`No design fixture agent "${id}".`);
  return agent;
};

/** A waiting agent's open permission request, as Needs me lists it (newest first). */
export type DesignRequest = {
  readonly id: string;
  readonly agentId: string;
  readonly kind: "edit" | "execute";
  /** The permission's title: what the agent asks. */
  readonly ask: string;
  /** The command or file the ask is about, shown in monospace. */
  readonly target: string;
  readonly ago: string;
};

export const REQUESTS: readonly DesignRequest[] = [
  { id: "r3", agentId: "a1", kind: "edit", ask: "Edit", target: "src/checkout/totals.ts", ago: "now" },
  { id: "r2", agentId: "a2", kind: "execute", ask: "Run", target: "pnpm test -u footer", ago: "4m" },
  { id: "r1", agentId: "a3", kind: "edit", ask: "Edit", target: "README.md", ago: "12m" },
];

// --- The chat with the checkout agent (a1). ---

export type PlanStep = { readonly text: string; readonly status: "done" | "active" | "pending" };

export const PLAN: readonly PlanStep[] = [
  { text: "Find where the total is computed", status: "done" },
  { text: "Round once, after the sum", status: "active" },
  { text: "Add a test with three discounted items", status: "pending" },
  { text: "Run the checkout tests", status: "pending" },
];

export const USER_MESSAGE = "The checkout total is a cent short with three or more discounted items. Can you find out why and fix it?";

export const REASONING_SUMMARY = "Thought for 14s";

export type ToolCall = {
  readonly id: string;
  readonly kind: "read" | "search" | "execute";
  readonly tool: string;
  readonly target: string;
  readonly status: "done" | "running" | "failed";
  readonly detail: string;
  readonly input?: string;
  readonly output?: string;
};

export const TOOL_CALLS: readonly ToolCall[] = [
  { id: "t1", kind: "read", tool: "Read", target: "src/checkout/totals.ts", status: "done", detail: "84 lines" },
  {
    id: "t2",
    kind: "search",
    tool: "Search",
    target: "roundToCents",
    status: "done",
    detail: "2 matches",
    input: 'pattern "roundToCents" in src/checkout',
    output: "totals.ts:14   roundToCents(applyDiscount(item.price * item.quantity, item.discount));\nmoney.ts:4     export const roundToCents = (amount: number): number =>",
  },
  { id: "t3", kind: "read", tool: "Read", target: "src/checkout/discounts.ts", status: "done", detail: "41 lines" },
];

export const AGENT_CODE = `const lineTotal = (item: LineItem): number =>
  roundToCents(applyDiscount(item.price * item.quantity, item.discount));`;

export const SHELL_PERMISSION = { command: "pnpm vitest run src/checkout", answer: "Allowed once" } as const;

export type DiffLine = { readonly kind: "context" | "removed" | "added"; readonly old?: number; readonly new?: number; readonly text: string };

export const EDIT = {
  file: "src/checkout/totals.ts",
  added: 2,
  removed: 2,
  lines: [
    { kind: "context", old: 13, new: 13, text: "const lineTotal = (item: LineItem): number =>" },
    { kind: "removed", old: 14, text: "  roundToCents(applyDiscount(item.price * item.quantity, item.discount));" },
    { kind: "added", new: 14, text: "  applyDiscount(item.price * item.quantity, item.discount);" },
    { kind: "context", old: 16, new: 16, text: "export const sumLineItems = (items: readonly LineItem[]): number =>" },
    { kind: "removed", old: 17, text: "  items.reduce((total, item) => total + lineTotal(item), 0);" },
    { kind: "added", new: 17, text: "  roundToCents(items.reduce((total, item) => total + lineTotal(item), 0));" },
  ] satisfies DiffLine[] as readonly DiffLine[],
} as const;
