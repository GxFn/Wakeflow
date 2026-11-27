import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, linkSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executeDemandCreationRequest } from "../../../src/capabilities/demand/service.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedResourceParentHandle } from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import {
  demandFinalRootRef,
  demandPublicationStageRef,
} from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { requirementClaimStateRef } from "../../../src/kernel/layout.js";
import {
  cleanupDemandEventSourcingPublicationWorkspaceFixture,
  createDemandEventSourcingPublicationWorkspaceFixture,
  demandEventSourcingPublicationAuthoredDemand,
} from "../../governance/demand/demand-event-sourcing-publication-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 2 级（能力）：创建 Demand 被打断之后留在发布暂存树里的原子暂存残留，以及沿用已经改名生效的根
 * （1.4.1 段 1b，清单第 3 项第 2 行与第 4 项第 6 行）。
 *
 * 暂存树里的每份文件都经原子写入建成；进程死在 `link(暂存, 目标)` 与 `unlink(暂存)` 之间，留下暂存与目标
 * 共用一个节点的一对。以前这样的一对让同一个创建请求从此一直以冲突被拒绝（标记读不出，或身份、权威
 * 文件不被认）。这里对每种形状钉住两条出口都走得通：同一个请求原样重发，以及 create 的 recover；做完
 * 之后 Demand 根里不留暂存文件。另一条钉住顺序：根已经改名到最终位置、而那次改名的同步丢了的时候，
 * recover 先同步 `stages/` 与 `current/`，再认领需求包、删发布标记。
 */

const STAGE_PREFIX = ".wakeflow-atomic-";

type Fixture = Awaited<ReturnType<typeof createDemandEventSourcingPublicationWorkspaceFixture>>;

interface CreationCase {
  readonly fixture: Fixture;
  readonly workspace: string;
  readonly request: Readonly<{
    root: string;
    requirementId: string;
    demand: ReturnType<typeof demandEventSourcingPublicationAuthoredDemand>;
  }>;
  readonly demandId: string;
  readonly planDigest: string;
}

async function creationCase(t: TestContext): Promise<CreationCase> {
  const fixture = await createDemandEventSourcingPublicationWorkspaceFixture();
  t.after(() => cleanupDemandEventSourcingPublicationWorkspaceFixture(fixture));
  const request = {
    root: fixture.workspacePath,
    requirementId: fixture.requirementId,
    demand: demandEventSourcingPublicationAuthoredDemand(),
  };
  const preview = await executeDemandCreationRequest({ ...request, mode: "preview" });
  if (
    preview.kind !== "WakeflowDemandCreationPreview" ||
    preview.planDigest === null ||
    preview.demandId === null
  ) {
    throw new Error("Expected a ready creation preview.");
  }
  return {
    fixture,
    workspace: realpathSync(fixture.workspacePath),
    request,
    demandId: preview.demandId,
    planDigest: preview.planDigest,
  };
}

function apply(scenario: CreationCase) {
  return executeDemandCreationRequest({
    ...scenario.request,
    mode: "apply",
    planDigest: scenario.planDigest,
  });
}

function recover(scenario: CreationCase) {
  return executeDemandCreationRequest({
    root: scenario.request.root,
    mode: "recover",
    operationId: scenario.demandId,
  });
}

function stageRoot(scenario: CreationCase, ...segments: string[]): string {
  return path.join(
    scenario.workspace,
    ...demandPublicationStageRef(scenario.demandId).split("/"),
    ...segments,
  );
}

function finalRoot(scenario: CreationCase, ...segments: string[]): string {
  return path.join(
    scenario.workspace,
    ...demandFinalRootRef(scenario.demandId).split("/"),
    ...segments,
  );
}

function stageNamesUnder(directory: string): readonly string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" }).filter((name) =>
    path.basename(name).startsWith(STAGE_PREFIX),
  );
}

/**
 * 让 `directory` 里原子暂存文件的 unlink 失败（先放过 `skip` 次）：写者做完 link 之后收不掉暂存，留下
 * 一对；它随后释放暂存地址，所以这一对读起来就是死写者留下的。返回恢复正常的函数。
 */
function failStageUnlinks(t: TestContext, directory: string, skip = 0): () => void {
  let remaining = skip;
  let armed = true;
  const original = filesystemMutation.unlink;
  const mocked = t.mock.method(filesystemMutation, "unlink", async (target: string) => {
    const stage =
      armed && path.dirname(target) === directory && path.basename(target).startsWith(STAGE_PREFIX);
    if (stage) {
      if (remaining === 0)
        throw Object.assign(new Error("injected unlink failure"), { code: "EIO" });
      remaining -= 1;
    }
    return original.call(filesystemMutation, target);
  });
  return () => {
    armed = false;
    mocked.mock.restore();
  };
}

/** 让暂存根改名到最终位置这一步失败：暂存树已经建完，停在改名之前。 */
function failFinalRename(t: TestContext, scenario: CreationCase): () => void {
  const original = filesystemMutation.rename;
  const mocked = t.mock.method(filesystemMutation, "rename", async (from: string, to: string) => {
    if (to === finalRoot(scenario)) {
      throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
    }
    return original.call(filesystemMutation, from, to);
  });
  return () => mocked.mock.restore();
}

/** 在建完的暂存树的索引目录里手摆一个死写者的暂存；`paired` 时再链接成那个索引文件。 */
function plantIndexStage(scenario: CreationCase, paired: boolean): void {
  const targetRef = "event-sourcing/index/0000000000000009.json";
  const bytes = Buffer.from("{trunc");
  const address = issueDurableAtomicFileStageAddress(
    "create",
    parsePortableResourcePath(targetRef),
    computeSha256Digest(bytes),
    0o600,
  );
  releaseDurableAtomicFileStageAddress(address);
  const stage = stageRoot(scenario, "event-sourcing", "index", address.fileName);
  writeFileSync(stage, bytes, { mode: 0o600 });
  if (paired) linkSync(stage, stageRoot(scenario, targetRef));
}

