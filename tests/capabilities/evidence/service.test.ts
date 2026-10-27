import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  deriveEvidenceEventIdentity,
  MANAGED_EVIDENCE_RECORD_EVENT_OCCUPANCY,
} from "../../../src/capabilities/evidence/decide.js";
import { executeRecordEvidenceRequest } from "../../../src/capabilities/evidence/service.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { readStableRootResourceTree } from "../../../src/foundation/filesystem/stable-resource-tree-read.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { ManagedEvidenceCapturePlanningService } from "../../../src/governance/evidence/managed-evidence-capture-planning-service.js";
import { materializeManagedEvidencePublicationStage } from "../../../src/governance/evidence/managed-evidence-publication-stage-materializer.js";
import { createManagedEvidencePublicationTransaction } from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";
import { createManagedEvidencePublicationTransactionJournal } from "../../../src/governance/evidence/managed-evidence-publication-transaction-store.js";
import { DemandResultReviewSnapshotError } from "../../../src/governance/review/demand-result-review-snapshot.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { WAKEFLOW_DEMAND_TREE_CAPACITY } from "../../../src/kernel/limits.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  EVIDENCE_CAPTURED_AT,
  EVIDENCE_REPOSITORY_ID,
  fileSelection,
  type ManagedEvidenceCapturePlanningWorkspaceFixture,
  readyCapturePlan,
} from "../../governance/evidence/managed-evidence-capture-planning-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 2 级（能力）：evidence 切片效果（§13.89 D1 到 D3）：preview 零写、apply 重算并按内容摘要执行、同内容
 * `already-recorded`、源漂移 `plan-drift`、内容阻塞、四种来源各成一份记录、recover 的 healthy、recovered 与 retired 结局，
 * 以及能归档的深度与累计容量阻塞（open-items W10）、notification 观察记录可记录（open-items W32）。
 */

const CLOCK = { clock: () => EVIDENCE_CAPTURED_AT };

function rejectedWith(reason: string, code = "precondition-failed") {
  return (error: unknown) =>
    isWakeflowError(error) && error.code === code && error.reason === reason;
}

