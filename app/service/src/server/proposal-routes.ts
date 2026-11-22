// The proposal routes: list, read, approve, reject and my draft, for file and item proposals alike.
import { ROUTES, type ResponseOf } from "@wombat/shared/routes";
import type { Hono } from "hono";

import type { Proposals } from "../proposals/proposals.ts";
import { DraftRefused } from "../proposals/refused.ts";
import { checked, InvalidRequest, readBody, readQuery } from "./request.ts";

/** A draft the request can't make is the request's fault: answered as invalid_request. */
const asRequest = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (error instanceof DraftRefused) throw new InvalidRequest(error.message, error.problems.length > 0 ? error.problems : undefined);
    throw error;
  }
};

export const proposalRoutes = (app: Hono, proposals: Proposals) => {
  app.get("/proposals", async (c) => {
    const { status } = readQuery(c, ROUTES.listProposals.query);
    return c.json(checked(ROUTES.listProposals.response, { proposals: await proposals.list(status) }) satisfies ResponseOf<typeof ROUTES.listProposals>);
  });

  app.get("/proposals/:id", async (c) => {
    const { version } = readQuery(c, ROUTES.getProposal.query);
    return c.json(checked(ROUTES.getProposal.response, await proposals.get(c.req.param("id"), version)) satisfies ResponseOf<typeof ROUTES.getProposal>);
  });

  app.post("/proposals/:id/approve", async (c) => {
    const { version } = await readBody(c, ROUTES.approveProposal.body);
    return c.json(checked(ROUTES.approveProposal.response, await proposals.approve(c.req.param("id"), version)) satisfies ResponseOf<typeof ROUTES.approveProposal>);
  });

  app.post("/proposals/:id/reject", async (c) => {
    const { reason } = await readBody(c, ROUTES.rejectProposal.body);
    return c.json(checked(ROUTES.rejectProposal.response, await proposals.reject(c.req.param("id"), reason)) satisfies ResponseOf<typeof ROUTES.rejectProposal>);
  });

  app.put("/proposals/:id/draft", async (c) => {
    const { onVersion, ...content } = await readBody(c, ROUTES.saveDraft.body);
    return c.json(
      checked(ROUTES.saveDraft.response, await asRequest(() => proposals.putDraft(c.req.param("id"), onVersion, content))) satisfies ResponseOf<typeof ROUTES.saveDraft>,
    );
  });

  app.delete("/proposals/:id/draft", async (c) =>
    c.json(checked(ROUTES.clearDraft.response, await asRequest(() => proposals.clearDraft(c.req.param("id")))) satisfies ResponseOf<typeof ROUTES.clearDraft>),
  );
};
