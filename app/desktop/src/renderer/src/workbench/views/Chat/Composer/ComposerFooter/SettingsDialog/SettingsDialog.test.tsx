import type { ConfigOption } from "@wombat/shared/api";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { FailureLine, panelOptions, SettingsPanel } from "./SettingsDialog.tsx";

const select = (id: string, category: string): ConfigOption => ({
  id,
  name: `Name of ${id}`,
  type: "select",
  category,
  currentValue: "a",
  options: [{ value: "a", name: "Alpha" }, { value: "b", name: "Beta" }],
});

test("panelOptions leaves out the option the Mode button owns, by identity, and keeps a second mode option", () => {
  const model = select("m", "model");
  const mode = select("mode", "mode");
  const otherMode = select("mode2", "mode");
  expect(panelOptions([model, mode, otherMode])).toEqual([model, otherMode]);
  expect(panelOptions([model])).toEqual([model]);
  expect(panelOptions(undefined)).toEqual([]);
});

test("the slider is for the thought_level option optionByCategory returns, not a second one", () => {
  const first = select("e1", "thought_level");
  const second = select("e2", "thought_level");
  const html = renderToStaticMarkup(<SettingsPanel config={[first, second]} setConfig={() => Promise.resolve()} />);
  expect(html.match(/type="range"/g)).toHaveLength(1);
  expect(html).toContain('aria-valuetext="Alpha"');
  expect(html).toContain('role="listbox"');
});

test("the failure line is announced, and absent without a failure", () => {
  expect(renderToStaticMarkup(<FailureLine failure="Model not available" />)).toMatch(/role="alert"[^>]*>Model not available</);
  expect(renderToStaticMarkup(<FailureLine failure={undefined} />)).toBe("");
});

test("panelOptions leaves out the hidden ids, and the panel shows no heading for them", () => {
  const model = select("m", "model");
  const agent = select("agent", "");
  expect(panelOptions([model, agent], ["agent"])).toEqual([model]);
  expect(panelOptions([model, agent], [])).toEqual([model, agent]);
  const html = renderToStaticMarkup(<SettingsPanel config={[model, agent]} setConfig={() => Promise.resolve()} hidden={["agent"]} />);
  expect(html).toContain("Name of m");
  expect(html).not.toContain("Name of agent");
});
