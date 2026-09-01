import type { WakeflowTargetHostEffectRearm as RearmWire } from "../../contracts/generated/governance/delivery/target-host-effect-rearm.generated.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_REARM_SCHEMA } from "../../contracts/generated/governance/delivery/target-host-effect-rearm.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA } from "../../contracts/generated/governance/delivery/target-delivery-intent.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA } from "../../contracts/generated/workspace/window-host-binding.generated.js";
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
import { parseUuidV4 } from "../../foundation/identity/uuid-v4.js";
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
  parseWindowWorkClaimId,
  WindowWorkClaimError,
  type WindowWorkClaimId,
} from "./window-work-claim.js";

/**
 * Wakeflow Governance / Delivery：精确 rejected-before-effect 尾部的显式 Rearm。
 *
 * Rearm 只把同一 Target Delivery 恢复为 `delivery-prepared`；它不执行宿主效果、不
 * 复用旧 Claim，也不表示自动重试。下一次效果必须重新取得全新 WindowWorkClaim。
 */

const REARM_KIND = "WakeflowTargetHostEffectRearm" as const;
const REARM_SCHEMA_VERSION = 1 as const;
const EVENT_ID_PREFIX = "demand-event_";
const COMMIT_ID_PREFIX = "demand-event-commit_";

export interface TargetHostEffectRearm {
  readonly kind: typeof REARM_KIND;
  readonly schemaVersion: typeof REARM_SCHEMA_VERSION;
  readonly target: Readonly<{
    readonly demandId: WakeflowDurableId<"demand">;
    readonly targetTaskId: WakeflowDurableId<"target-task">;
    readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  }>;
  readonly rejectedAttempt: Readonly<{
    readonly claimId: WindowWorkClaimId;
    readonly claimDigest: Sha256Digest;
    readonly claimEventId: WakeflowDurableId<"demand-event">;
    readonly claimCommitId: WakeflowDurableId<"demand-event-commit">;
    readonly observationDigest: Sha256Digest;
  }>;
  /** Rearm记录的审计时间；Rejected Attempt因果顺序由Event引用与CAS建立。 */
  readonly rearmedAt: UtcInstant;
  readonly rearmDigest: Sha256Digest;
}

export type CreateTargetHostEffectRearmInput = Omit<
  TargetHostEffectRearm,
  "kind" | "schemaVersion" | "rearmedAt" | "rearmDigest"
>;

export interface CreateTargetHostEffectRearmOptions {
  readonly clock?: UtcWallClock;
}

export type TargetHostEffectRearmErrorReason =
  "json" | "schema" | "identifier" | "digest" | "time" | "representation";

const ERROR_MESSAGES = {
  json: "Target Host Effect Rearm is not passive JSON data.",
  schema: "Target Host Effect Rearm does not satisfy its Schema.",
  identifier: "Target Host Effect Rearm contains an invalid identity.",
  digest:
    "Target Host Effect Rearm contains an invalid or inconsistent digest.",
  time: "Target Host Effect Rearm contains an invalid time.",
  representation: "Target Host Effect Rearm bytes are not deterministic.",
} as const satisfies Readonly<Record<TargetHostEffectRearmErrorReason, string>>;

/** Rearm 准入、创建或确定性表示失败时的稳定错误。 */
export class TargetHostEffectRearmError extends Error {
  override readonly name = "TargetHostEffectRearmError";
  readonly code = "wakeflow-target-host-effect-rearm" as const;
  readonly reason: TargetHostEffectRearmErrorReason;
  readonly path: string;

