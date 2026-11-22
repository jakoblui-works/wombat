// Answer state is per request: one request's pending or failed answer never shows on another, and a request's latest
// attempt is the one that counts.
import { expect, test } from "vitest";

import { type AnswerAttempt, answerState } from "./answer.ts";

const attempt = (requestId: string, submittedAt: number, outcome: "pending" | "failed" | "done"): AnswerAttempt => ({
  requestId,
  submittedAt,
  pending: outcome === "pending",
  error: outcome === "failed" ? new Error(`answer to ${requestId} failed`) : null,
});

test("each request reads its own answer: pending, failed or nothing", () => {
  const attempts = [attempt("req-a", 1, "failed"), attempt("req-b", 2, "pending")];
  expect(answerState(attempts, "req-a")).toEqual({ pending: false, error: new Error("answer to req-a failed") });
  expect(answerState(attempts, "req-b")).toEqual({ pending: true, error: undefined });
  expect(answerState(attempts, "req-c")).toEqual({ pending: false, error: undefined });
});

test("a request's latest attempt counts: a retry clears the earlier failure", () => {
  expect(answerState([attempt("req-a", 1, "failed"), attempt("req-a", 2, "pending")], "req-a")).toEqual({ pending: true, error: undefined });
  expect(answerState([attempt("req-a", 2, "done"), attempt("req-a", 1, "failed")], "req-a")).toEqual({ pending: false, error: undefined });
});
