// Lasting check (silent failure): the port rules. Every route, the stream and unknown paths included, needs the
// token; an Origin, when present, must be the app's; the Host must name the loopback address and the bound port
// (DNS rebinding); no response ever carries CORS headers; the server listens on 127.0.0.1 only.
import { connect } from "node:net";
import { networkInterfaces } from "node:os";

import { describe, expect, test } from "vitest";

import { ALL_SCENARIOS, REPO, setup, TEST_TIMEOUT_MS, trackedHarness, WAIT_MS } from "../../test/manager-fixtures.ts";
import { APP_ORIGIN, appRoutes as routes, expectError, serve } from "../../test/server-fixtures.ts";
import { startServer } from "./server.ts";


describe("port rules", () => {
  test(
    "every route refuses a request without the token, with a wrong token, a foreign Origin or a foreign Host, and nothing changes",
    async () => {
      const s = await serve();
      const { id } = await s.manager.start("fake-hang", REPO);
      const seq = s.store.currentSeq();
      const pids = s.pids().length;

      const refusals = [
        { what: "no token", headers: { origin: APP_ORIGIN }, host: undefined, status: 401, code: "unauthorized" },
        {
          what: "wrong token",
          headers: { origin: APP_ORIGIN, authorization: "Bearer not-the-token" },
          host: undefined,
          status: 401,
          code: "unauthorized",
        },
        {
          what: "foreign Origin",
          headers: { origin: "https://evil.example", authorization: `Bearer ${s.token}` },
          host: undefined,
          status: 403,
          code: "forbidden_origin",
        },
        {
          what: "foreign Host",
          headers: { origin: APP_ORIGIN, authorization: `Bearer ${s.token}` },
          host: `evil.example:${s.port}`,
          status: 403,
          code: "forbidden_host",
        },
      ];
      for (const route of routes(id)) {
        for (const refusal of refusals) {
          const response = await s.request({
            ...route,
            headers: refusal.headers,
            ...(refusal.host === undefined ? {} : { host: refusal.host }),
          });
          expectError(response, refusal.status, refusal.code, `${route.method} ${route.path} with ${refusal.what}`);
        }
      }

      expect(s.store.currentSeq()).toBe(seq);
      expect(s.pids()).toHaveLength(pids);
      expect(s.store.listAgents().map((agent) => agent.id)).toEqual([id]);
      expect(s.shutdownRequests(), "a refused POST /shutdown must not start a shutdown").toBe(0);
      // Control: the same agent answers with the token.
      expect((await s.api("GET", `/agents/${id}/log`)).status).toBe(200);
      // Control: the items routes exist (not configured on this server), so the refusals above came from the rules.
      for (const path of ["/structures", "/structures/bugs/items", "/items/BUG-1"]) {
        expectError(await s.api("GET", path), 409, "items_not_configured", path);
      }
      // Control: the proposal routes exist too: with the token they answer anything but the unknown-route error.
      for (const { method, path } of [
        { method: "GET", path: "/proposals" },
        { method: "POST", path: "/proposals/prop_1/approve" },
        { method: "POST", path: "/proposals/prop_1/reject" },
      ]) {
        const response = await s.api(method, path);
        expect((response.json as { error?: { code?: string } } | undefined)?.error?.code, `${method} ${path}: ${response.text}`).not.toBe("not_found");
      }
      // Control, last since it ends the agents: POST /shutdown exists and, with the token, does ask for a shutdown.
      expect((await s.api("POST", "/shutdown")).status).toBe(202);
      expect(s.shutdownRequests()).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the token must match exactly, the Origin must be the app's or absent, and the Host must be the loopback address with the bound port",
    async () => {
      const s = await serve();
      const bearer = `Bearer ${s.token}`;
      const otherPort = s.port === 65535 ? s.port - 1 : s.port + 1;
      const ok = { status: 200, code: undefined };
      const unauthorized = { status: 401, code: "unauthorized" };
      const badOrigin = { status: 403, code: "forbidden_origin" };
      const badHost = { status: 403, code: "forbidden_host" };
      const refused = { status: 0, code: undefined };
      const cases: {
        what: string;
        path?: string;
        headers: Record<string, string>;
        host?: string | null;
        expected: { status: number; code: string | undefined };
      }[] = [
        { what: "token and app Origin", headers: { authorization: bearer, origin: APP_ORIGIN }, expected: ok },
        { what: "token and no Origin (curl)", headers: { authorization: bearer }, expected: ok },
        { what: "no Authorization", headers: {}, expected: unauthorized },
        { what: "a prefix of the token", headers: { authorization: bearer.slice(0, -1) }, expected: unauthorized },
        { what: "token in the query", path: `/agents?token=${s.token}`, headers: {}, expected: unauthorized },
        { what: "Origin null", headers: { authorization: bearer, origin: "null" }, expected: badOrigin },
        { what: "Origin app://wombatx", headers: { authorization: bearer, origin: "app://wombatx" }, expected: badOrigin },
        { what: "Host 127.0.0.1:<port>", headers: { authorization: bearer }, host: `127.0.0.1:${s.port}`, expected: ok },
        { what: "Host localhost:<port>", headers: { authorization: bearer }, host: `localhost:${s.port}`, expected: ok },
        { what: "a foreign Host", headers: { authorization: bearer }, host: `evil.example:${s.port}`, expected: badHost },
        { what: "another port", headers: { authorization: bearer }, host: `127.0.0.1:${otherPort}`, expected: badHost },
        { what: "localhost without a port", headers: { authorization: bearer }, host: "localhost", expected: badHost },
        // Node's HTTP server answers a request without Host with 400 before any route sees it; refused either way.
        { what: "no Host", headers: { authorization: bearer }, host: null, expected: refused },
      ];
      for (const { what, path = "/agents", headers, host, expected } of cases) {
        const response = await s.request({ path, headers, ...(host === undefined ? {} : { host }) });
        if (expected === refused) {
          expect([400, 403], `${what}: ${response.status} ${response.text}`).toContain(response.status);
        } else if (expected.code === undefined) {
          expect(response.status, `${what}: ${response.text}`).toBe(expected.status);
        } else {
          expectError(response, expected.status, expected.code, what);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "no response carries CORS headers, a preflight included",
    async () => {
      // The request helpers fail on any access-control-* header; these are the requests most likely to get one.
      const s = await serve();
      const preflight = await s.request({
        method: "OPTIONS",
        path: "/agents",
        headers: {
          origin: APP_ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      });
      expect(preflight.status, "a preflight never succeeds").toBeGreaterThanOrEqual(400);
      // With the token, so the token check can't be what keeps CORS headers off.
      await s.request({
        method: "OPTIONS",
        path: "/agents",
        headers: {
          authorization: `Bearer ${s.token}`,
          origin: APP_ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      });
      expect((await s.api("GET", "/agents")).status).toBe(200);
      const stream = await s.stream();
      expect(stream.status).toBe(200);
      stream.close();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the server listens on 127.0.0.1 only",
    async () => {
      const s = await serve();
      const reachable = (host: string) =>
        new Promise<boolean>((resolve) => {
          const socket = connect({ host, port: s.port });
          const timer = setTimeout(() => {
            socket.destroy();
            resolve(false);
          }, WAIT_MS);
          socket.once("connect", () => {
            clearTimeout(timer);
            socket.destroy();
            resolve(true);
          });
          socket.once("error", () => {
            clearTimeout(timer);
            resolve(false);
          });
        });
      expect(await reachable("127.0.0.1"), "control: loopback reaches it").toBe(true);
      const others = Object.values(networkInterfaces())
        .flatMap((addresses) => addresses ?? [])
        // Link-local IPv6 addresses need a scope id; without one a connect can hang instead of failing.
        .filter((address) => !address.internal && !address.address.toLowerCase().startsWith("fe80:"))
        .map((address) => address.address);
      for (const host of ["::1", ...others]) expect(await reachable(host), host).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the server refuses to start with an empty or short token",
    async () => {
      const t = setup();
      const options = {
        manager: t.manager,
        store: t.store,
        harnesses: ALL_SCENARIOS.map((scenario) => trackedHarness(scenario, t.pidDir)),
        workspaceRoot: t.root,
      };
      for (const token of ["", "short-token-15c"]) {
        const outcome = await startServer({ ...options, token }).then(
          async (server) => {
            await server.close();
            return "started";
          },
          () => "refused",
        );
        expect(outcome, JSON.stringify(token)).toBe("refused");
      }
      // Control: 16 characters are enough.
      const server = await startServer({ ...options, token: "token-of-16-char" });
      await server.close();
    },
    TEST_TIMEOUT_MS,
  );
});
