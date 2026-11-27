import { deepEqual, equal } from "node:assert/strict";
import { linkSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  applyCompletion,
  applyContinuation,
  type LifecycleOrderCase,
  lifecycleOrderCase,
} from "./lifecycle-order.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：根的三个目录里留着死写者的原子暂存时，Demand 照常完成与续接，暂存不进归档（1.4.1 段 1b，
 * 清单第 3 项第 1 行）。
 *
 * 清点容忍这些残留之后，带着它们的根第一次能走到封档。`index/` 与 `snapshots/` 本来就整个不进负载；
 * `task-packages/` 是负载，所以钉住：暂存文件不在封好的归档里，续接放回的根里也没有它。
 */

const STAGE_PREFIX = ".wakeflow-atomic-";

/** 摆一个死写者的暂存；`paired` 时把同一个节点再链接成 `targetRef`。 */
function plantDeadStage(scenario: LifecycleOrderCase, targetRef: string, paired: boolean): void {
  const bytes = Buffer.from("{}\n");
  const address = issueDurableAtomicFileStageAddress(
    "create",
    parsePortableResourcePath(targetRef),
    computeSha256Digest(bytes),
    0o600,
  );
  releaseDurableAtomicFileStageAddress(address);
  const root = path.join(scenario.workspace, ...scenario.demandRoot.split("/"));
  const stage = path.join(root, path.dirname(targetRef), address.fileName);
  writeFileSync(stage, bytes, { mode: 0o600 });
  if (paired) linkSync(stage, path.join(root, targetRef));
}

/**
 * 把根里一份真实的任务包变成"写者死在 link 之后"的样子：给同一个节点再起一个死暂存的名字。返回任务包
 * 的文件名。手摆一份不属于这个 Demand 的任务包会让根的制品数对不上，所以用夹具里已经在的那一份。
 */
function pairExistingTaskPackage(scenario: LifecycleOrderCase): string {
  const directory = path.join(
    scenario.workspace,
    ...scenario.demandRoot.split("/"),
    "artifacts",
    "task-packages",
  );
  const name = readdirSync(directory).find(
    (entry) => entry.endsWith(".json") && !entry.startsWith(STAGE_PREFIX),
  );
  if (name === undefined) throw new Error("Expected a task package in the fixture.");
  const member = path.join(directory, name);
  const address = issueDurableAtomicFileStageAddress(
    "create",
    parsePortableResourcePath(`artifacts/task-packages/${name}`),
    computeSha256Digest(readFileSync(member)),
    statSync(member).mode & 0o777,
  );
  releaseDurableAtomicFileStageAddress(address);
  linkSync(member, path.join(directory, address.fileName));
  return name;
}

function stageNamesUnder(directory: string): readonly string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" }).filter((name) =>
    path.basename(name).startsWith(STAGE_PREFIX),
  );
}

test("三个目录里留着死暂存（含一份成对的真实任务包）：完成照常封档，归档里没有暂存文件；续接放回的根里也没有", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  plantDeadStage(scenario, "event-sourcing/index/0000000000000099.json", false);
  plantDeadStage(scenario, "event-sourcing/index/0000000000000098.json", true);
  plantDeadStage(scenario, "event-sourcing/snapshots/0000000000000098.json", true);
  plantDeadStage(
    scenario,
    "artifacts/task-packages/task-package_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json",
    false,
  );
  // 负载里成对的那一种：真实的任务包与它的死暂存共用一个节点。目标照常进归档，暂存不进。
  const pairedPackage = pairExistingTaskPackage(scenario);

  const completed = await applyCompletion(scenario);
  equal(completed.disposition, "completed");
  const archive = path.join(scenario.ledger, ...completed.archive.archiveRef.split("/"));
  deepEqual(stageNamesUnder(archive), []);
  equal(
    readdirSync(archive, { recursive: true, encoding: "utf8" }).some(
      (name) => path.basename(name) === pairedPackage,
    ),
    true,
    "成对的任务包应当在归档里",
  );

  const continued = await applyContinuation(scenario);
  equal(continued.disposition, "continued");
  const restored = path.join(scenario.workspace, ...scenario.demandRoot.split("/"));
  deepEqual(stageNamesUnder(restored), []);
  equal(
    statSync(path.join(restored, "artifacts", "task-packages", pairedPackage)).nlink,
    1,
    "放回的任务包只有一个名字",
  );
});
