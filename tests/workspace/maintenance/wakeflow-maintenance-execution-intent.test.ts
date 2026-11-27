import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
} from "../../../src/configuration/wakeflow-config.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { createWakeflowHostMaintenanceContribution } from "../../../src/workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import {
  advanceWakeflowMaintenanceExecutionIntent,
  computeWakeflowMaintenanceExecutionIntentDigest,
  createWakeflowMaintenanceExecutionIntent,
  createWakeflowMaintenanceIntentResourceDeclaration,
  parseWakeflowMaintenanceExecutionIntent,
  reconstructWakeflowMaintenanceExecutionFromIntent,
  renderWakeflowMaintenanceExecutionIntent,
  WakeflowMaintenanceExecutionIntentError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent.js";
import {
  assertWakeflowMaintenanceExecutionIntentCapacity,
  WakeflowMaintenanceExecutionIntentStoreError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-intent-store.js";
import { createWakeflowMaintenanceExecutionPlan } from "../../../src/workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import { parseWakeflowMaintenanceOperationId } from "../../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import {
  computeWakeflowStaticMaterializationPreviewDigest,
  parseWakeflowStaticMaterializationPreview,
} from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview-contract.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

const OPERATION_ID = parseWakeflowMaintenanceOperationId(
  "maintenance_operation_11111111-1111-4111-8111-111111111111",
);
const PROFILES = Object.freeze([
  claudeCodeWorkspaceHostResourceProfile,
  codexWorkspaceHostResourceProfile,
]);

function fixture() {
  const config = parseWakeflowConfig(createMinimalWakeflowConfig());
  const desiredDigest = computeWakeflowConfigDigest(config);
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(codexWorkspaceHostResourceProfile);
  const basis = {
    kind: "WakeflowStaticMaterializationPreview" as const,
    schemaVersion: 1 as const,
    executionBoundary: "preview-only" as const,
    action: "fresh-initialize" as const,
    status: "ready" as const,
    currentConfigDigest: null,
    desiredConfigDigest: desiredDigest,
    matrixDigest: matrix.matrixDigest,
    coreLayoutInspectionDigest: desiredDigest,
    blockerCodes: Object.freeze([]),
    steps: Object.freeze([
      Object.freeze({
        stepId: "authority:config",
        kind: "publish-config" as const,
        ownerId: "config-authority",
        targetKey: "workspace.config-authority",
        sourceDigest: null,
        targetDigest: desiredDigest,
        dependsOn: Object.freeze([]),
      }),
    ]),
  };
  const preview = parseWakeflowStaticMaterializationPreview({
    ...basis,
    planDigest: computeWakeflowStaticMaterializationPreviewDigest(basis),
  });
  const plan = createWakeflowMaintenanceExecutionPlan(
    preview,
    codexWorkspaceHostResourceProfile,
    null,
  );
  const request = Object.freeze({
    action: "fresh-initialize" as const,
    desiredConfig: config,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
  return Object.freeze({ config, plan, request });
}

test("compact intent reconstructs the exact plan and request after restart", () => {
  const value = fixture();
  const intent = createWakeflowMaintenanceExecutionIntent(
    OPERATION_ID,
    value.plan,
    value.request,
    value.config,
  );
  deepEqual(
    intent.hostProfiles.map((entry) => entry.hostId),
    ["claude-code", "codex"],
  );
  equal(intent.planDigest, value.plan.planDigest);
  const reconstructed = reconstructWakeflowMaintenanceExecutionFromIntent(intent);
  equal(reconstructed.plan.planDigest, value.plan.planDigest);
  const recoveredRequest = reconstructed.request;
  equal(recoveredRequest.action, "fresh-initialize");
  equal(
    computeWakeflowConfigDigest(parseWakeflowConfig(recoveredRequest.desiredConfig)),
    computeWakeflowConfigDigest(value.config),
  );

  const text = renderWakeflowMaintenanceExecutionIntent(intent);
  deepEqual(parseWakeflowMaintenanceExecutionIntent(JSON.parse(text)), intent);
  equal(
    computeWakeflowMaintenanceExecutionIntentDigest(
      parseWakeflowMaintenanceExecutionIntent(JSON.parse(text)),
    ),
    computeWakeflowMaintenanceExecutionIntentDigest(intent),
  );
  equal(text.includes("absolutePath"), false);
  equal(text.includes("lockToken"), false);
});

test("the completed-steps counter starts at zero, advances by one, stays outside the intent digest and stops at the plan's length", () => {
  const value = fixture();
  const intent = createWakeflowMaintenanceExecutionIntent(
    OPERATION_ID,
    value.plan,
    value.request,
    value.config,
  );
  equal(intent.completedSteps, 0);
  equal(reconstructWakeflowMaintenanceExecutionFromIntent(intent).completedSteps, 0);

  const advanced = advanceWakeflowMaintenanceExecutionIntent(intent);
  equal(advanced.completedSteps, 1);
  // 计数说的是"做到哪了"，摘要认的是"这次要做成什么样"（ADR-0031，5a 的 C 行）。
  equal(
    computeWakeflowMaintenanceExecutionIntentDigest(advanced),
    computeWakeflowMaintenanceExecutionIntentDigest(intent),
  );
  equal(
    renderWakeflowMaintenanceExecutionIntent(advanced) ===
      renderWakeflowMaintenanceExecutionIntent(intent),
    false,
  );
  deepEqual(
    parseWakeflowMaintenanceExecutionIntent(
      JSON.parse(renderWakeflowMaintenanceExecutionIntent(advanced)),
    ),
    advanced,
  );

  // 计划只有一步：做完之后没有后继；超过计划长度的计数、缺了计数的旧文件都不被准入。
  const isIntentError = (reason: string) => (error: unknown) =>
    error instanceof WakeflowMaintenanceExecutionIntentError && error.reason === reason;
  throws(() => advanceWakeflowMaintenanceExecutionIntent(advanced), isIntentError("relation"));
  const wire = JSON.parse(renderWakeflowMaintenanceExecutionIntent(intent)) as Record<
    string,
    unknown
  >;
  throws(
    () => parseWakeflowMaintenanceExecutionIntent({ ...wire, completedSteps: 2 }),
    isIntentError("relation"),
  );
  const { completedSteps: _completedSteps, ...withoutCounter } = wire;
  throws(() => parseWakeflowMaintenanceExecutionIntent(withoutCounter), isIntentError("schema"));
});

test("intent rejects desired Config or plan relation drift", () => {
  const value = fixture();
  const intent = createWakeflowMaintenanceExecutionIntent(
    OPERATION_ID,
    value.plan,
    value.request,
    value.config,
  );
  for (const candidate of [
    {
      ...intent,
      desiredConfig: {
        ...intent.desiredConfig,
        presentation: { language: "zh-Hans" },
      },
    },
    { ...intent, planDigest: intent.sharedPreview.planDigest },
  ]) {
    let caught: unknown;
    try {
      parseWakeflowMaintenanceExecutionIntent(candidate);
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof WakeflowMaintenanceExecutionIntentError, true);
    if (caught instanceof WakeflowMaintenanceExecutionIntentError) {
      equal(caught.reason, "relation");
    }
  }
});

test("intent resource is a private transaction artifact: created once, replaced exactly, retired exactly", () => {
  deepEqual(createWakeflowMaintenanceIntentResourceDeclaration(OPERATION_ID), {
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: `maintenance.transaction-intent.${OPERATION_ID}`,
    family: "maintenance",
    ownerId: "workspace-maintenance",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: `.wakeflow-local/runtime/maintenance/transactions/${OPERATION_ID}.intent.json`,
    },
    tracking: { disposition: "ignored", privacy: "runtime-private" },
    nodePolicy: {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "transaction-artifact",
      allowedMutationRecipes: ["exclusive-create", "exact-source-replace", "exact-retire"],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });
});

test("intent persistence budget rejects an oversized host payload", () => {
  const value = fixture();
  const contribution = createWakeflowHostMaintenanceContribution({
    hostId: "codex",
    capabilityId: "codex-maintenance",
    status: "ready",
    blockerCodes: [],
    operations: [
      {
        operationId: "example-operation:program",
        operationKind: "example-operation",
        ownerId: "example-owner",
        targetKey: "example.target",
        sourceDigest: null,
        targetDigest: computeWakeflowConfigDigest(value.config),
        payload: { value: "x".repeat(2 * 1024 * 1024) },
      },
    ],
  });
  const plan = createWakeflowMaintenanceExecutionPlan(
    value.plan.sharedPreview,
    codexWorkspaceHostResourceProfile,
    contribution,
  );
  const intent = createWakeflowMaintenanceExecutionIntent(
    OPERATION_ID,
    plan,
    value.request,
    value.config,
  );
  let caught: unknown;
  try {
    assertWakeflowMaintenanceExecutionIntentCapacity(intent);
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowMaintenanceExecutionIntentStoreError, true);
  if (caught instanceof WakeflowMaintenanceExecutionIntentStoreError) {
    equal(caught.reason, "capacity");
  }
});

const WRITER = Object.freeze({
  version: "1.2.0",
  manifestDigest: parseSha256Digest(`sha256:${"5".repeat(64)}`),
});

test("intent carries the optional writer stamp, round-trips it and reconstructs the same plan (C11)", () => {
  const value = fixture();
  const unstamped = createWakeflowMaintenanceExecutionIntent(
    OPERATION_ID,
    value.plan,
    value.request,
    value.config,
  );
  equal(Object.hasOwn(unstamped, "writer"), false);
  deepEqual(
    createWakeflowMaintenanceExecutionIntent(
      OPERATION_ID,
      value.plan,
      value.request,
      value.config,
      null,
    ),
    unstamped,
  );
  const intent = createWakeflowMaintenanceExecutionIntent(
    OPERATION_ID,
    value.plan,
    value.request,
    value.config,
    WRITER,
  );
  deepEqual(intent.writer, WRITER);
  equal(intent.planDigest, value.plan.planDigest);
  equal(
    reconstructWakeflowMaintenanceExecutionFromIntent(intent).plan.planDigest,
    value.plan.planDigest,
  );

  const text = renderWakeflowMaintenanceExecutionIntent(intent);
  deepEqual((JSON.parse(text) as { writer?: unknown }).writer, {
    version: "1.2.0",
    manifestDigest: WRITER.manifestDigest,
  });
  deepEqual(parseWakeflowMaintenanceExecutionIntent(JSON.parse(text)), intent);
  equal(
    computeWakeflowMaintenanceExecutionIntentDigest(
      parseWakeflowMaintenanceExecutionIntent(JSON.parse(text)),
    ),
    computeWakeflowMaintenanceExecutionIntentDigest(intent),
  );
  const legacy = parseWakeflowMaintenanceExecutionIntent(
    JSON.parse(renderWakeflowMaintenanceExecutionIntent(unstamped)),
  );
  equal(Object.hasOwn(legacy, "writer"), false);

  // 写者戳的文法在读盘时核对（创建时它是组合根注入的类型化值）。
  for (const writer of [
    { version: "v1", manifestDigest: WRITER.manifestDigest },
    { version: "1.2.0" },
    "1.2.0",
  ]) {
    throws(
      () => parseWakeflowMaintenanceExecutionIntent({ ...JSON.parse(text), writer }),
      (error: unknown) =>
        error instanceof WakeflowMaintenanceExecutionIntentError && error.reason === "schema",
    );
  }
  throws(
    () => parseWakeflowMaintenanceExecutionIntent({ ...intent, writer: null }),
    (error: unknown) =>
      error instanceof WakeflowMaintenanceExecutionIntentError && error.reason === "schema",
  );
});
