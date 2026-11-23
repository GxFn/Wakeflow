import { deepEqual, equal, rejects } from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { threadId } from "node:worker_threads";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { demandEventAppendCandidateRef } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import { parseDemandEventCommitSequence } from "../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { demandLifecycleJournalRef } from "../../../src/kernel/layout.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planFixtureTargetTask,
} from "../../governance/tasking/target-task-planning-service.fixture.js";
import { startAppendCrashProcess } from "../../support/append-crash-process.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

async function preparePrivateModes(root: string) {
  const request = { root, mode: "preview", action: "reconcile", request: {} };
  const preview = await executeCodexWakeflowMaintenance(request);
  if (preview.mode !== "preview" || preview.planDigest === null)
    throw new Error("Expected fixture mode convergence.");
  await executeCodexWakeflowMaintenance({
    ...request,
    mode: "apply",
    planDigest: preview.planDigest,
  });
}

for (const point of ["candidate", "linked"] as const) {
  test(`真实 MCP 在 ${point} 落盘后死亡：只读预览、公开 reconcile 恢复、原请求幂等继续`, {
    timeout: 40_000,
  }, async () => {
    const fixture = await createTargetTaskPlanningWorkspaceFixture({ freshBaseline: true });
    await preparePrivateModes(fixture.workspacePath);
    const server = await startAppendCrashProcess(path.join(fixture.fixtureRoot, "barrier"), point);
    const demandPath = path.join(
      fixture.workspacePath,
      demandFinalRootRef(fixture.request.demandId),
    );
    const candidates = path.join(demandPath, "event-sourcing/append-candidates");
    const commits = path.join(demandPath, "event-sourcing/commits");
    try {
      const interrupted = rejects(
        server.client.callTool({
          name: "wakeflow_plan_target_task",
          arguments: {
            root: fixture.workspacePath,
            ...fixture.request,
            idempotencyKey: "crash-plan",
            expectedStreamRevision: 1,
          },
        }),
      );
      await server.paused();
      const candidateNames = readdirSync(candidates);
      const before = new Map(
        readdirSync(commits).map((name) => [name, readFileSync(path.join(commits, name))]),
      );
      const request = {
        root: fixture.workspacePath,
        mode: "preview",
        action: "reconcile",
        request: {},
      };
      const busy = await executeCodexWakeflowMaintenance(request);
      if (busy.mode !== "preview") throw new Error("Expected preview.");
      equal(busy.status, "blocked");
      equal(
        busy.blockerCodes.some((code) => code.startsWith("demand-candidates-busy:")),
        true,
      );
      deepEqual(readdirSync(candidates), candidateNames);
      server.crash();
      await interrupted;
      const preview = await executeCodexWakeflowMaintenance(request);
      if (preview.mode !== "preview" || preview.planDigest === null)
        throw new Error("Expected recovery preview.");
      equal(preview.status, "ready");
      deepEqual(readdirSync(candidates), candidateNames);
      equal(JSON.stringify(preview).includes(fixture.fixtureRoot), false);
      const recovered = await executeCodexWakeflowMaintenance({
        ...request,
        mode: "apply",
        planDigest: preview.planDigest,
      });
      equal(recovered.status, "completed");
      deepEqual(readdirSync(candidates), []);
      for (const [name, bytes] of before) deepEqual(readFileSync(path.join(commits, name)), bytes);
      const result = await planFixtureTargetTask(fixture, { idempotencyKey: "crash-plan" });
      equal(result.status, point === "linked" ? "idempotent" : "committed");
      equal(readdirSync(commits).length, 2);
    } finally {
      await server.close();
      await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
    }
  });
}

