import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  executeImplementationReviewDecisionRequest,
  executeTargetResultImportRequest,
} from "../../../src/capabilities/result-review/service.js";
import { demandFinalRootRef } from "../../../src/kernel/layout.js";
import type { DeliveredTarget } from "../../governance/delivery/delivery-workspace.fixture.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  type DeliveryWorkspaceFixture,
  deliverFixtureTarget,
} from "../../governance/delivery/delivery-workspace.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../../governance/result/implementation-target-result-report.fixture.js";
import {
  CODEX_REVIEW_FACADE,
  fixtureImplementationDecisionRequest,
  importFixtureImplementationResult,
  inspectFixtureReview,
  landFixtureTargetCompletion,
  loadFixtureTaskPackage,
  REVIEW_DECIDED_AT,
  REVIEW_DECISION_UUID,
  REVIEW_FIXTURE_REPORTED_AT,
  registerFixtureControllerWindow,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { plain, rejectedWith } from "./service.fixture.js";

useDisposableDurability();

/**
 * 上报的提交由导入核实并自动记成证据（ADR-0028 决定 4–6），2 级（能力）测试：产品仓库是真实的 Git 仓库，
 * 报告里的提交在导入那一次调用里被只读地观察——仓库里没有的提交让导入被拒并点名；真实的提交在结果落账
 * 之后各记成一条受管证据，评审单元把它们列成已核实，Controller 直接引用它们接受。仓库不可观察（夹具
 * 默认的普通目录）时导入照旧通过，那个提交在单元里显示为未核实。
 *
 * 投递夹具的任务包固定 leave-uncommitted，completed 的结果不能带提交；这里的报告用 needs-review，
 * 它不受提交期望约束，接受时由 Controller 按锚点绑定证据。
 */

/** 在夹具的产品目录里建一个真实仓库；全局与系统配置不参与。 */
function productGit(fixture: Readonly<DeliveryWorkspaceFixture>) {
  const cwd = path.join(fixture.fixtureRoot, "ProductA");
  const git = (...args: readonly string[]): string => {
    const result = spawnSync(
      "git",
      ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args],
      {
        cwd,
        encoding: "utf8",
        shell: false,
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      },
    );
    if (result.status !== 0) throw new Error(`fixture git ${args[0]} failed`);
    return result.stdout.trim();
  };
  const commit = (file: string, body: string): string => {
    writeFileSync(path.join(cwd, file), body, { mode: 0o644 });
    git("add", file);
    git("commit", "--quiet", "--message", file);
    return git("rev-parse", "HEAD");
  };
  return { git, commit };
}

/** 一份带提交的 needs-review 报告：不引用任何证据，本 Demand 里的受管证据只会来自导入自己。 */
async function committedContent(
  fixture: Readonly<DeliveryWorkspaceFixture>,
  delivered: Readonly<DeliveredTarget>,
  commitOids: readonly string[],
) {
  const taskPackage = await loadFixtureTaskPackage(
    fixture,
    delivered.envelope.target.taskPackageId,
  );
  const base = createImplementationTargetResultReportContentFixture(taskPackage);
  return {
    ...base,
    outcome: "needs-review" as const,
    anchorEvidence: [],
    evidenceLocators: [],
    repositoryChange: {
      ...base.repositoryChange,
      disposition: "committed",
      branch: "main",
      commits: commitOids.map((value) => ({ algorithm: "sha1", value })),
    },
  };
}

/** 直接经导入切片提交：夹具的导入助手会先登记一条文档证据，这里不要它。 */
async function importReport(
  fixture: Readonly<DeliveryWorkspaceFixture>,
  delivered: Readonly<DeliveredTarget>,
  content: unknown,
  idempotencyKey: string,
) {
  return executeTargetResultImportRequest(
    CODEX_REVIEW_FACADE,
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey,
      deliveryId: delivered.prepared.delivery.deliveryId,
      claimDigest: delivered.prepared.permit.fence.claimDigest,
      report: { workType: "implementation", content },
    },
    { clock: () => REVIEW_FIXTURE_REPORTED_AT },
  );
}

function recordedManifest(fixture: Readonly<DeliveryWorkspaceFixture>, evidenceId: string) {
  return JSON.parse(
    readFileSync(
      path.join(
        fixture.workspacePath,
        ...demandFinalRootRef(fixture.demandId).split("/"),
        "artifacts",
        "managed-evidence",
        evidenceId,
        "manifest.json",
      ),
      "utf8",
    ),
  );
}

