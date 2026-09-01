import type { WakeflowControllerTargetReviewResume as ResumeWire } from "../../contracts/generated/governance/review/controller-target-review-resume.generated.js";
import { WAKEFLOW_CONTROLLER_TARGET_REVIEW_RESUME_SCHEMA } from "../../contracts/generated/governance/review/controller-target-review-resume.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  createUuidV4,
  parseUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../../foundation/identity/uuid-v4.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import {
  parseDemandEventStreamRevision,
  DemandEventStreamPositionError,
  type DemandEventStreamRevision,
} from "../demand/event-sourcing/demand-event-stream-position.js";

/**
 * Wakeflow Governance / Review：从精确blocked Decision恢复同一Result审查资格。
 *
 * Resume只陈述阻断条件已具备重新审查的基础。旧Decision保持不可变；Controller必须
 * 重新读取Review Snapshot并运行独立检查，才能产生下一代Decision。
 */

const RESUME_KIND = "WakeflowControllerTargetReviewResume" as const;
const RESUME_SCHEMA_VERSION = 1 as const;
const RESUME_ID_PREFIX = "target-review-resume_";
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

export interface ControllerTargetReviewResume {
  readonly kind: typeof RESUME_KIND;
  readonly schemaVersion: typeof RESUME_SCHEMA_VERSION;
  readonly targetReviewResumeId: WakeflowDurableId<"target-review-resume">;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly blockedDecision: Readonly<{
    readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
    readonly decisionDigest: Sha256Digest;
    readonly targetResultId: WakeflowDurableId<"target-result">;
    readonly targetResultDigest: Sha256Digest;
  }>;
  readonly blockedSource: Readonly<{
    readonly snapshotDigest: Sha256Digest;
    readonly stateDigest: Sha256Digest;
    readonly streamRevision: DemandEventStreamRevision;
  }>;
  readonly resolutionSummary: string;
  readonly resumedAt: UtcInstant;
  readonly resumeDigest: Sha256Digest;
}

export type CreateControllerTargetReviewResumeInput = Omit<
  ControllerTargetReviewResume,
  | "kind"
  | "schemaVersion"
  | "targetReviewResumeId"
  | "resumedAt"
  | "resumeDigest"
>;

export interface CreateControllerTargetReviewResumeOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
}

export type ControllerTargetReviewResumeErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "position"
  | "time"
  | "text"
  | "representation";

const ERROR_MESSAGES = {
  json: "Controller Target Review Resume is not passive JSON data.",
  schema: "Controller Target Review Resume does not satisfy its Schema.",
  identifier: "Controller Target Review Resume contains an invalid identity.",
  digest:
    "Controller Target Review Resume contains an invalid or inconsistent digest.",
  position:
    "Controller Target Review Resume contains an invalid Event Stream position.",
  time: "Controller Target Review Resume contains an invalid time.",
  text: "Controller Target Review Resume contains invalid resolution text.",
  representation:
    "Controller Target Review Resume bytes are not deterministic.",
} as const satisfies Readonly<
  Record<ControllerTargetReviewResumeErrorReason, string>
>;

export class ControllerTargetReviewResumeError extends Error {
  override readonly name = "ControllerTargetReviewResumeError";
  readonly code = "wakeflow-controller-target-review-resume" as const;
  readonly reason: ControllerTargetReviewResumeErrorReason;
  readonly path: string;

  constructor(reason: ControllerTargetReviewResumeErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<ResumeWire>(
  WAKEFLOW_CONTROLLER_TARGET_REVIEW_RESUME_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

function fail(
  reason: ControllerTargetReviewResumeErrorReason,
  path: string,
): never {
  throw new ControllerTargetReviewResumeError(reason, path);
}

function id<
  Kind extends
    | "target-review-resume"
    | "target-review-decision"
    | "target-result"
    | "program"
    | "demand"
    | "target-task"
    | "window",
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

function instant(value: unknown, path: string): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", path);
    throw error;
  }
}

function streamRevision(
  value: unknown,
  path: string,
): DemandEventStreamRevision {
  try {
    return parseDemandEventStreamRevision(value, path);
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) {
      fail("position", path);
    }
    throw error;
  }
}

function text(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8192 ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", path);
  }
  return value;
}

function resumeBasis(
  value: Omit<ControllerTargetReviewResume, "resumeDigest">,
): Omit<ControllerTargetReviewResume, "resumeDigest"> {
  return {
    kind: RESUME_KIND,
    schemaVersion: RESUME_SCHEMA_VERSION,
    targetReviewResumeId: value.targetReviewResumeId,
    programId: value.programId,
    demandId: value.demandId,
    targetTaskId: value.targetTaskId,
    controllerWindowId: value.controllerWindowId,
    blockedDecision: value.blockedDecision,
    blockedSource: value.blockedSource,
    resolutionSummary: value.resolutionSummary,
    resumedAt: value.resumedAt,
  };
}

