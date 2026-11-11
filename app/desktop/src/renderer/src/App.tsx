import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { OpenAgents } from "./workbench/open-agents.ts";
import { Workbench } from "./workbench/Workbench/Workbench.tsx";

export const App = ({ queryClient, openAgents }: { queryClient: QueryClient; openAgents: OpenAgents }) => (
  <QueryClientProvider client={queryClient}>
    <Workbench openAgents={openAgents} />
  </QueryClientProvider>
);
