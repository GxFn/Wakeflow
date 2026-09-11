import { deepEqual, equal } from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  deriveManagedEvidenceId,
  ManagedEvidenceCapturePlanningService,
  ManagedEvidenceCapturePlanningServiceError,
  type ManagedEvidenceCapturePlanningServiceErrorReason,
} from "../../../src/governance/evidence/managed-evidence-capture-planning-service.js";
import { parseManagedEvidenceSourceSelection } from "../../../src/governance/evidence/managed-evidence-source-selection.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  EVIDENCE_CAPTURED_AT,
  EVIDENCE_DESIGN_SURFACE_ID,
  EVIDENCE_REPOSITORY_ID,
  fileSelection,
  readyCapturePlan,
  type ManagedEvidenceCapturePlanningWorkspaceFixture,
} from "./managed-evidence-capture-planning-service.fixture.js";

/**
 * 捕获规划（切片 8 D1 到 D3）：四种来源的零写观察、隐私分类与内容阻塞、由内容派生的身份。
 */

function treeSelection(contentReview: "reject" | "controller-confirmed" = "controller-confirmed") {
  return {
    kind: "test-output",
    source: {
      kind: "managed-path",
      root: { kind: "repository", repositoryId: EVIDENCE_REPOSITORY_ID },
      path: "artifacts/test-run",
      resourceType: "tree",
    },
    contentReview,
  };
}

