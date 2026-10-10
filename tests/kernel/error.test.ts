import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  fail,
  failWithBlockers,
  isWakeflowError,
  toWakeflowError,
  translateLegacyError,
  WakeflowError,
} from "../../src/kernel/error.js";
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

test("旧错误类按家族表翻成封闭码：retryable 为 concurrency-conflict，旧码与授权事实进 details，消息不复制（§13.166）", () => {
  class LockError extends Error {
    readonly code = "wakeflow-rooted-exclusive-file-lock";
    readonly reason = "timeout";
    readonly path = "$lock";
    readonly retryable = true;
  }
  const lock = translateLegacyError(new LockError("/Users/someone/private lock"));
  ok(lock !== null);
  deepEqual(lock.toPublicDetails(), {
    code: "concurrency-conflict",
    reason: "timeout",
    path: "$lock",
    retryable: true,
    details: { legacyCode: "wakeflow-rooted-exclusive-file-lock" },
    causeReason: "timeout",
  });
  equal(lock.message.includes("/Users"), false);
  const publication = translateLegacyError(
    Object.assign(new Error("x"), {
      code: "wakeflow-demand-event-sourcing-publication-transaction",
      reason: "Not A Token",
      path: "/Users/someone/not-a-structural-path",
      publicationAuthority: "recoverable",
      operationId: "maintenance_operation_11111111-1111-4111-8111-111111111111",
      eventAuthority: "/Users/someone/leak",
    }),
    "$request",
  );
  ok(publication !== null);
  deepEqual(publication.toPublicDetails(), {
    code: "precondition-failed",
    reason: "legacy",
    path: "$request",
    retryable: false,
    details: {
      legacyCode: "wakeflow-demand-event-sourcing-publication-transaction",
      operationId: "maintenance_operation_11111111-1111-4111-8111-111111111111",
      publicationAuthority: "recoverable",
    },
  });
  // 表外的 wakeflow- 码落到 unexpected；不是旧错误形状的异常不翻译。
  equal(
    translateLegacyError(
      Object.assign(new Error("x"), { code: "wakeflow-not-a-module", reason: "r" }),
    )?.code,
    "unexpected",
  );
  equal(
    translateLegacyError(Object.assign(new Error("x"), { code: "legacy-conflict", reason: "r" })),
    null,
  );
  equal(translateLegacyError(new Error("plain")), null);
  equal(
    toWakeflowError(Object.assign(new Error("x"), { code: "wakeflow-json-value", reason: "shape" }))
      .code,
    "unexpected",
  );
  equal(
    toWakeflowError(Object.assign(new Error("x"), { code: "wakeflow-json-value", reason: "shape" }))
      .reason,
    "shape",
  );
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

test("公共细节沿 cause 链投影第一个 Node errno 与第一个内层 reason，不复制消息（§13.165 G3）", () => {
  const errno = Object.assign(new Error("EACCES: permission denied, rm '/Users/someone/x'"), {
    code: "EACCES",
  });
  class LegacyError extends Error {
    readonly reason = "stage-recovery-required";
  }
  const nested = new WakeflowError("io-failure", "demand-root-remove", "$demandRoot", {
    cause: new LegacyError("legacy", { cause: errno }),
  });
  deepEqual(nested.toPublicDetails(), {
    code: "io-failure",
    reason: "demand-root-remove",
    path: "$demandRoot",
    retryable: false,
    causeCode: "EACCES",
    causeReason: "stage-recovery-required",
  });
  equal(JSON.stringify(nested.toPublicDetails()).includes("/Users"), false);
  // 只有 errno：没有 causeReason；内层 reason 不是 kebab 记号时省略；没有 cause 时两者都不出现。
  deepEqual(
    new WakeflowError("io-failure", "receipt-read", "$receipt", { cause: errno }).toPublicDetails(),
    {
      code: "io-failure",
      reason: "receipt-read",
      path: "$receipt",
      retryable: false,
      causeCode: "EACCES",
    },
  );
  const loud = Object.assign(new Error("x"), { reason: "Not A Token /Users/someone" });
  equal(Object.hasOwn(toWakeflowError(loud).toPublicDetails(), "causeReason"), false);
  equal(Object.hasOwn(new WakeflowError("unexpected", "x").toPublicDetails(), "causeCode"), false);
  // 内核错误套内核错误：内层 reason 进入 causeReason；自引用的链在 8 层处停止。
  const inner = new WakeflowError("concurrency-conflict", "lock-held", "$lock");
  equal(
    new WakeflowError("io-failure", "wrapped", "$", { cause: inner }).toPublicDetails().causeReason,
    "lock-held",
  );
  const loop: { cause?: unknown } = {};
  loop.cause = loop;
  deepEqual(new WakeflowError("unexpected", "x", "$", { cause: loop }).toPublicDetails(), {
    code: "unexpected",
    reason: "x",
    path: "$",
    retryable: false,
  });
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

test("failWithBlockers：阻塞码是原因，details 至多 8 项，非标识阻塞项只留阻塞码（§13.131 审查）", () => {
  const blockers = [
    "section-anchor-unknown:性能约束",
    ...Array.from({ length: 9 }, (_, index) => `step-uncovered:ts-${index + 1}`),
  ];
  throws(
    () => failWithBlockers(blockers, "$request.sectionAnchors"),
    (error: unknown) => {
      if (!isWakeflowError(error)) return false;
      const details = error.toPublicDetails();
      equal(details.code, "precondition-failed");
      equal(details.reason, "section-anchor-unknown");
      equal(details.path, "$request.sectionAnchors");
      equal(Object.keys(details.details ?? {}).length, 8);
      equal(details.details?.blocker, "section-anchor-unknown");
      equal(details.details?.blocker2, "step-uncovered:ts-1");
      return true;
    },
  );
  throws(
    () => failWithBlockers([], "$"),
    (error: unknown) => isWakeflowError(error) && error.reason === "empty-blockers",
  );
});
