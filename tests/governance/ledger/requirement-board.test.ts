/**
 * 1 级组件测试：`src/governance/ledger/requirement-board.ts` 在一次性根上的真实读写——认领状态文件的独占创建与
 * CAS 替换、看板列举、索引渲染，以及状态写入与索引刷新共用的那把看板锁（ADR-0011 D1 D5；ADR-0033；
 * §13.126、§13.209；open-items W29 / R-ROOT-02）。锁的"他人持有"用另一条调用链表示；持有者死亡要真实
 * 进程，所以那两个用例起一个子进程持锁再 SIGKILL。
 */
import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { REQUIREMENT_BOARD_INDEX_REF } from "../../../src/kernel/layout.js";
import {
  activateRequirementClaim,
  archiveRequirementClaim,
  claimRequirementPackage,
  compareRequirementClaimStates,
  computeRequirementClaimStateDigest,
  createRequirementClaimState,
  createRequirementClaimStateFile,
  listRequirementClaimStates,
  pendingRequirementWork,
  publishRequirementBoardIndex,
  readRequirementClaimState,
  refreshRequirementBoardIndex,
  renderRequirementBoardIndex,
  requirementBoardIndexLanguageOf,
  replaceRequirementClaimStateFile,
  supplementAttachTarget,
  withdrawRequirementClaim,
} from "../../../src/governance/ledger/requirement-board.js";
import {
  materializeWorkspaceLocksRoot,
  withWorkspaceLock,
  workspaceLockRef,
} from "../../../src/kernel/workspace-locks.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { holdKernelLockInChildProcess } from "../../support/kernel-lock-process.js";

useDisposableDurability();

const AT = parseUtcInstant("2026-09-04T10:00:00.000Z");
const LATER = parseUtcInstant("2026-09-04T11:00:00.000Z");
const REQUIREMENT = "requirement_77777777-7777-4777-8777-777777777777";
const OTHER = "requirement_88888888-8888-4888-8888-888888888888";
const DEMAND = "demand_99999999-9999-4999-8999-999999999999";
function indexPath(root: RootedDirectory): string {
  return path.join(root.absolutePath, ...REQUIREMENT_BOARD_INDEX_REF.split("/"));
}

/** 另一条调用链持有看板的锁，直到 `release`。 */
async function holdBoardLock(root: RootedDirectory) {
  const inside = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const done = withWorkspaceLock(root, "requirement-board", async () => {
    inside.resolve();
    await release.promise;
  });
  await inside.promise;
  return {
    async release() {
      release.resolve();
      await done;
    },
  };
}

test("看板锁的真实持有进程死亡后，状态替换不需要任何清理就继续", async (t) => {
  const root = await fixture(t);
  await createRequirementClaimStateFile(root, pending());
  const source = await readRequirementClaimState(root, REQUIREMENT);
  if (source === null) throw new Error("Expected pending claim.");
  const held = await holdKernelLockInChildProcess(
    root.absolutePath,
    workspaceLockRef("requirement-board"),
  );
  try {
    await held.crash();
    await replaceRequirementClaimStateFile(
      root,
      source,
      withdrawRequirementClaim(source.state, "done", LATER),
    );
    equal((await readRequirementClaimState(root, REQUIREMENT))?.state.status, "withdrawn");
  } finally {
    await held.close();
  }
});

function pending(
  requirementId = REQUIREMENT,
  priority: "P0" | "P1" | "P2" | "P3" = "P1",
  recordDigest = `sha256:${"a".repeat(64)}`,
) {
  return createRequirementClaimState({
    requirementId,
    programId: "program_11111111-1111-4111-8111-111111111111",
    recordDigest: recordDigest as never,
    title: "示例 | 需求",
    demandType: "requirement",
    priority,
    testingMode: "controller-only",
    publishedAt: AT,
    supersedes: null,
    parkedTrigger: null,
  });
}

