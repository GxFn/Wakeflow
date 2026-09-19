import { deepEqual, equal, notEqual, rejects } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../src/foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, type Sha256Digest } from "../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import type { PortableResourcePath } from "../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../src/foundation/text/utf8.js";
import {
  inspectActiveLayout,
  inspectActiveProjectionTargets,
  materializeActiveLayout,
  publishActiveProjection,
  renderActiveProjectionFiles,
  type ActiveProjectionDemandEvidence,
  type ActiveProjectionDemandFacts,
  type ActiveProjectionFacts,
  type ActiveProjectionFile,
} from "../../src/kernel/active-projection.js";
import { WakeflowError } from "../../src/kernel/error.js";
import {
  demandProjectionIndexRef,
  demandProjectionProgressRef,
  demandProjectionRootRef,
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
  WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
  WAKEFLOW_ACTIVE_ROOT_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
} from "../../src/kernel/layout.js";
import { durableAtomicFileStageRefForTest } from "../foundation/filesystem/durable-atomic-file-test-support.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";

/**
 * 内核活动投影（gate-log §13.94 D5）：两级容器的检查与物化；事实 → 四份文件的渲染，标记
 * 与指纹只绑定事实；发布在投影锁内逐文件 CAS，任一目标 unsafe（手写、符号链接、模式、硬链接）
 * 整轮零写；不活动 Demand 的页面目录只在每个成员都带标记时退休。
 */

const DEMAND_A = "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEMAND_B = "demand_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POD_ID = "pod_99999999-9999-4999-8999-999999999999";
const REPOSITORY_ID = "repository_22222222-2222-4222-8222-222222222222";
const MARKER = /^<!-- wakeflow:(active|demand)-projection:v1:(sha256:[0-9a-f]{64}) -->$/mu;
const LOCK_TOKEN_UUID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";

function digest(seed: string): Sha256Digest {
  return computeCanonicalJsonSha256Digest({ seed });
}

async function fixture(t: TestContext): Promise<RootedDirectory> {
  const absolutePath = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-projection-")));
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return root;
}

function demandFacts(
  demandId: string,
  overrides: Partial<ActiveProjectionDemandFacts> = {},
): ActiveProjectionDemandFacts {
  return {
    demandId,
    title: "Plan one target task",
    demandType: "requirement",
    podId: POD_ID,
    podName: "main",
    lifecycle: "active",
    streamRevision: 2,
    stateDigest: digest(`state:${demandId}`),
    reviewSnapshotDigest: digest(`review:${demandId}`),
    route: {
      disposition: "work-available",
      frontier: "implementation-delivery-planning",
      owner: "controller",
      suggestedTool: "wakeflow_prepare_delivery",
      blockers: [],
    },
    progress: {
      implementationTargets: 1,
      implementationAccepted: 0,
      deliveriesInFlight: 0,
      resultsAwaitingReview: 0,
      testTargets: 0,
      testAccepted: 0,
    },
    targets: [
      {
        targetTaskId: "target-task_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        workType: "implementation",
        phase: "planned",
        repositoryId: REPOSITORY_ID,
        windowId: "window_88888888-8888-4888-8888-888888888888",
      },
    ],
    lastEventId: null,
    awaitingDecision: null,
    evidenceCount: 0,
    ...overrides,
  };
}

function facts(
  overrides: Partial<ActiveProjectionFacts> = {},
  demands: readonly ActiveProjectionDemandFacts[] = [demandFacts(DEMAND_A)],
): ActiveProjectionFacts {
  return {
    language: "en",
    program: {
      programId: "program_11111111-1111-4111-8111-111111111111",
      displayName: "Example Program",
    },
    configDigest: digest("config"),
    pods: [
      {
        podId: POD_ID,
        name: "main",
        placement: "primary",
        lifecycle: "open",
        activeDemandId: DEMAND_A,
        worktrees: [],
      },
    ],
    unmergedAccepted: [],
    demands,
    activeDemands: observedDemands(...demands.map((demand) => demand.demandId)),
    ...overrides,
  };
}

