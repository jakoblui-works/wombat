import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { Composer, STOPPED_TEXT } from "./Composer.tsx";

const render = (stopped: boolean) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Composer agentId="agent-bakery-1" turnActive={false} connected stopped={stopped} features={[]} onOpenContext={() => undefined} />
    </QueryClientProvider>,
  );

test("a stopped agent's box is read-only and a visible line says why", () => {
  const html = render(true);
  expect(html).toContain(STOPPED_TEXT.replace("'", "&#x27;"));
  expect(html).toMatch(/<textarea[^>]*readonly/i);
  expect(html).toMatch(/<textarea[^>]*aria-disabled="true"/);
});

test("a running agent's box is editable and shows no stopped line", () => {
  const html = render(false);
  expect(html).not.toContain("Start a new agent");
  expect(html).not.toMatch(/<textarea[^>]*readonly/i);
});
