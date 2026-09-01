import type { WakeflowTestExecutionAttempt as TestExecutionAttemptWire } from "../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import { WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA } from "../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import { WAKEFLOW_TEST_CARD_SCHEMA } from "../../contracts/generated/governance/testing/test-card.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseTestCard,
  TestCardError,
  type TestCard,
  type TestCardSetupPolicy,
} from "./test-card.js";

/**
 * Wakeflow Governance / Testing：一次Controller授权的逻辑Test执行attempt。
 *
 * Initial与rerun attempt都表示一次Controller授权的真实Test执行。它与host-send attempt
 * 严格分离：同一投递在宿主效果前的替代授权不能创建新Test attempt。环境setup字段是
 * Test执行前必须落实的指令，不是完成回执，也不授权Wakeflow直接操作环境。
 */

const ATTEMPT_KIND = "WakeflowTestExecutionAttempt" as const;
const ATTEMPT_SCHEMA_VERSION = 1 as const;

export type TestEnvironmentSetupDirective =
  "prepare-fresh-environment" | "reuse-confirmed-environment";

interface TestExecutionAttemptBase {
  readonly kind: typeof ATTEMPT_KIND;
  readonly schemaVersion: typeof ATTEMPT_SCHEMA_VERSION;
  readonly testAttemptId: WakeflowDurableId<"test-attempt">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly testCard: Readonly<{
    readonly testCardId: WakeflowDurableId<"test-card">;
    readonly testCardDigest: Sha256Digest;
  }>;
  readonly environmentSetup: Readonly<{
    readonly policy: TestCardSetupPolicy;
    readonly directive: TestEnvironmentSetupDirective;
  }>;
}

export interface InitialTestExecutionAttempt extends TestExecutionAttemptBase {
  readonly ordinal: 1;
  readonly mode: "initial";
  readonly rerunSource?: never;
}

export interface RerunTestExecutionAttempt extends TestExecutionAttemptBase {
  readonly ordinal: number;
  readonly mode: "rerun";
  readonly rerunSource: Readonly<{
    readonly previousAttemptId: WakeflowDurableId<"test-attempt">;
    readonly previousResult: Readonly<{
      readonly targetResultId: WakeflowDurableId<"target-result">;
      readonly resultDigest: Sha256Digest;
    }>;
    readonly reviewDecision: Readonly<{
      readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
      readonly decisionDigest: Sha256Digest;
    }>;
  }>;
}

export type TestExecutionAttempt =
  InitialTestExecutionAttempt | RerunTestExecutionAttempt;

export interface CreateInitialTestExecutionAttemptInput {
  readonly testAttemptId: WakeflowDurableId<"test-attempt">;
  readonly testCard: Readonly<TestCard>;
}

export interface CreateRerunTestExecutionAttemptInput {
  readonly testAttemptId: WakeflowDurableId<"test-attempt">;
  readonly testCard: Readonly<TestCard>;
  readonly previousAttempt: Readonly<TestExecutionAttempt>;
  readonly previousResult: RerunTestExecutionAttempt["rerunSource"]["previousResult"];
  readonly reviewDecision: RerunTestExecutionAttempt["rerunSource"]["reviewDecision"];
}

export type TestExecutionAttemptErrorReason =
  "json" | "schema" | "identifier" | "digest" | "test-card" | "relation";

const ERROR_MESSAGES = {
  json: "Test execution attempt is not passive JSON data.",
  schema: "Test execution attempt does not satisfy its Schema.",
  identifier: "Test execution attempt contains an invalid typed identity.",
  digest: "Test execution attempt contains an invalid digest.",
  "test-card": "Test execution attempt requires a valid TestCard.",
  relation: "Test execution attempt does not match its TestCard.",
} as const satisfies Readonly<Record<TestExecutionAttemptErrorReason, string>>;

