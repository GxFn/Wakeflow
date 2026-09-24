import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  ImplementationReviewDecisionRequest,
  ImplementationReviewDecisionResult,
  TargetResultImportResult,
  TargetResultReviewInspectionResult,
} from "../../../src/capabilities/result-review/contract.js";
import {
  executeImplementationReviewDecisionRequest,
  executeTargetResultImportRequest,
  executeTargetResultReviewInspectionRequest,
  type ExecuteResultReviewOptions,
  type ResultReviewHostFacade,
} from "../../../src/capabilities/result-review/service.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant, type UtcInstant } from "../../../src/foundation/time/utc-instant.js";
import type { DeliveryEnvelope } from "../../../src/governance/delivery/delivery-envelope.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { executeRecordEvidenceRequest } from "../../../src/capabilities/evidence/service.js";
import {
  readDemandResultReviewSnapshot,
  type DemandResultReviewSnapshot,
} from "../../../src/governance/review/demand-result-review-snapshot.js";
import type { TaskPackage } from "../../../src/governance/tasking/task-package.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { DISPOSABLE_WORKSPACE_DURABILITY } from "../../support/prepared-workspace.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  deliverFixtureTarget,
  landFixturePrompt,
  registerFixtureWindowRoute,
  withFixtureDemandRoot,
  type DeliveredTarget,
  type DeliveryWindowRoute,
  type DeliveryWorkspaceFixture,
} from "../delivery/delivery-workspace.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../result/implementation-target-result-report.fixture.js";
import { PLANNING_REPOSITORY_ID } from "../tasking/target-task-planning-service.fixture.js";
import type { TargetTaskPlanningWorkspaceFixtureOptions } from "../tasking/target-task-planning-service.fixture.js";
import { implementationReviewJudgmentWire } from "./controller-implementation-review-decision.fixture.js";

/**
 * 实现链的评审夹具（能力卡 7 修订，§13.87）：已规划目标 → 投递 accepted → 受管证据记录 →
 * 经 result-review 切片导入结果（附 wake-controller 回调许可）→ 目标会话 Stop 记录 → 评审
 * 检查投影 → 一份可直接提交的 accept 决定请求。Controller 窗口在这里登记绑定，回调落地
 * 由 `landFixtureCallback` 写入 Controller 会话记录。
 */

export const CODEX_REVIEW_FACADE: Readonly<ResultReviewHostFacade> = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});

/** 最小配置里的 Controller 窗口；回调许可指向它。 */
export const REVIEW_CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
export const REVIEW_EVIDENCE_CAPTURED_AT = parseUtcInstant("2026-08-29T12:08:00.000Z");
export const REVIEW_FIXTURE_REPORTED_AT = parseUtcInstant("2026-08-29T12:10:00.000Z");
export const REVIEW_TARGET_STOPPED_AT = parseUtcInstant("2026-08-29T12:11:00.000Z");
export const REVIEW_CALLBACK_LANDED_AT = parseUtcInstant("2026-08-29T12:12:00.000Z");
export const REVIEW_INSPECTED_AT = parseUtcInstant("2026-08-29T12:13:00.000Z");
export const REVIEW_DECIDED_AT = parseUtcInstant("2026-08-29T12:15:00.000Z");
export const REVIEW_DECISION_UUID = "d3d3d3d3-d3d3-43d3-83d3-d3d3d3d3d3d3";

const CONTROLLER_RAW_HANDLE = "codex-host-thread:controller-fixture";
const CONTROLLER_BINDING_UUID = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";
const CONTROLLER_BINDING_OBSERVED_AT = parseUtcInstant("2026-08-29T12:01:00.000Z");
const CONTROLLER_BINDING_REGISTERED_AT = parseUtcInstant("2026-08-29T12:00:30.000Z");

export interface FixtureEvidence {
  readonly evidenceId: string;
  /** 报告里可引用的可移植定位符：受管证据记录 payload 里的 `content` 成员。 */
  readonly ref: string;
  readonly digest: string;
  readonly bytes: number;
}

export interface ControllerImplementationReviewDecisionServiceFixture extends DeliveryWorkspaceFixture {
  readonly controllerRoute: Readonly<DeliveryWindowRoute>;
  readonly delivered: Readonly<DeliveredTarget>;
  readonly envelope: Readonly<DeliveryEnvelope>;
  readonly evidence: Readonly<FixtureEvidence>;
  readonly imported: Readonly<TargetResultImportResult>;
  readonly inspection: Readonly<TargetResultReviewInspectionResult>;
  readonly reviewSnapshot: Readonly<DemandResultReviewSnapshot>;
  readonly decisionRequest: Readonly<ImplementationReviewDecisionRequest>;
}

/** 当前 Demand 事件流修订：追加请求的期望修订由此读取，不写常量。 */
export async function currentFixtureStreamRevision(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
): Promise<number> {
  return withFixtureDemandRoot(
    fixture,
    async (root) => (await new DemandEventSourcingRepository(root).audit()).aggregate.streamRevision,
  );
}

