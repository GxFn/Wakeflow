import { deepEqual, equal, rejects } from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  cancellationReasonBlockers,
  deriveCancellationWithdrawalReason,
} from "../../../src/capabilities/demand/decide.js";
import {
  executeDemandCancellationRequest,
  executeDemandCompletionRequest,
  executeDemandContinuationRequest,
} from "../../../src/capabilities/demand/lifecycle.js";
import { executeStatusRequest } from "../../../src/capabilities/observation/service.js";
import { executeTargetTaskPlanningPublicRequest } from "../../../src/capabilities/tasking/service.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { assertNoActiveDemand } from "../../../src/governance/demand/publication/demand-active-guard.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { deriveDurableId } from "../../../src/kernel/ids.js";
import { demandLifecycleJournalRef, workClaimRef } from "../../../src/kernel/layout.js";
import { readRequirementClaimState } from "../../../src/kernel/requirement-board.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  prepareFixtureDelivery,
} from "../../governance/delivery/delivery-workspace.fixture.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../../governance/lifecycle/demand-completion-service.fixture.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  PLANNING_REPOSITORY_ID,
  PLANNING_REQUIREMENT_ID,
  PLANNING_WINDOW_ID,
} from "../../governance/tasking/target-task-planning-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

useDisposableDurability();

/**
 * demand 切片效果：升级后路由 awaiting-decision 且完成被阻塞；记录决定后完成即归档
 * （终态事件、归档包、需求包 archived、活动根删除、日志清理、recover）；continue 从归档
 * 重开并要求先规划；取消释放声明并撤回需求包；取消后不能再 continue；删根中断留下的残根
 * 由 recover 按日志与已封归档清除（W19）；取消理由按码点截断进看板（W20）。级别 2（能力）。
 */

const OWNER_POD_ID = "pod_99999999-9999-4999-8999-999999999999";
const OTHER_POD_ID = "pod_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** 每个条目的类型、权限、mtime 与文件内容：预览若改写任何已有文件，快照即不同。 */
function snapshotTree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (current: string, ref: string): void => {
    const stat = lstatSync(current, { bigint: true });
    const kind = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
    const content = kind === "file" ? readFileSync(current).toString("base64") : "";
    result[ref] = [kind, Number(stat.mode & 0o777n), stat.mtimeNs, content].join(":");
    if (kind !== "directory") return;
    for (const name of readdirSync(current).sort())
      visit(path.join(current, name), `${ref}/${name}`);
  };
  if (existsSync(root)) visit(root, ".");
  return result;
}

const ESCALATED_AT = parseUtcInstant("2026-08-29T12:30:00.000Z");

function demandRootExists(workspacePath: string, demandId: string): boolean {
  return existsSync(path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")));
}

async function escalate(workspacePath: string, demandId: string, targetTaskId: string) {
  const demandRoot = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    const repository = new DemandEventSourcingRepository(demandRoot);
    const loaded = await repository.load();
    if (loaded === null) throw new Error("Expected a loaded aggregate.");
    const eventId = deriveDurableId("demand-event", "test-escalation", demandId);
    await executeDemandEventSourcingCommand(
      repository,
      {
        commandType: "lifecycle.escalate-demand",
        commandVersion: 1,
        demandId,
        eventId,
        recordedAt: ESCALATED_AT,
        escalation: {
          issue: "The accepted result leaves an open question about the rollout window.",
          requirementRefs: [],
          evidence: [],
          options: [
            { option: "Ship now", impact: "Rollout during business hours." },
            { option: "Wait for the window", impact: "One extra day." },
          ],
          recommendation: "Wait for the window.",
          source: {
            kind: "review-decision",
            targetTaskId,
            targetReviewDecisionId: `target-review-decision_${"1".repeat(8)}-1111-4111-8111-${"1".repeat(12)}`,
            decisionDigest: `sha256:${"1".repeat(64)}`,
          },
        },
      },
      {
        commitId: deriveDurableId("demand-event-commit", "test-escalation", demandId),
        expectedStreamRevision: loaded.aggregate.streamRevision,
      },
    );
    return eventId;
  } finally {
    await demandRoot.close();
  }
}

