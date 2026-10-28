import { equal } from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  computeWakeflowStaticMaterializationPreviewDigest,
  parseWakeflowStaticMaterializationPreview,
  type WakeflowStaticMaterializationPreview,
  WakeflowStaticMaterializationPreviewError,
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
  equal(parseWakeflowStaticMaterializationPreview(value).planDigest, value.planDigest);
  const realisticTarget = preview({
    steps: Object.freeze([
      step(
        "support-memory:surface_33333333-3333-4333-8333-333333333333",
        [],
        "surface_33333333-3333-4333-8333-333333333333:claude-code",
      ),
    ]),
  });
  equal(parseWakeflowStaticMaterializationPreview(realisticTarget).steps.length, 1);
});

test("Static materialization preview closes target and dependency order", () => {
  expectInvalid(
    preview({
      steps: Object.freeze([step("core:first", [], " invalid")]),
    }),
  );
  expectInvalid(
    preview({
      steps: Object.freeze([
        step("core:first"),
        step("core:second"),
        step("core:third", ["core:second", "core:first"]),
      ]),
    }),
  );
});

test("Static materialization preview closes action-specific Config facts", () => {
  expectInvalid(
    preview({
      action: "fresh-initialize",
      currentConfigDigest: null,
      desiredConfigDigest: null,
    }),
  );
  expectInvalid(
    preview({
      action: "fresh-initialize",
      currentConfigDigest: null,
    }),
  );
  expectInvalid(
    preview({
      action: "reconcile",
      currentConfigDigest: DIGEST,
      desiredConfigDigest: null,
    }),
  );
  expectInvalid(
    preview({
      action: "reconcile",
      currentConfigDigest: null,
      desiredConfigDigest: DIGEST,
    }),
  );
});

const OTHER_DIGEST = parseSha256Digest(`sha256:${"1".repeat(64)}`, "$digest");

function detachStep(
  stepId: string,
  kind: WakeflowStaticMaterializationStep["kind"],
  targetKey: string,
  dependsOn: readonly string[] = [],
): Readonly<WakeflowStaticMaterializationStep> {
  return Object.freeze({
    stepId,
    kind,
    ownerId: "config-authority",
    targetKey,
    sourceDigest: DIGEST,
    targetDigest: OTHER_DIGEST,
    dependsOn: Object.freeze(dependsOn),
  });
}

test("退出路径的 Config 事实（ADR-0024）：detach-workspace 以 retire-config 收尾且期望摘要等于当前摘要，detach-repository 以 publish-config 收尾且期望摘要不同", () => {
  const removal = detachStep(
    "detach:managed-block:program-instruction",
    "remove-managed-block",
    "program-instruction",
  );
  const projections = detachStep(
    "detach:window-projections:workspace",
    "retire-window-projections",
    "workspace",
  );
  const retire = detachStep(
    "authority:retire-config",
    "retire-config",
    "workspace.config-authority",
    [removal.stepId, projections.stepId],
  );
  const workspace = preview({
    action: "detach-workspace",
    steps: Object.freeze([removal, projections, retire]),
  });
  equal(parseWakeflowStaticMaterializationPreview(workspace).steps.length, 3);
  // 退役步必须是最后一步并依赖之前的每一步；期望摘要不能偏离当前摘要；不能用 publish-config 收尾。
  expectInvalid(preview({ action: "detach-workspace", steps: Object.freeze([retire, removal]) }));
  expectInvalid(
    preview({
      action: "detach-workspace",
      desiredConfigDigest: OTHER_DIGEST,
      steps: Object.freeze([retire]),
    }),
  );
  expectInvalid(
    preview({
      action: "detach-workspace",
      steps: Object.freeze([
        detachStep("authority:config", "publish-config", "workspace.config-authority"),
      ]),
    }),
  );
  // ready 的 detach-workspace 必须有退役步；blocked 的可以没有步骤。
  expectInvalid(preview({ action: "detach-workspace" }));
  equal(
    parseWakeflowStaticMaterializationPreview(
      preview({
        action: "detach-workspace",
        status: "blocked",
        blockerCodes: Object.freeze([
          "detach-unknown-managed-body:program-instruction:claude-code",
        ]),
      }),
    ).status,
    "blocked",
  );

  const publish = detachStep("authority:config", "publish-config", "workspace.config-authority", [
    removal.stepId,
  ]);
  const repository = preview({
    action: "detach-repository",
    desiredConfigDigest: OTHER_DIGEST,
    steps: Object.freeze([removal, publish]),
  });
  equal(parseWakeflowStaticMaterializationPreview(repository).steps.at(-1)?.kind, "publish-config");
  expectInvalid(preview({ action: "detach-repository", steps: Object.freeze([removal, publish]) }));
  expectInvalid(
    preview({
      action: "detach-repository",
      desiredConfigDigest: OTHER_DIGEST,
      steps: Object.freeze([retire]),
    }),
  );
  expectInvalid(
    preview({
      action: "detach-repository",
      currentConfigDigest: null,
      desiredConfigDigest: OTHER_DIGEST,
    }),
  );
  // 阻塞码可带冒号分隔的目标段，但仍以短横线词开头。
  expectInvalid(
    preview({ action: "reconcile", status: "blocked", blockerCodes: Object.freeze([":bad"]) }),
  );
});