export async function loadFixtureTaskPackage(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  taskPackageId: string,
): Promise<Readonly<TaskPackage>> {
  return withFixtureDemandRoot(fixture, async (root) => {
    const located = await new DemandEventSourcingRepository(root).findTargetTaskPlannedEvent(
      taskPackageId,
    );
    if (located === null) throw new Error("Expected a planned TaskPackage fixture.");
    return located.event.data.taskPackage;
  });
}

/** 登记 Controller 窗口的私有绑定：回调许可与落地记录都以它的会话为准。 */
export async function registerFixtureControllerWindow(
  fixture: Readonly<{
    readonly workspacePath: string;
    readonly workspaceRoot: DeliveryWorkspaceFixture["workspaceRoot"];
  }>,
): Promise<Readonly<DeliveryWindowRoute>> {
  return registerFixtureWindowRoute(fixture, REVIEW_CONTROLLER_WINDOW_ID, {
    value: CONTROLLER_RAW_HANDLE,
    uuid: CONTROLLER_BINDING_UUID,
    observedAt: CONTROLLER_BINDING_OBSERVED_AT,
    registeredAt: CONTROLLER_BINDING_REGISTERED_AT,
  });
}

/** 从产品仓库记录一份受管证据（preview + apply），返回报告可引用的定位符。 */
export async function recordFixtureEvidence(
  fixture: Readonly<{
    readonly fixtureRoot: string;
    readonly workspacePath: string;
    readonly demandId: string;
  }>,
  relativePath = "artifacts/review/verification.txt",
  content = "verification passed\n",
  capturedAt: UtcInstant = REVIEW_EVIDENCE_CAPTURED_AT,
): Promise<Readonly<FixtureEvidence>> {
  const filePath = path.join(fixture.fixtureRoot, "ProductA", ...relativePath.split("/"));
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o755 });
  writeFileSync(filePath, content, { mode: 0o644 });
  const selection = {
    kind: "test-output",
    source: {
      kind: "managed-path",
      root: { kind: "repository", repositoryId: PLANNING_REPOSITORY_ID },
      path: relativePath,
      resourceType: "file",
    },
    contentReview: "reject",
  } as const;
  const preview = await executeRecordEvidenceRequest(
    { root: fixture.workspacePath, mode: "preview", demandId: fixture.demandId, selection },
    { clock: () => capturedAt, durability: DISPOSABLE_WORKSPACE_DURABILITY },
  );
  if (preview.kind !== "WakeflowRecordEvidencePreview" || preview.planDigest === null) {
    throw new Error(`Expected a ready evidence plan: ${preview.kind === "WakeflowRecordEvidencePreview" ? preview.blockers.join(",") : preview.kind}`);
  }
  const applied = await executeRecordEvidenceRequest(
    {
      root: fixture.workspacePath,
      mode: "apply",
      demandId: fixture.demandId,
      selection,
      planDigest: preview.planDigest,
    },
    { clock: () => capturedAt, durability: DISPOSABLE_WORKSPACE_DURABILITY },
  );
  if (applied.kind !== "WakeflowRecordEvidenceMutation" || applied.publication === null) {
    throw new Error("Expected a recorded evidence publication.");
  }
  const bytes = encodeUtf8(content);
  return Object.freeze({
    evidenceId: applied.publication.evidenceId,
    ref: `artifacts/managed-evidence/${applied.publication.evidenceId}/payload/content`,
    digest: computeSha256Digest(bytes),
    bytes: bytes.byteLength,
  });
}

export interface ImportFixtureImplementationOptions {
  readonly idempotencyKey?: string;
  readonly expectedStreamRevision?: number;
  readonly reportedAt?: UtcInstant;
  readonly evidence?: Readonly<FixtureEvidence>;
  /** 报告内容原样进入导入请求（请求参数本身是 unknown，由切片解析）；用于 needs-review 等变体。 */
  readonly content?: unknown;
}

/** 经切片导入实现结果：报告内容按当前任务包与受管证据生成，围栏取自 accepted 结局。 */
export async function importFixtureImplementationResult(
  fixture: Readonly<{
    readonly fixtureRoot: string;
    readonly workspacePath: string;
    readonly demandId: string;
  }>,
  delivered: Readonly<DeliveredTarget>,
  options: ImportFixtureImplementationOptions = {},
): Promise<Readonly<TargetResultImportResult>> {
  const evidence = options.evidence ?? (await recordFixtureEvidence(fixture));
  const taskPackage = await loadFixtureTaskPackage(fixture, delivered.envelope.target.taskPackageId);
  const content =
    options.content ?? createImplementationTargetResultReportContentFixture(taskPackage, evidence);
  return executeTargetResultImportRequest(
    CODEX_REVIEW_FACADE,
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey: options.idempotencyKey ?? "fixture-import-1",
      expectedStreamRevision:
        options.expectedStreamRevision ?? (await currentFixtureStreamRevision(fixture)),
      deliveryId: delivered.prepared.delivery.deliveryId,
      claimDigest: delivered.prepared.permit.fence.claimDigest,
      report: { workType: "implementation", content },
    },
    {
      clock: () => options.reportedAt ?? REVIEW_FIXTURE_REPORTED_AT,
      durability: DISPOSABLE_WORKSPACE_DURABILITY,
    },
  );
}