/** 活动根里第一条受管证据的第一个负载文件（复审 G6 的篡改用例）。 */
function firstEvidencePayloadFile(root: string): string {
  const pending = [path.join(root, ".wakeflow-active")];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (
        entry.isFile() &&
        candidate.includes(`${path.sep}managed-evidence${path.sep}`) &&
        candidate.includes(`${path.sep}payload${path.sep}`)
      ) {
        return candidate;
      }
    }
  }
  throw new Error("no managed evidence payload in the fixture");
}

test("升级阻塞完成；记录决定后完成即归档、recover 幂等、continue 重开、取消撤回需求包", async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const root = fixture.workspacePath;
    const demandId = fixture.demandId;
    const ledgerArchives = path.join(fixture.fixtureRoot, "wakeflow-ledger", "archives", demandId);

    await escalate(root, demandId, fixture.targetTaskId);
    const awaiting = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root, demandId });
    if (awaiting.route === null) throw new Error("Expected an active route.");
    equal(awaiting.route.disposition, "awaiting-decision");
    equal(awaiting.next.owner, "user");
    equal(awaiting.next.suggestedTool, "wakeflow_continue_demand");

    const blockedCompletion = await executeDemandCompletionRequest({
      root,
      mode: "preview",
      demandId,
    });
    if (blockedCompletion.kind !== "WakeflowDemandCompletionPreview")
      throw new Error("Expected a preview.");
    equal(blockedCompletion.status, "blocked");
    equal(blockedCompletion.blockers.includes("awaiting-decision"), true);

    const decisionPreview = await executeDemandContinuationRequest({
      root,
      mode: "preview",
      demandId,
      action: "record-decision",
      decision: { text: "Wait for the window.", chosenOption: "Wait for the window" },
    });
    if (
      decisionPreview.kind !== "WakeflowDemandContinuationPreview" ||
      decisionPreview.planDigest === null
    )
      throw new Error("Expected a ready decision plan.");
    const decided = await executeDemandContinuationRequest({
      root,
      mode: "apply",
      demandId,
      action: "record-decision",
      decision: { text: "Wait for the window.", chosenOption: "Wait for the window" },
      planDigest: decisionPreview.planDigest,
    });
    if (decided.kind !== "WakeflowDemandContinuationMutation")
      throw new Error("Expected a mutation.");
    equal(decided.disposition, "decision-recorded");
    equal(decided.next.frontier, "demand-completion-preflight");

    // 复审 G6：受管证据的负载字节在完成路径上重新哈希——改一个字节，preview 的 evidence-integrity 门失败并点名
    // `<evidenceId>:<ref>`；改回去才通过。
    const payloadFile = firstEvidencePayloadFile(root);
    const original = readFileSync(payloadFile);
    writeFileSync(payloadFile, Buffer.concat([original, Buffer.from("x")]));
    const tampered = await executeDemandCompletionRequest({ root, mode: "preview", demandId });
    if (tampered.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected a preview.");
    const integrity = tampered.verify?.gates.find((gate) => gate.gate === "evidence-integrity");
    equal(integrity?.status, "fail");
    equal(integrity?.detail?.includes(":"), true, "the failing evidence and file are named");
    writeFileSync(payloadFile, original);

    const ledgerRoot = path.join(fixture.fixtureRoot, "wakeflow-ledger");
    const beforeApply = [snapshotTree(root), snapshotTree(ledgerRoot)];
    const preview = await executeDemandCompletionRequest({ root, mode: "preview", demandId });
    if (preview.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected a preview.");
    if (preview.planDigest === null) throw new Error(preview.blockers.join(","));
    equal(
      preview.verify?.gates.every((gate) => gate.status === "pass"),
      true,
    );
    deepEqual([snapshotTree(root), snapshotTree(ledgerRoot)], beforeApply, "preview wrote");
    equal(existsSync(ledgerArchives), false);

    await rejects(
      executeDemandCompletionRequest({
        root,
        mode: "apply",
        demandId,
        planDigest: `sha256:${"f".repeat(64)}`,
      }),
      (error: unknown) => error instanceof WakeflowError && error.reason === "plan-drift",
    );
    const completed = await executeDemandCompletionRequest({
      root,
      mode: "apply",
      demandId,
      planDigest: preview.planDigest,
    });
    if (completed.kind !== "WakeflowDemandCompletionMutation")
      throw new Error("Expected a mutation.");
    equal(completed.disposition, "completed");
    equal(completed.package.status, "archived");
    equal(completed.releasedClaims, 0);
    // W34：非 research 的完成归档保留 continue 前沿（下面的 continue 预览随即 ready）。
    equal(completed.next.frontier, "demand-continuation");
    equal(demandRootExists(root, demandId), false, "active root survived");
    equal(
      existsSync(path.join(root, ...demandLifecycleJournalRef(demandId).split("/"))),
      false,
      "journal survived",
    );
    equal(readdirSync(ledgerArchives).length, 1);
    const archiveDirectory = path.join(
      fixture.fixtureRoot,
      "wakeflow-ledger",
      ...completed.archive.archiveRef.split("/"),
    );
    equal(existsSync(path.join(archiveDirectory, "manifest.json")), true);
    equal(existsSync(path.join(archiveDirectory, "verify-report.json")), true);
    equal(existsSync(path.join(archiveDirectory, "payload", "identity.json")), true);
    equal(existsSync(path.join(archiveDirectory, "payload", "event-sourcing", "snapshots")), false);
    const claim = await readRequirementClaimState(fixture.workspaceRoot, PLANNING_REQUIREMENT_ID);
    equal(claim?.state.status, "archived");
    equal(claim?.state.archive?.demandId, demandId);

    const archivedRoute = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root, demandId });
    if (archivedRoute.archive === null) throw new Error("Expected an archived route.");
    equal(archivedRoute.archive.outcome, "completed");
    equal(archivedRoute.next.frontier, "demand-continuation");

    const recovered = await executeDemandCompletionRequest({
      root,
      mode: "recover",
      operationId: demandId,
    });
    if (recovered.kind !== "WakeflowDemandCompletionMutation")
      throw new Error("Expected a mutation.");
    equal(recovered.disposition, "recovered");
    equal(recovered.terminalEvent.eventId, completed.terminalEvent.eventId);

    const continuePreview = await executeDemandContinuationRequest({
      root,
      mode: "preview",
      demandId,
      action: "continue",
      continuation: { kind: "optimization", summary: "Tighten the focused checks." },
    });
    if (continuePreview.kind !== "WakeflowDemandContinuationPreview")
      throw new Error("Expected a preview.");
    if (continuePreview.planDigest === null) throw new Error(continuePreview.blockers.join(","));
    const continued = await executeDemandContinuationRequest({
      root,
      mode: "apply",
      demandId,
      action: "continue",
      continuation: { kind: "optimization", summary: "Tighten the focused checks." },
      planDigest: continuePreview.planDigest,
    });
    if (continued.kind !== "WakeflowDemandContinuationMutation")
      throw new Error("Expected a mutation.");
    equal(continued.disposition, "continued");
    equal(continued.package?.status, "claimed");
    equal(continued.next.frontier, "implementation-task-planning");
    equal(demandRootExists(root, demandId), true);
    const reopened = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root, demandId });
    if (reopened.route === null) throw new Error("Expected an active route.");
    equal(reopened.route.lifecycle, "active");
    equal(reopened.route.disposition, "work-available");

    const planned = await executeTargetTaskPlanningPublicRequest({
      root,
      demandId,
      idempotencyKey: "continue-plan-1",
      expectedStreamRevision: reopened.route.observedEventStream.streamRevision,
      taskPackage: {
        assignment: { repositoryId: PLANNING_REPOSITORY_ID, windowId: PLANNING_WINDOW_ID },
        workType: "implementation",
        objective: "续接后的优化任务",
        confirmedContext: ["Demand 已从归档重开"],
        selectedAuthorityMemberRefs: [
          `requirements/${PLANNING_REQUIREMENT_ID}/requirement.md`,
          `requirements/${PLANNING_REQUIREMENT_ID}/landing.md`,
        ],
        boundaries: { inScope: ["优化"], outOfScope: ["投递"], forbidden: ["宿主发送"] },
        completionExpectations: ["聚焦检查通过"],
        commitExpectation: "leave-uncommitted",
        acceptanceAnchors: [
          {
            anchorId: "opt",
            claim: "优化生效",
            probe: "运行检查",
            expected: "通过",
            requirementRef: {
              recordDigest: fixture.recordDigest,
              sectionAnchor: "acceptance-criteria",
              itemId: "ac-2",
            },
          },
        ],
        lineage: {
          kind: "continuation",
          continuesTargetTaskId: fixture.targetTaskId,
        },
        sectionAnchors: [],
      },
    });
    equal(planned.status, "committed");
    equal(planned.next.frontier, "implementation-delivery-planning");

    const cancelPreview = await executeDemandCancellationRequest({
      root,
      mode: "preview",
      demandId,
      reason: "The optimization is no longer wanted.",
    });
    if (cancelPreview.kind !== "WakeflowDemandCancellationPreview")
      throw new Error("Expected a preview.");
    if (cancelPreview.planDigest === null) throw new Error(cancelPreview.blockers.join(","));
    const cancelled = await executeDemandCancellationRequest({
      root,
      mode: "apply",
      demandId,
      reason: "The optimization is no longer wanted.",
      planDigest: cancelPreview.planDigest,
    });
    if (cancelled.kind !== "WakeflowDemandCancellationMutation")
      throw new Error("Expected a mutation.");
    equal(cancelled.disposition, "cancelled");
    equal(cancelled.package.status, "withdrawn");
    equal(cancelled.next.frontier, null);
    // 复审 G2：看板上的撤回理由带前缀与用户的取消理由，不再只有字面量。
    const withdrawn = await readRequirementClaimState(
      fixture.workspaceRoot,
      PLANNING_REQUIREMENT_ID,
    );
    equal(
      withdrawn?.state.withdrawal?.reason,
      `demand-cancelled:${demandId}: The optimization is no longer wanted.`,
    );
    equal(demandRootExists(root, demandId), false);
    equal(readdirSync(ledgerArchives).length, 2);

    const afterCancel = await executeDemandContinuationRequest({
      root,
      mode: "preview",
      demandId,
      action: "continue",
      continuation: { kind: "verified-bug", summary: "x" },
    });
    if (afterCancel.kind !== "WakeflowDemandContinuationPreview")
      throw new Error("Expected a preview.");
    equal(afterCancel.status, "blocked");
    equal(afterCancel.blockers.includes("archive-outcome:cancelled"), true);
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});

