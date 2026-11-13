// T6-2, as S2c changes it (T14, row T14-6): the footer shows the agent's tool and its settings through the slots;
// nothing in it, nor in the default dialogs' bodies, names a tool vendor. (Which option shows how is the settings
// dialog's: SettingsDialog/SettingsPanel.test.tsx.) S2d (T19, row T19-12): the footer itself shows the NotRunning
// indicator in place of the `context` slot, so a harness's own context component can't forget it.
import type { ConfigOption, ContextBreakdown } from "@wombat/shared/api";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { summary } from "../../../../../../../../test/summaries.ts";
import { ComposerFooter } from "./ComposerFooter.tsx";
import { SettingsPanel } from "./SettingsDialog/SettingsDialog.tsx";
import { footerSlot, registerHarnessUi } from "./slots.ts";

const options: ConfigOption[] = [
  { id: "z", name: "Zed mode", type: "boolean", currentValue: true },
  {
    id: "m",
    name: "Model",
    type: "select",
    category: "model",
    currentValue: "small",
    options: [
      { value: "small", name: "Small one" },
      { value: "large", name: "Large one" },
    ],
  },
  { id: "t", name: "Thinking", type: "slider", currentValue: 3 },
  {
    id: "g",
    name: "Effort",
    type: "select",
    category: "thought_level",
    currentValue: "low",
    options: [{ group: "tiers", name: "Tiers", options: [{ value: "low", name: "Low effort" }] }],
  },
];

const breakdown: ContextBreakdown = {
  model: "small",
  used: 52_000,
  size: 200_000,
  categories: [
    { name: "Conversation", tokens: 52_000, kind: "used" },
    { name: "Free space", tokens: 148_000, kind: "free" },
  ],
  lists: [{ id: "notes", title: "Notes", rows: [{ name: "opening-hours.md", detail: "Project", tokens: 300 }] }],
};

const agent = summary("agent-bakery-1", { harness: "fake-reply" });

const render = (given: ConfigOption[] | undefined) =>
  renderToStaticMarkup(<ComposerFooter agent={agent} toolName="Some tool" options={given} usage={{ used: 52_000, size: 200_000 }} onSet={() => undefined} />);

test("the footer shows the tool's name, and neither it nor the default dialogs name a vendor", () => {
  expect(render(undefined)).toContain("Some tool");
  const DefaultContextDialog = footerSlot(agent.harness, "contextDialog");
  const shown = [
    render(undefined),
    render(options),
    renderToStaticMarkup(<SettingsPanel config={options} setConfig={() => Promise.resolve()} />),
    renderToStaticMarkup(<DefaultContextDialog agent={agent} breakdown={breakdown} error={undefined} />),
    renderToStaticMarkup(<DefaultContextDialog agent={agent} breakdown={undefined} error="Available once the agent is idle" />),
  ];
  for (const html of shown) expect(html.toLowerCase()).not.toMatch(/claude|anthropic/);
});

type Access = "running" | "resumable" | "closed";

/** A harness whose `context` slot is its own: a marker that would show a stale ring for a stopped agent. */
const OVERRIDE_HARNESS = "t19-own-context-harness";
const OWN_CONTEXT = "own-context-slot-marker";
registerHarnessUi(OVERRIDE_HARNESS, { context: () => <span>{OWN_CONTEXT}</span> });

const renderWith = (harness: string, access: Access) =>
  renderToStaticMarkup(
    <ComposerFooter
      agent={summary("agent-bakery-1", { harness })}
      toolName="Some tool"
      options={options}
      usage={{ used: 52_000, size: 200_000 }}
      access={access}
      onSet={() => undefined}
    />,
  );

/** The ring the default `context` slot draws (ContextRing: role img, named by its token count). */
const RING = /role="img"[^>]*aria-label="[^"]*tokens/;

test.each<Access>(["resumable", "closed"])("T19-12: %s: \"Not running\" replaces the context slot, the default ring and a harness's own alike", (access) => {
  for (const [harness, slot] of [
    ["fake-reply", RING],
    [OVERRIDE_HARNESS, new RegExp(OWN_CONTEXT)],
  ] as const) {
    const html = renderWith(harness, access);
    expect(html, `${harness}: the indicator`).toContain("Not running");
    expect(html, `${harness}: no context slot`).not.toMatch(slot);
  }
});

test("T19-12: running: the context slot is back (the ring, or the harness's own), and no indicator", () => {
  for (const [harness, slot] of [
    ["fake-reply", RING],
    [OVERRIDE_HARNESS, new RegExp(OWN_CONTEXT)],
  ] as const) {
    const html = renderWith(harness, "running");
    expect(html, `${harness}: the context slot`).toMatch(slot);
    expect(html, `${harness}: no indicator`).not.toContain("Not running");
  }
});
