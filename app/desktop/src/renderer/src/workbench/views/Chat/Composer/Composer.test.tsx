// S2c's stopped line, as S2d changes it (T19, row T19-11): no line between the composer and its footer, whatever the
// agent's access (the footer's NotRunning indicator says it isn't running); the box is editable while the agent runs
// and while a message would start it again, and read-only only when it can't be started again (`closed`).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { Composer } from "./Composer.tsx";

type Access = "running" | "resumable" | "closed";

const render = (access: Access) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Composer agentId="agent-bakery-1" turnActive={false} connected access={access} features={[]} onOpenContext={() => undefined} />
    </QueryClientProvider>,
  );

test.each<[Access, boolean]>([
  ["running", false],
  ["resumable", false],
  ["closed", true],
])("T19-11: %s: the box is read-only: %s, and no line under it says the agent isn't running", (access, readOnly) => {
  const html = render(access);
  expect(html).toMatch(/<textarea/);
  if (readOnly) {
    expect(html).toMatch(/<textarea[^>]*readonly/i);
    expect(html).toMatch(/<textarea[^>]*aria-disabled="true"/);
  } else {
    expect(html).not.toMatch(/<textarea[^>]*readonly/i);
  }
  expect(html).not.toMatch(/isn(&#x27;|')t running|Start a new agent/);
});