/** 看全了活动 Demand 的一轮：退休遍历只在带着这份证据时进行。 */
function observedDemands(...activeDemandIds: readonly string[]): ActiveProjectionDemandEvidence {
  return { observed: true, activeDemandIds };
}

function markerOf(content: string): { readonly kind: string; readonly fingerprint: string } {
  const match = MARKER.exec(content);
  if (match?.[1] === undefined || match[2] === undefined) throw new Error("marker missing");
  return { kind: match[1], fingerprint: match[2] };
}

function absolute(root: RootedDirectory, ref: PortableResourcePath): string {
  return path.join(root.absolutePath, ...ref.split("/"));
}

interface DiskSnapshot {
  readonly inode: number;
  readonly mode: number;
  readonly bytes: string;
}

function snapshot(root: RootedDirectory, refs: readonly PortableResourcePath[]) {
  const result = new Map<PortableResourcePath, DiskSnapshot>();
  for (const ref of refs) {
    const stat = statSync(absolute(root, ref));
    result.set(ref, {
      inode: stat.ino,
      mode: stat.mode & 0o777,
      bytes: readFileSync(absolute(root, ref), "utf8"),
    });
  }
  return result;
}

function refsOf(files: readonly Readonly<ActiveProjectionFile>[]): readonly PortableResourcePath[] {
  return files.map((entry) => entry.resourcePath);
}

function workspaceFingerprint(files: readonly Readonly<ActiveProjectionFile>[]): Sha256Digest {
  const first = files[0];
  if (first === undefined) throw new Error("no files");
  return first.fingerprint;
}

function demandFingerprint(files: readonly Readonly<ActiveProjectionFile>[]): Sha256Digest {
  const page = files.find((entry) => entry.kind === "demand");
  if (page === undefined) throw new Error("no demand page");
  return page.fingerprint;
}

test("两级容器：absent → 独占创建 → current；重复创建被拒而 recovering 幂等；缺 current 为 incomplete；模式不对为 conflict", async (t) => {
  const root = await fixture(t);
  const absent = await inspectActiveLayout(root);
  equal(absent.status, "absent");
  deepEqual(
    absent.entries.map((entry) => [entry.resourcePath, entry.status, entry.nodeDigest]),
    [
      [WAKEFLOW_ACTIVE_ROOT_REF, "absent", null],
      [WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, "absent", null],
    ],
  );

  const created = await materializeActiveLayout(root, { recovering: false });
  equal(created.disposition, "created");
  deepEqual(
    created.entries.map((entry) => [entry.disposition, entry.node.permissionBits]),
    [
      ["created", 0o700],
      ["created", 0o700],
    ],
  );
  const current = await inspectActiveLayout(root);
  equal(current.status, "current");
  equal(
    current.entries.every((entry) => entry.nodeDigest !== null),
    true,
  );
  notEqual(current.observationDigest, absent.observationDigest);

  await rejects(
    materializeActiveLayout(root, { recovering: false }),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "precondition-failed" &&
      error.reason === "active-layout-exists",
  );
  const recovered = await materializeActiveLayout(root, { recovering: true });
  equal(recovered.disposition, "current");
  equal((await inspectActiveLayout(root)).status, "current");

  rmdirSync(absolute(root, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF));
  equal((await inspectActiveLayout(root)).status, "incomplete");
  const repaired = await materializeActiveLayout(root, { recovering: true });
  deepEqual(
    repaired.entries.map((entry) => entry.disposition),
    ["current", "created"],
  );

  chmodSync(absolute(root, WAKEFLOW_ACTIVE_ROOT_REF), 0o755);
  equal((await inspectActiveLayout(root)).status, "conflict");
  chmodSync(absolute(root, WAKEFLOW_ACTIVE_ROOT_REF), 0o700);
  equal((await inspectActiveLayout(root)).status, "current");
});

