import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { demandEventSourcingSnapshotRef } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { parseDemandEventCommitSequence } from "../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";
import { withFixtureDemandRoot } from "../../governance/delivery/delivery-workspace.fixture.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
  decideFixtureImplementation,
  inspectFixtureReview,
} from "../../governance/review/controller-implementation-review-decision-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { plain } from "./service.fixture.js";

useDisposableDurability();

/**
 * result-review 切片公开入口对快照缓存残留的容忍（Codex 审阅批 H S4，open-items W22），2 级（能力）
 * 测试：已发布 Demand 的 event-sourcing/snapshots 里留着一个死写者的合法原子暂存文件时，评审检查
 * （wakeflow_inspect_target_result_review 的服务入口）仍能加载——快照是可重建缓存，不是权威树形；
 * 读路径不删残留，随后的一次决定写入经写前回收把它清掉并发布新的检查点。建在
 * controller-implementation-review-decision-service 夹具上。
 */

test("已发布 Demand 的快照目录留着死写者的合法原子暂存时，评审检查仍能加载；随后的一次决定写入回收残留并发布新快照", async () => {
  const fixture = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const residue = await withFixtureDemandRoot(fixture, async (root) => {
      const loaded = await new DemandEventSourcingRepository(root).load();
      ok(loaded);
      const nextSequence = parseDemandEventCommitSequence(loaded.aggregate.commitSequence + 1);
      const nextSnapshotRef = demandEventSourcingSnapshotRef(nextSequence);
      const address = issueDurableAtomicFileStageAddress(
        "create",
        nextSnapshotRef,
        `sha256:${"0".repeat(64)}`,
        0o600,
      );
      const snapshotsDirectory = path.join(root.absolutePath, "event-sourcing", "snapshots");
      const stagePath = path.join(snapshotsDirectory, address.fileName);
      writeFileSync(stagePath, "{}", { mode: 0o600 });
      // 写者"死了"：本进程不再持有这个暂存地址，残留只能等下一次同目标写入回收。
      releaseDurableAtomicFileStageAddress(address);
      return Object.freeze({
        stagePath,
        nextSnapshotPath: path.join(root.absolutePath, ...nextSnapshotRef.split("/")),
      });
    });

    const inspection = await inspectFixtureReview(fixture, fixture.targetTaskId);
    equal(inspection.reviewUnit.status, fixture.inspection.reviewUnit.status);
    deepEqual(
      plain(inspection.reviewUnit.allowedDecisions),
      plain(fixture.inspection.reviewUnit.allowedDecisions),
    );
    // 读路径不替缓存做清理。
    equal(existsSync(residue.stagePath), true);

    const accepted = await decideFixtureImplementation(fixture);
    equal(accepted.status, "committed");
    equal(existsSync(residue.stagePath), false);
    equal(existsSync(residue.nextSnapshotPath), true);
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});
