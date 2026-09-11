import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import type { ManagedEvidenceCapturePlan } from "../../../src/governance/evidence/managed-evidence-capture-plan.js";
import type { ManagedEvidenceCapturePreview } from "../../../src/governance/evidence/managed-evidence-capture-planning-service.js";
import { executeDemandCreationRequest } from "../../../src/capabilities/demand/service.js";
import {
  cleanupDemandEventSourcingPublicationWorkspaceFixture,
  createDemandEventSourcingPublicationWorkspaceFixture,
  demandEventSourcingPublicationAuthoredDemand,
  PUBLICATION_RECORDED_AT,
  PUBLICATION_REQUIREMENT_ID,
  type DemandEventSourcingPublicationWorkspaceFixture,
} from "../demand/demand-event-sourcing-publication-service.fixture.js";

export const EVIDENCE_REPOSITORY_ID =
  "repository_22222222-2222-4222-8222-222222222222";
export const EVIDENCE_DESIGN_SURFACE_ID =
  "surface_33333333-3333-4333-8333-333333333333";
export const EVIDENCE_CAPTURED_AT = parseUtcInstant("2026-09-01T21:00:00.000Z");
/**
 * 由需求包与看板认领状态确定性派生的 Demand 标识（demand 切片 `deriveDemandCreationIds`）；
 * fixture 创建后校验，认领状态形状一变这里就会报出新值。
 */
export const EVIDENCE_DEMAND_ID = "demand_0aa174cc-cf4c-484d-8ac2-961b3489b5c6";

export interface ManagedEvidenceCapturePlanningWorkspaceFixture {
  readonly publication: Readonly<DemandEventSourcingPublicationWorkspaceFixture>;
  /** 由需求包与认领状态确定性派生；同一 fixture 每次得到同一个标识。 */
  readonly demandId: string;
  readonly repositoryRoot: string;
  readonly designRoot: string;
}

/** 创建一份active Demand及可捕获的repository tree与support file。 */
export async function createManagedEvidenceCapturePlanningWorkspaceFixture(): Promise<
  Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>
> {
  const publication =
    await createDemandEventSourcingPublicationWorkspaceFixture();
  try {
    const demandRequest = {
      root: publication.workspacePath,
      requirementId: PUBLICATION_REQUIREMENT_ID,
      demand: demandEventSourcingPublicationAuthoredDemand(),
    };
    const preview = await executeDemandCreationRequest(
      { ...demandRequest, mode: "preview" },
      { clock: () => PUBLICATION_RECORDED_AT },
    );
    if (preview.kind !== "WakeflowDemandCreationPreview" || preview.planDigest === null) {
      throw new Error("Expected a ready Demand creation plan.");
    }
    const created = await executeDemandCreationRequest(
      { ...demandRequest, mode: "apply", planDigest: preview.planDigest },
      { clock: () => PUBLICATION_RECORDED_AT },
    );
    if (created.kind !== "WakeflowDemandCreationMutation") {
      throw new Error("Expected a Demand creation mutation.");
    }
    const demandId = created.publication.demandId;
    if (demandId !== EVIDENCE_DEMAND_ID) {
      throw new Error(`EVIDENCE_DEMAND_ID drifted; derived ${demandId}`);
    }

    const repositoryRoot = path.join(publication.fixtureRoot, "ProductA");
    const designRoot = path.join(publication.workspacePath, "Design");
    mkdirSync(path.join(repositoryRoot, "artifacts/test-run/logs"), {
      recursive: true,
      mode: 0o755,
    });
    mkdirSync(path.join(repositoryRoot, "artifacts/test-run/screenshots"), {
      recursive: true,
      mode: 0o755,
    });
    writeFileSync(
      path.join(repositoryRoot, "artifacts/test-run/logs/report.txt"),
      "tests passed\n",
      { mode: 0o644 },
    );
    writeFileSync(
      path.join(repositoryRoot, "artifacts/test-run/screenshots/result.bin"),
      Uint8Array.from([0x00, 0xff, 0x01, 0x02]),
      { mode: 0o644 },
    );
    mkdirSync(path.join(designRoot, "reports"), {
      recursive: true,
      mode: 0o755,
    });
    writeFileSync(path.join(designRoot, "reports/result.txt"), "reviewed\n", {
      mode: 0o644,
    });
    return Object.freeze({ publication, demandId, repositoryRoot, designRoot });
  } catch (error: unknown) {
    await cleanupDemandEventSourcingPublicationWorkspaceFixture(publication);
    throw error;
  }
}

export async function cleanupManagedEvidenceCapturePlanningWorkspaceFixture(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
): Promise<void> {
  await cleanupDemandEventSourcingPublicationWorkspaceFixture(
    fixture.publication,
  );
}

/** 机制测试只关心就绪计划；阻塞是断言失败而不是分支。 */
export function readyCapturePlan(
  preview: ManagedEvidenceCapturePreview,
): Readonly<ManagedEvidenceCapturePlan> {
  if (preview.status !== "ready") {
    throw new Error(`Expected a ready capture plan, blocked by ${preview.blockers.join(",")}.`);
  }
  return preview.plan;
}

/** 复制类文件来源的缺省选择：`kind` 与 `contentReview` 由调用方按场景覆盖。 */
export function fileSelection(
  path: string,
  contentReview: "reject" | "controller-confirmed" = "reject",
) {
  return {
    kind: "test-output" as const,
    source: {
      kind: "managed-path" as const,
      root: { kind: "repository" as const, repositoryId: EVIDENCE_REPOSITORY_ID },
      path,
      resourceType: "file" as const,
    },
    contentReview,
  };
}