async function fixture(t: TestContext): Promise<RootedDirectory> {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-board-")));
  const root = await RootedDirectory.open(dir);
  // 维护的自举留下的锁目录：子进程持锁的用例直接按路径打开锁文件。
  await materializeWorkspaceLocksRoot(root);
  t.after(async () => {
    await root.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return root;
}

// W29（R-ROOT-02）：旧实现锁外列举、只对索引文件做 CAS，一次读完 pending 后被挂起的旧刷新会在
// withdrawn 的新刷新之后把索引写回 pending。现在列举与发布都在看板的锁内：锁被他人持有时刷新既不列举
// 也不发布，拿到锁后看到的是那一刻的状态。状态写入与刷新共用这一把锁（ADR-0033 决定 3），所以锁被占着
// 时状态写入也排在后面。
test("索引刷新在看板的锁内列举并发布：锁被他人持有时不发布、状态写入也等着；放开之后索引等于当前状态的投影（W29，R-ROOT-02）", async (t) => {
  const root = await fixture(t);
  await createRequirementClaimStateFile(root, pending());
  const source = await readRequirementClaimState(root, REQUIREMENT);
  if (source === null) throw new Error("expected a state");
  const holder = await holdBoardLock(root);
  const refresh = refreshRequirementBoardIndex(root);
  const write = replaceRequirementClaimStateFile(
    root,
    source,
    withdrawRequirementClaim(source.state, "不做了", LATER),
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    // 两个都还在等锁：刷新没有在锁外列举后把索引写出来，状态也还没有变。
    equal(existsSync(indexPath(root)), false);
    equal((await readRequirementClaimState(root, REQUIREMENT))?.state.status, "pending");
  } finally {
    await holder.release();
  }
  await Promise.all([refresh, write]);
  equal((await readRequirementClaimState(root, REQUIREMENT))?.state.status, "withdrawn");
  // 状态提交之后调用方照例刷新一次：索引就是当前状态的投影，不会停在 pending。
  const digest = await refreshRequirementBoardIndex(root);
  const index = readFileSync(indexPath(root), "utf8");
  equal(index, renderRequirementBoardIndex((await listRequirementClaimStates(root)).states));
  equal(index.includes(REQUIREMENT), false);
  equal(index.includes("| pending |"), false);
  // 再刷新一次是幂等的：同一投影，同一摘要。
  equal(await refreshRequirementBoardIndex(root), digest);
});

test("看板锁的真实持有进程死亡后刷新直接继续；排在活动持有者之后的刷新与写入在放开后各自进行，索引收敛到当前状态（W29）", async (t) => {
  const root = await fixture(t);
  await createRequirementClaimStateFile(root, pending());
  const held = await holdKernelLockInChildProcess(
    root.absolutePath,
    workspaceLockRef("requirement-board"),
  );
  try {
    await held.crash();
    await refreshRequirementBoardIndex(root);
  } finally {
    await held.close();
  }
  equal(
    readFileSync(indexPath(root), "utf8").includes(`| P1 | pending | \`${REQUIREMENT}\` |`),
    true,
  );
  // 活动持有者放开之前排队的两次刷新与一次新建都在放开后才进行。
  const holder = await holdBoardLock(root);
  const queued = Promise.all([
    refreshRequirementBoardIndex(root),
    refreshRequirementBoardIndex(root),
    createRequirementClaimStateFile(root, pending(OTHER, "P0")),
  ]);
  await holder.release();
  equal((await queued)[2], "created");
  await refreshRequirementBoardIndex(root);
  const index = readFileSync(indexPath(root), "utf8");
  equal(index, renderRequirementBoardIndex((await listRequirementClaimStates(root)).states));
  equal(index.split("\n").filter((line) => /^\| P[0-3] \|/u.test(line)).length, 2);
});

test("看板锁被活动持有者占着时，带信号的刷新按中止收敛（OperationAbortedError），不发布索引（W29）", async (t) => {
  const root = await fixture(t);
  await createRequirementClaimStateFile(root, pending());
  const holder = await holdBoardLock(root);
  try {
    await rejects(
      refreshRequirementBoardIndex(root, AbortSignal.timeout(100)),
      OperationAbortedError,
    );
  } finally {
    await holder.release();
  }
  equal(existsSync(indexPath(root)), false);
});

test("转移是纯函数：修订链、状态载荷与拒绝的来源状态", () => {
  const first = pending();
  equal(first.status, "pending");
  equal(first.revision, 1);
  const claimed = claimRequirementPackage(first, DEMAND, LATER);
  equal(claimed.revision, 2);
  equal(claimed.previousStateDigest, computeRequirementClaimStateDigest(first));
  equal(claimed.claim?.demandId, DEMAND);
  const archived = archiveRequirementClaim(claimed, LATER);
  equal(archived.status, "archived");
  equal(archived.archive?.demandId, DEMAND);
  throws(
    () => claimRequirementPackage(claimed, DEMAND, LATER),
    (error: unknown) =>
      error instanceof WakeflowError && error.reason === "claim-claim-from-claimed",
  );
  const parked = createRequirementClaimState({
    ...pending(),
    parkedTrigger: "等待接口冻结",
  } as never);
  equal(parked.status, "parked");
  equal(activateRequirementClaim(parked, LATER).status, "pending");
  const withdrawn = withdrawRequirementClaim(parked, "不做了", LATER);
  equal(withdrawn.status, "withdrawn");
  equal(withdrawn.parked, null);
  throws(
    () => activateRequirementClaim(first, LATER),
    (error: unknown) =>
      error instanceof WakeflowError && error.reason === "claim-activate-from-pending",
  );
});

test("supplement 包并入哪个 Demand：父需求已归档才有去处；看板上能动手的 pending 包分成可认领与可续接两种（Q7；1.3.0 终验）", () => {
  const parent = pending();
  const supplement = createRequirementClaimState({
    requirementId: OTHER,
    programId: parent.programId,
    recordDigest: `sha256:${"b".repeat(64)}` as never,
    title: "示例补充",
    demandType: "supplement",
    priority: "P1",
    testingMode: "controller-only",
    publishedAt: AT,
    supersedes: null,
    supplements: REQUIREMENT,
    parkedTrigger: null,
  });
  // 不是 supplement 包：没有并入的去处，去认领。
  equal(supplementAttachTarget([parent], parent), undefined);
  // 父需求还没有被认领、正在进行、或看板上没有：等它完成。
  equal(supplementAttachTarget([parent, supplement], supplement), null);
  const claimed = claimRequirementPackage(parent, DEMAND, LATER);
  equal(supplementAttachTarget([claimed, supplement], supplement), null);
  equal(supplementAttachTarget([supplement], supplement), null);
  // 父需求已由某个 Demand 归档：并入那个 Demand。
  const archived = archiveRequirementClaim(claimed, LATER);
  equal(supplementAttachTarget([archived, supplement], supplement), DEMAND);

  deepEqual(pendingRequirementWork([]), { claimable: 0, attachable: 0 });
  deepEqual(pendingRequirementWork([parent, supplement]), { claimable: 1, attachable: 0 });
  deepEqual(pendingRequirementWork([claimed, supplement]), { claimable: 0, attachable: 0 });
  deepEqual(pendingRequirementWork([archived, supplement]), { claimable: 0, attachable: 1 });
  const third = pending("requirement_66666666-6666-4666-8666-666666666666");
  deepEqual(pendingRequirementWork([archived, supplement, third]), { claimable: 1, attachable: 1 });
});

test("索引的 Parked 列是触发词前 40 个码点加省略号：第 40 个码点是 emoji 时整个保留，索引 well-formed（§13.209，R-ROOT-05）", () => {
  const trigger = `${"等".repeat(39)}😀${"x".repeat(5)}`;
  const parked = createRequirementClaimState({ ...pending(), parkedTrigger: trigger } as never);
  const index = renderRequirementBoardIndex([parked]);
  equal(index.isWellFormed(), true);
  equal(index.includes(`| ${"等".repeat(39)}😀… |`), true);
  equal(index.includes("😀x"), false);
  // 不超过 40 个码点的触发词原样进列，不加省略号。
  const short = createRequirementClaimState({
    ...pending(),
    parkedTrigger: "等待接口冻结",
  } as never);
  equal(renderRequirementBoardIndex([short]).includes("| 等待接口冻结 |"), true);
});

test("状态文件独占创建、CAS 替换、目录列出与索引重写", async (t) => {
  const root = await fixture(t);
  const first = pending();
  equal(await createRequirementClaimStateFile(root, first), "created");
  equal(await createRequirementClaimStateFile(root, first), "current");
  // 同一记录换元数据（这里是优先级）重放仍是 current；另一份记录占同一标识才是冲突。
  equal(await createRequirementClaimStateFile(root, pending(REQUIREMENT, "P0")), "current");
  await rejects(
    createRequirementClaimStateFile(root, pending(REQUIREMENT, "P1", `sha256:${"b".repeat(64)}`)),
    (error: unknown) => error instanceof WakeflowError && error.code === "concurrency-conflict",
  );
  const stateFile = path.join(
    root.absolutePath,
    ".wakeflow-active/current/board",
    `${REQUIREMENT}.json`,
  );
  equal(statSync(stateFile).mode & 0o777, 0o600);
  const source = await readRequirementClaimState(root, REQUIREMENT);
  if (source === null) throw new Error("expected a state");
  const claimed = claimRequirementPackage(source.state, DEMAND, LATER);
  await replaceRequirementClaimStateFile(root, source, claimed);
  await rejects(
    replaceRequirementClaimStateFile(
      root,
      source,
      withdrawRequirementClaim(source.state, "x", LATER),
    ),
    (error: unknown) => error instanceof WakeflowError && error.reason === "claim-state-changed",
  );
  await createRequirementClaimStateFile(root, pending(OTHER, "P0"));
  const listing = await listRequirementClaimStates(root);
  deepEqual(
    [...listing.states]
      .sort(compareRequirementClaimStates)
      .map((state) => [state.requirementId, state.status]),
    [
      [OTHER, "pending"],
      [REQUIREMENT, "claimed"],
    ],
  );
  equal(listing.skipped, 0);
  await publishRequirementBoardIndex(root, listing.states);
  const index = readFileSync(
    path.join(root.absolutePath, ...REQUIREMENT_BOARD_INDEX_REF.split("/")),
    "utf8",
  );
  equal(index, renderRequirementBoardIndex(listing.states));
  equal(index.includes("示例 \\| 需求"), true);
  equal(index.includes(`\`${DEMAND}\``), true);
  equal(index.split("\n").filter((line) => /^\| P[0-3] \|/u.test(line)).length, 2);
  // G11（§13.209）：v2 标记，Testing 与 Parked 两列；没有 parked 的行是 —。
  equal(index.includes("<!-- wakeflow:board-projection:v2 -->"), true);
  equal(
    index.includes(
      "| Priority | Status | Requirement | Title | Type | Testing | Parked | Published | Demand |",
    ),
    true,
  );
  equal(index.includes("| controller-only | — |"), true);
  equal(existsSync(stateFile), true);
});

// 旧实现的已验证行为（todo-service："concurrent claim attempts against one exact snapshot allow
// exactly one commit"、"concurrent appenders serialize"）在新的每包锁加整文件 CAS 上同样成立。
test("上一个写者死在链接之后：状态文件带着死暂存的第二个链接，第一次替换先结算再读，不被拒（L10）", async (t) => {
  const root = await fixture(t);
  await createRequirementClaimStateFile(root, pending());
  const source = await readRequirementClaimState(root, REQUIREMENT);
  if (source === null) throw new Error("expected a state");
  const stateFile = path.join(
    root.absolutePath,
    ".wakeflow-active/current/board",
    `${REQUIREMENT}.json`,
  );
  // 死写者留下的那一对：暂存名的属主已经释放，暂存与状态文件是同一个节点的两个链接。
  const address = issueDurableAtomicFileStageAddress(
    "create",
    parsePortableResourcePath(`.wakeflow-active/current/board/${REQUIREMENT}.json`),
    computeSha256Digest(readFileSync(stateFile)),
    0o600,
  );
  releaseDurableAtomicFileStageAddress(address);
  linkSync(stateFile, path.join(path.dirname(stateFile), address.fileName));
  equal(statSync(stateFile).nlink, 2);

  await replaceRequirementClaimStateFile(
    root,
    source,
    withdrawRequirementClaim(source.state, "x", LATER),
  );
  equal(statSync(stateFile).nlink, 1);
  equal((await readRequirementClaimState(root, REQUIREMENT))?.state.status, "withdrawn");
});

test("并发：两个 Demand 凭同一快照认领恰有一个成功，同一状态并发创建恰有一个 created（§13.126）", async (t) => {
  const root = await fixture(t);
  const first = pending();
  const creations = await Promise.all([
    createRequirementClaimStateFile(root, first),
    createRequirementClaimStateFile(root, first),
  ]);
  deepEqual([...creations].sort(), ["created", "current"]);
  const source = await readRequirementClaimState(root, REQUIREMENT);
  if (source === null) throw new Error("expected a state");
  const rival = "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const outcomes = await Promise.allSettled([
    replaceRequirementClaimStateFile(
      root,
      source,
      claimRequirementPackage(source.state, DEMAND, LATER),
    ),
    replaceRequirementClaimStateFile(
      root,
      source,
      claimRequirementPackage(source.state, rival, LATER),
    ),
  ]);
  deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["fulfilled", "rejected"]);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  const reason = rejected?.status === "rejected" ? rejected.reason : null;
  equal(reason instanceof WakeflowError && reason.reason === "claim-state-changed", true);
  const after = await readRequirementClaimState(root, REQUIREMENT);
  equal(after?.state.status, "claimed");
  equal(after?.state.revision, 2);
  equal([DEMAND, rival].includes(after?.state.claim?.demandId ?? ""), true);
  // 输者重读后看到的是赢者的认领，不能再凭旧快照认领。
  await rejects(
    replaceRequirementClaimStateFile(
      root,
      source,
      claimRequirementPackage(source.state, rival, LATER),
    ),
    (error: unknown) => error instanceof WakeflowError && error.reason === "claim-state-changed",
  );
});

