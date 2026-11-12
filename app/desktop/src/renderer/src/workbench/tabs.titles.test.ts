// The titles views report for their tabs (the diff tab's "<file name> (diff)"): a report takes the place of the view's
// title until the view unmounts; a restored tab keeps its saved title until its view reports; and a title change never
// arms the layout saver, while a tab the user opened in the same dockview event still does.
import type { IDockviewPanel } from "dockview-react";
import { afterEach, expect, test, vi } from "vitest";

import { summary } from "../../../../test/summaries.ts";
import "./activities.ts";
import { layoutSaver, pageChanges } from "./layout-saver.ts";
import { retitleTabs, type TabHost, tabKey, tabTitles, withoutTitleChanges } from "./tabs.ts";

afterEach(() => {
  vi.useRealTimers();
});

const panel = (viewId: string, params: unknown, title: string) => {
  const made = { id: tabKey(viewId, params), title, params: { viewId, params }, api: { setTitle: (next: string) => (made.title = next) } };
  return made;
};

const ctx = { agents: [summary("agent-1", { title: "Fix the hours" })] };

test("a reported title holds until its view unmounts; a static title isn't reset, so a restored tab keeps its saved one", () => {
  const titles = tabTitles();
  const chat = panel("chat", { agentId: "agent-1" }, "Fix the hours");
  const diff = panel("diff", { agentId: "agent-1", requestId: "req-1" }, "notes.txt (diff)");
  const host = { panels: [chat, diff] as unknown as IDockviewPanel[] } as TabHost;

  titles.report({ id: chat.id, title: chat.title, setTitle: chat.api.setTitle }, "Reported");
  retitleTabs(host, ctx, titles.get);
  expect(chat.title).toBe("Reported");

  titles.forget(chat.id);
  retitleTabs(host, ctx, titles.get);
  expect(chat.title).toBe("Fix the hours");
  expect(diff.title, "the restored diff tab's saved title").toBe("notes.txt (diff)");
});

test("a title change never arms the saver; a tab opened in the same dockview event does", () => {
  vi.useFakeTimers();
  const written: unknown[] = [];
  const byThePage = pageChanges();
  const saver = layoutSaver(() => ({}) as never, (layout) => written.push(layout), 10);
  const change = (reasons: string[]) => saver.schedule(byThePage.classify(withoutTitleChanges(new Set(reasons))));

  change(["panelTitle"]);
  vi.advanceTimersByTime(50);
  expect(written).toHaveLength(0);

  change(["structure", "panelTitle"]);
  vi.advanceTimersByTime(50);
  expect(written).toHaveLength(1);
});
