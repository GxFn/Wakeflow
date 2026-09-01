import { deepEqual, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  parseGitObjectId,
  sameGitObjectId,
  GitObjectIdError,
} from "../../../src/foundation/git/git-object-id.js";

test("Git object ID显式区分完整SHA-1与SHA-256格式", () => {
  const sha1 = parseGitObjectId({ algorithm: "sha1", value: "a".repeat(40) });
  const sha256 = parseGitObjectId({
    algorithm: "sha256",
    value: "b".repeat(64),
  });
  deepEqual(sha1, { algorithm: "sha1", value: "a".repeat(40) });
  deepEqual(sha256, { algorithm: "sha256", value: "b".repeat(64) });
  if (!sameGitObjectId(sha256, { ...sha256 })) {
    throw new Error("Expected equal Git object IDs.");
  }
});

test("Git object ID拒绝缩写、大写、算法长度错配和额外字段", () => {
  for (const value of [
    { algorithm: "sha1", value: "a".repeat(12) },
    { algorithm: "sha1", value: "A".repeat(40) },
    { algorithm: "sha1", value: "a".repeat(64) },
    { algorithm: "sha256", value: "a".repeat(40) },
    { algorithm: "sha256", value: "a".repeat(64), extra: true },
  ]) {
    throws(
      () => parseGitObjectId(value),
      (error: unknown) =>
        error instanceof GitObjectIdError && error.reason === "schema",
    );
  }
});
