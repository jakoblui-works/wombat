import { APP_ORIGIN } from "@wombat/shared";
import type { DiscoveryFile } from "@wombat/shared/discovery";

export type ServiceCall = { body?: unknown; timeoutMs: number };

/** The one place a call to the service gets the file's bearer token and the app's Origin. */
export const callService = (
  file: DiscoveryFile,
  method: string,
  pathname: string,
  { body, timeoutMs }: ServiceCall,
): Promise<Response> =>
  fetch(`http://127.0.0.1:${String(file.port)}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${file.token}`,
      origin: APP_ORIGIN,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
