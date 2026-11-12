// T6-2: the footer shows the agent's options in the agent's order, each by its type; nothing in it names a tool vendor.
import type { ConfigOption } from "@wombat/shared/api";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ComposerFooter } from "./ComposerFooter.tsx";

const options: ConfigOption[] = [
  { id: "z", name: "Zed mode", type: "boolean", currentValue: true },
  {
    id: "m",
    name: "Model",
    type: "select",
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
    currentValue: "low",
    options: [{ group: "tiers", name: "Tiers", options: [{ value: "low", name: "Low effort" }] }],
  },
];
const render = (given: ConfigOption[] | undefined) => renderToStaticMarkup(<ComposerFooter toolName="Some tool" options={given} usage={undefined} onSet={() => undefined} />);

test("options come in the agent's order, each by its type", () => {
  const html = render(options);
  const at = (text: string) => html.indexOf(text);
  expect([at("Some tool"), at("Zed mode"), at("Model"), at("Thinking"), at("Effort")].every((index, i, all) => index >= 0 && (i === 0 || index > (all[i - 1] ?? 0)))).toBe(true);
  expect(html).toMatch(/role="switch"[^>]*aria-label="Zed mode"|aria-label="Zed mode"[^>]*role="switch"/);
  expect(html.match(/role="combobox"/g)).toHaveLength(2);
  expect(html).toContain("Small one");
  expect(html).toContain("Low effort");
  // A type this app doesn't know reads as text, with its value.
  expect(html).toMatch(/<span[^>]*>Thinking: 3<\/span>/);
});

test("without options only the tool name shows, and nothing names a vendor", () => {
  const html = render(undefined);
  expect(html).toContain("Some tool");
  expect(html).not.toContain('role="combobox"');
  expect(html.toLowerCase()).not.toContain("claude");
  expect(render(options).toLowerCase()).not.toContain("claude");
});
