import { equal } from "node:assert/strict";
import { test } from "node:test";

import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  recomposeWakeflowManagedTextEnvelope,
} from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import {
  planWakeflowManagedTextAuthorityTransition,
  WakeflowManagedTextAuthorityTransitionError,
  type WakeflowManagedTextAuthorityTransitionErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-managed-text-authority-transition.js";

const CURRENT = Object.freeze({
  component: "program-instruction",
  owner: "host-instruction-integration",
  body: "## Current\n",
});
const DESIRED = Object.freeze({
  component: "program-instruction",
  owner: "host-instruction-integration",
  body: "## Desired\n",
});

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  if (ArrayBuffer.isView(value)) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function expectTransitionError(
  action: () => unknown,
  reason: WakeflowManagedTextAuthorityTransitionErrorReason,
  path: string,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowManagedTextAuthorityTransitionError, true);
  if (caught instanceof WakeflowManagedTextAuthorityTransitionError) {
    equal(caught.code, "wakeflow-managed-text-authority-transition");
    equal(caught.reason, reason);
    equal(caught.path, path);
  }
}

test("Managed Text authority transition inserts into unmanaged outside bytes", () => {
  const source = encodeUtf8("# User-owned instructions\n");
  const transition = planWakeflowManagedTextAuthorityTransition(source, {
    currentTargets: [],
    desiredTarget: DESIRED,
  });

  equal(transition.disposition, "recompose-required");
  equal(transition.sourceAuthority, "unmanaged");
  equal(transition.target?.disposition, "inserted");
  equal(
    Buffer.from(transition.target?.bytes ?? []).subarray(0, source.byteLength)
      .equals(Buffer.from(source)),
    true,
  );
  assertDeepFrozen(transition);
});

test("Managed Text authority transition admits exact current and converges to desired", () => {
  const currentBytes = recomposeWakeflowManagedTextEnvelope(
    new Uint8Array(),
    CURRENT,
  ).bytes;
  const update = planWakeflowManagedTextAuthorityTransition(currentBytes, {
    currentTargets: [CURRENT],
    desiredTarget: DESIRED,
  });
  equal(update.disposition, "recompose-required");
  equal(update.sourceAuthority, "admitted-current");
  equal(update.target?.disposition, "updated");

  const targetBytes = update.target?.bytes;
  if (targetBytes === undefined) throw new Error("Expected target bytes.");
  const current = planWakeflowManagedTextAuthorityTransition(targetBytes, {
    currentTargets: [CURRENT],
    desiredTarget: DESIRED,
  });
  equal(current.disposition, "current");
  equal(current.sourceAuthority, "desired");
  equal(current.target, null);
});

test("Managed Text authority transition rejects marker-only ownership claims", () => {
  const unknownBytes = recomposeWakeflowManagedTextEnvelope(
    new Uint8Array(),
    { ...CURRENT, body: "## User changed managed content\n" },
  ).bytes;
  expectTransitionError(
    () => planWakeflowManagedTextAuthorityTransition(unknownBytes, {
      currentTargets: [CURRENT],
      desiredTarget: DESIRED,
    }),
    "unadmitted-source",
    "$source",
  );

  const foreignBytes = recomposeWakeflowManagedTextEnvelope(
    new Uint8Array(),
    {
      component: "foreign-component",
      owner: "foreign-owner",
      body: "## Foreign\n",
    },
  ).bytes;
  expectTransitionError(
    () => planWakeflowManagedTextAuthorityTransition(foreignBytes, {
      currentTargets: [CURRENT],
      desiredTarget: DESIRED,
    }),
    "relation",
    "$source",
  );

  expectTransitionError(
    () => planWakeflowManagedTextAuthorityTransition(new Uint8Array(), {
      currentTargets: [CURRENT, CURRENT],
      desiredTarget: DESIRED,
    }),
    "input",
    "$request.currentTargets/1",
  );
});
