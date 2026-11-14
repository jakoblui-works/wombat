// The proposal routes: list, read, approve, reject and my draft, for file and item proposals alike.
import {
  ApproveRequest,
  DraftRequest,
  ListProposalsQuery,
  ListProposalsResponse as ListProposalsSchema,
  Proposal as ProposalSchema,
  ProposalDetail as ProposalDetailSchema,
  ProposalDetailQuery,
  RejectRequest,
  type ListProposalsResponse,
  type Proposal,
  type ProposalDetail,
} from "@wombat/shared/proposals";
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
    const { status } = readQuery(c, ListProposalsQuery);
    return c.json(checked(ListProposalsSchema, { proposals: await proposals.list(status) }) satisfies ListProposalsResponse);
  });

  app.get("/proposals/:id", async (c) => {
    const { version } = readQuery(c, ProposalDetailQuery);
    return c.json(checked(ProposalDetailSchema, await proposals.get(c.req.param("id"), version)) satisfies ProposalDetail);
  });

  app.post("/proposals/:id/approve", async (c) => {
    const { version } = await readBody(c, ApproveRequest);
    return c.json(checked(ProposalSchema, await proposals.approve(c.req.param("id"), version)) satisfies Proposal);
  });

  app.post("/proposals/:id/reject", async (c) => {
    const { reason } = await readBody(c, RejectRequest);
    return c.json(checked(ProposalSchema, await proposals.reject(c.req.param("id"), reason)) satisfies Proposal);
  });

  app.put("/proposals/:id/draft", async (c) => {
    const { onVersion, ...content } = await readBody(c, DraftRequest);
    return c.json(checked(ProposalSchema, await asRequest(() => proposals.putDraft(c.req.param("id"), onVersion, content))) satisfies Proposal);
  });

  app.delete("/proposals/:id/draft", async (c) =>
    c.json(checked(ProposalSchema, await asRequest(() => proposals.clearDraft(c.req.param("id")))) satisfies Proposal),
  );
};
