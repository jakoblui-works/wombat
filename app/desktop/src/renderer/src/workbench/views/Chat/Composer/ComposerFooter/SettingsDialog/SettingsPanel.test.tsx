// S2c, T14 (row T14-4): the settings dialog's body shows every option except mode (it has its own button), in the
// agent's order, each by its type; options without a category stay. What it relies on in the markup (roles and
// names, not looks): a boolean is a `switch` named by the option; a select's values are listed by name, and the
// current one carries aria-checked, aria-selected or aria-current "true"; thought_level is a slider (role="slider"
// or a range input); a type this app doesn't know reads "<name>: <value>".
import type { ConfigOption } from "@wombat/shared/api";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { SettingsPanel } from "./SettingsDialog.tsx";

const options: ConfigOption[] = [
  { id: "z", name: "Zed mode", type: "boolean", currentValue: false },
  {
    id: "m",
    name: "Model",
    type: "select",
    category: "model",
    currentValue: "small",
    options: [
      { value: "small", name: "Small one", description: "Quick answers" },
      { value: "large", name: "Large one", description: "Slow and thorough" },
    ],
  },
  { id: "t", name: "Thinking budget", type: "slider", currentValue: 3 },
  {
    id: "e",
    name: "Effort",
    type: "select",
    category: "thought_level",
    currentValue: "mid",
    options: [
      { value: "low", name: "Low" },
      { value: "mid", name: "Middling" },
      { value: "top", name: "Utmost" },
    ],
  },
  {
    id: "mode",
    name: "Way of working",
    type: "select",
    category: "mode",
    currentValue: "ask",
    options: [{ value: "ask", name: "Ask before edits" }],
  },
  {
    id: "v",
    name: "Voice",
    type: "select",
    currentValue: "warm",
    options: [{ group: "tones", name: "Tones", options: [{ value: "dry", name: "Dry" }, { value: "warm", name: "Warm" }] }],
  },
];

const render = () => renderToStaticMarkup(<SettingsPanel config={options} setConfig={() => Promise.resolve()} />);

test("every option but mode, in the agent's order, each by its type, the uncategorised ones too", () => {
  const html = render();
  const at = (text: string) => html.indexOf(text);
  const order = ["Zed mode", "Model", "Thinking budget", "Effort", "Voice"].map(at);
  expect(order.every((index) => index >= 0), `all shown: ${JSON.stringify(order)}`).toBe(true);
  expect([...order].sort((a, b) => a - b), "in the agent's order").toEqual(order);

  expect(html, "mode has its own button").not.toContain("Way of working");
  expect(html).not.toContain("Ask before edits");

  expect(html).toMatch(/role="switch"[^>]*aria-label="Zed mode"|aria-label="Zed mode"[^>]*role="switch"/);
  for (const text of ["Quick answers", "Slow and thorough", "Large one", "Tones", "Dry", "Low", "Middling", "Utmost"]) expect(html).toContain(text);
  expect(html.match(/role="slider"|type="range"/g), "thought_level as one slider").toHaveLength(1);
  expect(html).toMatch(/Thinking budget: 3/);

  // The two selects shown as lists each mark their current value, and only it: the first value name after each mark.
  const valueNames = ["Small one", "Large one", "Dry", "Warm"];
  const markedValues = [...html.matchAll(/aria-(?:checked|selected|current)="true"/g)].map(({ index }) => {
    const after = valueNames.map((name) => ({ name, at: html.indexOf(name, index) })).filter(({ at }) => at >= 0);
    return after.sort((a, b) => a.at - b.at)[0]?.name;
  });
  expect(markedValues.sort()).toEqual(["Small one", "Warm"]);
});