export function parseControllerTargetReviewResume(
  value: unknown,
): Readonly<ControllerTargetReviewResume> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$resume");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const basis = resumeBasis({
    kind: RESUME_KIND,
    schemaVersion: RESUME_SCHEMA_VERSION,
    targetReviewResumeId: id(
      wire.targetReviewResumeId,
      "target-review-resume",
      "$/targetReviewResumeId",
    ),
    programId: id(wire.programId, "program", "$/programId"),
    demandId: id(wire.demandId, "demand", "$/demandId"),
    targetTaskId: id(wire.targetTaskId, "target-task", "$/targetTaskId"),
    controllerWindowId: id(
      wire.controllerWindowId,
      "window",
      "$/controllerWindowId",
    ),
    blockedDecision: Object.freeze({
      targetReviewDecisionId: id(
        wire.blockedDecision.targetReviewDecisionId,
        "target-review-decision",
        "$/blockedDecision/targetReviewDecisionId",
      ),
      decisionDigest: digest(
        wire.blockedDecision.decisionDigest,
        "$/blockedDecision/decisionDigest",
      ),
      targetResultId: id(
        wire.blockedDecision.targetResultId,
        "target-result",
        "$/blockedDecision/targetResultId",
      ),
      targetResultDigest: digest(
        wire.blockedDecision.targetResultDigest,
        "$/blockedDecision/targetResultDigest",
      ),
    }),
    blockedSource: Object.freeze({
      snapshotDigest: digest(
        wire.blockedSource.snapshotDigest,
        "$/blockedSource/snapshotDigest",
      ),
      stateDigest: digest(
        wire.blockedSource.stateDigest,
        "$/blockedSource/stateDigest",
      ),
      streamRevision: streamRevision(
        wire.blockedSource.streamRevision,
        "$/blockedSource/streamRevision",
      ),
    }),
    resolutionSummary: text(wire.resolutionSummary, "$/resolutionSummary"),
    resumedAt: instant(wire.resumedAt, "$/resumedAt"),
  });
  const resumeDigest = digest(wire.resumeDigest, "$/resumeDigest");
  if (computeCanonicalJsonSha256Digest(basis) !== resumeDigest) {
    fail("digest", "$/resumeDigest");
  }
  return Object.freeze({ ...basis, resumeDigest });
}

export function createControllerTargetReviewResume(
  input: Readonly<CreateControllerTargetReviewResumeInput>,
  options: CreateControllerTargetReviewResumeOptions = {},
): Readonly<ControllerTargetReviewResume> {
  let targetReviewResumeId: WakeflowDurableId<"target-review-resume">;
  try {
    targetReviewResumeId = createWakeflowDurableId(
      "target-review-resume",
      createUuidV4(options.uuidFactory),
    );
  } catch (error: unknown) {
    if (
      error instanceof UuidV4Error ||
      error instanceof WakeflowDurableIdError
    ) {
      fail("identifier", "$uuidFactory");
    }
    throw error;
  }
  let resumedAt: UtcInstant;
  try {
    resumedAt =
      options.clock === undefined
        ? readUtcWallClock()
        : readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  const basis = resumeBasis({
    kind: RESUME_KIND,
    schemaVersion: RESUME_SCHEMA_VERSION,
    targetReviewResumeId,
    programId: input.programId,
    demandId: input.demandId,
    targetTaskId: input.targetTaskId,
    controllerWindowId: input.controllerWindowId,
    blockedDecision: input.blockedDecision,
    blockedSource: input.blockedSource,
    resolutionSummary: input.resolutionSummary,
    resumedAt,
  });
  return parseControllerTargetReviewResume({
    ...basis,
    resumeDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

function uuidFromResumeId(value: string) {
  return parseUuidV4(value.slice(RESUME_ID_PREFIX.length));
}

export function controllerTargetReviewResumeEventId(
  value: unknown,
): WakeflowDurableId<"demand-event"> {
  const resume = parseControllerTargetReviewResume(value);
  return createWakeflowDurableId(
    "demand-event",
    uuidFromResumeId(resume.targetReviewResumeId),
  );
}

export function controllerTargetReviewResumeCommitId(
  value: unknown,
): WakeflowDurableId<"demand-event-commit"> {
  const resume = parseControllerTargetReviewResume(value);
  return createWakeflowDurableId(
    "demand-event-commit",
    uuidFromResumeId(resume.targetReviewResumeId),
  );
}

export function renderControllerTargetReviewResume(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseControllerTargetReviewResume(value),
    "$resume",
  );
}

export function parseControllerTargetReviewResumeDocument(
  textValue: unknown,
): Readonly<ControllerTargetReviewResume> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(textValue, "$resume");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$resume");
    }
    throw error;
  }
  const resume = parseControllerTargetReviewResume(json);
  if (renderControllerTargetReviewResume(resume) !== textValue) {
    fail("representation", "$resume");
  }
  return resume;
}
