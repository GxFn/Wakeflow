import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { isWakeflowError } from "../../src/kernel/error.js";
import {
  assertCanonicalTextWithinLimit,
  assertWithinByteLimit,
  assertWithinCharacterLimit,
  assertWithinItemLimit,
  measureCanonicalBytes,
  WAKEFLOW_LIMITS,
} from "../../src/kernel/limits.js";

test("上限表按用途命名且断言以 capacity-exceeded 失败", () => {
  equal(WAKEFLOW_LIMITS.promptCharacters, 65_536);
  equal(measureCanonicalBytes({ a: 1 }), '{"a":1}'.length);
  assertWithinByteLimit({ a: 1 }, "publicRequestBytes");
  throws(
    () => assertWithinCharacterLimit("x".repeat(65_537), "promptCharacters", "$.prompt"),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "capacity-exceeded" &&
      error.reason === "prompt-characters" &&
      error.path === "$.prompt",
  );
  assertWithinItemLimit(256, "listPageItems");
  throws(
    () => assertWithinItemLimit(257, "listPageItems"),
    (error: unknown) => isWakeflowError(error) && error.reason === "list-page-items",
  );
  throws(
    () => assertWithinItemLimit(-1, "listPageItems"),
    (error: unknown) => isWakeflowError(error) && error.code === "invalid-request",
  );
});

test("超出公共字节上限以 kebab-case 原因的 WakeflowError 失败", () => {
  const oversizedRequest = "x".repeat(WAKEFLOW_LIMITS.publicRequestBytes);
  throws(
    () => assertWithinByteLimit(oversizedRequest, "publicRequestBytes", "$request"),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "capacity-exceeded" &&
      error.reason === "public-request-bytes" &&
      error.path === "$request",
  );
  const oversizedResult = "x".repeat(WAKEFLOW_LIMITS.publicResultBytes + 1);
  throws(
    () => assertCanonicalTextWithinLimit(oversizedResult, "publicResultBytes", "$result"),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "output-boundary" &&
      error.reason === "public-result-bytes" &&
      error.path === "$result",
  );
});
