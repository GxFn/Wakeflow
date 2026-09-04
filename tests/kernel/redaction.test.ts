import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { isWakeflowError } from "../../src/kernel/error.js";
import {
  assertPublicJson,
  assertRequestFreeOfPrivateText,
  containsPrivateText,
  createRedactionBoundary,
  locatePrivateText,
  mergeRedactionBoundaries,
} from "../../src/kernel/redaction.js";

const boundary = createRedactionBoundary([
  "/Users/someone/Workspace",
  "/private/Users/someone/Workspace",
  "session_11111111-1111-4111-8111-111111111111",
  "/",
]);

test("边界忽略过短的值，并在键与值里定位私有文本", () => {
  equal(boundary.privateValues.has("/"), false);
  equal(containsPrivateText({ ok: "nothing here" }, boundary), false);
  equal(
    locatePrivateText({ nested: [{ ref: "/Users/someone/Workspace/x" }] }, boundary),
    "$.nested[0].ref",
  );
  equal(
    locatePrivateText({ "session_11111111-1111-4111-8111-111111111111": 1 }, boundary),
    "$.session_11111111-1111-4111-8111-111111111111",
  );
});

test("公共输出与请求分别以 output-boundary 与 privacy-violation 失败", () => {
  throws(
    () => assertPublicJson({ path: "/private/Users/someone/Workspace" }, boundary, "$"),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "output-boundary" &&
      error.reason === "private-value" &&
      error.path === "$.path",
  );
  throws(
    () => assertRequestFreeOfPrivateText({ a: { "b c": "/Users/someone/Workspace" } }, boundary),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "privacy-violation" &&
      error.path === "$.a.b_c",
  );
  const merged = mergeRedactionBoundaries(boundary, createRedactionBoundary(["/Users/other"]));
  equal(merged.privateValues.size, 4);
});
