import { deepEqual, equal } from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import {
  ManagedEvidenceCapturePlanningService,
  ManagedEvidenceCapturePlanningServiceError,
  type ManagedEvidenceCapturePlanningServiceErrorReason,
} from "../../../src/governance/evidence/managed-evidence-capture-planning-service.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  EVIDENCE_CAPTURED_AT,
  EVIDENCE_DEMAND_ID,
  EVIDENCE_DESIGN_SURFACE_ID,
  EVIDENCE_REPOSITORY_ID,
} from "./managed-evidence-capture-planning-service.fixture.js";

function treeSelection(opaqueContentPolicy = "controller-confirmed") {
  return {
    evidenceType: "test-output",
    source: {
      root: { kind: "repository", repositoryId: EVIDENCE_REPOSITORY_ID },
      path: "artifacts/test-run",
      resourceType: "tree",
    },
    sensitivity: "internal",
    opaqueContentPolicy,
  };
}

async function expectPlanningError(
  action: () => Promise<unknown>,
  reason: ManagedEvidenceCapturePlanningServiceErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof ManagedEvidenceCapturePlanningServiceError, true);
  if (caught instanceof ManagedEvidenceCapturePlanningServiceError) {
    equal(caught.code, "wakeflow-managed-evidence-capture-planning-service");
    equal(caught.reason, reason);
  }
}

test("Evidence capture preview从真实tree派生Manifest且保持零写", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const uuidCalls = { value: 0 };
    const clockCalls = { value: 0 };
    const service = new ManagedEvidenceCapturePlanningService(
      fixture.publication.workspaceRoot,
    );
    const plan = await service.preview(EVIDENCE_DEMAND_ID, treeSelection(), {
      uuidFactory: () => {
        uuidCalls.value += 1;
        return "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      },
      clock: () => {
        clockCalls.value += 1;
        return EVIDENCE_CAPTURED_AT;
      },
    });

    equal(
      plan.manifest.evidenceId,
      "evidence_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    equal(plan.manifest.capturedAt, EVIDENCE_CAPTURED_AT);
    equal(
      plan.manifest.recordedBy.windowId,
      "window_55555555-5555-4555-8555-555555555555",
    );
    equal(plan.manifest.source.resourceType, "tree");
    deepEqual(
      plan.manifest.payload.treeManifest.files.map((file) => file.ref),
      ["logs/report.txt", "screenshots/result.bin"],
    );
    deepEqual(plan.manifest.contentReview, {
      disposition: "controller-confirmed",
      opaqueFileRefs: ["screenshots/result.bin"],
    });
    equal(plan.expectedDemand.streamRevision, 1);
    equal(uuidCalls.value, 1);
    equal(clockCalls.value, 1);
    const basis = {
      kind: plan.kind,
      schemaVersion: plan.schemaVersion,
      configDigest: plan.configDigest,
      expectedDemand: plan.expectedDemand,
      manifest: plan.manifest,
    };
    equal(plan.planDigest, computeCanonicalJsonSha256Digest(basis));
    equal(Object.isFrozen(plan), true);

    const demandRoot = path.join(
      fixture.publication.workspacePath,
      ...demandFinalRootRef(EVIDENCE_DEMAND_ID).split("/"),
    );
    equal(existsSync(path.join(demandRoot, "evidence")), false);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("file来源规范化为content且无需opaque review", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const plan = await new ManagedEvidenceCapturePlanningService(
      fixture.publication.workspaceRoot,
    ).preview(
      EVIDENCE_DEMAND_ID,
      {
        evidenceType: "design-review",
        source: {
          root: {
            kind: "support-surface",
            surfaceId: EVIDENCE_DESIGN_SURFACE_ID,
          },
          path: "reports/result.txt",
          resourceType: "file",
        },
        sensitivity: "internal",
        opaqueContentPolicy: "reject",
      },
      {
        uuidFactory: () => "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        clock: () => EVIDENCE_CAPTURED_AT,
      },
    );
    equal(plan.manifest.payload.treeManifest.fileCount, 1);
    equal(plan.manifest.payload.treeManifest.files[0]?.ref, "content");
    equal(plan.manifest.source.root.kind, "support-surface");
    deepEqual(plan.manifest.contentReview, {
      disposition: "not-required",
      opaqueFileRefs: [],
    });
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("opaque reject与错误Config root在分配身份和时间前失败", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const service = new ManagedEvidenceCapturePlanningService(
      fixture.publication.workspaceRoot,
    );
    const counters = { uuid: 0, clock: 0 };
    const options = {
      uuidFactory: () => {
        counters.uuid += 1;
        return "ffffffff-ffff-4fff-8fff-ffffffffffff";
      },
      clock: () => {
        counters.clock += 1;
        return EVIDENCE_CAPTURED_AT;
      },
    };
    await expectPlanningError(
      () =>
        service.preview(EVIDENCE_DEMAND_ID, treeSelection("reject"), options),
      "opaque-content",
    );
    equal(counters.uuid, 0);
    equal(counters.clock, 0);

    await expectPlanningError(
      () =>
        service.preview(
          EVIDENCE_DEMAND_ID,
          {
            ...treeSelection(),
            source: {
              ...treeSelection().source,
              root: {
                kind: "repository",
                repositoryId: "repository_99999999-9999-4999-8999-999999999999",
              },
            },
          },
          options,
        ),
      "source-root",
    );
    equal(counters.uuid, 0);
    equal(counters.clock, 0);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("Capture Planning拒绝资源类型漂移和预取消请求", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const service = new ManagedEvidenceCapturePlanningService(
      fixture.publication.workspaceRoot,
    );
    await expectPlanningError(
      () =>
        service.preview(EVIDENCE_DEMAND_ID, {
          ...treeSelection(),
          source: { ...treeSelection().source, resourceType: "file" },
        }),
      "source-type",
    );
    const controller = new AbortController();
    controller.abort();
    await expectPlanningError(
      () =>
        service.preview(EVIDENCE_DEMAND_ID, treeSelection(), {
          signal: controller.signal,
        }),
      "aborted",
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});