/** 目标会话在结果之后留下 Stop 记录：accept 的完成证据（§13.87 D2）。 */
export async function landFixtureTargetCompletion(
  fixture: Readonly<{ readonly workspaceRoot: DeliveryWorkspaceFixture["workspaceRoot"] }>,
  route: Readonly<DeliveryWindowRoute>,
  recordedAt: UtcInstant = REVIEW_TARGET_STOPPED_AT,
  event: "stop" | "turn-complete" = "stop",
) {
  return writeHostHookObservation(fixture.workspaceRoot, {
    hostId: "codex",
    event,
    sessionId: route.rawHandle,
    cwd: route.windowPath,
    recordedAt,
  });
}

/** Controller 会话收到回调 prompt 后留下的 `user-prompt-submit` 记录。 */
export async function landFixtureCallback(
  fixture: Readonly<{ readonly workspaceRoot: DeliveryWorkspaceFixture["workspaceRoot"] }>,
  controllerRoute: Readonly<DeliveryWindowRoute>,
  prompt: string,
  recordedAt: UtcInstant = REVIEW_CALLBACK_LANDED_AT,
) {
  return landFixturePrompt(fixture, controllerRoute, prompt, recordedAt);
}

export async function inspectFixtureReview(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  targetTaskId: string,
  options: ExecuteResultReviewOptions = { clock: () => REVIEW_INSPECTED_AT },
): Promise<Readonly<TargetResultReviewInspectionResult>> {
  return executeTargetResultReviewInspectionRequest(
    CODEX_REVIEW_FACADE,
    { root: fixture.workspacePath, demandId: fixture.demandId, targetTaskId },
    { durability: DISPOSABLE_WORKSPACE_DURABILITY, ...options },
  );
}

/** 从检查投影组装一份实现决定请求；判断字段来自决定夹具。 */
export function fixtureImplementationDecisionRequest(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  inspection: Readonly<TargetResultReviewInspectionResult>,
  expectedStreamRevision: number,
  decision: "accept" | "rework" | "blocked" | "escalate" = "accept",
  idempotencyKey = "fixture-decision-1",
): Readonly<ImplementationReviewDecisionRequest> {
  return Object.freeze({
    root: fixture.workspacePath,
    demandId: fixture.demandId,
    idempotencyKey,
    expectedStreamRevision,
    targetResultId: inspection.reviewUnit.targetResult.targetResultId,
    snapshotDigest: inspection.snapshotDigest,
    reviewUnitDigest: inspection.reviewUnit.reviewUnitDigest,
    ...implementationReviewJudgmentWire(decision),
  });
}

export async function decideFixtureImplementation(
  fixture: Readonly<ControllerImplementationReviewDecisionServiceFixture>,
  overrides: Partial<ImplementationReviewDecisionRequest> = {},
  options: ExecuteResultReviewOptions = {
    clock: () => REVIEW_DECIDED_AT,
    uuidFactory: () => REVIEW_DECISION_UUID,
  },
): Promise<Readonly<ImplementationReviewDecisionResult>> {
  return executeImplementationReviewDecisionRequest(
    CODEX_REVIEW_FACADE,
    { ...fixture.decisionRequest, ...overrides },
    { durability: DISPOSABLE_WORKSPACE_DURABILITY, ...options },
  );
}

export async function readControllerImplementationReviewDecisionServiceSnapshot(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
): Promise<Readonly<DemandResultReviewSnapshot>> {
  return withFixtureDemandRoot(fixture, readDemandResultReviewSnapshot);
}

export async function createControllerImplementationReviewDecisionServiceFixture(
  options: TargetTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<ControllerImplementationReviewDecisionServiceFixture>> {
  const fixture = await createDeliveryWorkspaceFixture(options);
  try {
    const controllerRoute = await registerFixtureControllerWindow(fixture);
    const delivered = await deliverFixtureTarget(fixture);
    const evidence = await recordFixtureEvidence(fixture);
    const imported = await importFixtureImplementationResult(fixture, delivered, { evidence });
    await landFixtureTargetCompletion(fixture, fixture.route);
    const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId);
    const reviewSnapshot = await readControllerImplementationReviewDecisionServiceSnapshot(fixture);
    return Object.freeze({
      ...fixture,
      controllerRoute,
      delivered,
      envelope: delivered.envelope,
      evidence,
      imported,
      inspection,
      reviewSnapshot,
      decisionRequest: fixtureImplementationDecisionRequest(
        fixture,
        inspection,
        imported.event.streamRevision,
      ),
    });
  } catch (error: unknown) {
    await cleanupDeliveryWorkspaceFixture(fixture);
    throw error;
  }
}

export async function cleanupControllerImplementationReviewDecisionServiceFixture(
  fixture: Readonly<ControllerImplementationReviewDecisionServiceFixture>,
): Promise<void> {
  await cleanupDeliveryWorkspaceFixture(fixture);
}
