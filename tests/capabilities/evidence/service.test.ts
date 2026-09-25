import { deepEqual, equal, rejects } from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { deriveEvidenceEventIdentity } from "../../../src/capabilities/evidence/decide.js";
import { executeRecordEvidenceRequest } from "../../../src/capabilities/evidence/service.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { ManagedEvidenceCapturePlanningService } from "../../../src/governance/evidence/managed-evidence-capture-planning-service.js";
import { materializeManagedEvidencePublicationStage } from "../../../src/governance/evidence/managed-evidence-publication-stage-materializer.js";
import { createManagedEvidencePublicationTransaction } from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";
import { createManagedEvidencePublicationTransactionJournal } from "../../../src/governance/evidence/managed-evidence-publication-transaction-store.js";
import { ManagedEvidenceReadingService } from "../../../src/governance/evidence/managed-evidence-reading-service.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  EVIDENCE_CAPTURED_AT,
  EVIDENCE_REPOSITORY_ID,
  fileSelection,
  type ManagedEvidenceCapturePlanningWorkspaceFixture,
  readyCapturePlan,
} from "../../governance/evidence/managed-evidence-capture-planning-service.fixture.js";

/**
 * evidence 切片效果（§13.89 D1 到 D3）：preview 零写、apply 重算并按内容摘要执行、同内容
 * `already-recorded`、源漂移 `plan-drift`、内容阻塞、四种来源各成一份记录、recover 的 healthy、recovered 与 retired 结局。
 */

const CLOCK = { clock: () => EVIDENCE_CAPTURED_AT };

function rejectedWith(reason: string, code = "precondition-failed") {
  return (error: unknown) =>
    isWakeflowError(error) && error.code === code && error.reason === reason;
}

function request(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
  body: Readonly<Record<string, unknown>>,
) {
  return { root: fixture.publication.workspacePath, demandId: fixture.demandId, ...body };
}

async function preview(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
  selection: unknown,
) {
  const result = await executeRecordEvidenceRequest(
    request(fixture, { mode: "preview", selection }),
    CLOCK,
  );
  if (result.kind !== "WakeflowRecordEvidencePreview") throw new Error("Expected a preview.");
  return result;
}

async function apply(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
  selection: unknown,
  planDigest: string,
  clock = EVIDENCE_CAPTURED_AT,
) {
  const result = await executeRecordEvidenceRequest(
    request(fixture, { mode: "apply", selection, planDigest }),
    { clock: () => clock },
  );
  if (result.kind !== "WakeflowRecordEvidenceMutation") throw new Error("Expected a mutation.");
  return result;
}

function demandRootPath(fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>) {
  return path.join(
    fixture.publication.workspacePath,
    ...demandFinalRootRef(fixture.demandId).split("/"),
  );
}

