import { createHash } from "node:crypto";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

// Adds sources to one directive of a CSP, merging into it if it's there and otherwise starting
// from default-src (what the directive fell back to).
const addSources = (policy: string, name: string, sources: string[]): string => {
  const directives = policy
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .filter((part) => part[0]);
  const existing = directives.find(([directive]) => directive === name);
  if (existing) existing.push(...sources.filter((source) => !existing.includes(source)));
  else {
    const fallback = directives.find(([directive]) => directive === "default-src")?.slice(1) ?? [];
    directives.push([name, ...fallback, ...sources.filter((source) => !fallback.includes(source))]);
  }
  return directives.map((part) => part.join(" ")).join("; ");
};

// `pnpm dev` only (Vite serve): loosen the page's CSP just enough for hot reload. Scripts from the
// dev server are already 'self'; this allows the inline React refresh preamble by its hash and
// the HMR WebSocket. The built app keeps index.html's policy untouched; object-src, base-uri,
// form-action and the main process's window and navigation blocks are never relaxed.
const devCsp = (): Plugin => ({
  name: "wombat:dev-csp",
  apply: "serve",
  enforce: "post",
  transformIndexHtml: {
    order: "post",
    handler: (html, { server }) => {
      const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
      const hashes = inlineScripts.map(([, body = ""]) => sha256(body));
      const devUrl = server?.resolvedUrls?.local[0];
      const socket = devUrl === undefined ? [] : [new URL(devUrl).origin.replace(/^http/, "ws")];
      return html.replace(
        /(http-equiv="Content-Security-Policy"\s+content=")([^"]*)"/,
        (_match, prefix: string, policy: string) =>
          `${prefix}${addSources(addSources(policy, "script-src", hashes), "connect-src", socket)}"`,
      );
    },
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
    plugins: [react(), devCsp()],
  },
});
