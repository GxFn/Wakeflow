import { equal, ok, rejects } from "node:assert/strict";
import { type TestContext, test } from "node:test";

import type { PrepareDeliveryResult } from "../../../src/capabilities/delivery/contract.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { deriveDurableId } from "../../../src/kernel/ids.js";
import {
  createWorkClaim,
  deriveWorkClaimId,
  inspectWorkClaim,
  releaseWorkClaim,
  takeWorkClaim,
  type WorkClaim,
} from "../../../src/kernel/work-claims.js";
import {
  cleanupDeliveryWorkspaceFixture,
  createDeliveryWorkspaceFixture,
  type DeliveryWorkspaceFixture,
  prepareFixtureDelivery,
  withFixtureDemandRoot,
} from "../../governance/delivery/delivery-workspace.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * prepare_delivery 的并发声明回收（第 2 级，能力；能力卡 6 §6.1，open-items W13 / CR-R-ROOT-03）：
 * 孤儿判定来自上下文加载时的聚合快照，持有者可能是一次已取声明、尚未追加的并发 prepare，所以回收
 * 只能在本次追加以流修订 CAS 提交之后执行。三组用例都钩住仓储的 appendPreparedCommit 入口做确定性
 * 交错：两种先后顺序下窗口声明都属于提交了事件的一方，败方被拒为 concurrency-conflict/stream-revision
 * 且不碰赢方的声明；死孤儿在追加边界上仍在盘上、提交之后才被换成本次声明，持有者先行回滚的
 * claim-absent 被容忍。同键重放不取声明，围栏来自签发事件。
 */

const SECOND_PREPARED_AT = parseUtcInstant("2026-08-29T12:05:10.000Z");
const REPLAYED_AT = parseUtcInstant("2026-08-29T12:09:00.000Z");

/**
 * 在仓储的 appendPreparedCommit 入口按到达顺序设栅：前 `count` 次到达先通知再等放行，之后的调用直接
 * 通过。追加之前的加载、判定与取声明都已完成，所以栅上就是"决定已做、CAS 未做"的那一刻。
 */
function gateAppends(t: TestContext, count: number) {
  const arrived = Array.from({ length: count }, () => Promise.withResolvers<void>());
  const released = Array.from({ length: count }, () => Promise.withResolvers<void>());
  let calls = 0;
  const original = DemandEventSourcingRepository.prototype.appendPreparedCommit;
  t.mock.method(
    DemandEventSourcingRepository.prototype,
    "appendPreparedCommit",
    async function (this: DemandEventSourcingRepository, ...args: Parameters<typeof original>) {
      const ordinal = calls;
      calls += 1;
      arrived[ordinal]?.resolve();
      await released[ordinal]?.promise;
      return original.apply(this, args);
    },
  );
  return Object.freeze({
    arrivedAt: (ordinal: number): Promise<void> => arrived[ordinal]?.promise ?? Promise.resolve(),
    release: (ordinal: number): void => released[ordinal]?.resolve(),
    releaseAll: (): void => {
      for (const gate of released) gate.resolve();
    },
  });
}

/** 等命令到达追加栅；命令没到栅就结束算测试失败，它的拒绝原样上抛。 */
async function untilBarrier(
  barrier: Promise<void>,
  command: Promise<unknown>,
  label: string,
): Promise<void> {
  await Promise.race([
    barrier,
    command.then(() => {
      throw new Error(`${label} finished without reaching the append barrier.`);
    }),
  ]);
}

async function windowClaim(
  fixture: Readonly<DeliveryWorkspaceFixture>,
): Promise<Readonly<WorkClaim> | null> {
  return (await inspectWorkClaim(fixture.workspaceRoot, fixture.route.windowId)).claim;
}

/** 与切片同一派生：投递标识由 Demand 与 prepare 的幂等键决定。 */
function deliveryIdFor(fixture: Readonly<DeliveryWorkspaceFixture>, idempotencyKey: string) {
  return deriveDurableId("target-delivery", "prepare-delivery", fixture.demandId, idempotencyKey);
}

function rejectedWith(reason: string, code: string) {
  return (error: unknown) =>
    isWakeflowError(error) && error.code === code && error.reason === reason;
}

