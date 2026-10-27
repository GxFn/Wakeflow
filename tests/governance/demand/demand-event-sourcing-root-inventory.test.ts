import { equal, notEqual, rejects } from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { threadId } from "node:worker_threads";

import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { demandEventSourcingSnapshotRef } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import {
  DemandEventSourcingRootInventoryError,
  type DemandEventSourcingRootInventoryErrorReason,
  inspectDemandEventSourcingRootInventory,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import { parseDemandEventCommitSequence } from "../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { disposableRoot } from "../../support/temp-root.js";

useDisposableDurability();

/**
 * Governance / Demand Event Sourcing 根目录的排他资源清单，1 级（组件）测试：允许项与未知项的封闭
 * 证明、投影与候选目录的树形规则，以及快照目录里 foundation 原子暂存残留按写者状态的分类
 * （§13.161 B3-2 的同一规则；Codex 审阅批 H S4，open-items W22）。
 */

/** 一个空的健康 Demand root：事件溯源子树、身份与权威文件、空的 artifacts/task-packages 与 transactions。 */
async function prepareHealthyRoot(root: RootedDirectory, fixtureRoot: string): Promise<void> {
  await new DemandFileEventStore(root).initialize();
  writeFileSync(path.join(fixtureRoot, "identity.json"), "{}\n", { mode: 0o600 });
  writeFileSync(path.join(fixtureRoot, "authority.json"), "{}\n", { mode: 0o600 });
  mkdirSync(path.join(fixtureRoot, "artifacts"), { mode: 0o700 });
  mkdirSync(path.join(fixtureRoot, "artifacts", "task-packages"), { mode: 0o700 });
  mkdirSync(path.join(fixtureRoot, "transactions"), { mode: 0o700 });
}

function failsWith(reason: DemandEventSourcingRootInventoryErrorReason) {
  return (error: unknown) =>
    error instanceof DemandEventSourcingRootInventoryError && error.reason === reason;
}

test("Demand Event Sourcing root inventory 同时证明允许项与未知项不存在", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-root-inventory-"));
  chmodSync(fixtureRoot, 0o700);
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    await prepareHealthyRoot(root, fixtureRoot);

    const inventory = await inspectDemandEventSourcingRootInventory(root);
    equal(inventory.commitCount, 0);
    equal(inventory.snapshotCount, 0);
    equal(inventory.artifactCount, 0);
    await rejects(
      inspectDemandEventSourcingRootInventory(root, {
        phase: "publication" as never,
      }),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootInventoryError && error.reason === "input",
    );

    const projectionPath = path.join(
      fixtureRoot,
      "artifacts",
      "task-packages",
      "task-package_11111111-1111-4111-8111-111111111111.json",
    );
    writeFileSync(projectionPath, "{}\n", { mode: 0o600 });
    equal((await inspectDemandEventSourcingRootInventory(root)).artifactCount, 1);
    rmSync(projectionPath);

    // 测试卡目录已随测试合同并入任务包而退役：再出现即树形不合法。
    mkdirSync(path.join(fixtureRoot, "artifacts", "test-cards"), {
      mode: 0o700,
    });
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootInventoryError && error.reason === "tree-shape",
    );
    rmSync(path.join(fixtureRoot, "artifacts", "test-cards"), { recursive: true });

    const invalidProjectionPath = path.join(
      fixtureRoot,
      "artifacts",
      "task-packages",
      "foreign.json",
    );
    writeFileSync(invalidProjectionPath, "{}\n", { mode: 0o600 });
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootInventoryError && error.reason === "tree-shape",
    );
    rmSync(invalidProjectionPath);

    const unknownArtifactRoot = path.join(fixtureRoot, "artifacts", "foreign");
    mkdirSync(unknownArtifactRoot, { mode: 0o700 });
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootInventoryError && error.reason === "tree-shape",
    );
    rmSync(unknownArtifactRoot, { recursive: true });

    writeFileSync(path.join(fixtureRoot, "unknown.txt"), "not-owned\n", {
      mode: 0o600,
    });
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootInventoryError && error.reason === "tree-shape",
    );
    rmSync(path.join(fixtureRoot, "unknown.txt"));
    writeFileSync(
      path.join(fixtureRoot, "event-sourcing", "append-candidates", "residue.json"),
      "residue\n",
      { mode: 0o600 },
    );
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootInventoryError && error.reason === "tree-shape",
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("快照目录里 foundation 的原子暂存按写者分类：活写者 source-changed、死写者容忍且不计数不删除、所有者未知或名字畸形仍是 tree-shape（S4，open-items W22）", async (t) => {
  const fixtureRoot = disposableRoot(t, "wakeflow-demand-root-inventory-stage-");
  chmodSync(fixtureRoot, 0o700);
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    await prepareHealthyRoot(root, fixtureRoot);
    const snapshotsDirectory = path.join(fixtureRoot, "event-sourcing", "snapshots");
    const address = issueDurableAtomicFileStageAddress(
      "create",
      demandEventSourcingSnapshotRef(parseDemandEventCommitSequence(1)),
      `sha256:${"0".repeat(64)}`,
      0o600,
    );
    const stagePath = path.join(snapshotsDirectory, address.fileName);
    writeFileSync(stagePath, "{}", { mode: 0o600 });
    // 本进程还持有这个暂存地址：一次检查点正在落盘，清单让调用方稍后重来。
    await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("source-changed"));
    releaseDurableAtomicFileStageAddress(address);
    // 写者死了：残留被容忍，不计入快照数，也不被清单删除。
    const tolerated = await inspectDemandEventSourcingRootInventory(root);
    equal(tolerated.snapshotCount, 0);
    equal(existsSync(stagePath), true);
    // 同进程另一线程签发的暂存：所有者未知，仍按未知资源拒绝。
    const unknownOwnerName = address.fileName.replace(
      `__${process.pid}-${threadId}-`,
      `__${process.pid}-${threadId + 1}-`,
    );
    notEqual(unknownOwnerName, address.fileName);
    const unknownOwnerPath = path.join(snapshotsDirectory, unknownOwnerName);
    writeFileSync(unknownOwnerPath, "{}", { mode: 0o600 });
    await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("tree-shape"));
    rmSync(unknownOwnerPath);
    // 带暂存前缀却不是本协议暂存文件的名字：树形错误。
    const malformedPath = path.join(snapshotsDirectory, ".wakeflow-atomic-residue.tmp");
    writeFileSync(malformedPath, "{}", { mode: 0o600 });
    await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("tree-shape"));
    rmSync(malformedPath);
    // 容忍不放松节点策略：死写者残留的权限位不对仍是 node-policy。
    chmodSync(stagePath, 0o644);
    await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("node-policy"));
  } finally {
    await root.close();
  }
});
