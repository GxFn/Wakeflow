import { equal } from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { createWakeflowDurableId } from "../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../src/foundation/time/utc-instant.js";
import {
  createWorkClaim,
  inspectWorkClaim,
  MAXIMUM_WORK_CLAIM_GENERATION,
  releaseWorkClaimIfHeld,
  takeWorkClaim,
  type WorkClaim,
} from "../../src/kernel/work-claims.js";
import { createWakeflowWindowHostBindingId } from "../../src/workspace/window-runtime/wakeflow-window-host-binding-id.js";

async function fixture(t: TestContext): Promise<RootedDirectory> {
  const absolutePath = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-claims-")));
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return root;
}

function claimFor(windowId: WorkClaim["windowId"], generation: number): Readonly<WorkClaim> {
  return createWorkClaim({
    claimId: createWakeflowDurableId("work-claim"),
    hostId: "codex",
    windowId,
    bindingId: createWakeflowWindowHostBindingId(),
    holder: {
      demandId: createWakeflowDurableId("demand"),
      targetTaskId: createWakeflowDurableId("target-task"),
      deliveryId: createWakeflowDurableId("target-delivery"),
      generation,
    },
    claimedAt: parseUtcInstant("2026-09-11T08:00:00.000Z"),
  });
}

test("条件释放：只释放仍属于本围栏的声明，缺失与易主都不是错误", async (t) => {
  const root = await fixture(t);
  const windowId = createWakeflowDurableId("window");
  const claim = claimFor(windowId, 1);
  equal((await takeWorkClaim(root, claim)).disposition, "created");

  // 围栏不匹配（另一份声明的标识与摘要）：窗口仍被原声明占着，什么都不动。
  const foreign = claimFor(windowId, 2);
  const fence = { claimId: foreign.claimId, claimDigest: foreign.claimDigest };
  equal((await releaseWorkClaimIfHeld(root, windowId, fence)).disposition, "foreign");
  // 标识相同但摘要不同同样视为易主。
  const stale = { claimId: claim.claimId, claimDigest: foreign.claimDigest };
  equal((await releaseWorkClaimIfHeld(root, windowId, stale)).disposition, "foreign");
  equal((await inspectWorkClaim(root, windowId)).claim?.claimDigest, claim.claimDigest);

  const held = { claimId: claim.claimId, claimDigest: claim.claimDigest };
  equal((await releaseWorkClaimIfHeld(root, windowId, held)).disposition, "released");
  equal((await inspectWorkClaim(root, windowId)).status, "absent");
  // 重复释放（追加已提交、释放曾中断的重放路径）：缺失即已完成。
  equal((await releaseWorkClaimIfHeld(root, windowId, held)).disposition, "absent");
});

test("条件释放：声明已被别处释放并换成新声明后，旧围栏报告易主且不动新声明", async (t) => {
  const root = await fixture(t);
  const windowId = createWakeflowDurableId("window");
  const claim = claimFor(windowId, 1);
  equal((await takeWorkClaim(root, claim)).disposition, "created");
  const held = { claimId: claim.claimId, claimDigest: claim.claimDigest };
  // 另一路径先释放并接管窗口，本路径的清理随后才执行。
  equal((await releaseWorkClaimIfHeld(root, windowId, held)).disposition, "released");
  const successor = claimFor(windowId, 2);
  equal((await takeWorkClaim(root, successor)).disposition, "created");
  equal((await releaseWorkClaimIfHeld(root, windowId, held)).disposition, "foreign");
  equal((await inspectWorkClaim(root, windowId)).claim?.claimDigest, successor.claimDigest);
});

test("声明代际上限是内核常量，投递 rearm 上限由它派生", async () => {
  equal(MAXIMUM_WORK_CLAIM_GENERATION, 4);
  const { DELIVERY_REARM_LIMIT } = await import("../../src/governance/delivery/delivery-rearm.js");
  equal(DELIVERY_REARM_LIMIT, MAXIMUM_WORK_CLAIM_GENERATION - 1);
});
