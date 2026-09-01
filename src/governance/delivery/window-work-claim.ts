import type { WakeflowWindowWorkClaim as WindowWorkClaimWire } from "../../contracts/generated/governance/delivery/window-work-claim.generated.js";
import { WAKEFLOW_WINDOW_WORK_CLAIM_SCHEMA } from "../../contracts/generated/governance/delivery/window-work-claim.generated.js";
import { WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA } from "../../contracts/generated/governance/delivery/target-delivery-intent.generated.js";
import { WAKEFLOW_TEST_CARD_SCHEMA } from "../../contracts/generated/governance/testing/test-card.generated.js";
import { WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA } from "../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA } from "../../contracts/generated/workspace/window-host-binding.generated.js";
import {
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
import type { WakeflowWorkspaceHostId } from "../../workspace/workspace-host-resource-profile.js";
import {
  parseWakeflowWindowHostBindingId,
  WakeflowWindowHostBindingIdError,
  type WakeflowWindowHostBindingId,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-id.js";

/**
 * Wakeflow Governance / Delivery：一个稳定窗口的当前持久工作占用权威。
 *
 * Claim 在宿主效果前跨 Demand 排他占用窗口，并预绑定后续 Claim Event/Commit。它没有
 * TTL，不会因进程退出或墙上时间推移自动失效；释放必须由领域 owner 证明精确业务终态。
 * implementation Claim保持历史无判别字节；Test Claim额外绑定logical attempt与
 * target-facing packet digest。进程mutex、raw handle、宿主发送和验收判断都不属于本记录。
 */

const CLAIM_KIND = "WakeflowWindowWorkClaim" as const;
const CLAIM_SCHEMA_VERSION = 1 as const;
const CLAIM_ID_PREFIX = "window_work_claim_" as const;

declare const WINDOW_WORK_CLAIM_ID_BRAND: unique symbol;

export type WindowWorkClaimId = string & {
  readonly [WINDOW_WORK_CLAIM_ID_BRAND]: "WindowWorkClaimId";
};

interface WindowWorkClaimTargetBase {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly intentDigest: Sha256Digest;
  readonly intentPreparedAt: UtcInstant;
}

export interface ImplementationWindowWorkClaimTarget extends WindowWorkClaimTargetBase {
  /** 历史implementation Claim不写入判别字段，保持已有持久字节。 */
  readonly workType?: never;
}

export interface TestWindowWorkClaimTarget extends WindowWorkClaimTargetBase {
  readonly workType: "test";
  readonly testAttemptId: WakeflowDurableId<"test-attempt">;
  readonly testDispatchPacketDigest: Sha256Digest;
}

export type WindowWorkClaimTarget =
  ImplementationWindowWorkClaimTarget | TestWindowWorkClaimTarget;

export interface WindowWorkClaim {
  readonly kind: typeof CLAIM_KIND;
  readonly schemaVersion: typeof CLAIM_SCHEMA_VERSION;
  readonly claimId: WindowWorkClaimId;
  readonly programId: WakeflowDurableId<"program">;
  readonly target: Readonly<WindowWorkClaimTarget>;
  readonly route: Readonly<{
    readonly hostId: WakeflowWorkspaceHostId;
    readonly windowId: WakeflowDurableId<"window">;
    readonly bindingId: WakeflowWindowHostBindingId;
  }>;
  readonly hostObservation: Readonly<{
    readonly authorityDigest: Sha256Digest;
    readonly observedAt: UtcInstant;
  }>;
  readonly claimTransition: Readonly<{
    readonly commitId: WakeflowDurableId<"demand-event-commit">;
    readonly eventId: WakeflowDurableId<"demand-event">;
    readonly expectedStreamRevision: number;
    readonly expectedStateDigest: Sha256Digest;
  }>;
  readonly claimedAt: UtcInstant;
  readonly claimDigest: Sha256Digest;
}

export type CreateWindowWorkClaimInput = Omit<
  WindowWorkClaim,
  "claimDigest" | "claimedAt" | "kind" | "schemaVersion"
>;

export interface CreateWindowWorkClaimOptions {
  readonly clock?: UtcWallClock;
}

export type WindowWorkClaimErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "time"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  json: "Window Work Claim is not passive JSON data.",
  schema: "Window Work Claim does not satisfy its portable Schema.",
  identifier: "Window Work Claim contains an invalid typed identity.",
  digest: "Window Work Claim contains an invalid or inconsistent digest.",
  time: "Window Work Claim contains an invalid time.",
  relation: "Window Work Claim times or transition facts are inconsistent.",
  representation:
    "Window Work Claim bytes are not its deterministic representation.",
} as const satisfies Readonly<Record<WindowWorkClaimErrorReason, string>>;

/** WindowWorkClaim 准入、创建或确定性表示失败时的稳定错误。 */
export class WindowWorkClaimError extends Error {
  override readonly name = "WindowWorkClaimError";
  readonly code = "wakeflow-window-work-claim" as const;
  readonly reason: WindowWorkClaimErrorReason;
  readonly path: string;

  constructor(reason: WindowWorkClaimErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<WindowWorkClaimWire>(
  WAKEFLOW_WINDOW_WORK_CLAIM_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TARGET_DELIVERY_INTENT_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_TEST_CARD_SCHEMA,
    WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
  ],
);

function fail(reason: WindowWorkClaimErrorReason, path: string): never {
  throw new WindowWorkClaimError(reason, path);
}

/** 严格解析一个不进入 durable ID 词汇的 WindowWorkClaim 代际身份。 */
export function parseWindowWorkClaimId(
  value: unknown,
  path = "$claimId",
): WindowWorkClaimId {
  if (typeof value !== "string" || !value.startsWith(CLAIM_ID_PREFIX)) {
    fail("identifier", path);
  }
  try {
    parseUuidV4(value.slice(CLAIM_ID_PREFIX.length), path);
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("identifier", path);
    throw error;
  }
  return value as WindowWorkClaimId;
}

/** 为一次新的业务占用创建随机 Claim ID；重放必须继续使用已创建 ID。 */
export function createWindowWorkClaimId(
  factory?: UuidV4Factory,
): WindowWorkClaimId {
  try {
    return parseWindowWorkClaimId(`${CLAIM_ID_PREFIX}${createUuidV4(factory)}`);
  } catch (error: unknown) {
    if (error instanceof UuidV4Error || error instanceof WindowWorkClaimError) {
      fail("identifier", "$uuidFactory");
    }
    throw error;
  }
}

function id<
  Kind extends
    | "program"
    | "demand"
    | "target-task"
    | "target-delivery"
    | "test-attempt"
    | "demand-event"
    | "demand-event-commit"
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

function time(value: unknown, path: string): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", path);
    throw error;
  }
}

