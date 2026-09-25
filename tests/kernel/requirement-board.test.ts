import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
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
  renderRequirementBoardIndex,
  replaceRequirementClaimStateFile,
  withdrawRequirementClaim,
} from "../../src/kernel/requirement-board.js";

const AT = parseUtcInstant("2026-09-04T10:00:00.000Z");
const LATER = parseUtcInstant("2026-09-04T11:00:00.000Z");
const REQUIREMENT = "requirement_77777777-7777-4777-8777-777777777777";
const OTHER = "requirement_88888888-8888-4888-8888-888888888888";
const DEMAND = "demand_99999999-9999-4999-8999-999999999999";

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
