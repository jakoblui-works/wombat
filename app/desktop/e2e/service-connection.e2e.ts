// The page reaches the service only through window.wombat.service, and follows it across a restart on a new
// port. Every launch runs in its own sandbox (app-fixtures.ts).
import {
  alertsSeen,
  bridgeRequest,
  connectionStates,
  expect,
  isAlive,
  startAgent,
  test,
  waitForConnection,
  waitUntil,
  WAIT_MS,
  REPO,
} from "./app-fixtures.ts";

test.describe("service bridge", () => {
  test("the page lists the service's agents through the bridge", async ({ sandbox }) => {
    const { page } = await sandbox.launch();
    await waitForConnection(page, "connected");
    const agentId = await startAgent(sandbox, "fake-reply");

    const answer = await bridgeRequest(page, "GET", "/agents");
    expect(answer, "the bridge refused GET /agents").toMatchObject({ ok: true, status: 200 });
    const ids = ((answer as { body: { agents?: { id: string }[] } }).body.agents ?? []).map(({ id }) => id);
    expect(ids).toContain(agentId);
  });

  test("killing the service shows reconnecting; a new service on a new port brings connected back, and alerts flow", async ({ sandbox }) => {
    test.setTimeout(60_000);
    const { page } = await sandbox.launch();
    await waitForConnection(page, "connected");
    const first = await sandbox.waitForService();

    // SIGKILL: the discovery file stays behind, naming a port nothing answers on.
    process.kill(first.pid, "SIGKILL");
    await waitUntil("the old service to be gone", WAIT_MS, () => (isAlive(first.pid) ? undefined : true));
    await waitUntil("the page to show reconnecting", WAIT_MS, async () => ((await connectionStates(page)).includes("reconnecting") ? true : undefined));
    const reconnectingAt = (await connectionStates(page)).lastIndexOf("reconnecting");

    // While reconnecting the app doesn't start a service itself (only restart() does), so the test
    // starts the new one, on a port other than the old one; the page must find it through the discovery file.
    const port = await sandbox.freePort(first.port);
    const second = await sandbox.startService(sandbox.workspace, { WOMBAT_PORT: String(port) });
    expect(second.port).toBe(port);
    await waitForConnection(page, "connected", { after: reconnectingAt + 1 });

    // Alerts from the new service reach the page.
    const started = await bridgeRequest(page, "POST", "/agents", { harness: "fake-reply", repo: REPO });
    expect(started, "starting an agent through the bridge failed").toMatchObject({ ok: true, status: 201 });
    const agentId = (started as { body: { id: string } }).body.id;
    await waitUntil(`an alert for agent ${agentId}`, WAIT_MS, async () =>
      (await alertsSeen(page)).some((alert) => (alert as { agentId?: string }).agentId === agentId) ? true : undefined,
    );
  });
});
