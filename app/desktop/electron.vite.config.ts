import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import { NONCE_PLACEHOLDER, newNonce, pageCsp, withNonce } from "./src/main/page-csp.ts";

const sha256 = (text: string): string => `sha256-${createHash("sha256").update(text).digest("base64")}`;

const isHtml = (res: ServerResponse): boolean => /^text\/html\b/.test(String(res.getHeader("content-type") ?? ""));

// `pnpm dev` only (Vite serve): the dev server sends the page with the same CSP header and fresh
// nonce as the built app's app:// handler, plus what hot reload needs: the inline React refresh
// preamble by its hash and the HMR WebSocket. Vite's own <style> injection takes the nonce from
// `html.cspNonce`, set to the placeholder and replaced per response like the csp-nonce meta.
const devCsp = (): Plugin => ({
  name: "wombat:dev-csp",
  apply: "serve",
  config: () => ({ html: { cspNonce: NONCE_PLACEHOLDER } }),
  configureServer: (server) => {
    server.middlewares.use((req, res, next) => {
      // A 304 would keep the cached page and its old nonce under a new header.
      if (req.headers.accept?.includes("text/html")) delete req.headers["if-none-match"];
      const end = res.end.bind(res) as (chunk?: unknown, ...rest: unknown[]) => ServerResponse;
      res.end = ((chunk?: unknown, ...rest: unknown[]) => {
        if (!isHtml(res) || (typeof chunk !== "string" && !Buffer.isBuffer(chunk))) return end(chunk, ...rest);
        const nonce = newNonce();
        const html = withNonce(chunk.toString(), nonce);
        const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
        const hmrSocket = `ws://${req.headers.host ?? "localhost"}`;
        res.setHeader(
          "Content-Security-Policy",
          pageCsp(nonce, { scriptHashes: inlineScripts.map(([, body = ""]) => sha256(body)), hmrSocket }),
        );
        return end(html, ...rest.filter((arg) => typeof arg === "function"));
      }) as typeof res.end;
      next();
    });
  },
});

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ["@wombat/shared"] },
    },
  },
  preload: {
    build: {
      // A sandboxed preload can't load modules: bundle shared code in and emit CommonJS.
      externalizeDeps: { exclude: ["@wombat/shared"] },
      rolldownOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss(), devCsp()],
    resolve: { alias: { "@": path.join(import.meta.dirname, "src/renderer/src") } },
  },
});
