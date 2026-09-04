import { equal, notEqual, throws } from "node:assert/strict";
import { test } from "node:test";

import { isWakeflowError } from "../../src/kernel/error.js";
import {
  deriveDemandCommitId,
  deriveDurableId,
  deterministicUuidV4,
  parseIdempotencyKey,
} from "../../src/kernel/ids.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

test("确定性 UUID 派生：同输入同身份，不同输入不同身份，形状仍是 v4", () => {
  const first = deterministicUuidV4("wakeflow-test", "alpha", "1");
  equal(first, deterministicUuidV4("wakeflow-test", "alpha", "1"));
  equal(UUID_V4.test(first), true);
  notEqual(first, deterministicUuidV4("wakeflow-test", "alpha", "2"));
  notEqual(first, deterministicUuidV4("other-namespace", "alpha", "1"));
  // 片段边界必须保留：("ab","c") 与 ("a","bc") 不能碰撞。
  notEqual(
    deterministicUuidV4("wakeflow-test", "ab", "c"),
    deterministicUuidV4("wakeflow-test", "a", "bc"),
  );
  throws(
    () => deterministicUuidV4(""),
    (error: unknown) => isWakeflowError(error) && error.code === "invalid-request",
  );
});

test("typed durable id 与 commitId 由种类、命名空间和片段派生", () => {
  const taskPackageId = deriveDurableId("task-package", "plan-target-task", "demand-x", "key-1");
  equal(taskPackageId.startsWith("task-package_"), true);
  equal(taskPackageId, deriveDurableId("task-package", "plan-target-task", "demand-x", "key-1"));
  notEqual(
    deriveDurableId("target-task", "plan-target-task", "demand-x", "key-1").slice(-36),
    taskPackageId.slice(-36),
  );
  const commitId = deriveDemandCommitId("demand-x", "key-1");
  equal(commitId.startsWith("demand-event-commit_"), true);
  equal(commitId, deriveDemandCommitId("demand-x", "key-1"));
  notEqual(commitId, deriveDemandCommitId("demand-x", "key-2"));
});

test("幂等键只接受短的 URL 安全标识", () => {
  equal(parseIdempotencyKey("plan-1"), "plan-1");
  equal(parseIdempotencyKey("a.b:c_d"), "a.b:c_d");
  for (const bad of ["", "bad key", "x".repeat(129), 42, null, "汉字"]) {
    throws(
      () => parseIdempotencyKey(bad, "$request.idempotencyKey"),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "invalid-request" &&
        error.path === "$request.idempotencyKey",
    );
  }
});