test("渲染：一个 Demand 得两份工作区页与两份 Demand 页，标记合法且指纹只随绑定事实变化", () => {
  const files = renderActiveProjectionFiles(facts());
  deepEqual(refsOf(files), [
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
    WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
    demandProjectionIndexRef(DEMAND_A),
    demandProjectionProgressRef(DEMAND_A),
  ]);
  deepEqual(
    files.map((entry) => [entry.kind, entry.demandId]),
    [
      ["workspace", null],
      ["workspace", null],
      ["demand", DEMAND_A],
      ["demand", DEMAND_A],
    ],
  );
  // Demand 页面住在 .wakeflow-active/projections/<demandId>/，不进 Demand 根（权威树）。
  equal(demandProjectionRootRef(DEMAND_A), `.wakeflow-active/projections/${DEMAND_A}`);
  equal(
    files.every(
      (entry) => !entry.resourcePath.startsWith(`${WAKEFLOW_ACTIVE_CURRENT_ROOT_REF}/demand_`),
    ),
    true,
  );
  for (const entry of files) {
    const marker = markerOf(entry.content);
    equal(marker.kind, entry.kind === "workspace" ? "active" : "demand");
    equal(marker.fingerprint, entry.fingerprint);
    equal(entry.digest, computeSha256Digest(entry.bytes));
  }
  const workspace = workspaceFingerprint(files);
  equal(files[1]?.fingerprint, workspace);
  const demand = demandFingerprint(files);
  equal(files[3]?.fingerprint, demand);
  notEqual(workspace, demand);

  // 未绑定的事实不改指纹：程序显示名只进正文；Demand 标题不进 Demand 页指纹。
  const renamedProgram = renderActiveProjectionFiles(
    facts({
      program: { programId: "program_11111111-1111-4111-8111-111111111111", displayName: "Other" },
    }),
  );
  equal(workspaceFingerprint(renamedProgram), workspace);
  notEqual(renamedProgram[0]?.digest, files[0]?.digest, "the body still follows the facts");
  const retitled = renderActiveProjectionFiles(
    facts({}, [demandFacts(DEMAND_A, { title: "Other" })]),
  );
  equal(demandFingerprint(retitled), demand);

  // 绑定的事实各自改指纹：语言、配置摘要、状态摘要、评审快照摘要、路由、pod 集合。
  const bound: readonly (readonly [string, ActiveProjectionFacts])[] = [
    ["language", facts({ language: "zh-Hans" })],
    ["configDigest", facts({ configDigest: digest("config-2") })],
    ["stateDigest", facts({}, [demandFacts(DEMAND_A, { stateDigest: digest("state-2") })])],
    [
      "reviewSnapshotDigest",
      facts({}, [demandFacts(DEMAND_A, { reviewSnapshotDigest: digest("review-2") })]),
    ],
    [
      "route",
      facts({}, [
        demandFacts(DEMAND_A, {
          route: {
            disposition: "blocked",
            frontier: null,
            owner: "none",
            suggestedTool: null,
            blockers: ["work-claim-held"],
          },
        }),
      ]),
    ],
    [
      "pods",
      facts({
        pods: [
          {
            podId: POD_ID,
            name: "main",
            placement: "primary",
            lifecycle: "closing",
            activeDemandId: null,
            worktrees: [],
          },
        ],
      }),
    ],
  ];
  for (const [label, changed] of bound) {
    const rendered = renderActiveProjectionFiles(changed);
    notEqual(
      workspaceFingerprint(rendered),
      workspace,
      `${label} must change the workspace fingerprint`,
    );
    if (label !== "configDigest" && label !== "pods") {
      notEqual(demandFingerprint(rendered), demand, `${label} must change the demand fingerprint`);
    }
  }
  deepEqual(refsOf(renderActiveProjectionFiles(facts({}, []))), [
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
    WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
  ]);
});