test("真实仓库里上报的提交：不存在的提交让导入被拒；真实的提交在导入后各有一条带观察的证据，评审单元列成已核实，Controller 引用它们接受", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    await registerFixtureControllerWindow(fixture);
    const delivered = await deliverFixtureTarget(fixture);
    const { git, commit } = productGit(fixture);
    git("init", "--quiet", "--initial-branch=main");
    const first = commit("first.txt", "first\n");
    const second = commit("second.txt", "second\n");
    const blob = git("rev-parse", "HEAD:first.txt");

    // 仓库里没有的对象号、不是提交的对象号：导入被拒并点名，什么都没有落账。
    for (const [label, unknown] of [
      ["missing", "d".repeat(40)],
      ["blob", blob],
    ] as const) {
      await rejects(
        importReport(
          fixture,
          delivered,
          await committedContent(fixture, delivered, [first, unknown]),
          `fixture-import-commit-${label}`,
        ),
        rejectedWith("commit-unknown"),
        label,
      );
    }

    const content = await committedContent(fixture, delivered, [first, second]);
    const imported = await importReport(fixture, delivered, content, "fixture-import-commits");
    equal(imported.status, "committed");
    await landFixtureTargetCompletion(fixture, fixture.route);

    const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId);
    const reported = plain(inspection.reviewUnit.reportedCommits) ?? [];
    deepEqual(
      reported.map((entry) => [entry.commitOid, entry.verified, entry.changedPaths]),
      [
        [first, true, [{ status: "added", path: "first.txt" }]],
        [second, true, [{ status: "added", path: "second.txt" }]],
      ],
    );
    for (const entry of reported) {
      equal(entry.changedPathCount, 1);
      ok((entry.patchBytes ?? 0) > 0);
      const manifest = recordedManifest(fixture, entry.evidenceId as string);
      equal(manifest.kind, "commit");
      equal(manifest.source.commitOid, entry.commitOid);
      equal(manifest.source.observation.patch.bytes, entry.patchBytes);
    }
    // 两条证据各占一个流修订：结果事件之后流又前进了两格，评审以检查读到的修订为准。
    equal(inspection.eventStream.streamRevision, imported.event.streamRevision + 2);

    // 重放同一次导入不重复登记：同一个提交的证据身份是确定的。
    const replayed = await importReport(fixture, delivered, content, "fixture-import-commits");
    equal(replayed.event.eventId, imported.event.eventId);
    const again = await inspectFixtureReview(fixture, fixture.targetTaskId);
    equal(again.eventStream.streamRevision, inspection.eventStream.streamRevision);
    deepEqual(plain(again.reviewUnit.reportedCommits), reported);

    // Controller 被唤醒时证据已经在：needs-review 的结果按锚点绑定这两条提交证据即可接受。
    deepEqual(inspection.reviewUnit.allowedDecisions, ["accept", "rework", "blocked", "escalate"]);
    const evidenceIds = reported.map((entry) => entry.evidenceId as string);
    const accepted = await executeImplementationReviewDecisionRequest(
      CODEX_REVIEW_FACADE,
      {
        ...fixtureImplementationDecisionRequest(fixture, again, again.eventStream.streamRevision),
        anchorEvidence: inspection.reviewUnit.taskPackage.acceptanceAnchors.map((anchor) => ({
          anchorId: anchor.anchorId,
          evidenceIds,
        })),
      },
      { clock: () => REVIEW_DECIDED_AT, uuidFactory: () => REVIEW_DECISION_UUID },
    );
    equal(accepted.target.phase, "accepted");
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("仓库不可观察时不拦导入：产品目录不是 Git 仓库，上报的提交在评审单元里显示为未核实；没有上报提交时单元里没有这一项", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    await registerFixtureControllerWindow(fixture);
    const delivered = await deliverFixtureTarget(fixture);
    const reportedCommit = "a".repeat(40);
    const imported = await importReport(
      fixture,
      delivered,
      await committedContent(fixture, delivered, [reportedCommit]),
      "fixture-import-unobservable",
    );
    await landFixtureTargetCompletion(fixture, fixture.route);
    const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId);
    equal(inspection.eventStream.streamRevision, imported.event.streamRevision);
    deepEqual(plain(inspection.reviewUnit.reportedCommits), [
      {
        commitOid: reportedCommit,
        verified: false,
        evidenceId: null,
        changedPathCount: null,
        changedPaths: [],
        patchBytes: null,
      },
    ]);
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }

  const uncommitted = await createDeliveryWorkspaceFixture();
  try {
    await registerFixtureControllerWindow(uncommitted);
    const delivered = await deliverFixtureTarget(uncommitted);
    await importFixtureImplementationResult(uncommitted, delivered);
    await landFixtureTargetCompletion(uncommitted, uncommitted.route);
    const inspection = await inspectFixtureReview(uncommitted, uncommitted.targetTaskId);
    equal("reportedCommits" in inspection.reviewUnit, false);
  } finally {
    await cleanupDeliveryWorkspaceFixture(uncommitted);
  }
});