function claimBasis(
  value: Omit<WindowWorkClaim, "claimDigest">,
): Omit<WindowWorkClaim, "claimDigest"> {
  return {
    kind: CLAIM_KIND,
    schemaVersion: CLAIM_SCHEMA_VERSION,
    claimId: value.claimId,
    programId: value.programId,
    target: value.target,
    route: value.route,
    hostObservation: value.hostObservation,
    claimTransition: value.claimTransition,
    claimedAt: value.claimedAt,
  };
}

/** 解析完整Claim，并验证typed来源、transition和不包含自身的摘要。 */
export function parseWindowWorkClaim(
  value: unknown,
): Readonly<WindowWorkClaim> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$claim");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const validated = validateWire(json);
  if (!validated.ok) fail("schema", validated.path);
  const wire = validated.value;
  let bindingId: WakeflowWindowHostBindingId;
  try {
    bindingId = parseWakeflowWindowHostBindingId(
      wire.route.bindingId,
      "$/route/bindingId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingIdError) {
      fail("identifier", "$/route/bindingId");
    }
    throw error;
  }
  const targetBase = {
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
    intentDigest: digest(wire.target.intentDigest, "$/target/intentDigest"),
    intentPreparedAt: time(
      wire.target.intentPreparedAt,
      "$/target/intentPreparedAt",
    ),
  } as const;
  const target: Readonly<WindowWorkClaimTarget> =
    "workType" in wire.target
      ? Object.freeze({
          ...targetBase,
          workType: "test" as const,
          testAttemptId: id(
            wire.target.testAttemptId,
            "test-attempt",
            "$/target/testAttemptId",
          ),
          testDispatchPacketDigest: digest(
            wire.target.testDispatchPacketDigest,
            "$/target/testDispatchPacketDigest",
          ),
        })
      : Object.freeze(targetBase);
  const basis = claimBasis({
    kind: CLAIM_KIND,
    schemaVersion: CLAIM_SCHEMA_VERSION,
    claimId: parseWindowWorkClaimId(wire.claimId, "$/claimId"),
    programId: id(wire.programId, "program", "$/programId"),
    target,
    route: Object.freeze({
      hostId: wire.route.hostId,
      windowId: id(wire.route.windowId, "window", "$/route/windowId"),
      bindingId,
    }),
    hostObservation: Object.freeze({
      authorityDigest: digest(
        wire.hostObservation.authorityDigest,
        "$/hostObservation/authorityDigest",
      ),
      observedAt: time(
        wire.hostObservation.observedAt,
        "$/hostObservation/observedAt",
      ),
    }),
    claimTransition: Object.freeze({
      commitId: id(
        wire.claimTransition.commitId,
        "demand-event-commit",
        "$/claimTransition/commitId",
      ),
      eventId: id(
        wire.claimTransition.eventId,
        "demand-event",
        "$/claimTransition/eventId",
      ),
      expectedStreamRevision: wire.claimTransition.expectedStreamRevision,
      expectedStateDigest: digest(
        wire.claimTransition.expectedStateDigest,
        "$/claimTransition/expectedStateDigest",
      ),
    }),
    claimedAt: time(wire.claimedAt, "$/claimedAt"),
  });
  // 三个UTC字段只保存审计观察；Intent、Observation与Claim顺序由来源tuple、freshness和Event CAS证明。
  const claimDigest = digest(wire.claimDigest, "$/claimDigest");
  if (computeCanonicalJsonSha256Digest(basis) !== claimDigest) {
    fail("digest", "$/claimDigest");
  }
  return Object.freeze({ ...basis, claimDigest });
}

