/**
 * 1 级组件测试：`src/kernel/requirement-board.ts` 在一次性根上的真实读写——认领状态文件的独占创建与
 * CAS 替换、每包锁的残留退休、看板列举、索引渲染，以及索引刷新的看板级锁（ADR-0011 D1 D5；§13.126、
 * §13.209；open-items W29 / R-ROOT-02）。锁的"他人持有"用本进程的租约表示，残留退休需要真实进程死亡，
 * 所以那两个用例起一个子进程持锁再 SIGKILL。
 */
import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { parsePortableResourcePath } from "../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { acquireRootedExclusiveFileLock } from "../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { parseUtcInstant } from "../../src/foundation/time/utc-instant.js";
import { WakeflowError } from "../../src/kernel/error.js";
import { REQUIREMENT_BOARD_INDEX_REF } from "../../src/kernel/layout.js";
import {
  activateRequirementClaim,
  archiveRequirementClaim,
  claimRequirementPackage,
  compareRequirementClaimStates,
  computeRequirementClaimStateDigest,
  createRequirementClaimState,
  createRequirementClaimStateFile,
  listRequirementClaimStates,
  publishRequirementBoardIndex,
  readRequirementClaimState,
  refreshRequirementBoardIndex,
  renderRequirementBoardIndex,
  replaceRequirementClaimStateFile,
  withdrawRequirementClaim,
} from "../../src/kernel/requirement-board.js";
import { useDisposableDurability } from "../support/disposable-durability.js";
import { holdLockInChildProcess } from "../support/held-lock-process.js";

useDisposableDurability();

const AT = parseUtcInstant("2026-09-04T10:00:00.000Z");
const LATER = parseUtcInstant("2026-09-04T11:00:00.000Z");
const REQUIREMENT = "requirement_77777777-7777-4777-8777-777777777777";
const OTHER = "requirement_88888888-8888-4888-8888-888888888888";
const DEMAND = "demand_99999999-9999-4999-8999-999999999999";
const INDEX_LOCK = ".wakeflow-active/current/board/locks/index.lock";
const INDEX_LOCK_REF = parsePortableResourcePath(INDEX_LOCK, "$test");

function indexPath(root: RootedDirectory): string {
  return path.join(root.absolutePath, ...REQUIREMENT_BOARD_INDEX_REF.split("/"));
}

test("claim 锁的真实持有进程死亡后，正常 CAS 退休残留并继续", async (t) => {
  const root = await fixture(t);
  await createRequirementClaimStateFile(root, pending());
  const source = await readRequirementClaimState(root, REQUIREMENT);
  if (source === null) throw new Error("Expected pending claim.");
  const held = await holdLockInChildProcess(
    root.absolutePath,
    `.wakeflow-active/current/board/locks/${REQUIREMENT}.lock`,
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
  t.after(async () => {
    await root.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return root;
}

// W29（R-ROOT-02）：旧实现锁外列举、只对索引文件做 CAS，一次读完 pending 后被挂起的旧刷新会在
// withdrawn 的新刷新之后把索引写回 pending。现在列举与发布都在 `locks/index.lock` 内：锁被他人持有时
// 刷新既不列举也不发布，拿到锁后看到的已是新状态。本进程持有的租约对刷新而言是活动 owner，不会被退休。
test("索引刷新在看板级锁内列举并发布：锁被他人持有时不发布，释放后列举到的是 withdrawn，索引不再写回 pending（W29，R-ROOT-02）", async (t) => {
  const root = await fixture(t);
  await createRequirementClaimStateFile(root, pending());
  const source = await readRequirementClaimState(root, REQUIREMENT);
  if (source === null) throw new Error("expected a state");
  const lease = await acquireRootedExclusiveFileLock(root, INDEX_LOCK_REF);
  const refresh = refreshRequirementBoardIndex(root);
  try {
    // 状态写入只持状态锁：索引锁被占不阻塞权威状态的提交（两把锁互不嵌套）。
    await replaceRequirementClaimStateFile(
      root,
      source,
      withdrawRequirementClaim(source.state, "不做了", LATER),
    );
    equal((await readRequirementClaimState(root, REQUIREMENT))?.state.status, "withdrawn");
    // 刷新还在等锁：它没有在锁外列举到 pending 后把索引写出来。
    equal(existsSync(indexPath(root)), false);
  } finally {
    await lease.release();
  }
  const digest = await refresh;
  const index = readFileSync(indexPath(root), "utf8");
  equal(index, renderRequirementBoardIndex((await listRequirementClaimStates(root)).states));
  equal(index.includes(REQUIREMENT), false);
  equal(index.includes("| pending |"), false);
  // 再刷新一次是幂等的：同一投影，同一摘要。
  equal(await refreshRequirementBoardIndex(root), digest);
});

test("索引锁的真实持有进程死亡后，刷新退休残留并继续；排在活动持有者之后的两次刷新各自在锁内列举，索引收敛到当前状态（W29）", async (t) => {
  const root = await fixture(t);
  await createRequirementClaimStateFile(root, pending());
  const held = await holdLockInChildProcess(root.absolutePath, INDEX_LOCK);
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
  // 活动持有者释放之前排队的两次刷新都在释放后才列举：两次看到同一状态，索引与权威一致。
  const lease = await acquireRootedExclusiveFileLock(root, INDEX_LOCK_REF);
  const refreshes = Promise.all([
    refreshRequirementBoardIndex(root),
    refreshRequirementBoardIndex(root),
  ]);
  try {
    equal(await createRequirementClaimStateFile(root, pending(OTHER, "P0")), "created");
  } finally {
    await lease.release();
  }
  const [first, second] = await refreshes;
  equal(first, second);
  const index = readFileSync(indexPath(root), "utf8");
  equal(index, renderRequirementBoardIndex((await listRequirementClaimStates(root)).states));
  equal(index.split("\n").filter((line) => /^\| P[0-3] \|/u.test(line)).length, 2);
});

test("索引锁被活动持有者占着时，带信号的刷新按中止收敛（io-failure，reason 以 -aborted 结尾），不发布索引（W29）", async (t) => {
  const root = await fixture(t);
  await createRequirementClaimStateFile(root, pending());
  const lease = await acquireRootedExclusiveFileLock(root, INDEX_LOCK_REF);
  try {
    await rejects(
      refreshRequirementBoardIndex(root, AbortSignal.timeout(100)),
      (error: unknown) =>
        error instanceof WakeflowError &&
        error.code === "io-failure" &&
        error.reason.endsWith("-aborted"),
    );
  } finally {
    await lease.release();
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