  constructor(reason: TargetHostEffectRearmErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<RearmWire>(
  WAKEFLOW_TARGET_HOST_EFFECT_REARM_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
  ],
);

function fail(reason: TargetHostEffectRearmErrorReason, path: string): never {
  throw new TargetHostEffectRearmError(reason, path);
}

function id<
  Kind extends
    | "demand"
    | "target-task"
    | "target-delivery"
    | "demand-event"
    | "demand-event-commit",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function claimId(value: unknown, path: string): WindowWorkClaimId {
  try {
    return parseWindowWorkClaimId(value, path);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("identifier", path);
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

function rearmBasis(
  value: Omit<TargetHostEffectRearm, "rearmDigest">,
): Omit<TargetHostEffectRearm, "rearmDigest"> {
  return {
    kind: REARM_KIND,
    schemaVersion: REARM_SCHEMA_VERSION,
    target: value.target,
    rejectedAttempt: value.rejectedAttempt,
    rearmedAt: value.rearmedAt,
  };
}

export function parseTargetHostEffectRearm(
  value: unknown,
): Readonly<TargetHostEffectRearm> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$rearm");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  const basis = rearmBasis({
    kind: REARM_KIND,
    schemaVersion: REARM_SCHEMA_VERSION,
    target: Object.freeze({
      demandId: id(wire.target.demandId, "demand", "$/target/demandId"),
      targetTaskId: id(
        wire.target.targetTaskId,
        "target-task",
        "$/target/targetTaskId",
      ),
      targetDeliveryId: id(
        wire.target.targetDeliveryId,
        "target-delivery",
        "$/target/targetDeliveryId",
      ),
    }),
    rejectedAttempt: Object.freeze({
      claimId: claimId(
        wire.rejectedAttempt.claimId,
        "$/rejectedAttempt/claimId",
      ),
      claimDigest: digest(
        wire.rejectedAttempt.claimDigest,
        "$/rejectedAttempt/claimDigest",
      ),
      claimEventId: id(
        wire.rejectedAttempt.claimEventId,
        "demand-event",
        "$/rejectedAttempt/claimEventId",
      ),
      claimCommitId: id(
        wire.rejectedAttempt.claimCommitId,
        "demand-event-commit",
        "$/rejectedAttempt/claimCommitId",
      ),
      observationDigest: digest(
        wire.rejectedAttempt.observationDigest,
        "$/rejectedAttempt/observationDigest",
      ),
    }),
    rearmedAt: instant(wire.rearmedAt, "$/rearmedAt"),
  });
  const rearmDigest = digest(wire.rearmDigest, "$/rearmDigest");
  if (computeCanonicalJsonSha256Digest(basis) !== rearmDigest) {
    fail("digest", "$/rearmDigest");
  }
  return Object.freeze({ ...basis, rearmDigest });
}

/** 从当前rejected attempt和墙上时钟创建一次显式Rearm；墙钟只进入审计记录。 */
export function createTargetHostEffectRearm(
  input: Readonly<CreateTargetHostEffectRearmInput>,
  options: CreateTargetHostEffectRearmOptions = {},
): Readonly<TargetHostEffectRearm> {
  let rearmedAt: UtcInstant;
  try {
    rearmedAt =
      options.clock === undefined
        ? readUtcWallClock()
        : readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  const basis = rearmBasis({
    kind: REARM_KIND,
    schemaVersion: REARM_SCHEMA_VERSION,
    target: input.target,
    rejectedAttempt: input.rejectedAttempt,
    rearmedAt,
  });
  return parseTargetHostEffectRearm({
    ...basis,
    rearmDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

function uuidFromTypedId(value: string, prefix: string) {
  return parseUuidV4(value.slice(prefix.length));
}

/** Rearm Event 使用原 Claim Commit 的独立 UUID，形成稳定幂等身份。 */
export function targetHostEffectRearmEventId(
  value: unknown,
): WakeflowDurableId<"demand-event"> {
  const rearm = parseTargetHostEffectRearm(value);
  return createWakeflowDurableId(
    "demand-event",
    uuidFromTypedId(rearm.rejectedAttempt.claimCommitId, COMMIT_ID_PREFIX),
  );
}

/** Rearm Commit 使用原 Claim Event 的独立 UUID，形成稳定幂等身份。 */
export function targetHostEffectRearmCommitId(
  value: unknown,
): WakeflowDurableId<"demand-event-commit"> {
  const rearm = parseTargetHostEffectRearm(value);
  return createWakeflowDurableId(
    "demand-event-commit",
    uuidFromTypedId(rearm.rejectedAttempt.claimEventId, EVENT_ID_PREFIX),
  );
}

export function renderTargetHostEffectRearm(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseTargetHostEffectRearm(value),
    "$rearm",
  );
}

export function parseTargetHostEffectRearmDocument(
  text: unknown,
): Readonly<TargetHostEffectRearm> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$rearm");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$rearm");
    }
    throw error;
  }
  const rearm = parseTargetHostEffectRearm(json);
  if (renderTargetHostEffectRearm(rearm) !== text) {
    fail("representation", "$rearm");
  }
  return rearm;
}