test("reconcile 不删除无法归属的候选条目", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture({ freshBaseline: true });
  await preparePrivateModes(fixture.workspacePath);
  const stray = path.join(
    fixture.workspacePath,
    demandFinalRootRef(fixture.request.demandId),
    "event-sourcing/append-candidates/unknown",
  );
  try {
    writeFileSync(stray, "preserve me\n", { mode: 0o600 });
    const result = await executeCodexWakeflowMaintenance({
      root: fixture.workspacePath,
      mode: "preview",
      action: "reconcile",
      request: {},
    });
    if (result.mode !== "preview") throw new Error("Expected preview.");
    equal(result.status, "blocked");
    equal(existsSync(stray), true);
    equal(readFileSync(stray, "utf8"), "preserve me\n");
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("reconcile 沿用身份合同的字节预算，恢复合法大身份下的半写候选", {
  timeout: 120_000,
}, async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture({
    identityText: "验".repeat(16_000),
  });
  await preparePrivateModes(fixture.workspacePath);
  const root = path.join(fixture.workspacePath, demandFinalRootRef(fixture.request.demandId));
  const candidate = path.join(
    root,
    demandEventAppendCandidateRef(
      parseDemandEventCommitSequence(2),
      parseWakeflowDurableIdOfKind(
        "demand-event-commit_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "demand-event-commit",
      ),
      `${process.pid}-${threadId}-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
    ),
  );
  try {
    equal(readFileSync(path.join(root, "identity.json")).length > 128 * 1024, true);
    writeFileSync(candidate, "{partial\n", { mode: 0o600 });
    const request = {
      root: fixture.workspacePath,
      mode: "preview",
      action: "reconcile",
      request: {},
    };
    const preview = await executeCodexWakeflowMaintenance(request);
    if (preview.mode !== "preview" || preview.planDigest === null)
      throw new Error("Expected recovery preview.");
    equal(preview.status, "ready");
    await executeCodexWakeflowMaintenance({
      ...request,
      mode: "apply",
      planDigest: preview.planDigest,
    });
    equal(existsSync(candidate), false);
    equal(readdirSync(path.join(root, "event-sourcing/commits")).length, 1);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

const RECONCILE_PREVIEW = { mode: "preview", action: "reconcile", request: {} } as const;

/** 在 Demand 根里摆一个暂存文件；`paired` 时再把它硬链接成那个目标（写者死在 link 之后）。 */
function plantStage(
  demandRoot: string,
  targetRef: string,
  bytes: Buffer,
  options: { readonly paired: boolean },
) {
  const address = issueDurableAtomicFileStageAddress(
    "create",
    targetRef,
    computeSha256Digest(bytes),
    0o600,
  );
  const stage = path.join(demandRoot, path.dirname(targetRef), address.fileName);
  writeFileSync(stage, bytes, { mode: 0o600 });
  const member = path.join(demandRoot, targetRef);
  if (options.paired) linkSync(stage, member);
  return { address, stage, member };
}

test("reconcile 清掉 index、snapshots 与 task-packages 里死写者留下的暂存：缓存成对的连目标一起丢，任务包成对的留下目标；写者活着时预览被挡住", {
  timeout: 60_000,
}, async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture({ freshBaseline: true });
  await preparePrivateModes(fixture.workspacePath);
  const demandId = fixture.request.demandId;
  const demandRoot = path.join(fixture.workspacePath, demandFinalRootRef(demandId));
  const request = { root: fixture.workspacePath, ...RECONCILE_PREVIEW };
  try {
    const garbage = Buffer.from("{trunc");
    const packageBytes = Buffer.from("{}\n");
    const planted = [
      plantStage(demandRoot, "event-sourcing/index/0000000000000009.json", garbage, {
        paired: false,
      }),
      plantStage(demandRoot, "event-sourcing/index/0000000000000008.json", garbage, {
        paired: true,
      }),
      plantStage(demandRoot, "event-sourcing/snapshots/0000000000000008.json", garbage, {
        paired: true,
      }),
      plantStage(
        demandRoot,
        "artifacts/task-packages/task-package_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json",
        packageBytes,
        { paired: false },
      ),
    ];
    const pairedPackage = plantStage(
      demandRoot,
      "artifacts/task-packages/task-package_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json",
      packageBytes,
      { paired: true },
    );

    // 写者（本进程签发的地址）都还活着：预览被挡住，什么都不删。
    const busy = await executeCodexWakeflowMaintenance(request);
    if (busy.mode !== "preview") throw new Error("Expected preview.");
    equal(busy.status, "blocked");
    deepEqual(busy.blockerCodes, [`demand-stage-residue-busy:${demandId}`]);
    for (const entry of [...planted, pairedPackage]) {
      releaseDurableAtomicFileStageAddress(entry.address);
    }

    const preview = await executeCodexWakeflowMaintenance(request);
    if (preview.mode !== "preview" || preview.planDigest === null)
      throw new Error("Expected recovery preview.");
    equal(preview.status, "ready");
    equal(JSON.stringify(preview.plan).includes('"stageResidueCount":5'), true);
    equal(JSON.stringify(preview).includes(fixture.fixtureRoot), false);
    for (const entry of [...planted, pairedPackage]) equal(existsSync(entry.stage), true);

    const applied = await executeCodexWakeflowMaintenance({
      ...request,
      mode: "apply",
      planDigest: preview.planDigest,
    });
    equal(applied.status, "completed");
    equal(JSON.stringify(applied).includes('"stageResidueRetiredCount":5'), true);
    for (const entry of [...planted, pairedPackage]) {
      equal(existsSync(entry.stage), false, entry.stage);
    }
    equal(existsSync(planted[1]?.member ?? ""), false, "成对的索引目标应一起丢掉");
    equal(existsSync(planted[2]?.member ?? ""), false, "成对的快照目标应一起丢掉");
    equal(statSync(pairedPackage.member).nlink, 1, "任务包的目标留下，只剩一个链接");
    deepEqual(readFileSync(pairedPackage.member), packageBytes);

    // 手摆的那个任务包不是这个 Demand 的，拿掉之后原来的请求照常继续。
    rmSync(pairedPackage.member);
    const settled = await executeCodexWakeflowMaintenance(request);
    if (settled.mode !== "preview") throw new Error("Expected preview.");
    equal(
      settled.blockerCodes.some((code) => code.startsWith("demand-")),
      false,
    );
    const result = await planFixtureTargetTask(fixture, { idempotencyKey: "after-residue" });
    equal(result.status, "committed");
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("reconcile 遇到没有候选目录的残根：生命周期日志在时跳过它（归那个事务的 recover），日志不在时照旧挡住", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture({ freshBaseline: true });
  await preparePrivateModes(fixture.workspacePath);
  const demandId = fixture.request.demandId;
  const demandRoot = path.join(fixture.workspacePath, demandFinalRootRef(demandId));
  const journal = path.join(fixture.workspacePath, demandLifecycleJournalRef(demandId));
  const request = { root: fixture.workspacePath, ...RECONCILE_PREVIEW };
  try {
    rmdirSync(path.join(demandRoot, "event-sourcing/append-candidates"));
    const blocked = await executeCodexWakeflowMaintenance(request);
    if (blocked.mode !== "preview") throw new Error("Expected preview.");
    equal(blocked.status, "blocked");
    deepEqual(blocked.blockerCodes, ["demand-recovery-not-initialized"]);

    mkdirSync(path.dirname(journal), { recursive: true, mode: 0o700 });
    writeFileSync(journal, "{}\n", { mode: 0o600 });
    const skipped = await executeCodexWakeflowMaintenance(request);
    if (skipped.mode !== "preview") throw new Error("Expected preview.");
    equal(skipped.blockerCodes.includes("demand-recovery-not-initialized"), false);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

function hasStageResidueBlocker(codes: readonly string[]): boolean {
  return codes.some((code) => code.startsWith("demand-stage-residue-"));
}

test("写者已死却清不掉的暂存（成对的任务包内容对不上）：不进计划、不挡维护；同一个根的追加候选照常收掉，暂存原样留着", {
  timeout: 60_000,
}, async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture({ freshBaseline: true });
  await preparePrivateModes(fixture.workspacePath);
  const demandId = fixture.request.demandId;
  const demandRoot = path.join(fixture.workspacePath, demandFinalRootRef(demandId));
  const request = { root: fixture.workspacePath, ...RECONCILE_PREVIEW };
  try {
    const mismatched = plantStage(
      demandRoot,
      "artifacts/task-packages/task-package_cccccccc-cccc-4ccc-8ccc-cccccccccccc.json",
      Buffer.from("{}\n"),
      { paired: true },
    );
    // 两个名字是同一个节点：原地改写之后内容不再是暂存地址里记的那一份。
    writeFileSync(mismatched.stage, "[]\n");
    equal(statSync(mismatched.member).nlink, 2);
    // 同一个根里另有一个本来清得掉的：整个根的暂存都不排进计划（应用对三个目录一起动手）。
    const lone = plantStage(
      demandRoot,
      "event-sourcing/index/0000000000000009.json",
      Buffer.from("{trunc"),
      { paired: false },
    );
    releaseDurableAtomicFileStageAddress(mismatched.address);
    releaseDurableAtomicFileStageAddress(lone.address);

    const leftOut = await executeCodexWakeflowMaintenance(request);
    if (leftOut.mode !== "preview") throw new Error("Expected preview.");
    equal(hasStageResidueBlocker(leftOut.blockerCodes), false, leftOut.blockerCodes.join(","));
    equal(JSON.stringify(leftOut.plan).includes('"stageResidueCount"'), false);

    const candidate = path.join(
      demandRoot,
      demandEventAppendCandidateRef(
        parseDemandEventCommitSequence(2),
        parseWakeflowDurableIdOfKind(
          "demand-event-commit_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "demand-event-commit",
        ),
        `${process.pid}-${threadId}-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
      ),
    );
    writeFileSync(candidate, "{partial\n", { mode: 0o600 });
    const preview = await executeCodexWakeflowMaintenance(request);
    if (preview.mode !== "preview" || preview.planDigest === null)
      throw new Error(`Expected recovery preview: ${JSON.stringify(preview).slice(0, 400)}`);
    equal(preview.status, "ready");
    equal(JSON.stringify(preview.plan).includes('"stageResidueCount":0'), true);
    // 以前预览放行而应用严格：这里的应用每次都以计划漂移失败，整个工作区的 reconcile 停住。
    const applied = await executeCodexWakeflowMaintenance({
      ...request,
      mode: "apply",
      planDigest: preview.planDigest,
    });
    equal(applied.status, "completed");
    equal(existsSync(candidate), false);
    for (const file of [mismatched.stage, mismatched.member, lone.stage]) {
      equal(existsSync(file), true, file);
    }
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("只有暂存残留的根读不出身份、或三个目录之一自己不对：预览不失败、不挡维护，也不把它排进计划", {
  timeout: 60_000,
}, async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture({ freshBaseline: true });
  await preparePrivateModes(fixture.workspacePath);
  const demandId = fixture.request.demandId;
  const demandRoot = path.join(fixture.workspacePath, demandFinalRootRef(demandId));
  const request = { root: fixture.workspacePath, ...RECONCILE_PREVIEW };
  try {
    const lone = plantStage(
      demandRoot,
      "event-sourcing/index/0000000000000009.json",
      Buffer.from("{trunc"),
      { paired: false },
    );
    releaseDurableAtomicFileStageAddress(lone.address);
    const identity = path.join(demandRoot, "identity.json");
    const identityBytes = readFileSync(identity);
    writeFileSync(identity, "not json\n");
    const unreadable = await executeCodexWakeflowMaintenance(request);
    if (unreadable.mode !== "preview") throw new Error("Expected preview.");
    equal(hasStageResidueBlocker(unreadable.blockerCodes), false);
    equal(JSON.stringify(unreadable.plan).includes('"stageResidueCount"'), false);
    writeFileSync(identity, identityBytes);

    // 快照目录的位置上是一个普通文件：目录自己不对，不是"读的时候正在变"，不报 busy 也不报 unknown。
    const snapshots = path.join(demandRoot, "event-sourcing/snapshots");
    rmSync(snapshots, { recursive: true });
    writeFileSync(snapshots, "x", { mode: 0o600 });
    const malformed = await executeCodexWakeflowMaintenance(request);
    if (malformed.mode !== "preview") throw new Error("Expected preview.");
    equal(hasStageResidueBlocker(malformed.blockerCodes), false, malformed.blockerCodes.join(","));
    equal(JSON.stringify(malformed.plan).includes('"stageResidueCount"'), false);
    equal(existsSync(lone.stage), true);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