/** 签发了许可的一方必须持有窗口声明，且声明与许可围栏一致：没有"有许可、无声明"的窗口。 */
function assertClaimMatchesPermit(
  claim: Readonly<WorkClaim> | null,
  committed: Readonly<PrepareDeliveryResult>,
): void {
  ok(claim !== null, "the committed permit must hold the window claim");
  equal(claim.claimId, committed.permit.fence.claimId);
  equal(claim.claimDigest, committed.permit.fence.claimDigest);
  equal(claim.holder.deliveryId, committed.delivery.deliveryId);
  equal(claim.holder.generation, 1);
}

async function assertOnlyEnvelopeOf(
  fixture: Readonly<DeliveryWorkspaceFixture>,
  committedDeliveryId: string,
  loserDeliveryId: string,
): Promise<void> {
  await withFixtureDemandRoot(fixture, async (root) => {
    const repository = new DemandEventSourcingRepository(root);
    ok((await repository.findDeliveryPreparedEvent(committedDeliveryId)) !== null);
    equal(await repository.findDeliveryPreparedEvent(loserDeliveryId), null);
  });
}

test("B 用旧聚合把在途的 A 当孤儿并先提交：A 撞 stream-revision 只回滚自己，窗口声明属于 B", {
  timeout: 60_000,
}, async (t) => {
  const fixture = await createDeliveryWorkspaceFixture();
  const gate = gateAppends(t, 1);
  let first: Promise<PrepareDeliveryResult> | undefined;
  try {
    first = prepareFixtureDelivery(fixture, { idempotencyKey: "race-a" });
    await untilBarrier(gate.arrivedAt(0), first, "A");
    // A 已取得声明、尚未追加：窗口声明是 A 的，聚合里还没有 A 的投递。
    equal((await windowClaim(fixture))?.holder.deliveryId, deliveryIdFor(fixture, "race-a"));

    const second = await prepareFixtureDelivery(
      fixture,
      { idempotencyKey: "race-b" },
      { clock: () => SECOND_PREPARED_AT },
    );
    equal(second.status, "committed");
    equal(second.event.streamRevision, 3);
    // B 提交之后才回收 A 的声明并写入自己的：A 恢复之前窗口声明已经属于 B。
    assertClaimMatchesPermit(await windowClaim(fixture), second);

    gate.release(0);
    await rejects(first, rejectedWith("stream-revision", "concurrency-conflict"));
    // A 的回滚是精确释放，碰不到 B 的声明。
    assertClaimMatchesPermit(await windowClaim(fixture), second);
    await assertOnlyEnvelopeOf(
      fixture,
      second.delivery.deliveryId,
      deliveryIdFor(fixture, "race-a"),
    );

    // A 换修订重试被目标阶段挡住；B 的同键重放是幂等回执、围栏不变，也不碰声明。
    await rejects(
      prepareFixtureDelivery(fixture, { idempotencyKey: "race-a", expectedStreamRevision: 3 }),
      rejectedWith("target-phase", "precondition-failed"),
    );
    const replayed = await prepareFixtureDelivery(
      fixture,
      { idempotencyKey: "race-b" },
      { clock: () => REPLAYED_AT },
    );
    equal(replayed.status, "idempotent");
    equal(replayed.permit.fence.claimDigest, second.permit.fence.claimDigest);
    assertClaimMatchesPermit(await windowClaim(fixture), second);
  } finally {
    gate.releaseAll();
    await first?.catch(() => undefined);
    t.mock.restoreAll();
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

test("A 先提交、把 A 当孤儿的 B 撞 stream-revision：B 什么都不释放，窗口声明仍属于 A", {
  timeout: 60_000,
}, async (t) => {
  const fixture = await createDeliveryWorkspaceFixture();
  const gate = gateAppends(t, 2);
  let first: Promise<PrepareDeliveryResult> | undefined;
  let second: Promise<PrepareDeliveryResult> | undefined;
  try {
    first = prepareFixtureDelivery(fixture, { idempotencyKey: "race-a" });
    await untilBarrier(gate.arrivedAt(0), first, "A");
    second = prepareFixtureDelivery(
      fixture,
      { idempotencyKey: "race-b" },
      { clock: () => SECOND_PREPARED_AT },
    );
    await untilBarrier(gate.arrivedAt(1), second, "B");
    // B 已把 A 的声明判为孤儿并走到追加边界：回收延后到提交之后，所以 A 的声明必须还在盘上。
    equal((await windowClaim(fixture))?.holder.deliveryId, deliveryIdFor(fixture, "race-a"));

    gate.release(0);
    const committed = await first;
    equal(committed.status, "committed");
    equal(committed.event.streamRevision, 3);
    assertClaimMatchesPermit(await windowClaim(fixture), committed);

    gate.release(1);
    await rejects(second, rejectedWith("stream-revision", "concurrency-conflict"));
    // 败方没有创建过声明，也不得释放赢方的：窗口声明与 A 的许可围栏一致。
    assertClaimMatchesPermit(await windowClaim(fixture), committed);
    await assertOnlyEnvelopeOf(
      fixture,
      committed.delivery.deliveryId,
      deliveryIdFor(fixture, "race-b"),
    );

    // B 换修订重试被目标阶段挡住；A 的同键重放是幂等回执、围栏不变，也不碰声明。
    await rejects(
      prepareFixtureDelivery(fixture, { idempotencyKey: "race-b", expectedStreamRevision: 3 }),
      rejectedWith("target-phase", "precondition-failed"),
    );
    const replayed = await prepareFixtureDelivery(
      fixture,
      { idempotencyKey: "race-a" },
      { clock: () => REPLAYED_AT },
    );
    equal(replayed.status, "idempotent");
    equal(replayed.permit.fence.claimDigest, committed.permit.fence.claimDigest);
    assertClaimMatchesPermit(await windowClaim(fixture), committed);
  } finally {
    gate.releaseAll();
    await first?.catch(() => undefined);
    await second?.catch(() => undefined);
    t.mock.restoreAll();
    await cleanupDeliveryWorkspaceFixture(fixture);
  }
});

for (const variant of ["still-held", "released-meanwhile"] as const) {
  test(`同目标的死孤儿声明（${variant}）：追加边界上原样保留，提交之后精确回收并换成本次声明`, {
    timeout: 60_000,
  }, async (t) => {
    const fixture = await createDeliveryWorkspaceFixture();
    // 一次崩溃在追加之前的 prepare 留下的声明：同 Demand 同目标，deliveryId 不在聚合里。
    const orphan = createWorkClaim({
      claimId: deriveWorkClaimId("prepare-delivery", fixture.demandId, "crashed-prepare"),
      hostId: "codex",
      windowId: parseWakeflowDurableIdOfKind(fixture.route.windowId, "window"),
      bindingId: fixture.route.bindingId,
      holder: {
        demandId: parseWakeflowDurableIdOfKind(fixture.demandId, "demand"),
        targetTaskId: parseWakeflowDurableIdOfKind(fixture.targetTaskId, "target-task"),
        deliveryId: deliveryIdFor(fixture, "crashed-prepare"),
        generation: 1,
      },
      claimedAt: parseUtcInstant("2026-08-29T12:00:00.000Z"),
    });
    await takeWorkClaim(fixture.workspaceRoot, orphan);
    const gate = gateAppends(t, 1);
    let prepared: Promise<PrepareDeliveryResult> | undefined;
    try {
      prepared = prepareFixtureDelivery(fixture);
      await untilBarrier(gate.arrivedAt(0), prepared, "prepare");
      // 追加边界上孤儿仍在：回收不在判定时发生。
      equal((await windowClaim(fixture))?.claimDigest, orphan.claimDigest);
      if (variant === "released-meanwhile") {
        // 持有者在本次提交之前自己回滚了：提交后的精确释放遇到 claim-absent 不是错误。
        await releaseWorkClaim(fixture.workspaceRoot, orphan);
      }
      gate.release(0);
      const result = await prepared;
      equal(result.status, "committed");
      equal(result.event.streamRevision, 3);
      assertClaimMatchesPermit(await windowClaim(fixture), result);
      ok(result.permit.fence.claimDigest !== orphan.claimDigest);
    } finally {
      gate.releaseAll();
      await prepared?.catch(() => undefined);
      t.mock.restoreAll();
      await cleanupDeliveryWorkspaceFixture(fixture);
    }
  });
}