test("发布：created → current（inode 不变）→ 事实变化后 updated（CAS 替换）；文件 0600；页面在 projections 目录", async (t) => {
  const root = await fixture(t);
  await materializeActiveLayout(root, { recovering: false });
  const files = renderActiveProjectionFiles(facts());
  const refs = refsOf(files);

  const created = await publishActiveProjection(root, files);
  equal(created.disposition, "created");
  deepEqual(
    created.targets.map((target) => target.status),
    ["current", "current", "current", "current"],
  );
  deepEqual(created.retired, []);
  const first = snapshot(root, refs);
  for (const [ref, disk] of first) {
    equal(disk.mode, 0o600, `${ref} mode`);
    equal(disk.bytes, files.find((entry) => entry.resourcePath === ref)?.content);
  }
  equal(existsSync(absolute(root, demandProjectionRootRef(DEMAND_A))), true);
  equal(existsSync(path.join(root.absolutePath, ".wakeflow-active", "current", DEMAND_A)), false);

  const current = await publishActiveProjection(root, files);
  equal(current.disposition, "current");
  deepEqual(
    current.targets.map((target) => [target.status, target.currentDigest]),
    created.targets.map((target) => [target.status, target.currentDigest]),
  );
  notEqual(
    current.observationDigest,
    created.observationDigest,
    "the receipt binds its disposition",
  );
  for (const [ref, disk] of snapshot(root, refs)) {
    equal(disk.inode, first.get(ref)?.inode, `${ref} must keep its inode on a no-op round`);
  }

  const changed = renderActiveProjectionFiles(
    facts({}, [demandFacts(DEMAND_A, { stateDigest: digest("state-2"), streamRevision: 3 })]),
  );
  const before = await inspectActiveProjectionTargets(root, changed);
  deepEqual(
    before.map((target) => target.status),
    ["stale", "stale", "stale", "stale"],
  );
  const updated = await publishActiveProjection(root, changed);
  equal(updated.disposition, "updated");
  equal(
    updated.targets.every((target) => target.status === "current"),
    true,
  );
  for (const [ref, disk] of snapshot(root, refs)) {
    notEqual(disk.inode, first.get(ref)?.inode, `${ref} must be replaced, not rewritten in place`);
    equal(disk.mode, 0o600);
    equal(disk.bytes, changed.find((entry) => entry.resourcePath === ref)?.content);
  }
});

test("手写：去掉标记后整轮零写，兄弟文件字节与 inode 不变，回执 unsafe/handwritten", async (t) => {
  const root = await fixture(t);
  await materializeActiveLayout(root, { recovering: false });
  const files = renderActiveProjectionFiles(facts());
  await publishActiveProjection(root, files);
  const handwritten = demandProjectionIndexRef(DEMAND_A);
  writeFileSync(absolute(root, handwritten), "# My notes\n\nkept by hand\n");
  const before = snapshot(root, refsOf(files));

  const changed = renderActiveProjectionFiles(
    facts({}, [demandFacts(DEMAND_A, { stateDigest: digest("state-2") })]),
  );
  const receipt = await publishActiveProjection(root, changed);
  equal(receipt.disposition, "unsafe");
  deepEqual(receipt.retired, []);
  deepEqual(
    receipt.targets.map((target) => [target.status, target.reason]),
    [
      ["stale", null],
      ["stale", null],
      ["unsafe", "handwritten"],
      ["stale", null],
    ],
  );
  deepEqual(snapshot(root, refsOf(files)), before, "an unsafe round must write nothing");
});

