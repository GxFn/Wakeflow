import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

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
  // 同一记录重放（发布时间不同）仍是 current；另一份记录占同一标识才是冲突。
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