/** 从已闭合来源和当前墙上时钟创建一份不会自动过期的 Claim。 */
export function createWindowWorkClaim(
  input: Readonly<CreateWindowWorkClaimInput>,
  options: CreateWindowWorkClaimOptions = {},
): Readonly<WindowWorkClaim> {
  let claimedAt: UtcInstant;
  try {
    claimedAt =
      options.clock === undefined
        ? readUtcWallClock()
        : readUtcWallClock(options.clock);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$clock");
    throw error;
  }
  const basis = claimBasis({
    kind: CLAIM_KIND,
    schemaVersion: CLAIM_SCHEMA_VERSION,
    claimId: input.claimId,
    programId: input.programId,
    target: input.target,
    route: input.route,
    hostObservation: input.hostObservation,
    claimTransition: input.claimTransition,
    claimedAt,
  });
  return parseWindowWorkClaim({
    ...basis,
    claimDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

/** 将 Claim 渲染为唯一的确定性 JSON 文档。 */
export function renderWindowWorkClaim(value: unknown): string {
  return renderDeterministicJsonDocument(parseWindowWorkClaim(value), "$claim");
}

/** 只接受与领域渲染逐字节相同的 Claim 文档。 */
export function parseWindowWorkClaimDocument(
  text: unknown,
): Readonly<WindowWorkClaim> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$claim");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$claim");
    }
    throw error;
  }
  const claim = parseWindowWorkClaim(json);
  if (renderWindowWorkClaim(claim) !== text) {
    fail("representation", "$claim");
  }
  return claim;
}

/** 返回已准入 Claim 自身声明并复验过的 Canonical 摘要。 */
export function computeWindowWorkClaimDigest(value: unknown): Sha256Digest {
  return parseWindowWorkClaim(value).claimDigest;
}
