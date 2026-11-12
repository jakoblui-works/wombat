// T14 (S2c, row T14-3): which option is the model, the effort, the mode comes from the ACP category alone: the first
// option with it, never one whose id or name merely says so.
import { expect, test } from "vitest";

import { type ConfigOption, optionByCategory } from "./api.ts";

const select = (id: string, name: string, category?: string): ConfigOption => ({
  id,
  name,
  type: "select",
  currentValue: "a",
  options: [{ value: "a", name: "A" }],
  ...(category === undefined ? {} : { category }),
});

const options: ConfigOption[] = [
  select("model", "Model", "other"),
  select("llm", "Engine", "model"),
  { id: "depth", name: "Depth", type: "boolean", currentValue: true, category: "thought_level" },
  select("llm-backup", "Backup engine", "model"),
  select("mode", "Mode"),
];

test("the first option with the category, whatever its id or name; undefined when none has it", () => {
  expect(optionByCategory(options, "model")?.id).toBe("llm");
  expect(optionByCategory(options, "thought_level")?.id).toBe("depth");
  expect(optionByCategory(options, "mode")).toBeUndefined();
  expect(optionByCategory([], "model")).toBeUndefined();
});
