import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { OpenAgents } from "./workbench/open-agents.ts";
import { Shell } from "./workbench/shell/Shell.tsx";

export const App = ({ queryClient, openAgents }: { queryClient: QueryClient; openAgents: OpenAgents }) => (
  <QueryClientProvider client={queryClient}>
    <Shell openAgents={openAgents} />
  </QueryClientProvider>
);
