import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { fail, isWakeflowError, toWakeflowError, WakeflowError } from "../../src/kernel/error.js";
import {
  isWakeflowErrorCode,
  WAKEFLOW_ERROR_CODES,
} from "../../src/contracts/vocabulary/wakeflow-error-code.js";

test("WakeflowError 只接受封闭错误码、kebab-case 原因与结构路径", () => {
  const error = new WakeflowError("precondition-failed", "review-pending", "$.demandId", {
    retryable: false,
  });
  deepEqual(error.toPublicDetails(), {
    code: "precondition-failed",
    reason: "review-pending",
    path: "$.demandId",
    retryable: false,
  });
  equal(error.message, "precondition-failed: review-pending at $.demandId");
  equal(Object.isFrozen(error), true);
  throws(() => new WakeflowError("nope" as never, "x"), TypeError);
  throws(() => new WakeflowError("unexpected", "Not Kebab"), TypeError);
  throws(() => new WakeflowError("unexpected", "x", "request.root"), TypeError);
  equal(new WakeflowError("unexpected", "x", "$/events/0").path, "$/events/0");
  equal(WAKEFLOW_ERROR_CODES.length, 12);
  equal(isWakeflowErrorCode("io-failure"), true);
  equal(isWakeflowErrorCode("IoFailure"), false);
});

test("fail 抛出内核错误，toWakeflowError 把陌生异常包成 unexpected 且不复制消息", () => {
  throws(
    () => fail("concurrency-conflict", "stream-revision", "$.expectedStreamRevision"),
    (error: unknown) =>
      isWakeflowError(error) && error.code === "concurrency-conflict" && error.retryable === false,
  );
  const wrapped = toWakeflowError(new Error("/Users/private/path leaked"), "$.request");
  equal(wrapped.code, "unexpected");
  equal(wrapped.reason, "unhandled");
  equal(wrapped.path, "$.request");
  equal(wrapped.message.includes("/Users/private"), false);
  equal((wrapped.cause as Error).message.includes("leaked"), true);
  const original = new WakeflowError("not-found", "demand");
  equal(toWakeflowError(original), original);
});

test("WakeflowError details 只接受少量短标识并进入公共细节", () => {
  const operationId = "maintenance_operation_11111111-1111-4111-8111-111111111111";
  const error = new WakeflowError("recovery-required", "journal", "$request.root", {
    details: { operationId },
  });
  deepEqual(error.toPublicDetails(), {
    code: "recovery-required",
    reason: "journal",
    path: "$request.root",
    retryable: false,
    details: { operationId },
  });
  equal(Object.isFrozen(error.details), true);
  equal(new WakeflowError("unexpected", "x", "$", { details: {} }).details, null);
  equal(Object.hasOwn(new WakeflowError("unexpected", "x").toPublicDetails(), "details"), false);
  throws(
    () => new WakeflowError("unexpected", "x", "$", { details: { path: "/Users/someone/x" } }),
    TypeError,
  );
  throws(
    () => new WakeflowError("unexpected", "x", "$", { details: { "bad key": "v" } }),
    TypeError,
  );
  throws(
    () => new WakeflowError("unexpected", "x", "$", { details: { note: "has space" } }),
    TypeError,
  );
});
