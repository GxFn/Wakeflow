import type { WakeflowTestCardGenerationSource as GenerationSourceWire } from "../../contracts/generated/governance/testing/test-card-generation-source.generated.js";
import { WAKEFLOW_TEST_CARD_GENERATION_SOURCE_SCHEMA } from "../../contracts/generated/governance/testing/test-card-generation-source.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
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

/** TestCard创建原因；Event拥有该事实，TestCard本体不复制历史lineage。 */

export type TestCardGenerationSource =
  | Readonly<{
      readonly kind: "initial";
    }>
  | Readonly<{
      readonly kind: "product-defect-retest";
      readonly previousTestCard: Readonly<{
        readonly testCardId: WakeflowDurableId<"test-card">;
        readonly testCardDigest: Sha256Digest;
      }>;
      readonly testReviewDecision: Readonly<{
        readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
        readonly decisionDigest: Sha256Digest;
      }>;
      readonly productDefectRemediation: Readonly<{
        readonly productDefectRemediationId: WakeflowDurableId<"product-defect-remediation">;
        readonly authorizationDigest: Sha256Digest;
      }>;
    }>;

export type TestCardGenerationSourceErrorReason =
  "json" | "schema" | "identifier" | "digest";

const ERROR_MESSAGES = {
  json: "TestCard Generation Source is not passive JSON data.",
  schema: "TestCard Generation Source does not satisfy its Schema.",
  identifier: "TestCard Generation Source contains an invalid identity.",
  digest: "TestCard Generation Source contains an invalid digest.",
} as const satisfies Readonly<
  Record<TestCardGenerationSourceErrorReason, string>
>;

export class TestCardGenerationSourceError extends Error {
  override readonly name = "TestCardGenerationSourceError";
  readonly code = "wakeflow-test-card-generation-source" as const;
  readonly reason: TestCardGenerationSourceErrorReason;
  readonly path: string;

  constructor(reason: TestCardGenerationSourceErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<GenerationSourceWire>(
  WAKEFLOW_TEST_CARD_GENERATION_SOURCE_SCHEMA,
  [WAKEFLOW_SHA256_DIGEST_SCHEMA],
);

function fail(
  reason: TestCardGenerationSourceErrorReason,
  path: string,
): never {
  throw new TestCardGenerationSourceError(reason, path);
}

function id<
  Kind extends
    "test-card" | "target-review-decision" | "product-defect-remediation",
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

export function parseTestCardGenerationSource(
  value: unknown,
): Readonly<TestCardGenerationSource> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$generationSource");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  if (wire.kind === "initial") {
    return Object.freeze({ kind: "initial" as const });
  }
  return Object.freeze({
    kind: "product-defect-retest" as const,
    previousTestCard: Object.freeze({
      testCardId: id(
        wire.previousTestCard.testCardId,
        "test-card",
        "$/previousTestCard/testCardId",
      ),
      testCardDigest: digest(
        wire.previousTestCard.testCardDigest,
        "$/previousTestCard/testCardDigest",
      ),
    }),
    testReviewDecision: Object.freeze({
      targetReviewDecisionId: id(
        wire.testReviewDecision.targetReviewDecisionId,
        "target-review-decision",
        "$/testReviewDecision/targetReviewDecisionId",
      ),
      decisionDigest: digest(
        wire.testReviewDecision.decisionDigest,
        "$/testReviewDecision/decisionDigest",
      ),
    }),
    productDefectRemediation: Object.freeze({
      productDefectRemediationId: id(
        wire.productDefectRemediation.productDefectRemediationId,
        "product-defect-remediation",
        "$/productDefectRemediation/productDefectRemediationId",
      ),
      authorizationDigest: digest(
        wire.productDefectRemediation.authorizationDigest,
        "$/productDefectRemediation/authorizationDigest",
      ),
    }),
  });
}