test("不安全目标：符号链接、0644、硬链接都让整轮零写并给出原因", async (t) => {
  const root = await fixture(t);
  await materializeActiveLayout(root, { recovering: false });
  const files = renderActiveProjectionFiles(facts());
  await publishActiveProjection(root, files);
  const refs = refsOf(files);
  const changed = renderActiveProjectionFiles(facts({ configDigest: digest("config-2") }));
  const indexPath = absolute(root, WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF);
  const statusPath = absolute(root, WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF);
  const progressPath = absolute(root, demandProjectionProgressRef(DEMAND_A));

  async function expectZeroWrite(reason: string, ref: PortableResourcePath): Promise<void> {
    const siblings = refs.filter((entry) => entry !== ref);
    const before = snapshot(root, siblings);
    const receipt = await publishActiveProjection(root, changed);
    equal(receipt.disposition, "unsafe");
    equal(receipt.targets.find((target) => target.resourcePath === ref)?.reason, reason);
    deepEqual(snapshot(root, siblings), before, `${reason}: siblings must stay untouched`);
  }

  const indexBytes = readFileSync(indexPath);
  unlinkSync(indexPath);
  symlinkSync(statusPath, indexPath);
  await expectZeroWrite("symlink", WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF);
  unlinkSync(indexPath);
  writeFileSync(indexPath, indexBytes, { mode: 0o600 });

  chmodSync(statusPath, 0o644);
  await expectZeroWrite("mode", WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF);
  chmodSync(statusPath, 0o600);

  linkSync(progressPath, `${progressPath}.link`);
  await expectZeroWrite("links", demandProjectionProgressRef(DEMAND_A));
  unlinkSync(`${progressPath}.link`);

  const receipt = await publishActiveProjection(root, changed);
  equal(receipt.disposition, "updated");
});

test("退休：不在事实里的 Demand 页面目录只在每个成员都带标记时退休，否则整目录留下并报 unsafe", async (t) => {
  const root = await fixture(t);
  await materializeActiveLayout(root, { recovering: false });
  await publishActiveProjection(root, renderActiveProjectionFiles(facts()), {
    activeDemands: observedDemands(DEMAND_A),
  });

  const withoutDemands = renderActiveProjectionFiles(facts({}, []));
  const evidence = { activeDemands: observedDemands() };
  const retiredA = await publishActiveProjection(root, withoutDemands, evidence);
  equal(retiredA.disposition, "updated");
  deepEqual(retiredA.retired, [{ demandId: DEMAND_A, disposition: "retired" }]);
  equal(existsSync(absolute(root, demandProjectionRootRef(DEMAND_A))), false);

  await publishActiveProjection(
    root,
    renderActiveProjectionFiles(facts({}, [demandFacts(DEMAND_B)])),
    { activeDemands: observedDemands(DEMAND_B) },
  );
  const directoryB = absolute(root, demandProjectionRootRef(DEMAND_B));
  writeFileSync(path.join(directoryB, "notes.md"), "kept by hand\n", { mode: 0o600 });
  const kept = await publishActiveProjection(root, withoutDemands, evidence);
  deepEqual(kept.retired, [{ demandId: DEMAND_B, disposition: "unsafe" }]);
  equal(existsSync(path.join(directoryB, "index.md")), true);
  equal(existsSync(path.join(directoryB, "developer-progress.md")), true);
  equal(existsSync(path.join(directoryB, "notes.md")), true);

  unlinkSync(path.join(directoryB, "notes.md"));
  const retiredB = await publishActiveProjection(root, withoutDemands, evidence);
  deepEqual(retiredB.retired, [{ demandId: DEMAND_B, disposition: "retired" }]);
  equal(existsSync(directoryB), false);
});

