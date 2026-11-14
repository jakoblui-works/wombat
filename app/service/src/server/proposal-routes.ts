// The proposal routes: list, read, approve and reject, for file and item proposals alike.
import { ServerErrorCode } from "@wombat/shared/api";
import {
  ApproveRequest,
  ListProposalsQuery,
  ListProposalsResponse as ListProposalsSchema,
  Proposal as ProposalSchema,
  ProposalDetail as ProposalDetailSchema,
  RejectRequest,
  type ListProposalsResponse,
  type Proposal,
  type ProposalDetail,
} from "@wombat/shared/proposals";
import type { Context, Hono } from "hono";
import { z } from "zod";

import type { Proposals } from "../proposals/proposals.ts";
import { errorResponse, SERVER_STATUS } from "./errors.ts";
import { checked, readBody, readQuery } from "./request.ts";

/** `GET /proposals/:id?version=n`: one version's content instead of the current version's. */
const DetailQuery = z.strictObject(
  {
    version: z
      .string()
      .regex(/^[1-9][0-9]*$/, { error: "version must be a whole number of 1 or more: one of the proposal's versions" })
      .transform(Number)
      .exactOptional(),
  },
  { error: (issue) => (issue.code === "unrecognized_keys" ? "unknown query parameter; send only version" : undefined) },
);

export const proposalRoutes = (app: Hono, proposals: Proposals) => {
  app.get("/proposals", async (c) => {
    const { status } = readQuery(c, ListProposalsQuery);
    return c.json(checked(ListProposalsSchema, { proposals: await proposals.list(status) }) satisfies ListProposalsResponse);
  });

  app.get("/proposals/:id", async (c) => {
    const { version } = readQuery(c, DetailQuery);
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

  // In the app's contract, but not answered by this service.
  const notServedYet = (c: Context) =>
    errorResponse(
      c,
      SERVER_STATUS.not_found,
      ServerErrorCode.enum.not_found,
      `This service doesn't serve ${c.req.method} ${c.req.routePath} yet. Update the service to a version that does.`,
    );
  app.put("/proposals/:id/draft", notServedYet);
  app.delete("/proposals/:id/draft", notServedYet);
};
