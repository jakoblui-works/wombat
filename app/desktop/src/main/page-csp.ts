import { randomBytes } from "node:crypto";

// index.html carries this in place of the nonce; whatever serves the page replaces every
// occurrence with a fresh nonce per response (`withNonce`).
export const NONCE_PLACEHOLDER = "WOMBAT_CSP_NONCE";

// 128 bits, base64: the nonce for one response of the page.
export const newNonce = (): string => randomBytes(16).toString("base64");

export const withNonce = (html: string, nonce: string): string => html.replaceAll(NONCE_PLACEHOLDER, nonce);

// What `pnpm dev` needs on top of the built app's policy: the inline React refresh preamble
// (by its hash) and the dev server's HMR WebSocket.
export type DevRelaxations = {
  readonly scriptHashes: readonly string[];
  readonly hmrSocket: string;
};

// The page's Content-Security-Policy, sent as a response header. <style> elements need 'self' or
// the nonce (libraries read it from the csp-nonce meta); style="" attributes are never allowed,
// so styles set at runtime go through CSSOM (React style props).
export const pageCsp = (nonce: string, dev?: DevRelaxations): string => {
  const scripts = ["'self'", ...(dev?.scriptHashes.map((hash) => `'${hash}'`) ?? [])];
  const connect = dev === undefined ? ["'none'"] : [dev.hmrSocket];
  return [
    "default-src 'self'",
    `script-src ${scripts.join(" ")}`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'none'",
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
};