const SHAPES: readonly Readonly<{
  name: string;
  /** 造出这种残留，创建失败；返回恢复正常的函数。 */
  interrupt: (t: TestContext, scenario: CreationCase) => () => void;
  /** 创建失败之后再做的手脚。 */
  plant?: (scenario: CreationCase) => void;
  /** 残留所在的目录（相对暂存根）里此刻应当有暂存文件。 */
  directory: readonly string[];
}>[] = [
  {
    name: "发布标记成对",
    interrupt: (t, scenario) => failStageUnlinks(t, stageRoot(scenario, "transactions")),
    directory: ["transactions"],
  },
  {
    name: "身份文件成对",
    interrupt: (t, scenario) => failStageUnlinks(t, stageRoot(scenario)),
    directory: [],
  },
  {
    name: "权威文件成对",
    interrupt: (t, scenario) => failStageUnlinks(t, stageRoot(scenario), 1),
    directory: [],
  },
  {
    name: "索引目录里的单个暂存",
    interrupt: failFinalRename,
    plant: (scenario) => plantIndexStage(scenario, false),
    directory: ["event-sourcing", "index"],
  },
  {
    name: "索引文件成对",
    interrupt: failFinalRename,
    plant: (scenario) => plantIndexStage(scenario, true),
    directory: ["event-sourcing", "index"],
  },
];

for (const shape of SHAPES) {
  for (const exit of ["同一个请求重发", "recover"] as const) {
    test(`暂存树里留着${shape.name}：${exit}完成创建，Demand 根里不留暂存文件`, async (t) => {
      const scenario = await creationCase(t);
      const restore = shape.interrupt(t, scenario);
      await rejects(apply(scenario), (error: unknown) => error instanceof WakeflowError);
      restore();
      shape.plant?.(scenario);
      equal(existsSync(finalRoot(scenario)), false, "根还没有改名生效");
      ok(
        readdirSync(stageRoot(scenario, ...shape.directory)).some((name) =>
          name.startsWith(STAGE_PREFIX),
        ),
        "残留应当在暂存树里",
      );

      const result = await (exit === "recover" ? recover(scenario) : apply(scenario));
      if (result.kind !== "WakeflowDemandCreationMutation") throw new Error("Expected a mutation.");
      equal(existsSync(stageRoot(scenario)), false);
      deepEqual(stageNamesUnder(finalRoot(scenario)), []);
      equal(existsSync(finalRoot(scenario, "transactions", "publication.json")), false);
    });
  }
}

test("根已改名生效而那次改名的同步丢了：recover 先同步 stages 与 current，再认领需求包、删发布标记", async (t) => {
  const scenario = await creationCase(t);
  const relative = (absolute: string) =>
    path.relative(scenario.workspace, absolute).split(path.sep).join("/");
  const stages = path.posix.dirname(demandPublicationStageRef(scenario.demandId));
  const current = path.posix.dirname(demandFinalRootRef(scenario.demandId));
  const claimState = requirementClaimStateRef(scenario.fixture.requirementId);
  const marker = `${demandFinalRootRef(scenario.demandId)}/transactions/publication.json`;
  const events: string[] = [];
  let loseNextStagesSync = false;
  const originalRename = filesystemMutation.rename;
  t.mock.method(filesystemMutation, "rename", async (from: string, to: string) => {
    await originalRename.call(filesystemMutation, from, to);
    events.push(`rename -> ${relative(to)}`);
    if (to === finalRoot(scenario)) loseNextStagesSync = true;
  });
  const originalUnlink = filesystemMutation.unlink;
  t.mock.method(filesystemMutation, "unlink", async (target: string) => {
    await originalUnlink.call(filesystemMutation, target);
    events.push(`unlink ${relative(target)}`);
  });
  const originalSync = RootedResourceParentHandle.prototype.sync;
  t.mock.method(
    RootedResourceParentHandle.prototype,
    "sync",
    async function observedSync(this: RootedResourceParentHandle) {
      const directory = relative(path.dirname(this.resourceAbsolutePath));
      if (loseNextStagesSync && directory === stages) {
        loseNextStagesSync = false;
        events.push(`sync-lost ${directory}`);
        throw Object.assign(new Error("injected parent sync loss"), { code: "EIO" });
      }
      events.push(`sync ${directory}`);
      return originalSync.call(this);
    },
  );

  await rejects(apply(scenario), (error: unknown) => error instanceof WakeflowError);
  ok(events.includes(`sync-lost ${stages}`), events.join(" | "));
  equal(existsSync(finalRoot(scenario)), true, "根已经在最终位置");

  const start = events.length;
  const recovered = await recover(scenario);
  if (recovered.kind !== "WakeflowDemandCreationMutation") throw new Error("Expected a mutation.");
  const after = events.slice(start);
  const settledStages = after.indexOf(`sync ${stages}`);
  const settledCurrent = after.indexOf(`sync ${current}`, settledStages + 1);
  const claimed = after.indexOf(`rename -> ${claimState}`);
  const retired = after.indexOf(`unlink ${marker}`);
  ok(settledStages >= 0, `recover 没有同步 stages：${after.join(" | ")}`);
  ok(settledCurrent > settledStages, `recover 没有在其后同步 current：${after.join(" | ")}`);
  ok(claimed > settledCurrent, `认领不在两次同步之后：${after.join(" | ")}`);
  ok(retired > claimed, `删标记不在认领之后：${after.join(" | ")}`);
});