test("preview 零写返回计划投影与摘要；apply 重算计划落账；同内容再 apply 为 already-recorded；源漂移被拒", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const selection = fileSelection("artifacts/test-run/logs/report.txt");
    const previewed = await preview(fixture, selection);
    equal(previewed.status, "ready");
    equal(previewed.blockers.length, 0);
    equal(previewed.plan?.kind, "test-output");
    equal(previewed.plan?.recorded, false);
    equal(previewed.plan?.payload.fileCount, 1);
    equal(previewed.next.frontier, "evidence-record-apply");
    if (previewed.planDigest === null) throw new Error("Expected a plan digest.");
    const rendered = JSON.stringify(previewed);
    equal(rendered.includes(fixture.publication.fixtureRoot), false);
    equal(rendered.includes("treeManifest"), false);

    const recorded = await apply(fixture, selection, previewed.planDigest);
    equal(recorded.disposition, "recorded");
    equal(recorded.mode, "apply");
    equal(recorded.publication?.evidenceId, previewed.plan?.evidenceId);
    equal(recorded.publication?.kind, "test-output");
    equal(recorded.publication?.event.streamRevision, 2);
    equal(recorded.next.frontier, "implementation-task-planning");
    equal(JSON.stringify(recorded).includes(fixture.publication.fixtureRoot), false);

    const again = await preview(fixture, selection);
    equal(again.plan?.recorded, true);
    equal(again.planDigest, previewed.planDigest);
    const replayed = await apply(
      fixture,
      selection,
      previewed.planDigest,
      parseUtcInstant("2026-09-01T22:00:00.000Z"),
    );
    equal(replayed.disposition, "already-recorded");
    deepEqual(replayed.publication, recorded.publication);

    writeFileSync(
      path.join(fixture.repositoryRoot, "artifacts/test-run/logs/report.txt"),
      "tests passed again\n",
    );
    await rejects(apply(fixture, selection, previewed.planDigest), rejectedWith("plan-drift"));
    const drifted = await preview(fixture, selection);
    equal(drifted.planDigest === previewed.planDigest, false);
    equal(drifted.plan?.evidenceId === previewed.plan?.evidenceId, false);
    equal(drifted.plan?.recorded, false);
    const second = await apply(fixture, selection, drifted.planDigest as string);
    equal(second.disposition, "recorded");
    equal(second.publication?.event.streamRevision, 3);

    const healthy = await executeRecordEvidenceRequest(request(fixture, { mode: "recover" }));
    if (healthy.kind !== "WakeflowRecordEvidenceMutation") throw new Error("Expected a mutation.");
    equal(healthy.mode, "recover");
    equal(healthy.disposition, "healthy");
    equal(healthy.publication, null);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("内容阻塞：opaque 与非凭证命中在 reject 下阻塞、确认后进入记录；凭证命中永远阻塞", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const tree = (contentReview: "reject" | "controller-confirmed") => ({
      kind: "test-output",
      source: {
        kind: "managed-path",
        root: { kind: "repository", repositoryId: EVIDENCE_REPOSITORY_ID },
        path: "artifacts/test-run",
        resourceType: "tree",
      },
      contentReview,
    });
    const blocked = await preview(fixture, tree("reject"));
    equal(blocked.status, "blocked");
    deepEqual(blocked.blockers, ["opaque-content:screenshots/result.bin"]);
    equal(blocked.planDigest, null);
    equal(blocked.plan, null);
    equal(blocked.next.frontier, null);
    deepEqual(blocked.next.blockers, blocked.blockers);
    await rejects(
      executeRecordEvidenceRequest(
        request(fixture, {
          mode: "apply",
          selection: tree("reject"),
          planDigest: `sha256:${"0".repeat(64)}`,
        }),
        CLOCK,
      ),
      rejectedWith("plan-blocked"),
    );
    const confirmed = await preview(fixture, tree("controller-confirmed"));
    equal(confirmed.status, "ready");
    equal(confirmed.plan?.contentReview.disposition, "controller-confirmed");
    equal(confirmed.plan?.contentReview.opaqueFileCount, 1);
    const recorded = await apply(
      fixture,
      tree("controller-confirmed"),
      confirmed.planDigest as string,
    );
    equal(recorded.disposition, "recorded");

    writeFileSync(
      path.join(fixture.repositoryRoot, "artifacts/test-run/logs/secret.txt"),
      "api_key = abcdefghijklmnop\n",
    );
    const credential = await preview(fixture, tree("controller-confirmed"));
    equal(credential.status, "blocked");
    deepEqual(credential.blockers, ["privacy:credential-assignment:logs/secret.txt:1"]);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("observation、link、commit 各成一份记录：payload 是来源投影，不含句柄与路径，可经读取服务读回", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const written = await writeHostHookObservation(fixture.publication.workspaceRoot, {
      hostId: "codex",
      event: "user-prompt-submit",
      sessionId: "codex-host-thread:evidence-service",
      cwd: fixture.publication.workspacePath,
      recordedAt: parseUtcInstant("2026-09-01T20:55:00.000Z"),
      promptDigest: `sha256:${"7".repeat(64)}` as never,
    });
    const selections = [
      {
        kind: "hook-observation",
        source: { kind: "observation", hostId: "codex", recordId: written.record.recordId },
        contentReview: "reject",
      },
      {
        kind: "link",
        source: {
          kind: "link",
          url: "https://example.com/ci/run/42",
          digest: `sha256:${"8".repeat(64)}`,
        },
        contentReview: "reject",
      },
      {
        kind: "commit",
        source: { kind: "commit", repositoryId: EVIDENCE_REPOSITORY_ID, commitOid: "b".repeat(40) },
        contentReview: "reject",
      },
    ];
    const reading = new ManagedEvidenceReadingService(fixture.publication.workspaceRoot);
    for (const [index, selection] of selections.entries()) {
      const previewed = await preview(fixture, selection);
      equal(previewed.status, "ready", previewed.blockers.join(","));
      const recorded = await apply(fixture, selection, previewed.planDigest as string);
      equal(recorded.disposition, "recorded");
      equal(recorded.publication?.kind, selection.kind);
      equal(recorded.publication?.event.streamRevision, index + 2);
      const evidenceId = recorded.publication?.evidenceId as string;
      const content = readFileSync(
        path.join(
          demandRootPath(fixture),
          "artifacts",
          "managed-evidence",
          evidenceId,
          "payload",
          "content",
        ),
        "utf8",
      );
      equal(content.includes("codex-host-thread:evidence-service"), false);
      equal(content.includes(fixture.publication.workspacePath), false);
      const member = await reading.readPayloadMember(fixture.demandId, evidenceId, "content", {
        maximumBytes: parseByteCount(4096),
      });
      equal(member.manifest.kind, selection.kind);
      equal(member.manifest.source.kind, selection.source.kind);
      equal(member.opaque, false);
    }
    const manifest = await reading.readManifest(
      fixture.demandId,
      (await preview(fixture, selections[0])).plan?.evidenceId as string,
    );
    const source = manifest.manifest.source;
    if (source.kind !== "observation") throw new Error("Expected an observation source.");
    equal(source.event, "user-prompt-submit");
    equal(source.promptDigest, `sha256:${"7".repeat(64)}`);
    equal(source.transcript, "absent");
    await rejects(
      preview(fixture, {
        kind: "transcript",
        source: { kind: "observation", hostId: "codex", recordId: written.record.recordId },
        contentReview: "reject",
      }),
      rejectedWith("kind"),
    );
    await rejects(
      preview(fixture, {
        kind: "link",
        source: { kind: "link", url: "http://example.com/plain" },
        contentReview: "reject",
      }),
      rejectedWith("schema", "invalid-request"),
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

/** 在 Demand 根下留一份发布 journal（可选物化 stage），身份按切片自己的派生规则。 */
async function leaveJournal(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
  stage: boolean,
) {
  const capturePlan = readyCapturePlan(
    await new ManagedEvidenceCapturePlanningService(fixture.publication.workspaceRoot).preview(
      fixture.demandId,
      fileSelection("artifacts/test-run/logs/report.txt"),
      CLOCK,
    ),
  );
  const identity = deriveEvidenceEventIdentity(capturePlan.manifest.evidenceId);
  const transaction = createManagedEvidencePublicationTransaction({ capturePlan, ...identity });
  const demandRoot = await RootedDirectory.open(
    path.join(fixture.publication.workspacePath, ".wakeflow-active", "current", fixture.demandId),
  );
  try {
    await createManagedEvidencePublicationTransactionJournal(demandRoot, transaction);
    if (stage) {
      const sourceRoot = await RootedDirectory.open(fixture.repositoryRoot);
      try {
        await materializeManagedEvidencePublicationStage(sourceRoot, demandRoot, transaction);
      } finally {
        await sourceRoot.close();
      }
    } else {
      await executeDemandEventSourcingCommand(
        new DemandEventSourcingRepository(demandRoot),
        {
          commandType: "lifecycle.cancel-demand",
          commandVersion: 1,
          demandId: fixture.demandId,
          eventId: STALE_EVENT_ID,
          recordedAt: parseUtcInstant("2026-09-01T21:01:00.000Z"),
          reason: "stale recovery",
        },
        {
          commitId: STALE_COMMIT_ID,
          expectedStreamRevision: transaction.demandEventSourcingAppend.expectedStreamRevision,
        },
      );
    }
  } finally {
    await demandRoot.close();
  }
  return identity;
}

const STALE_EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_d3333333-3333-4333-8333-333333333333",
  "demand-event",
);
const STALE_COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_d4444444-4444-4444-8444-444444444444",
  "demand-event-commit",
);

async function recoverResult(fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>) {
  const result = await executeRecordEvidenceRequest(request(fixture, { mode: "recover" }));
  if (result.kind !== "WakeflowRecordEvidenceMutation") throw new Error("Expected a mutation.");
  equal(result.mode, "recover");
  return result;
}

test("recover 结局：留下的可完成 journal 前向发布为 recovered 并带发布回执；过期 journal 退休为 retired", async () => {
  const completable = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const identity = await leaveJournal(completable, true);
    const recovered = await recoverResult(completable);
    equal(recovered.disposition, "recovered");
    equal(recovered.publication?.event.eventId, identity.eventId);
    equal(recovered.publication?.event.commitId, identity.commitId);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(completable);
  }
  const stale = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    await leaveJournal(stale, false);
    const retired = await recoverResult(stale);
    equal(retired.disposition, "retired");
    equal(retired.publication, null);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(stale);
  }
});
