import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  currentUserIdOrNull,
  ownedByAnotherUser,
  requireCurrentUserId,
} from "../../../src/foundation/node/current-user.js";

/**
 * 级别 0（纯逻辑）：当前进程的有效用户（open-items L4）。
 *
 * 属主检查的三种问法收在一处之后，这里钉它们各自的含义，以及平台不提供 `geteuid` 时三种问法的不同结论：
 * 拿不到就是 null、拿不到就交给调用方的失败、拿不到就不核对。平台的缺席用临时拿掉 `process.geteuid` 来
 * 模拟，测试结束前放回。
 */

function withoutGeteuid(run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(process, "geteuid");
  Object.defineProperty(process, "geteuid", { value: undefined, configurable: true });
  try {
    run();
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(process, "geteuid");
    else Object.defineProperty(process, "geteuid", descriptor);
  }
}

class CallerError extends Error {}

function callerFailure(): never {
  throw new CallerError("unsupported");
}

test("平台提供 geteuid 时三种问法说的是同一个用户", () => {
  if (typeof process.geteuid !== "function") return;
  const expected = BigInt(process.geteuid());
  equal(currentUserIdOrNull(), expected);
  equal(requireCurrentUserId(callerFailure), expected);
  equal(ownedByAnotherUser(expected), false);
  equal(ownedByAnotherUser(expected + 1n), true);
});

test("平台不提供 geteuid 时：拿不到是 null，要求的一方抛调用方自己的错误，属主一律不核对", () => {
  withoutGeteuid(() => {
    equal(currentUserIdOrNull(), null);
    throws(() => requireCurrentUserId(callerFailure), CallerError);
    equal(ownedByAnotherUser(0n), false);
    equal(ownedByAnotherUser(12345n), false);
  });
  // 放回之后恢复原状。
  equal(typeof process.geteuid, "function");
});
