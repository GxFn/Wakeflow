import { equal } from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  computeWakeflowStaticMaterializationPreviewDigest,
  parseWakeflowStaticMaterializationPreview,
  WakeflowStaticMaterializationPreviewError,
  type WakeflowStaticMaterializationPreview,
  type WakeflowStaticMaterializationStep,
} from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview-contract.js";

const DIGEST = parseSha256Digest(`sha256:${"0".repeat(64)}`, "$digest");

function preview(
  overrides: Partial<Omit<WakeflowStaticMaterializationPreview, "planDigest">> = {},
) {
  const basis = Object.freeze({
    kind: "WakeflowStaticMaterializationPreview" as const,
    schemaVersion: 1 as const,
    executionBoundary: "preview-only" as const,
    action: "reconcile" as const,
    status: "ready" as const,
    currentConfigDigest: DIGEST,
    desiredConfigDigest: DIGEST,
    matrixDigest: DIGEST,
    coreLayoutInspectionDigest: DIGEST,
    blockerCodes: Object.freeze([]),
    steps: Object.freeze([]),
    ...overrides,
  });
  return {
    ...basis,
    planDigest: computeWakeflowStaticMaterializationPreviewDigest(basis),
  };
}

function step(
  stepId: string,
  dependsOn: readonly string[] = [],
  targetKey = "target",
): Readonly<WakeflowStaticMaterializationStep> {
  return Object.freeze({
    stepId,
    kind: "materialize-local-protocol",
    ownerId: "maintenance-bootstrap",
    targetKey,
    sourceDigest: null,
    targetDigest: DIGEST,
    dependsOn: Object.freeze(dependsOn),
  });
}

function expectInvalid(value: unknown): void {
  let caught: unknown;
  try {
    parseWakeflowStaticMaterializationPreview(value);
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowStaticMaterializationPreviewError, true);
}

test("Static materialization preview contract admits one canonical plan", () => {
  const value = preview();
  equal(parseWakeflowStaticMaterializationPreview(value).planDigest,
    value.planDigest);
  const realisticTarget = preview({
    steps: Object.freeze([step(
      "support-memory:surface_33333333-3333-4333-8333-333333333333",
      [],
      "surface_33333333-3333-4333-8333-333333333333:claude-code",
    )]),
  });
  equal(
    parseWakeflowStaticMaterializationPreview(realisticTarget).steps.length,
    1,
  );
});

test("Static materialization preview closes target and dependency order", () => {
  expectInvalid(preview({
    steps: Object.freeze([step("core:first", [], " invalid")]),
  }));
  expectInvalid(preview({
    steps: Object.freeze([
      step("core:first"),
      step("core:second"),
      step("core:third", ["core:second", "core:first"]),
    ]),
  }));
});

test("Static materialization preview closes action-specific Config facts", () => {
  expectInvalid(preview({
    action: "fresh-initialize",
    currentConfigDigest: null,
    desiredConfigDigest: null,
  }));
  expectInvalid(preview({
    action: "fresh-initialize",
    currentConfigDigest: null,
  }));
  expectInvalid(preview({
    action: "reconcile",
    currentConfigDigest: DIGEST,
    desiredConfigDigest: null,
  }));
  expectInvalid(preview({
    action: "reconcile",
    currentConfigDigest: null,
    desiredConfigDigest: DIGEST,
  }));
});
