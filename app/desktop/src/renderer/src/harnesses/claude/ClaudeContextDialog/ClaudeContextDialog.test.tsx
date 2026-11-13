import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { SAMPLE_BREAKDOWN } from "../../../../../../../shared/test/context-cases.ts";
import { summary } from "../../../../../../test/summaries.ts";
import { defaultSwatch } from "../../../workbench/views/Chat/Composer/ComposerFooter/ContextDialog/ContextDialog.tsx";
import { ClaudeContextDialog } from "./ClaudeContextDialog.tsx";

test("a category name the module doesn't know still renders, with the default colour", () => {
  const html = renderToStaticMarkup(
    <ClaudeContextDialog
      agent={summary("agent-bakery-1", { harness: "claude-code" })}
      breakdown={{ ...SAMPLE_BREAKDOWN, categories: [{ name: "Sourdough starter", tokens: 700, kind: "used" }, { name: "Messages", tokens: 900, kind: "used" }] }}
      error={undefined}
    />,
  );
  expect(html).toContain("Sourdough starter");
  expect(html).toContain(defaultSwatch({ kind: "used" }));
  expect(html).toContain("bg-[#30c4cc]");
});
