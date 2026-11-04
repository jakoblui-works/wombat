import { z } from "zod";

/** `$XDG_RUNTIME_DIR/wombat/service.json`: how the app finds the running service. Unknown fields are ignored. */
export const DiscoveryFile = z.object({
  apiVersion: z.int().positive(),
  port: z.int().min(1).max(65535),
  pid: z.int().positive(),
  token: z.string().min(1),
});
export type DiscoveryFile = z.infer<typeof DiscoveryFile>;