test("退休证据：没看全活动 Demand 的一轮一个页面目录都不删；看全且确认不活动才退休", async (t) => {
  const root = await fixture(t);
  await materializeActiveLayout(root, { recovering: false });
  await publishActiveProjection(root, renderActiveProjectionFiles(facts()), {
    activeDemands: observedDemands(DEMAND_A),
  });
  const directory = absolute(root, demandProjectionRootRef(DEMAND_A));
  const pages = [demandProjectionIndexRef(DEMAND_A), demandProjectionProgressRef(DEMAND_A)];
  const before = snapshot(root, pages);

  // 一次瞬时读失败会让在用的 Demand 掉出事实：文件集本身分不清"不活动"与"没读出来"。
  const withoutDemands = renderActiveProjectionFiles(facts({}, []));
  const unobserved = await publishActiveProjection(root, withoutDemands, {
    activeDemands: { observed: false, activeDemandIds: [] },
  });
  equal(unobserved.disposition, "updated", "工作区两页照常重写");
  deepEqual(unobserved.retired, []);
  deepEqual(snapshot(root, pages), before, "没看全的一轮不能删在用的 Demand 页面");

  // 不带证据的发布（fresh 物化那条路）同样不退休。
  deepEqual((await publishActiveProjection(root, withoutDemands)).retired, []);
  deepEqual(snapshot(root, pages), before);

  // 证据说它还活着：即便这一轮没渲染出它的页面，也不退休。
  const stillActive = await publishActiveProjection(root, withoutDemands, {
    activeDemands: observedDemands(DEMAND_A),
  });
  deepEqual(stillActive.retired, []);
  deepEqual(snapshot(root, pages), before);

  // 看全了、且证据里没有它：确实不活动，退休。
  const retired = await publishActiveProjection(root, withoutDemands, {
    activeDemands: observedDemands(),
  });
  deepEqual(retired.retired, [{ demandId: DEMAND_A, disposition: "retired" }]);
  equal(existsSync(directory), false);
});

test("投影锁：活动持有者让发布以 projection-contended 失败（可重试）；recovering 退休失活的锁", async (t) => {
  const root = await fixture(t);
  await materializeActiveLayout(root, { recovering: false });
  const files = renderActiveProjectionFiles(facts());
  const lockPath = absolute(root, WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF);

  // 父进程仍在：持有者活动，等到超时也拿不到锁。争用的语义与等待多久无关，取锁上限因此
  // 由调用方给出（默认 10 s），这一轮只等 50 ms。
  writeFileSync(
    lockPath,
    rootedExclusiveFileLockRecordTextForTest({ pid: process.ppid, tokenUuid: LOCK_TOKEN_UUID }),
    { mode: 0o600 },
  );
  await rejects(
    publishActiveProjection(root, files, { acquireTimeoutMilliseconds: 50 }),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "io-failure" &&
      error.reason === "projection-contended" &&
      error.retryable,
  );
  equal(existsSync(lockPath), true, "a contended round must not steal the lock");
  equal(existsSync(absolute(root, WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF)), false);
  unlinkSync(lockPath);

  // 进程号不存在：持有者失活，维护恢复语义先退休残留再发布。
  writeFileSync(
    lockPath,
    rootedExclusiveFileLockRecordTextForTest({ pid: 2_147_483_647, tokenUuid: LOCK_TOKEN_UUID }),
    { mode: 0o600 },
  );
  const receipt = await publishActiveProjection(root, files, { recovering: true });
  equal(receipt.disposition, "created");
  equal(existsSync(lockPath), false, "the lock is released after the round");
  equal(existsSync(absolute(root, WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF)), true);
});

