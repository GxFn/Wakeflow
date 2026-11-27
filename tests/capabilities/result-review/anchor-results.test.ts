import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  deliverFixtureTarget,
  withFixtureDemandRoot,
} from "../../governance/delivery/delivery-workspace.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../../governance/result/implementation-target-result-report.fixture.js";
import {
  importFixtureImplementationResult,
  inspectFixtureReview,
  landFixtureTargetCompletion,
  loadFixtureTaskPackage,
  recordFixtureEvidence,
  registerFixtureControllerWindow,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { plain, rejectedWith } from "./service.fixture.js";

useDisposableDurability();

/**
 * 逐条锚点的结论与任务包之外收到的指示（ADR-0030），2 级（能力）测试：实现结果的报告是记录版本 2，
 * 任务包里的每条验收锚点恰好一项结论——缺项、多项在导入时被拒并点名；两项新内容的文字过隐私扫描；
 * 结果事件写成版本 2；评审单元把目标的逐条结论与它申报的指示原样带给 Controller。
 */

test("导入核对逐条锚点的结论：缺项、多项、漏掉整项与文字里的凭证各被拒；合格的报告落成版本 2 的事件，评审单元带着逐条结论与任务包之外的指示", async () => {
  const fixture = await createDeliveryWorkspaceFixture();
  try {
    await registerFixtureControllerWindow(fixture);
    const delivered = await deliverFixtureTarget(fixture);
    const evidence = await recordFixtureEvidence(fixture);
    const taskPackage = await loadFixtureTaskPackage(
      fixture,
      delivered.envelope.target.taskPackageId,
    );
    const base = createImplementationTargetResultReportContentFixture(taskPackage, evidence);
    const [first, ...rest] = base.anchorResults;
    if (first === undefined) throw new Error("fixture task package has no anchors");
    const attempt = (label: string, content: unknown) =>
      importFixtureImplementationResult(fixture, delivered, {
        evidence,
        content,
        idempotencyKey: `fixture-import-anchor-${label}`,
      });

    await rejects(
      attempt("missing", { ...base, anchorResults: rest }),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "precondition-failed" &&
        error.reason === "anchor-result-missing" &&
        error.path === "$request.report.content.anchorResults" &&
        error.toPublicDetails().details?.blocker === `anchor-result-missing:${first.anchorId}`,
    );
    await rejects(
      attempt("unknown", {
        ...base,
        anchorResults: [
          ...base.anchorResults,
          { anchorId: "ac-not-in-package", status: "passed", observed: "多出来的一条。" },
        ],
      }),
      rejectedWith("anchor-result-unknown"),
    );
    // 整项漏掉是请求形状的问题：拒绝说出缺的是哪个成员。
    const { anchorResults: _omitted, ...withoutResults } = base;
    await rejects(
      attempt("absent", withoutResults),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "invalid-request" &&
        error.toPublicDetails().details?.schema === "required:anchorResults",
    );
    // 新加的两处文字和报告里别的文字一样过隐私扫描。
    await rejects(
      attempt("credential", {
        ...base,
        anchorResults: [
          { ...first, observed: "输出里有 api_key = abcdefghijklmnopqrstuvwxyz012345" },
          ...rest,
        ],
      }),
      (error: unknown) => isWakeflowError(error) && error.reason.startsWith("privacy"),
    );

    const content = {
      ...base,
      anchorResults: [
        { ...first, status: "failed", observed: "按任务包的命令跑了一遍，输出与要求不符。" },
        ...rest,
      ],
      outsideInstructions: [
        { source: "user", summary: "顺手把标题也改掉。", handling: "declined" },
      ],
    };
    const imported = await attempt("accepted", content);
    equal(imported.status, "committed");
    equal(imported.result.report.schemaVersion, 2);

    const stored = await withFixtureDemandRoot(fixture, (demandRoot) =>
      new DemandEventSourcingRepository(demandRoot).findTargetResultRecordedEvent(
        parseWakeflowDurableIdOfKind(imported.result.delivery.fence.claimId, "work-claim"),
      ),
    );
    equal(stored?.storedEvent.eventVersion, 2);

    await landFixtureTargetCompletion(fixture, fixture.route);
    const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId);
    const report = plain(inspection.reviewUnit.targetResult.report) as {
      readonly anchorResults?: readonly unknown[];
      readonly outsideInstructions?: readonly unknown[];
    };
    deepEqual(report.anchorResults, content.anchorResults);
    deepEqual(report.outsideInstructions, content.outsideInstructions);
  } finally {
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});
