import { equal, notEqual, rejects } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
 * （§13.161 B3-2 的同一规则；Codex 审阅批 H S4，open-items W22）。1.4.1 段 1b 起，`index/`、
 * `snapshots/` 与 `task-packages/` 三个目录用同一条规则：死掉的写者留下的单个暂存、以及与目标共用一个
 * 节点的暂存，都放行、不计数、不删除；认不出的形状逐种钉住仍然拒绝。
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

interface StageDirectoryCase {
  readonly name: string;
  readonly directory: readonly string[];
  readonly member: string;
  readonly otherMember: string;
  readonly count: (
    inventory: Awaited<ReturnType<typeof inspectDemandEventSourcingRootInventory>>,
  ) => number;
}

const STAGE_DIRECTORY_CASES: readonly StageDirectoryCase[] = [
  {
    name: "event-sourcing/index",
    directory: ["event-sourcing", "index"],
    member: "0000000000000001.json",
    otherMember: "0000000000000002.json",
    // 索引文件不计数；用快照数确认别的计数没有被牵连。
    count: (inventory) => inventory.snapshotCount,
  },
  {
    name: "event-sourcing/snapshots",
    directory: ["event-sourcing", "snapshots"],
    member: "0000000000000001.json",
    otherMember: "0000000000000002.json",
    count: (inventory) => inventory.snapshotCount,
  },
  {
    name: "artifacts/task-packages",
    directory: ["artifacts", "task-packages"],
    member: "task-package_11111111-1111-4111-8111-111111111111.json",
    otherMember: "task-package_22222222-2222-4222-8222-222222222222.json",
    count: (inventory) => inventory.artifactCount,
  },
];

for (const scenario of STAGE_DIRECTORY_CASES) {
  const memberRef = `${scenario.directory.join("/")}/${scenario.member}`;
  const otherRef = `${scenario.directory.join("/")}/${scenario.otherMember}`;
  const counted = scenario.name === "event-sourcing/index" ? 0 : 1;

  test(`${scenario.name}：死写者的单个暂存与成对的暂存都放行，不计数不删除；写者活着是 source-changed`, async (t) => {
    const fixtureRoot = disposableRoot(t, "wakeflow-demand-root-inventory-pair-");
    chmodSync(fixtureRoot, 0o700);
    const root = await RootedDirectory.open(fixtureRoot);
    try {
      await prepareHealthyRoot(root, fixtureRoot);
      const directory = path.join(fixtureRoot, ...scenario.directory);
      const single = issueDurableAtomicFileStageAddress(
        "create",
        otherRef,
        `sha256:${"1".repeat(64)}`,
        0o600,
      );
      writeFileSync(path.join(directory, single.fileName), "{}", { mode: 0o600 });
      const paired = issueDurableAtomicFileStageAddress(
        "create",
        memberRef,
        `sha256:${"2".repeat(64)}`,
        0o600,
      );
      writeFileSync(path.join(directory, paired.fileName), "{}", { mode: 0o600 });
      linkSync(path.join(directory, paired.fileName), path.join(directory, scenario.member));
      // 两个写者都还活着：一次写入正在落盘。
      await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("source-changed"));
      releaseDurableAtomicFileStageAddress(single);
      await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("source-changed"));
      releaseDurableAtomicFileStageAddress(paired);

      const tolerated = await inspectDemandEventSourcingRootInventory(root);
      equal(scenario.count(tolerated), counted, "残留不计数，成对的目标照常计数");
      equal(existsSync(path.join(directory, single.fileName)), true);
      equal(existsSync(path.join(directory, paired.fileName)), true);
      equal(existsSync(path.join(directory, scenario.member)), true);
    } finally {
      await root.close();
    }
  });

  test(`${scenario.name}：认不出的形状仍然拒绝——没有暂存的两链接成员、暂存指着别的目标、落单的两链接暂存、replace 暂存带两个链接、所有者未知、名字畸形`, async (t) => {
    const fixtureRoot = disposableRoot(t, "wakeflow-demand-root-inventory-shape-");
    chmodSync(fixtureRoot, 0o700);
    const outside = disposableRoot(t, "wakeflow-demand-root-inventory-outside-");
    const root = await RootedDirectory.open(fixtureRoot);
    try {
      await prepareHealthyRoot(root, fixtureRoot);
      const directory = path.join(fixtureRoot, ...scenario.directory);
      const memberPath = path.join(directory, scenario.member);
      const deadStage = (operation: "create" | "replace", ref: string) => {
        const address = issueDurableAtomicFileStageAddress(
          operation,
          ref,
          `sha256:${"3".repeat(64)}`,
          0o600,
        );
        releaseDurableAtomicFileStageAddress(address);
        return path.join(directory, address.fileName);
      };
      const reset = () => {
        rmSync(directory, { recursive: true });
        mkdirSync(directory, { mode: 0o700 });
      };

      // 两个链接的成员，另一个名字在根外面：没有暂存为它作证。
      writeFileSync(memberPath, "{}", { mode: 0o600 });
      linkSync(memberPath, path.join(outside, "elsewhere"));
      await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("node-policy"));
      rmSync(path.join(outside, "elsewhere"));
      await inspectDemandEventSourcingRootInventory(root);
      reset();

      // 暂存与成员共用一个节点，但暂存名里记的是另一条路径。
      const foreign = deadStage("create", otherRef);
      writeFileSync(foreign, "{}", { mode: 0o600 });
      linkSync(foreign, memberPath);
      await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("node-policy"));
      reset();

      // 暂存与成员共用一个节点、记的也是这条路径，但暂存名里的权限位与成员的不一样。
      const otherMode = issueDurableAtomicFileStageAddress(
        "create",
        memberRef,
        `sha256:${"3".repeat(64)}`,
        0o640,
      );
      releaseDurableAtomicFileStageAddress(otherMode);
      writeFileSync(path.join(directory, otherMode.fileName), "{}", { mode: 0o600 });
      linkSync(path.join(directory, otherMode.fileName), memberPath);
      await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("node-policy"));
      reset();

      // 两个链接的暂存，它的另一个名字不在这个目录里。
      const lone = deadStage("create", memberRef);
      writeFileSync(lone, "{}", { mode: 0o600 });
      linkSync(lone, path.join(outside, "elsewhere"));
      await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("node-policy"));
      rmSync(path.join(outside, "elsewhere"));
      reset();

      // replace 的暂存不会有两个链接。
      const replacing = deadStage("replace", memberRef);
      writeFileSync(replacing, "{}", { mode: 0o600 });
      linkSync(replacing, memberPath);
      await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("node-policy"));
      reset();

      // 同进程另一线程签发的暂存：所有者未知。
      const dead = deadStage("create", memberRef);
      const unknownOwner = dead.replace(
        `__${process.pid}-${threadId}-`,
        `__${process.pid}-${threadId + 1}-`,
      );
      notEqual(unknownOwner, dead);
      writeFileSync(unknownOwner, "{}", { mode: 0o600 });
      await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("tree-shape"));
      reset();

      writeFileSync(path.join(directory, ".wakeflow-atomic-residue.tmp"), "{}", { mode: 0o600 });
      await rejects(inspectDemandEventSourcingRootInventory(root), failsWith("tree-shape"));
    } finally {
      await root.close();
    }
  });
}