/** Test execution attempt准入或来源闭合失败时的稳定错误。 */
export class TestExecutionAttemptError extends Error {
  override readonly name = "TestExecutionAttemptError";
  readonly code = "wakeflow-test-execution-attempt" as const;
  readonly reason: TestExecutionAttemptErrorReason;
  readonly path: string;

  constructor(reason: TestExecutionAttemptErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<TestExecutionAttemptWire>(
  WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TEST_CARD_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

function fail(reason: TestExecutionAttemptErrorReason, path: string): never {
  throw new TestExecutionAttemptError(reason, path);
}

function id<
  Kind extends
    | "target-task"
    | "test-attempt"
    | "test-card"
    | "target-result"
    | "target-review-decision",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function setupDirective(
  policy: TestCardSetupPolicy,
  mode: TestExecutionAttempt["mode"],
): TestEnvironmentSetupDirective {
  return policy === "reuse-existing" ||
    (policy === "fresh-once" && mode === "rerun")
    ? "reuse-confirmed-environment"
    : "prepare-fresh-environment";
}

/** 解析并冻结只表达initial语义的Test execution attempt。 */
export function parseTestExecutionAttempt(
  value: unknown,
): Readonly<TestExecutionAttempt> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$attempt");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const common = {
    kind: ATTEMPT_KIND,
    schemaVersion: ATTEMPT_SCHEMA_VERSION,
    testAttemptId: id(wire.testAttemptId, "test-attempt", "$/testAttemptId"),
    targetTaskId: id(wire.targetTaskId, "target-task", "$/targetTaskId"),
    testCard: Object.freeze({
      testCardId: id(
        wire.testCard.testCardId,
        "test-card",
        "$/testCard/testCardId",
      ),
      testCardDigest: digest(
        wire.testCard.testCardDigest,
        "$/testCard/testCardDigest",
      ),
    }),
    environmentSetup: Object.freeze({
      policy: wire.environmentSetup.policy,
      directive: wire.environmentSetup.directive,
    }),
  } as const;
  if (wire.mode === "initial") {
    return Object.freeze({
      ...common,
      ordinal: 1 as const,
      mode: "initial" as const,
    });
  }
  if (wire.rerunSource === undefined) fail("schema", "$/rerunSource");
  const rerunSource = Object.freeze({
    previousAttemptId: id(
      wire.rerunSource.previousAttemptId,
      "test-attempt",
      "$/rerunSource/previousAttemptId",
    ),
    previousResult: Object.freeze({
      targetResultId: id(
        wire.rerunSource.previousResult.targetResultId,
        "target-result",
        "$/rerunSource/previousResult/targetResultId",
      ),
      resultDigest: digest(
        wire.rerunSource.previousResult.resultDigest,
        "$/rerunSource/previousResult/resultDigest",
      ),
    }),
    reviewDecision: Object.freeze({
      targetReviewDecisionId: id(
        wire.rerunSource.reviewDecision.targetReviewDecisionId,
        "target-review-decision",
        "$/rerunSource/reviewDecision/targetReviewDecisionId",
      ),
      decisionDigest: digest(
        wire.rerunSource.reviewDecision.decisionDigest,
        "$/rerunSource/reviewDecision/decisionDigest",
      ),
    }),
  });
  const testAttemptId = common.testAttemptId;
  if (rerunSource.previousAttemptId === testAttemptId) {
    fail("relation", "$/rerunSource/previousAttemptId");
  }
  return Object.freeze({
    ...common,
    ordinal: wire.ordinal,
    mode: "rerun" as const,
    rerunSource,
  });
}

/** 从一份已准入TestCard创建首个逻辑attempt。 */
export function createInitialTestExecutionAttempt(
  input: Readonly<CreateInitialTestExecutionAttemptInput>,
): Readonly<TestExecutionAttempt> {
  let testCard: Readonly<TestCard>;
  try {
    testCard = parseTestCard(input.testCard);
  } catch (error: unknown) {
    if (error instanceof TestCardError) fail("test-card", "$testCard");
    throw error;
  }
  return parseTestExecutionAttempt({
    kind: ATTEMPT_KIND,
    schemaVersion: ATTEMPT_SCHEMA_VERSION,
    testAttemptId: input.testAttemptId,
    targetTaskId: testCard.targetTaskId,
    testCard: {
      testCardId: testCard.testCardId,
      testCardDigest: testCard.testCardDigest,
    },
    ordinal: 1,
    mode: "initial",
    environmentSetup: {
      policy: testCard.setupPolicy,
      directive: setupDirective(testCard.setupPolicy, "initial"),
    },
  });
}

/** 从上一attempt和已验证的Result/Decision tuple创建下一次真实rerun。 */
export function createRerunTestExecutionAttempt(
  input: Readonly<CreateRerunTestExecutionAttemptInput>,
): Readonly<RerunTestExecutionAttempt> {
  const previousAttempt = parseTestExecutionAttempt(input.previousAttempt);
  let testCard: Readonly<TestCard>;
  try {
    testCard = parseTestCard(input.testCard);
  } catch (error: unknown) {
    if (error instanceof TestCardError) fail("test-card", "$testCard");
    throw error;
  }
  assertTestExecutionAttemptMatchesCard(previousAttempt, testCard);
  const ordinal = previousAttempt.ordinal + 1;
  if (ordinal > testCard.maxAttempts) fail("relation", "$/ordinal");
  const attempt = parseTestExecutionAttempt({
    kind: ATTEMPT_KIND,
    schemaVersion: ATTEMPT_SCHEMA_VERSION,
    testAttemptId: input.testAttemptId,
    targetTaskId: testCard.targetTaskId,
    testCard: {
      testCardId: testCard.testCardId,
      testCardDigest: testCard.testCardDigest,
    },
    ordinal,
    mode: "rerun",
    environmentSetup: {
      policy: testCard.setupPolicy,
      directive: setupDirective(testCard.setupPolicy, "rerun"),
    },
    rerunSource: {
      previousAttemptId: previousAttempt.testAttemptId,
      previousResult: input.previousResult,
      reviewDecision: input.reviewDecision,
    },
  });
  if (attempt.mode !== "rerun") fail("relation", "$/mode");
  return attempt;
}

/** 复验attempt仍绑定同一TestCard及其setup策略。 */
export function assertTestExecutionAttemptMatchesCard(
  attemptValue: unknown,
  testCardValue: unknown,
): void {
  const attempt = parseTestExecutionAttempt(attemptValue);
  let testCard: Readonly<TestCard>;
  try {
    testCard = parseTestCard(testCardValue);
  } catch (error: unknown) {
    if (error instanceof TestCardError) fail("test-card", "$testCard");
    throw error;
  }
  if (
    attempt.targetTaskId !== testCard.targetTaskId ||
    attempt.testCard.testCardId !== testCard.testCardId ||
    attempt.testCard.testCardDigest !== testCard.testCardDigest ||
    attempt.environmentSetup.policy !== testCard.setupPolicy ||
    attempt.environmentSetup.directive !==
      setupDirective(testCard.setupPolicy, attempt.mode) ||
    attempt.ordinal > testCard.maxAttempts
  ) {
    fail("relation", "$attempt");
  }
}

/** 复验rerun紧接上一attempt且没有跨越或分叉lineage。 */
export function assertRerunTestExecutionAttemptFollows(
  rerunValue: unknown,
  previousValue: unknown,
): void {
  const rerun = parseTestExecutionAttempt(rerunValue);
  const previous = parseTestExecutionAttempt(previousValue);
  if (
    rerun.mode !== "rerun" ||
    rerun.ordinal !== previous.ordinal + 1 ||
    rerun.targetTaskId !== previous.targetTaskId ||
    rerun.testCard.testCardId !== previous.testCard.testCardId ||
    rerun.testCard.testCardDigest !== previous.testCard.testCardDigest ||
    rerun.rerunSource.previousAttemptId !== previous.testAttemptId
  ) {
    fail("relation", "$attempt");
  }
}
