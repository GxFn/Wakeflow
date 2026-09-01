import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  createTaskPackage,
  TaskPackageError,
  type TestTaskPackage,
} from "../tasking/task-package.js";
import { parseTestCard, TestCardError, type TestCard } from "./test-card.js";

/**
 * Wakeflow Governance / Testing：从一份已持久化TestCard确定性派生Test TaskPackage。
 *
 * TaskPackage只承担目标窗口分配、Authority导航和任务完成边界，不复制approved plan、
 * environment操作或结果判断；这些内容继续由TestCard唯一拥有。Delivery attempt和Test
 * Result属于后续owner，不能在本投影中提前出现。
 */

export interface CreateTestTaskPackageInput {
  readonly configDigest: Sha256Digest;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly testCard: Readonly<TestCard>;
}

export interface CreateTestTaskPackageOptions {
  readonly clock?: UtcWallClock;
}

export type TestTaskPackageErrorReason = "input" | "test-card" | "task-package";

const ERROR_MESSAGES = {
  input: "Test TaskPackage input is invalid.",
  "test-card": "Test TaskPackage requires a valid TestCard.",
  "task-package": "Test TaskPackage projection is invalid.",
} as const satisfies Readonly<Record<TestTaskPackageErrorReason, string>>;

/** TestCard无法派生一份闭合Test TaskPackage时的稳定错误。 */
export class TestTaskPackageError extends Error {
  override readonly name = "TestTaskPackageError";
  readonly code = "wakeflow-test-task-package" as const;
  readonly reason: TestTaskPackageErrorReason;

  constructor(reason: TestTaskPackageErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: TestTaskPackageErrorReason): never {
  throw new TestTaskPackageError(reason);
}

function exactInput(value: unknown): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$input");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  const fields = ["configDigest", "taskPackageId", "testCard"] as const;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  ) {
    fail("input");
  }
  return record;
}

function uniqueTextList(
  values: readonly [string, ...string[]],
): readonly [string, ...string[]] {
  const unique = [...new Set(values)];
  const first = unique[0];
  if (first === undefined) fail("test-card");
  return Object.freeze([first, ...unique.slice(1)]);
}

/** 从TestCard派生唯一Test TaskPackage内容，并在最后读取创建时钟。 */
export function createTestTaskPackage(
  inputValue: unknown,
  options: CreateTestTaskPackageOptions = {},
): Readonly<TestTaskPackage> {
  const input = exactInput(inputValue);
  let testCard: Readonly<TestCard>;
  try {
    testCard = parseTestCard(input.testCard);
  } catch (error: unknown) {
    if (error instanceof TestCardError) fail("test-card");
    throw error;
  }
  const selectedAuthorityRefs = [
    ...testCard.testBasisAuthorities,
    testCard.environmentAuthority,
  ].sort((left, right) =>
    left.memberRef < right.memberRef
      ? -1
      : left.memberRef > right.memberRef
        ? 1
        : 0,
  );
  let taskPackage;
  try {
    taskPackage = createTaskPackage(
      {
        programId: testCard.programId,
        configDigest: input.configDigest,
        demandId: testCard.demandId,
        demandAuthorityDigest: testCard.demandAuthorityDigest,
        taskPackageId: input.taskPackageId,
        targetTaskId: testCard.targetTaskId,
        assignment: { windowId: testCard.testWindowId },
        workType: "test",
        objective: testCard.question,
        confirmedContext: testCard.controllerSelfChecks,
        selectedAuthorityRefs,
        boundaries: {
          inScope: uniqueTextList([
            testCard.objectBoundary,
            ...testCard.realScenarioConditions,
          ]),
          outOfScope: testCard.cannotConclude,
          forbidden: testCard.forbiddenOperations,
        },
        completionExpectations: testCard.evidenceRequired,
        acceptanceAnchors: [],
        testCard: {
          testCardId: testCard.testCardId,
          testCardDigest: testCard.testCardDigest,
        },
      },
      options,
    );
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) fail("task-package");
    throw error;
  }
  if (taskPackage.workType !== "test") fail("task-package");
  // createdAt只保存审计观察；TestCard来源关系与Event顺序由authority、digest和append CAS证明。
  return taskPackage;
}

/** 复验一份Test TaskPackage是否仍是指定TestCard的确定性投影。 */
export function assertTestTaskPackageMatchesTestCard(
  taskPackage: Readonly<TestTaskPackage>,
  testCard: Readonly<TestCard>,
): void {
  const expected = createTestTaskPackage(
    {
      configDigest: taskPackage.configDigest,
      taskPackageId: taskPackage.taskPackageId,
      testCard,
    },
    { clock: () => taskPackage.createdAt },
  );
  if (
    canonicalizeJson(expected, "$expectedTestTaskPackage") !==
    canonicalizeJson(taskPackage, "$testTaskPackage")
  ) {
    fail("task-package");
  }
}