test("未接受的目标让完成在 preview 阻塞；取消释放本 Demand 的窗口工作声明", async () => {
  const planning = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const blocked = await executeDemandCompletionRequest({
      root: planning.workspacePath,
      mode: "preview",
      demandId: planning.request.demandId,
    });
    if (blocked.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected a preview.");
    equal(blocked.status, "blocked");
    equal(blocked.blockers.includes("route:not-ready"), true);
    equal(blocked.planDigest, null);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(planning);
  }

  const fixture = await createDeliveryWorkspaceFixture();
  try {
    const root = fixture.workspacePath;
    const demandId = fixture.demandId;
    const prepared = await prepareFixtureDelivery(fixture);
    equal(prepared.status, "committed");
    const claimPath = path.join(root, ...workClaimRef(fixture.route.windowId).split("/"));
    equal(existsSync(claimPath), true);

    const reason = "Cancelled while the window still holds the claim.";
    const preview = await executeDemandCancellationRequest({
      root,
      mode: "preview",
      demandId,
      reason,
    });
    if (preview.kind !== "WakeflowDemandCancellationPreview")
      throw new Error("Expected a preview.");
    if (preview.planDigest === null) throw new Error(preview.blockers.join(","));
    equal(
      preview.verify?.gates.find((gate) => gate.gate === "work-claims-released")?.status,
      "fail",
    );
    const cancelled = await executeDemandCancellationRequest({
      root,
      mode: "apply",
      demandId,
      reason,
      planDigest: preview.planDigest,
    });
    if (cancelled.kind !== "WakeflowDemandCancellationMutation")
      throw new Error("Expected a mutation.");
    equal(cancelled.disposition, "cancelled");
    equal(cancelled.releasedClaims, 1);
    equal(existsSync(claimPath), false, "claim survived cancellation");
    equal(cancelled.package.status, "withdrawn");
    equal(demandRootExists(root, demandId), false);
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

/**
 * 在该 Demand 的账本归档目录里，用普通文件预先占住每个可能的归档名。计划推导只列出目录形态的归档，
 * 看不见这些占位；apply 写完日志、追加终态事件后发布归档时撞上占位而失败。
 */
function occupyArchiveNames(archives: string, demandId: string): readonly string[] {
  const occupied = path.join(archives, demandId);
  const placeholders = Array.from({ length: 199 }, (_, index) =>
    path.join(occupied, String(index + 2).padStart(10, "0")),
  );
  mkdirSync(occupied, { recursive: true });
  for (const placeholder of placeholders) writeFileSync(placeholder, "occupied\n");
  return placeholders;
}

/**
 * 在日志写下之后打断 apply（`occupyArchiveNames`）；清掉占位后 recover 按日志重放，结果与一次正常
 * apply 相同。
 */
async function interruptAndRecover(
  action: "complete" | "cancel",
  awaitingDecision = false,
): Promise<void> {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const root = fixture.workspacePath;
    const demandId = fixture.demandId;
    const journal = path.join(root, ...demandLifecycleJournalRef(demandId).split("/"));
    const archives = path.join(fixture.fixtureRoot, "wakeflow-ledger", "archives");
    const execute =
      action === "complete" ? executeDemandCompletionRequest : executeDemandCancellationRequest;
    const reason = action === "cancel" ? { reason: "Interrupted cancellation." } : {};
    if (awaitingDecision) await escalate(root, demandId, fixture.targetTaskId);
    const commitsRoot = path.join(root, demandFinalRootRef(demandId), "event-sourcing", "commits");
    const originalCommits = readdirSync(commitsRoot).map(
      (name) => [name, readFileSync(path.join(commitsRoot, name), "utf8")] as const,
    );
    const preview = await execute({ root, mode: "preview", demandId, ...reason });
    if (!("planDigest" in preview) || preview.planDigest === null)
      throw new Error("Expected a plan.");
    const occupied = path.join(archives, demandId);
    const placeholders = occupyArchiveNames(archives, demandId);
    await rejects(
      execute({ root, mode: "apply", demandId, ...reason, planDigest: preview.planDigest }),
    );
    equal(existsSync(journal), true, "journal missing after the interrupted apply");
    const interruptedRoot = await RootedDirectory.open(
      path.join(root, demandFinalRootRef(demandId)),
    );
    try {
      const audited = await new DemandEventSourcingRepository(interruptedRoot).audit();
      equal(audited.aggregate.state.lifecycle, action === "cancel" ? "cancelled" : "completed");
      equal(audited.aggregate.state.awaitingDecision, undefined);
      for (const [name, bytes] of originalCommits)
        equal(readFileSync(path.join(commitsRoot, name), "utf8"), bytes);
      equal(audited.replayedCommitCount, originalCommits.length + 1);
      if (awaitingDecision) {
        const history = await new DemandEventSourcingRepository(
          interruptedRoot,
        ).auditTargetResultHistory();
        equal(history.escalations.length, 1);
        equal(history.decisionRecords.length, 0, "cancellation must not invent an answer");
      }
    } finally {
      await interruptedRoot.close();
    }
    equal(demandRootExists(root, demandId), true);
    await rejects(
      assertNoActiveDemand(fixture.workspaceRoot, undefined, null, OWNER_POD_ID),
      (error: unknown) => error instanceof WakeflowError && error.reason === "pod-busy",
    );
    await assertNoActiveDemand(fixture.workspaceRoot, undefined, demandId, OWNER_POD_ID);
    for (const placeholder of placeholders) rmSync(placeholder);

    const recovered = await execute({ root, mode: "recover", operationId: demandId });
    if (!("archive" in recovered)) throw new Error("Expected a mutation.");
    equal(recovered.disposition, "recovered");
    equal(readdirSync(occupied).length, 1);
    equal(demandRootExists(root, demandId), false, "active root survived");
    equal(existsSync(journal), false, "journal survived");
    const claim = await readRequirementClaimState(fixture.workspaceRoot, PLANNING_REQUIREMENT_ID);
    equal(claim?.state.status, action === "complete" ? "archived" : "withdrawn");
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
}

test("完成的 apply 在日志之后中断：recover 按日志重放出与正常 apply 相同的归档与看板状态", async () => {
  await interruptAndRecover("complete");
});

test("取消的 apply 在日志之后中断：recover 按日志重放出归档并撤回需求包", async () => {
  await interruptAndRecover("cancel");
});

/** `cpSync` 不保留目录权限位：把副本树里的每个目录恢复成活动根的 0o700。 */
function restoreDirectoryModes(root: string): void {
  chmodSync(root, 0o700);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) restoreDirectoryModes(path.join(root, entry.name));
  }
}

/**
 * W19：终态事务在删活动根时中断，留下只缺 identity.json 或 authority.json 的残根。recover 不再把"活动根
 * 存在"当作健康：日志加绑定该计划的已封归档是权威——pod 身份取归档清单，不打开残根，残根按日志授权清除。
 * 残根由一次中断在封档前的 apply 造出：此刻的活动根就是归档负载的来源，副本去掉一个文件再配上原日志。
 */
test("删根中断留下的残根：recover 以日志与已封归档为权威完成退役，pod 身份取归档清单（W19）", async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const root = fixture.workspacePath;
    const demandId = fixture.demandId;
    const journal = path.join(root, ...demandLifecycleJournalRef(demandId).split("/"));
    const demandRoot = path.join(root, ...demandFinalRootRef(demandId).split("/"));
    const archives = path.join(fixture.fixtureRoot, "wakeflow-ledger", "archives");
    const preview = await executeDemandCompletionRequest({ root, mode: "preview", demandId });
    if (preview.kind !== "WakeflowDemandCompletionPreview" || preview.planDigest === null)
      throw new Error("Expected a plan.");
    const placeholders = occupyArchiveNames(archives, demandId);
    await rejects(
      executeDemandCompletionRequest({
        root,
        mode: "apply",
        demandId,
        planDigest: preview.planDigest,
      }),
    );
    const journalBytes = readFileSync(journal);
    const rootCopy = path.join(fixture.fixtureRoot, "demand-root-copy");
    cpSync(demandRoot, rootCopy, { recursive: true });
    for (const placeholder of placeholders) rmSync(placeholder);
    const recovered = await executeDemandCompletionRequest({
      root,
      mode: "recover",
      operationId: demandId,
    });
    if (recovered.kind !== "WakeflowDemandCompletionMutation")
      throw new Error("Expected a mutation.");
    equal(recovered.disposition, "recovered");
    equal(demandRootExists(root, demandId), false);

    for (const missing of ["identity.json", "authority.json"]) {
      cpSync(rootCopy, demandRoot, { recursive: true });
      restoreDirectoryModes(demandRoot);
      rmSync(path.join(demandRoot, missing));
      writeFileSync(journal, journalBytes, { mode: 0o600 });
      // 守卫看日志：残根的 Demand 仍占着归档清单记下的 pod，别的 pod 不受影响。
      await rejects(
        assertNoActiveDemand(fixture.workspaceRoot, undefined, null, OWNER_POD_ID),
        (error: unknown) => error instanceof WakeflowError && error.reason === "pod-busy",
      );
      await assertNoActiveDemand(fixture.workspaceRoot, undefined, null, OTHER_POD_ID);
      const again = await executeDemandCompletionRequest({
        root,
        mode: "recover",
        operationId: demandId,
      });
      if (again.kind !== "WakeflowDemandCompletionMutation")
        throw new Error(`Expected a mutation without ${missing}.`);
      equal(again.disposition, "recovered", missing);
      equal(again.terminalEvent.eventId, recovered.terminalEvent.eventId, missing);
      equal(again.archive.manifestDigest, recovered.archive.manifestDigest, missing);
      equal(demandRootExists(root, demandId), false, `residual root survived without ${missing}`);
      equal(existsSync(journal), false, `journal survived without ${missing}`);
      equal(readdirSync(path.join(archives, demandId)).length, 1, missing);
    }
    const claim = await readRequirementClaimState(fixture.workspaceRoot, PLANNING_REQUIREMENT_ID);
    equal(claim?.state.status, "archived");
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});

