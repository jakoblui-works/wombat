import { LoaderCircle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/** A strip under the title bar while the connection to the service is being re-established. */
export const Reconnecting = () => (
  <div role="alert" className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-surface-2 pr-2 pl-4">
    <LoaderCircle className="size-4 shrink-0 animate-spin text-fg-secondary" />
    <span className="text-base font-medium text-fg-primary">Reconnecting to the service…</span>
    <span className="min-w-0 truncate text-sm text-fg-secondary">Attempt 3, trying again in 4 s. Your agents keep running.</span>
    <Button variant="secondary" size="sm" className="ml-auto">
      <RotateCw />
      Restart
    </Button>
  </div>
);