test("锁内渲染：渲染时投影锁已在，同一轮里的第二次发布撞上 projection-contended；回执仍来自这一轮渲染", async (t) => {
  const root = await fixture(t);
  await materializeActiveLayout(root, { recovering: false });
  const lockPath = absolute(root, WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF);
  let lockedWhileRendering: boolean | null = null;
  let contender: unknown = null;

  const receipt = await publishActiveProjection(root, async () => {
    lockedWhileRendering = existsSync(lockPath);
    // 观察与落盘之间没有插队窗口：此刻别人拿不到锁，两轮刷新因此不能按与观察相反的顺序落盘。
    contender = await publishActiveProjection(root, renderActiveProjectionFiles(facts()), {
      acquireTimeoutMilliseconds: 50,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    return {
      files: renderActiveProjectionFiles(facts()),
      activeDemands: observedDemands(DEMAND_A),
    };
  });

  equal(lockedWhileRendering, true, "the render thunk must run while the projector lock is held");
  equal(
    contender instanceof WakeflowError &&
      contender.code === "io-failure" &&
      contender.reason === "projection-contended" &&
      contender.retryable,
    true,
  );
  equal(receipt.disposition, "created");
  equal(existsSync(lockPath), false, "the lock is released after the round");
  equal(
    markerOf(readFileSync(absolute(root, WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF), "utf8")).kind,
    "active",
  );
  // 锁内渲染交回的退休证据就是这一轮的证据：活动 Demand 的页面目录留下。
  equal(existsSync(absolute(root, demandProjectionIndexRef(DEMAND_A))), true);
});

test("恢复：失活的锁与同目录的工作区索引暂存残留一起退休，recovering 因此在它存在的那一轮也能发布", async (t) => {
  const root = await fixture(t);
  await materializeActiveLayout(root, { recovering: false });
  const files = renderActiveProjectionFiles(facts());
  const lockPath = absolute(root, WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF);
  writeFileSync(
    lockPath,
    rootedExclusiveFileLockRecordTextForTest({ pid: 2_147_483_647, tokenUuid: LOCK_TOKEN_UUID }),
    { mode: 0o600 },
  );

  // 崩溃残留：写工作区索引写到一半的暂存文件，与 projector.lock 同住 .wakeflow-active/。
  const partial = encodeUtf8("partial");
  const address = issueDurableAtomicFileStageAddress(
    "create",
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
    computeSha256Digest(partial),
    0o600,
  );
  const stageRef = durableAtomicFileStageRefForTest(WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF, address);
  writeFileSync(absolute(root, stageRef), partial, { mode: 0o600 });
  releaseDurableAtomicFileStageAddress(address);

  const receipt = await publishActiveProjection(root, files, { recovering: true });
  equal(receipt.disposition, "created");
  equal(existsSync(lockPath), false, "the dead lock must be retired");
  equal(existsSync(absolute(root, stageRef)), false, "the sibling residue stage goes with it");
  equal(existsSync(absolute(root, WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF)), true);
});

test("状态页：已接受分支段只声称投影真看得到的东西（§13.94 D5：投影作用域没有仓库指针）", () => {
  const unmergedAccepted = [
    {
      demandId: DEMAND_A,
      targetTaskId: "target-task_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      repositoryId: REPOSITORY_ID,
      branch: "wakeflow/demand-a",
      commit: "1111111111111111111111111111111111111111",
    },
  ];
  const en = renderActiveProjectionFiles(facts({ unmergedAccepted }))[1]?.content ?? "";
  const zh =
    renderActiveProjectionFiles(facts({ unmergedAccepted, language: "zh-Hans" }))[1]?.content ?? "";

  equal(/^## Accepted implementation results with a recorded branch$/mu.test(en), true);
  equal(/^## 已接受且记录了分支的实现结果$/mu.test(zh), true);
  // 旧标题声称分支仍在，而投影根本核对不了仓库指针。
  equal(en.includes("Accepted results whose branch still exists"), false);
  equal(zh.includes("已接受但分支仍在的结果"), false);
  equal(en.includes("may already be merged or deleted"), true);
  equal(en.includes("wakeflow_status reports the merge state"), true);
  equal(zh.includes("这里列出的分支可能已经合并或删除"), true);
  equal(zh.includes("合并状态由 wakeflow_status 报告"), true);
  // 行本身不变：段落改的是说法，不是内容。
  for (const content of [en, zh]) {
    equal(
      content.includes(
        "| `demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` | `target-task_cccccccc-cccc-4ccc-8ccc-cccccccccccc` | `repository_22222222-2222-4222-8222-222222222222` | `wakeflow/demand-a` | `1111111111111111111111111111111111111111` |",
      ),
      true,
    );
  }
});
