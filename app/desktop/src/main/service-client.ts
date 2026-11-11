import { APP_ORIGIN } from "@wombat/shared";
import type { DiscoveryFile } from "@wombat/shared/discovery";
import { appRoute, MAX_BODY_BYTES } from "@wombat/shared/routes";
import type { ServiceAnswer } from "../shared/bridge.ts";

/** `timeoutMs` bounds the whole call, body included; `signal` ends it early (a stream that's read until stopped). */
export type ServiceCall = { body?: unknown; timeoutMs?: number; signal?: AbortSignal };

/** The one place a call to the service gets the file's bearer token and the app's Origin. */
export const callService = (
  file: DiscoveryFile,
  method: string,
  pathname: string,
  { body, timeoutMs, signal }: ServiceCall,
): Promise<Response> =>
  fetch(`http://127.0.0.1:${String(file.port)}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${file.token}`,
      origin: APP_ORIGIN,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.any([...(timeoutMs === undefined ? [] : [AbortSignal.timeout(timeoutMs)]), ...(signal === undefined ? [] : [signal])]),
  });

/** Stopping an agent waits for it to exit, which can take a while. */
const REQUEST_TIMEOUT_MS = 60_000;

/** A page's request main won't send; its message is safe to show the page. */
export class RequestRefused extends Error {}

/** The page's request as it goes out, or a RequestRefused; checked before anything reaches the network. */
const checked = (method: unknown, path: unknown, body: unknown): { method: string; path: string; body: unknown } => {
  if (typeof method !== "string" || typeof path !== "string" || appRoute(method, path) === undefined) {
    throw new RequestRefused(`${String(method)} ${String(path)} isn't a route the app may call; see APP_ROUTES in @wombat/shared/routes.`);
  }
  if (body === undefined) return { method, path, body };
  if (method === "GET") throw new RequestRefused(`GET ${path} takes no body; send it without one.`);
  const json = JSON.stringify(body) as string | undefined;
  if (json === undefined) throw new RequestRefused(`The body for ${method} ${path} isn't JSON; send a JSON value.`);
  if (Buffer.byteLength(json) > MAX_BODY_BYTES) {
    throw new RequestRefused(`The body for ${method} ${path} is over ${String(MAX_BODY_BYTES / 1024 / 1024)} MiB, more than the service takes; send a shorter one.`);
  }
  return { method, path, body };
};

/**
 * The page's request to the service at `file`: refused (rejects with RequestRefused) unless it's on APP_ROUTES with a
 * body the service takes. Rejects too when the service can't be reached, with a message that doesn't name its address.
 */
export const requestService = async (file: DiscoveryFile | undefined, method: unknown, path: unknown, body: unknown): Promise<ServiceAnswer> => {
  const request = checked(method, path, body);
  if (file === undefined) throw new Error("The service isn't connected yet; try again once it is.");
  let status: number;
  let text: string;
  try {
    const response = await callService(file, request.method, request.path, { body: request.body, timeoutMs: REQUEST_TIMEOUT_MS });
    status = response.status;
    text = await response.text();
  } catch (error) {
    // Not the error's own message: it can name the service's port. The page gets the message only, never the cause.
    throw new Error(`The service didn't answer ${request.method} ${request.path} (${(error as Error).name}); check the connection state and try again.`, {
      cause: error,
    });
  }
  let parsed: unknown;
  try {
    parsed = text === "" ? undefined : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status, body: parsed };
};