/** kind 与来源不配：专门的原因，路径指到 kind 字段（§13.134，收 §13.133 G12）。 */
function kindSourceMismatch(error: unknown): boolean {
  return (
    isWakeflowError(error) &&
    error.code === "invalid-request" &&
    error.reason === "kind-source-mismatch" &&
    error.path === "$request.selection.kind"
  );
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

/** 托管证据记录的清单文件：`artifacts/managed-evidence/<evidenceId>/manifest.json`。 */
function evidenceManifestPath(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
  evidenceId: string,
) {
  return path.join(
    demandRootPath(fixture),
    "artifacts",
    "managed-evidence",
    evidenceId,
    "manifest.json",
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
    // notification 是 HOST_HOOK_EVENTS 的一员，此前 Manifest 枚举漏了它，真实观察到的记录在准入处变成 unexpected（W32）。
    const notification = await writeHostHookObservation(fixture.publication.workspaceRoot, {
      hostId: "codex",
      event: "notification",
      sessionId: "codex-host-thread:evidence-service",
      cwd: fixture.publication.workspacePath,
      recordedAt: parseUtcInstant("2026-09-01T20:56:00.000Z"),
      notificationType: "idle_prompt",
    });
    const selections = [
      {
        kind: "hook-observation",
        source: { kind: "observation", hostId: "codex", recordId: written.record.recordId },
        contentReview: "reject",
      },
      {
        kind: "hook-observation",
        source: { kind: "observation", hostId: "codex", recordId: notification.record.recordId },
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
      // Q12：读取服务随 L3 删除，直接读清单文件核对种类与来源。
      const recordedManifest = JSON.parse(
        readFileSync(evidenceManifestPath(fixture, evidenceId), "utf8"),
      ) as { kind: string; source: { kind: string } };
      equal(recordedManifest.kind, selection.kind);
      equal(recordedManifest.source.kind, selection.source.kind);
    }
    const manifest = JSON.parse(
      readFileSync(
        evidenceManifestPath(
          fixture,
          (await preview(fixture, selections[0])).plan?.evidenceId as string,
        ),
        "utf8",
      ),
    ) as { source: { kind: string; event?: string; promptDigest?: string; transcript?: string } };
    const source = manifest.source;
    if (source.kind !== "observation") throw new Error("Expected an observation source.");
    equal(source.event, "user-prompt-submit");
    equal(source.promptDigest, `sha256:${"7".repeat(64)}`);
    equal(source.transcript, "absent");
    const notificationManifest = JSON.parse(
      readFileSync(
        evidenceManifestPath(
          fixture,
          (await preview(fixture, selections[1])).plan?.evidenceId as string,
        ),
        "utf8",
      ),
    ) as { source: { kind: string; event?: string } };
    equal(notificationManifest.source.event, "notification");
    await rejects(
      preview(fixture, {
        kind: "transcript",
        source: { kind: "observation", hostId: "codex", recordId: written.record.recordId },
        contentReview: "reject",
      }),
      kindSourceMismatch,
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

/**
 * 证据发布之后才报告 aborted 的信号：只有提交目录多了一份提交、且读取发生在变更后的复核快照
 * 读取（`readSnapshotForNext`）之内时才中止，模拟调用方恰在证据提交之后取消。
 */
function abortAfterPublicationSignal(demandRoot: string): AbortSignal {
  const controller = new AbortController();
  const commitsPath = path.join(demandRoot, "event-sourcing", "commits");
  const committedBefore = readdirSync(commitsPath).length;
  const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  Object.defineProperty(controller.signal, "aborted", {
    get: () => {
      if (
        readdirSync(commitsPath).length > committedBefore &&
        new Error().stack?.includes("readSnapshotForNext") === true
      ) {
        controller.abort();
      }
      return nativeAborted?.call(controller.signal) === true;
    },
  });
  return controller.signal;
}

test("证据提交之后才中止：apply 以 io-failure/aborted 于 $signal 失败而不是 unexpected，证据已落账", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const selection = fileSelection("artifacts/test-run/logs/report.txt");
    const previewed = await preview(fixture, selection);
    const signal = abortAfterPublicationSignal(demandRootPath(fixture));
    await rejects(
      executeRecordEvidenceRequest(
        request(fixture, { mode: "apply", selection, planDigest: previewed.planDigest }),
        { ...CLOCK, signal },
      ),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "io-failure" &&
        error.reason === "aborted" &&
        error.path === "$signal" &&
        error.cause instanceof DemandResultReviewSnapshotError,
    );
    equal(signal.aborted, true);
    const after = await preview(fixture, selection);
    equal(after.plan?.recorded, true);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("选择里 kind 与来源不配（文件来源配 transcript、link、hook-observation 或 commit）报 kind-source-mismatch 并指到 kind 字段（§13.134）", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const file = fileSelection("artifacts/test-run/logs/report.txt");
    for (const kind of ["transcript", "link", "hook-observation", "commit"]) {
      for (const mode of ["preview", "apply"] as const) {
        await rejects(
          executeRecordEvidenceRequest(
            request(fixture, {
              mode,
              selection: { ...file, kind },
              ...(mode === "apply" ? { planDigest: `sha256:${"0".repeat(64)}` } : {}),
            }),
            CLOCK,
          ),
          kindSourceMismatch,
          `${mode} ${kind}`,
        );
      }
    }
    await rejects(
      preview(fixture, {
        kind: "test-output",
        source: { kind: "commit", repositoryId: EVIDENCE_REPOSITORY_ID, commitOid: "b".repeat(40) },
        contentReview: "reject",
      }),
      kindSourceMismatch,
    );
    const matched = await preview(fixture, file);
    equal(matched.status, "ready");
    equal(matched.plan?.recorded, false);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

/** 归档与取消读 Demand 根整树所用的容量（demand 切片 `readDemandRootSnapshot` 的同一组上限）。 */
const DEMAND_TREE_CAPACITY = {
  maximumEntries: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumEntries,
  maximumDepth: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumDepth,
  maximumFiles: WAKEFLOW_DEMAND_TREE_CAPACITY.maximumFiles,
  maximumFileBytes: parseByteCount(WAKEFLOW_DEMAND_TREE_CAPACITY.maximumFileBytes),
  maximumTotalBytes: parseByteCount(WAKEFLOW_DEMAND_TREE_CAPACITY.maximumTotalBytes),
};

async function readDemandTree(fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>) {
  const demandRoot = await RootedDirectory.open(demandRootPath(fixture));
  try {
    return await readStableRootResourceTree(demandRoot, DEMAND_TREE_CAPACITY);
  } finally {
    await demandRoot.close();
  }
}

function treeSelection(relativePath: string) {
  return {
    kind: "test-output",
    source: {
      kind: "managed-path",
      root: { kind: "repository", repositoryId: EVIDENCE_REPOSITORY_ID },
      path: relativePath,
      resourceType: "tree",
    },
    contentReview: "reject",
  };
}

/** `artifacts/<name>/d0/…/d<directories-1>/leaf.txt`：相对选择根的 ref 有 directories + 1 段。 */
function writeDeepTree(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
  name: string,
  directories: number,
): void {
  const deep = path.join(
    fixture.repositoryRoot,
    "artifacts",
    name,
    ...Array.from({ length: directories }, (_, index) => `d${index}`),
  );
  mkdirSync(deep, { recursive: true, mode: 0o755 });
  writeFileSync(path.join(deep, "leaf.txt"), `${name}\n`, { mode: 0o644 });
}

test("能归档的深度（open-items W10）：25 层目录树在 preview 以 capacity 拒绝；ref 恰为 20 段的树记录后，归档用的 Demand 根整树读取落在第 24 层而不撞深度上限", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    writeDeepTree(fixture, "deep-25", 25);
    await rejects(preview(fixture, treeSelection("artifacts/deep-25")), rejectedWith("capacity"));
    writeDeepTree(fixture, "deep-20", 19);
    const selection = treeSelection("artifacts/deep-20");
    const previewed = await preview(fixture, selection);
    equal(previewed.status, "ready", previewed.blockers.join(","));
    const recorded = await apply(fixture, selection, previewed.planDigest as string);
    equal(recorded.disposition, "recorded");
    // 与 complete/cancel 的 readDemandRootSnapshot 同一容量、同一读法。
    const tree = await readDemandTree(fixture);
    const leaf = tree.files.find((file) => file.resourcePath.endsWith("/leaf.txt"));
    equal(leaf?.depth, WAKEFLOW_DEMAND_TREE_CAPACITY.maximumDepth);
    equal(
      leaf?.resourcePath,
      `artifacts/managed-evidence/${recorded.publication?.evidenceId}/payload/${Array.from(
        { length: 19 },
        (_, index) => `d${index}`,
      ).join("/")}/leaf.txt`,
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("累计容量的计数基础（open-items W10）：一条单文件记录给 Demand 根增加五个记录成员，事件追加再增加 commit、index 与 snapshot 三个文件；重放不再增加", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const selection = fileSelection("artifacts/test-run/logs/report.txt");
    const before = await readDemandTree(fixture);
    equal(
      before.entries.some((entry) => entry.resourcePath === "artifacts/managed-evidence"),
      false,
    );
    const previewed = await preview(fixture, selection);
    const recorded = await apply(fixture, selection, previewed.planDigest as string);
    equal(recorded.disposition, "recorded");
    const after = await readDemandTree(fixture);
    // managed-evidence 目录、记录目录、payload 目录、清单与 content 五个成员，其中两个是文件。
    const event = MANAGED_EVIDENCE_RECORD_EVENT_OCCUPANCY;
    equal(after.entries.length - before.entries.length, 5 + event.entries);
    equal(after.files.length - before.files.length, 2 + event.files);
    const eventFiles = after.files.filter(
      (file) =>
        file.resourcePath.startsWith("event-sourcing/") &&
        !before.files.some((known) => known.resourcePath === file.resourcePath),
    );
    equal(eventFiles.length, event.files);
    await apply(fixture, selection, previewed.planDigest as string);
    equal((await readDemandTree(fixture)).entries.length, after.entries.length);
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});