/**
 * W20：撤回理由 `demand-cancelled:<demandId>: <理由>` 的上限按码点计。把第 4096 个码元正好放在一个 emoji 的
 * 高位代理项上：按码元切会留下 lone surrogate，看板状态在终态事件提交、归档封好之后才写不进去；按码点截断
 * 保留整个 emoji，apply 成功、看板理由 well-formed、recover 幂等。派生理由的准入在 preview 就校验。
 */
test("取消理由在 4096 码点边界恰为 emoji：撤回理由按码点截断、看板状态 well-formed、recover 幂等（W20）", async () => {
  const planning = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const root = planning.workspacePath;
    const demandId = planning.request.demandId;
    const prefix = `demand-cancelled:${demandId}: `;
    const filler = "No longer wanted. ".repeat(300).slice(0, 4095 - prefix.length);
    const reason = `${filler}${"\u{1F600}".repeat(40)}`;
    const derived = `${prefix}${reason}`;
    equal(derived.charCodeAt(4095) >= 0xd800 && derived.charCodeAt(4095) <= 0xdbff, true);
    equal(Array.from(derived).length > 4096, true);
    equal(derived.slice(0, 4096).isWellFormed(), false, "the UTF-16 cut would split the emoji");
    deepEqual(cancellationReasonBlockers(demandId, reason), []);
    deepEqual(cancellationReasonBlockers(demandId, "x\ud83d"), [
      "withdrawal-reason:lone-surrogate",
    ]);
    // 公开请求里的 lone surrogate 在 codec 就被拒绝，到不了计划。
    await rejects(
      executeDemandCancellationRequest({ root, mode: "preview", demandId, reason: "x\ud83d" }),
      (error: unknown) =>
        error instanceof WakeflowError &&
        error.code === "invalid-request" &&
        error.reason === "not-json",
    );
    const preview = await executeDemandCancellationRequest({
      root,
      mode: "preview",
      demandId,
      reason,
    });
    if (preview.kind !== "WakeflowDemandCancellationPreview")
      throw new Error("Expected a preview.");
    if (preview.planDigest === null) throw new Error(preview.blockers.join(","));
    const cancelled = await executeDemandCancellationRequest({
      root,
      mode: "apply",
      demandId,
      reason,
      planDigest: preview.planDigest,
    });
    if (cancelled.kind !== "WakeflowDemandCancellationMutation")
      throw new Error("Expected a mutation.");
    equal(cancelled.disposition, "cancelled");
    equal(cancelled.package.status, "withdrawn");
    const withdrawn = await readRequirementClaimState(
      planning.workspaceRoot,
      PLANNING_REQUIREMENT_ID,
    );
    const recorded = withdrawn?.state.withdrawal?.reason ?? "";
    equal(recorded.isWellFormed(), true);
    equal(Array.from(recorded).length, 4096);
    equal(recorded.startsWith(prefix), true);
    equal(recorded.endsWith("\u{1F600}"), true);
    equal(recorded, deriveCancellationWithdrawalReason(demandId, reason));
    const recovered = await executeDemandCancellationRequest({
      root,
      mode: "recover",
      operationId: demandId,
    });
    if (recovered.kind !== "WakeflowDemandCancellationMutation")
      throw new Error("Expected recovery.");
    equal(recovered.disposition, "recovered");
    equal(recovered.archive.manifestDigest, cancelled.archive.manifestDigest);
    equal(demandRootExists(root, demandId), false);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(planning);
  }
});