test("索引跟随工作区语言（1.4 第 3 段）：英文字节不变；中文有自己的标题、说明、表头与标记；不给语言的刷新沿用磁盘上的语言，给了就换", async (t) => {
  const root = await fixture(t);
  await createRequirementClaimStateFile(root, pending());
  const states = (await listRequirementClaimStates(root)).states;

  const en = renderRequirementBoardIndex(states);
  equal(
    renderRequirementBoardIndex(states, "en"),
    en,
    "English is the default and keeps its bytes",
  );
  equal(requirementBoardIndexLanguageOf(en), "en");
  const zh = renderRequirementBoardIndex(states, "zh-Hans");
  equal(zh.startsWith("# 需求看板\n\n<!-- wakeflow:board-projection:v2:zh-Hans -->\n"), true, zh);
  equal(zh.includes("本文件是 `board/` 下认领状态的确定性投影；请勿手改。"), true);
  equal(
    zh.includes("| 优先级 | 状态 | 需求包 | 标题 | 类型 | 测试 | 搁置 | 发布时间 | Demand |"),
    true,
  );
  equal(requirementBoardIndexLanguageOf(zh), "zh-Hans");
  // 行是同一批：状态与类型是机器取值，不翻译。
  deepEqual(
    zh.split("\n").filter((line) => /^\| P[0-3] \|/u.test(line)),
    en.split("\n").filter((line) => /^\| P[0-3] \|/u.test(line)),
  );

  // 没有索引、也没给语言：英文（Fresh 初始化绑定的就是这一份）。
  await refreshRequirementBoardIndex(root);
  equal(readFileSync(indexPath(root), "utf8"), en);
  // 知道配置的调用方给了语言：换成中文。
  await refreshRequirementBoardIndex(root, undefined, "zh-Hans");
  equal(readFileSync(indexPath(root), "utf8"), zh);
  // 不读配置的调用方刷新：状态变了，语言不变。
  await createRequirementClaimStateFile(root, pending(OTHER, "P0"));
  await refreshRequirementBoardIndex(root);
  const next = readFileSync(indexPath(root), "utf8");
  equal(
    next,
    renderRequirementBoardIndex((await listRequirementClaimStates(root)).states, "zh-Hans"),
  );
  equal(next.includes(OTHER), true);
  // 配置换回英文：下一次带语言的刷新换回来。
  await refreshRequirementBoardIndex(root, undefined, "en");
  equal(requirementBoardIndexLanguageOf(readFileSync(indexPath(root), "utf8")), "en");
});
