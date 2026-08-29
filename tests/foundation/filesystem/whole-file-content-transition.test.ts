import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  planWholeFileContentTransition,
  WholeFileContentTransitionError,
} from "../../../src/foundation/filesystem/whole-file-content-transition.js";

const CURRENT = Buffer.from("current\n");
const DESIRED = Buffer.from("desired\n");

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
  equal(replaced.matchedCurrentContentIndex, 0);
  equal(Buffer.from(replaced.desiredBytes).equals(DESIRED), true);
  equal(replaced.desiredBytes === DESIRED, false);
});

test("whole-file transition rejects unknown or duplicated current content", () => {
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
