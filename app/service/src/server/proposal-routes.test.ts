// The proposal routes: shapes, the status filter and the refusals. Access decides the conflict cases
// (items/access tests); one route-level conflict case shows the 200 answer.
import { ListProposalsResponse } from "@wombat/shared/api";
import { Proposal } from "@wombat/shared/items";
import { describe, expect, test } from "vitest";

import { readAt, writeAt } from "../../test/items-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { callTool, serveItemsForStub } from "../../test/mcp-fixtures.ts";
import { expectError } from "../../test/server-fixtures.ts";

const BUG1 = "bugs/BUG-1-login-times-out.md";
const BUG2 = "bugs/BUG-2-hero-caption.md";

const setup = async () => {
  const { s, root, token } = await serveItemsForStub();
  const propose = async (handle: string, note: string) => {
    const { version } = (await callTool(s, token, "get_item", { handle })).json as { version: string };
    const answer = await callTool(s, token, "propose_update", { handle, fields: { note }, version, reason: "Seen again" });
    return (answer.json as { proposed: string }).proposed;
  };
  return { s, root, propose };
};

describe("proposal routes", () => {
  test(
    "GET /proposals lists them and filters by status",
    async () => {
      const { s, propose } = await setup();
      const first = await propose("BUG-1", "First note");
      const second = await propose("BUG-2", "Second note");
      await s.api("POST", `/proposals/${second}/reject`);

      const all = ListProposalsResponse.parse((await s.api("GET", "/proposals")).json);
      const pending = ListProposalsResponse.parse((await s.api("GET", "/proposals?status=pending")).json);

      expect(all.proposals.map((p) => p.id).sort()).toEqual([first, second].sort());
      expect(pending.proposals.map((p) => p.id)).toEqual([first]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an invalid status answers the 400 invalid_request shape",
    async () => {
      const { s } = await setup();

      expectError(await s.api("GET", "/proposals?status=done"), 400, "invalid_request", "status");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "approve answers the proposal and writes the file",
    async () => {
      const { s, root, propose } = await setup();
      const id = await propose("BUG-2", "Approved note");

      const response = await s.api("POST", `/proposals/${id}/approve`);

      expect(response.status, response.text).toBe(200);
      expect(Proposal.parse(response.json)).toMatchObject({ id, status: "approved" });
      expect(readAt(root, BUG2)).toContain("Approved note");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "reject answers the proposal and leaves the file alone",
    async () => {
      const { s, root, propose } = await setup();
      const before = readAt(root, BUG2);
      const id = await propose("BUG-2", "Rejected note");

      const response = await s.api("POST", `/proposals/${id}/reject`);

      expect(response.status, response.text).toBe(200);
      expect(Proposal.parse(response.json)).toMatchObject({ id, status: "rejected" });
      expect(readAt(root, BUG2)).toBe(before);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an unknown proposal is 404 proposal_not_found",
    async () => {
      const { s } = await setup();

      expectError(await s.api("POST", "/proposals/nope/approve"), 404, "proposal_not_found");
      expectError(await s.api("POST", "/proposals/nope/reject"), 404, "proposal_not_found");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "deciding a proposal twice is 409 proposal_not_pending",
    async () => {
      const { s, propose } = await setup();
      const id = await propose("BUG-2", "Decided once");
      await s.api("POST", `/proposals/${id}/reject`);

      expectError(await s.api("POST", `/proposals/${id}/approve`), 409, "proposal_not_pending");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "approving after a hand edit answers 200 with status conflict and the reason",
    async () => {
      const { s, root, propose } = await setup();
      const id = await propose("BUG-1", "Stale note");
      writeAt(root, BUG1, `${readAt(root, BUG1)}\nEdited by hand meanwhile.\n`);

      const response = await s.api("POST", `/proposals/${id}/approve`);

      expect(response.status, response.text).toBe(200);
      const proposal = Proposal.parse(response.json);
      expect(proposal.status).toBe("conflict");
      expect(proposal.problem).toBeDefined();
      expect(readAt(root, BUG1)).not.toContain("Stale note");
    },
    TEST_TIMEOUT_MS,
  );
});