test("等待决定时取消：预检 ready、终态已追加后中断可恢复，旧事件保持不变", {
  timeout: 120_000,
}, async () => {
  await interruptAndRecover("cancel", true);
});

test("等待决定时取消在追加前中断：恢复读取原日志并完成取消，不伪造用户回答", {
  timeout: 120_000,
}, async (t) => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  try {
    const root = fixture.workspacePath;
    const demandId = fixture.demandId;
    await escalate(root, demandId, fixture.targetTaskId);
    const request = {
      root,
      demandId,
      reason: "Cancel instead of answering the pending escalation.",
    };
    const preview = await executeDemandCancellationRequest({ ...request, mode: "preview" });
    if (preview.kind !== "WakeflowDemandCancellationPreview" || preview.planDigest === null)
      throw new Error("Expected cancellation plan");
    const mock = t.mock.method(
      DemandEventSourcingRepository.prototype,
      "appendPreparedCommit",
      async () => {
        throw new Error("Injected failure before terminal append");
      },
    );
    try {
      await rejects(
        executeDemandCancellationRequest({
          ...request,
          mode: "apply",
          planDigest: preview.planDigest,
        }),
      );
    } finally {
      mock.mock.restore();
    }
    const journal = path.join(root, demandLifecycleJournalRef(demandId));
    equal(existsSync(journal), true);
    const demandRoot = await RootedDirectory.open(path.join(root, demandFinalRootRef(demandId)));
    try {
      const history = await new DemandEventSourcingRepository(
        demandRoot,
      ).auditTargetResultHistory();
      equal(history.aggregate.state.lifecycle, "active");
      equal(history.aggregate.state.awaitingDecision === undefined, false);
      equal(history.decisionRecords.length, 0);
    } finally {
      await demandRoot.close();
    }
    const recovered = await executeDemandCancellationRequest({
      root,
      mode: "recover",
      operationId: demandId,
    });
    if (recovered.kind !== "WakeflowDemandCancellationMutation")
      throw new Error("Expected recovery");
    equal(recovered.disposition, "recovered");
    equal(recovered.package.status, "withdrawn");
    equal(existsSync(journal), false);
    equal(demandRootExists(root, demandId), false);
    const again = await executeDemandCancellationRequest({
      root,
      mode: "recover",
      operationId: demandId,
    });
    if (again.kind !== "WakeflowDemandCancellationMutation")
      throw new Error("Expected repeated recovery");
    equal(again.archive.manifestDigest, recovered.archive.manifestDigest);
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});
