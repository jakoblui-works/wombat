// S2c, T16 (rows T16-1 and T16-2's desktop half; silent drift): the Claude module fills the context dialog for the
// service's Claude harness id, and only that slot; its /memory and /agents hints sit beside the lists the service
// sends with those ids, matched on the id, never the title. The harness id and the sample breakdown are the shared
// drift fixture (shared/test/context-cases.ts), which the service's own tests hold its side to.
import type { ContextBreakdown } from "@wombat/shared/api";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import "./claude-ui.ts";
import { CLAUDE_HARNESS_ID, SAMPLE_BREAKDOWN } from "../../../../../../shared/test/context-cases.ts";
import { summary } from "../../../../../test/summaries.ts";
import { footerSlot } from "../../workbench/views/Chat/Composer/ComposerFooter/slots.ts";

const agent = summary("agent-bakery-1", { harness: CLAUDE_HARNESS_ID });

test("T16-1: the Claude module fills the context dialog for the Claude harness id, and no other slot", () => {
  expect(footerSlot(CLAUDE_HARNESS_ID, "contextDialog")).not.toBe(footerSlot("fake-reply", "contextDialog"));
  expect(footerSlot(CLAUDE_HARNESS_ID, "settings")).toBe(footerSlot("fake-reply", "settings"));
  expect(footerSlot(CLAUDE_HARNESS_ID, "context")).toBe(footerSlot("fake-reply", "context"));
});

test("T16-2: /memory and /agents show beside the lists with those ids, whatever their titles", () => {
  const ClaudeDialog = footerSlot(CLAUDE_HARNESS_ID, "contextDialog");
  const render = (breakdown: ContextBreakdown) => renderToStaticMarkup(<ClaudeDialog agent={agent} breakdown={breakdown} error={undefined} />);
  const listOf = (id: string) => SAMPLE_BREAKDOWN.lists.find((list) => list.id === id);

  const sample = render(SAMPLE_BREAKDOWN);
  expect(sample).toContain("/memory");
  expect(sample).toContain("/agents");

  const retitled = render({
    ...SAMPLE_BREAKDOWN,
    lists: SAMPLE_BREAKDOWN.lists.map((list) => ({ ...list, title: `Renamed ${list.id.length}` })),
  });
  expect(retitled, "matched on the id").toContain("/memory");
  expect(retitled).toContain("/agents");

  const titlesOnly = render({
    ...SAMPLE_BREAKDOWN,
    lists: SAMPLE_BREAKDOWN.lists.map((list) => ({ ...list, id: `other_${list.id}` })),
  });
  expect(titlesOnly, "never on the title").not.toContain("/memory");
  expect(titlesOnly).not.toContain("/agents");

  const withoutThem = render({ ...SAMPLE_BREAKDOWN, lists: [listOf("skills"), listOf("mcp_tools")].filter((list) => list !== undefined) });
  expect(withoutThem).not.toContain("/memory");
  expect(withoutThem).not.toContain("/agents");
});
