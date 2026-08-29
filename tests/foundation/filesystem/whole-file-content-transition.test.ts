import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  planWholeFileContentTransition,
  WholeFileContentTransitionError,
  type WholeFileContentTransitionRequest,
} from "../../../src/foundation/filesystem/whole-file-content-transition.js";

const CURRENT = Buffer.from("current\n");
const DESIRED = Buffer.from("desired\n");

function asRequest(value: unknown): WholeFileContentTransitionRequest {
  return value as WholeFileContentTransitionRequest;
}

test("whole-file transition closes absent, current and admitted replacement", () => {
  const created = planWholeFileContentTransition(null, {
    currentContents: [],
    desiredContent: DESIRED,
  });
  equal(created.disposition, "create-required");
  equal(created.sourceAuthority, "absent");

  const current = planWholeFileContentTransition(DESIRED, {
    currentContents: [CURRENT],
    desiredContent: DESIRED,
  });
  equal(current.disposition, "current");
  equal(current.sourceAuthority, "desired");

  const replaced = planWholeFileContentTransition(CURRENT, {
    currentContents: [CURRENT],
    desiredContent: DESIRED,
  });
  equal(replaced.disposition, "replace-required");
  equal(replaced.sourceAuthority, "admitted-current");
  equal(Buffer.from(replaced.desiredBytes).equals(DESIRED), true);
  equal(replaced.desiredBytes === DESIRED, false);
  equal(Object.isFrozen(replaced), true);
  equal(
    Object.keys(replaced).sort().join(","),
    "desiredByteCount,desiredBytes,desiredDigest,disposition,sourceAuthority",
  );
});

test("whole-file transition rejects unknown, duplicated, or malformed input", () => {
  for (const [action, reason, path] of [
    [
      () => planWholeFileContentTransition(Buffer.from("unknown\n"), {
        currentContents: [CURRENT],
        desiredContent: DESIRED,
      }),
      "unadmitted-source",
      "$source",
    ],
    [
      () => planWholeFileContentTransition(null, {
        currentContents: [CURRENT, Buffer.from(CURRENT)],
        desiredContent: DESIRED,
      }),
      "duplicate-current",
      "$request.currentContents/1",
    ],
    [
      () => planWholeFileContentTransition(null, asRequest({
        currentContents: [],
        desiredContent: DESIRED,
        extra: true,
      })),
      "input",
      "$request",
    ],
  ] as const) {
    let caught: unknown;
    try {
      action();
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof WholeFileContentTransitionError, true);
    if (caught instanceof WholeFileContentTransitionError) {
      equal(caught.reason, reason);
      equal(caught.path, path);
    }
  }
});