function service(fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>) {
  return new ManagedEvidenceCapturePlanningService(fixture.publication.workspaceRoot);
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

test("目录树来源从真实字节派生 Manifest、由内容派生身份并保持零写", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const clockCalls = { value: 0 };
    const preview = await service(fixture).preview(fixture.demandId, treeSelection(), {
      clock: () => {
        clockCalls.value += 1;
        return EVIDENCE_CAPTURED_AT;
      },
    });
    const plan = readyCapturePlan(preview);
    equal(
      plan.manifest.evidenceId,
      deriveManagedEvidenceId(
        plan.manifest.demandId,
        parseManagedEvidenceSourceSelection(treeSelection()),
        plan.manifest.payload.artifactDigest,
      ),
    );
    equal(plan.manifest.kind, "test-output");
    equal(plan.manifest.capturedAt, EVIDENCE_CAPTURED_AT);
    equal(plan.manifest.recordedBy.windowId, "window_55555555-5555-4555-8555-555555555555");
    equal(plan.manifest.source.kind, "managed-path");
    deepEqual(
      plan.manifest.payload.treeManifest.files.map((file) => file.ref),
      ["logs/report.txt", "screenshots/result.bin"],
    );
    deepEqual(plan.manifest.contentReview, {
      disposition: "controller-confirmed",
      opaqueFileRefs: ["screenshots/result.bin"],
      privacyFindings: [],
    });
    equal(plan.expectedDemand.streamRevision, 1);
    equal(clockCalls.value, 1);
    if (preview.status === "ready") equal(preview.existing, null);
    const basis = {
      kind: plan.kind,
      schemaVersion: plan.schemaVersion,
      configDigest: plan.configDigest,
      expectedDemand: plan.expectedDemand,
      manifest: plan.manifest,
    };
    equal(plan.planDigest, computeCanonicalJsonSha256Digest(basis));
    equal(Object.isFrozen(plan), true);

    // 同一内容再次规划得到同一身份；时间不参与身份。
    const again = readyCapturePlan(
      await service(fixture).preview(fixture.demandId, treeSelection(), {
        clock: () => parseUtcInstant("2026-09-01T21:30:00.000Z"),
      }),
    );
    equal(again.manifest.evidenceId, plan.manifest.evidenceId);
    equal(again.manifest.capturedAt === plan.manifest.capturedAt, false);
    const demandRoot = path.join(
      fixture.publication.workspacePath,
      ...demandFinalRootRef(fixture.demandId).split("/"),
    );
    equal(existsSync(path.join(demandRoot, "artifacts", "managed-evidence")), false);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("文件来源规范化为 content；opaque 成员在 reject 下阻塞，凭证命中永远阻塞", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const plan = readyCapturePlan(
      await service(fixture).preview(
        fixture.demandId,
        {
          kind: "document",
          source: {
            kind: "managed-path",
            root: { kind: "support-surface", surfaceId: EVIDENCE_DESIGN_SURFACE_ID },
            path: "reports/result.txt",
            resourceType: "file",
          },
          contentReview: "reject",
        },
        { clock: () => EVIDENCE_CAPTURED_AT },
      ),
    );
    equal(plan.manifest.kind, "document");
    equal(plan.manifest.payload.treeManifest.fileCount, 1);
    equal(plan.manifest.payload.treeManifest.files[0]?.ref, "content");
    deepEqual(plan.manifest.contentReview, {
      disposition: "not-required",
      opaqueFileRefs: [],
      privacyFindings: [],
    });

    const clockCalls = { value: 0 };
    const blocked = await service(fixture).preview(fixture.demandId, treeSelection("reject"), {
      clock: () => {
        clockCalls.value += 1;
        return EVIDENCE_CAPTURED_AT;
      },
    });
    equal(blocked.status, "blocked");
    if (blocked.status === "blocked") {
      deepEqual(blocked.blockers, ["opaque-content:screenshots/result.bin"]);
    }
    equal(clockCalls.value, 0, "a blocked preview never reads the clock");

    writeFileSync(
      path.join(fixture.repositoryRoot, "artifacts/test-run/logs/secret.txt"),
      "token = abcdefghijklmnop\n",
    );
    const credential = await service(fixture).preview(fixture.demandId, treeSelection(), {
      clock: () => EVIDENCE_CAPTURED_AT,
    });
    equal(credential.status, "blocked");
    if (credential.status === "blocked") {
      deepEqual(credential.blockers, ["privacy:credential-assignment:logs/secret.txt:1"]);
      equal(credential.review.credentialFindings.length, 1);
    }
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("非凭证类命中按工作区根白名单判断，只在 controller-confirmed 下进入记录", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    writeFileSync(
      path.join(fixture.repositoryRoot, "artifacts/test-run/logs/paths.txt"),
      `${fixture.publication.workspaceRoot.absolutePath}/notes.md\n/Users/example/private/notes.md\n`,
    );
    const rejected = await service(fixture).preview(fixture.demandId, treeSelection("reject"), {
      clock: () => EVIDENCE_CAPTURED_AT,
    });
    equal(rejected.status, "blocked");
    if (rejected.status === "blocked") {
      deepEqual(rejected.blockers, [
        "opaque-content:screenshots/result.bin",
        "privacy:unlisted-absolute-path:logs/paths.txt:2",
      ]);
    }
    const confirmed = readyCapturePlan(
      await service(fixture).preview(fixture.demandId, treeSelection(), {
        clock: () => EVIDENCE_CAPTURED_AT,
      }),
    );
    deepEqual(confirmed.manifest.contentReview, {
      disposition: "controller-confirmed",
      opaqueFileRefs: ["screenshots/result.bin"],
      privacyFindings: [{ ref: "logs/paths.txt", line: 2, kind: "unlisted-absolute-path" }],
    });
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("observation 来源只保留 hook 记录的脱敏投影；link 与 commit 是引用投影", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const written = await writeHostHookObservation(fixture.publication.workspaceRoot, {
      hostId: "codex",
      event: "stop",
      sessionId: "codex-host-thread:evidence-fixture",
      cwd: fixture.publication.workspacePath,
      recordedAt: parseUtcInstant("2026-09-01T20:50:00.000Z"),
    });
    const recordId = written.record.recordId;
    const observation = readyCapturePlan(
      await service(fixture).preview(
        fixture.demandId,
        {
          kind: "hook-observation",
          source: { kind: "observation", hostId: "codex", recordId },
          contentReview: "reject",
        },
        { clock: () => EVIDENCE_CAPTURED_AT },
      ),
    );
    const source = observation.manifest.source;
    equal(source.kind, "observation");
    if (source.kind === "observation") {
      equal(source.event, "stop");
      equal(source.transcript, "absent");
      equal(source.recordDigest.startsWith("sha256:"), true);
    }
    const rendered = JSON.stringify(observation.manifest);
    equal(rendered.includes("codex-host-thread:evidence-fixture"), false);
    equal(rendered.includes(fixture.publication.workspacePath), false);
    equal(observation.manifest.payload.treeManifest.files[0]?.ref, "content");
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          kind: "transcript",
          source: { kind: "observation", hostId: "codex", recordId },
          contentReview: "reject",
        }),
      "kind",
    );
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          kind: "hook-observation",
          source: {
            kind: "observation",
            hostId: "codex",
            recordId: "99999999-9999-4999-8999-999999999999",
          },
          contentReview: "reject",
        }),
      "source",
    );

    const link = readyCapturePlan(
      await service(fixture).preview(
        fixture.demandId,
        {
          kind: "link",
          source: { kind: "link", url: "https://example.com/report" },
          contentReview: "reject",
        },
        { clock: () => EVIDENCE_CAPTURED_AT },
      ),
    );
    deepEqual(link.manifest.source, { kind: "link", url: "https://example.com/report", digest: null });
    const leaking = await service(fixture).preview(
      fixture.demandId,
      {
        kind: "link",
        source: { kind: "link", url: "https://example.com/report?token=abcdefghijklmnop" },
        contentReview: "controller-confirmed",
      },
      { clock: () => EVIDENCE_CAPTURED_AT },
    );
    equal(leaking.status, "blocked");
    if (leaking.status === "blocked") {
      deepEqual(leaking.blockers, ["privacy:credential-assignment:content:1"]);
    }

    const commit = readyCapturePlan(
      await service(fixture).preview(
        fixture.demandId,
        {
          kind: "commit",
          source: { kind: "commit", repositoryId: EVIDENCE_REPOSITORY_ID, commitOid: "a".repeat(40) },
          contentReview: "reject",
        },
        { clock: () => EVIDENCE_CAPTURED_AT },
      ),
    );
    equal(commit.manifest.kind, "commit");
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          kind: "commit",
          source: {
            kind: "commit",
            repositoryId: "repository_99999999-9999-4999-8999-999999999999",
            commitOid: "a".repeat(40),
          },
          contentReview: "reject",
        }),
      "source-root",
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("捕获规划拒绝未配置的根、资源类型漂移和预取消请求", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          ...treeSelection(),
          source: {
            ...treeSelection().source,
            root: {
              kind: "repository",
              repositoryId: "repository_99999999-9999-4999-8999-999999999999",
            },
          },
        }),
      "source-root",
    );
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, {
          ...treeSelection(),
          source: { ...treeSelection().source, resourceType: "file" },
        }),
      "source-type",
    );
    await expectPlanningError(
      () => service(fixture).preview(fixture.demandId, fileSelection("artifacts/missing.txt")),
      "source",
    );
    const controller = new AbortController();
    controller.abort();
    await expectPlanningError(
      () =>
        service(fixture).preview(fixture.demandId, treeSelection(), {
          signal: controller.signal,
        }),
      "aborted",
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});
