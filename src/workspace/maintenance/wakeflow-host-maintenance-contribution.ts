import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
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
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostId,
} from "../workspace-host-resource-profile.js";

/**
 * Wakeflow Workspace / Maintenance：宿主维护操作的共享数据边界。
 *
 * 宿主实现把自身只读检查结果收敛为这份被动 JSON 数据；共享事务只排序、摘要和记录
 * checkpoint，不解释 `payload`。payload 必须是无绝对路径、无凭据的精确操作合同，
 * 并由当前宿主的闭合 executor 在真实效果前重新验证。
 */

export interface WakeflowHostMaintenanceOperation {
  readonly operationId: string;
  readonly operationKind: string;
  readonly ownerId: string;
  readonly targetKey: string;
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
  readonly payload: JsonValue;
  readonly payloadDigest: Sha256Digest;
}

export interface WakeflowHostMaintenanceContribution {
  readonly kind: "WakeflowHostMaintenanceContribution";
  readonly schemaVersion: 1;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly capabilityId: string;
  readonly status: "ready" | "blocked";
  readonly blockerCodes: readonly string[];
  readonly operations:
    readonly Readonly<WakeflowHostMaintenanceOperation>[];
  readonly contributionDigest: Sha256Digest;
}

export interface WakeflowHostMaintenanceOperationInput {
  readonly operationId: string;
  readonly operationKind: string;
  readonly ownerId: string;
  readonly targetKey: string;
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
  readonly payload: unknown;
}

export interface CreateWakeflowHostMaintenanceContributionRequest {
  readonly hostId: WakeflowWorkspaceHostId;
  readonly capabilityId: string;
  readonly status: "ready" | "blocked";
  readonly blockerCodes: readonly string[];
  readonly operations: readonly WakeflowHostMaintenanceOperationInput[];
}

export type WakeflowHostMaintenanceContributionErrorReason =
  | "input"
  | "host"
  | "identity"
  | "digest"
  | "payload"
  | "order"
  | "status";

const ERROR_MESSAGES = {
  input: "Wakeflow host maintenance contribution input is invalid.",
  host: "Wakeflow host maintenance contribution host identity is invalid.",
  identity: "Wakeflow host maintenance contribution identity is invalid.",
  digest: "Wakeflow host maintenance contribution digest is invalid.",
  payload: "Wakeflow host maintenance operation payload is invalid.",
  order: "Wakeflow host maintenance operations are not uniquely ordered.",
  status: "Wakeflow host maintenance contribution status is inconsistent.",
} as const satisfies Readonly<Record<
  WakeflowHostMaintenanceContributionErrorReason,
  string
>>;

/** 宿主维护 contribution 准入失败的稳定、脱敏错误。 */
export class WakeflowHostMaintenanceContributionError extends Error {
  override readonly name = "WakeflowHostMaintenanceContributionError";
  readonly code = "wakeflow-host-maintenance-contribution" as const;
  readonly reason: WakeflowHostMaintenanceContributionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowHostMaintenanceContributionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const HOST_ID_SET = new Set<string>(WAKEFLOW_WORKSPACE_HOST_IDS);
const COMPONENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const OPERATION_ID_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z0-9_][a-z0-9_-]*)+$/u;
const BLOCKER_CODE_PATTERN = /^[a-z][a-z0-9_-]*(?::[a-z0-9_][a-z0-9_-]*)*$/u;
const TARGET_KEY_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,255}$/u;
const MAXIMUM_OPERATIONS = 128;
const MAXIMUM_BLOCKERS = 128;
const MAXIMUM_IDENTITY_LENGTH = 256;

function fail(
  reason: WakeflowHostMaintenanceContributionErrorReason,
  path: string,
): never {
  throw new WakeflowHostMaintenanceContributionError(reason, path);
}

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function nullableDigest(value: unknown, path: string): Sha256Digest | null {
  return value === null ? null : digest(value, path);
}

function parseIdentity(
  value: unknown,
  path: string,
  pattern: RegExp,
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAXIMUM_IDENTITY_LENGTH
    || !value.isWellFormed()
    || !pattern.test(value)
  ) {
    fail("identity", path);
  }
  return value;
}

function parseTargetKey(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || !value.isWellFormed()
    || !TARGET_KEY_PATTERN.test(value)
  ) {
    fail("identity", path);
  }
  return value;
}

function parsePayload(value: unknown, path: string): JsonValue {
  try {
    return parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("payload", error.path);
    throw error;
  }
}

function parseOperation(
  value: unknown,
  index: number,
  requirePayloadDigest: boolean,
  basePath: "$request.operations" | "$contribution.operations",
): Readonly<WakeflowHostMaintenanceOperation> {
  const path = `${basePath}/${index}`;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  const expectedFields = requirePayloadDigest
    ? "operationId\u0000operationKind\u0000ownerId\u0000payload\u0000payloadDigest\u0000sourceDigest\u0000targetDigest\u0000targetKey"
    : "operationId\u0000operationKind\u0000ownerId\u0000payload\u0000sourceDigest\u0000targetDigest\u0000targetKey";
  if (Object.keys(record).sort().join("\u0000") !== expectedFields) {
    fail("input", path);
  }
  const payload = parsePayload(record.payload, `${path}.payload`);
  const payloadDigest = computeCanonicalJsonSha256Digest(payload);
  if (
    requirePayloadDigest
    && digest(record.payloadDigest, `${path}.payloadDigest`) !== payloadDigest
  ) {
    fail("digest", `${path}.payloadDigest`);
  }
  const sourceDigest = nullableDigest(
    record.sourceDigest,
    `${path}.sourceDigest`,
  );
  const targetDigest = digest(record.targetDigest, `${path}.targetDigest`);
  return Object.freeze({
    operationId: parseIdentity(
      record.operationId,
      `${path}.operationId`,
      OPERATION_ID_PATTERN,
    ),
    operationKind: parseIdentity(
      record.operationKind,
      `${path}.operationKind`,
      COMPONENT_ID_PATTERN,
    ),
    ownerId: parseIdentity(
      record.ownerId,
      `${path}.ownerId`,
      COMPONENT_ID_PATTERN,
    ),
    targetKey: parseTargetKey(record.targetKey, `${path}.targetKey`),
    sourceDigest,
    targetDigest,
    payload,
    payloadDigest,
  });
}

function contributionDigestBasis(
  value: Omit<WakeflowHostMaintenanceContribution, "contributionDigest">,
) {
  return {
    ...value,
    kind: "WakeflowHostMaintenanceContributionDigestBasis" as const,
  };
}

/** 计算不包含自身摘要字段的宿主 contribution 语义摘要。 */
export function computeWakeflowHostMaintenanceContributionDigest(
  value: Omit<WakeflowHostMaintenanceContribution, "contributionDigest">,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(contributionDigestBasis(value));
}

function assertOrderedOperations(
  operations: readonly Readonly<WakeflowHostMaintenanceOperation>[],
): void {
  const targets = new Set<string>();
  for (let index = 0; index < operations.length; index += 1) {
    const current = operations[index];
    const previous = operations[index - 1];
    if (
      current === undefined
      || (
        previous !== undefined
        && previous.operationId >= current.operationId
      )
    ) {
      fail("order", `$contribution.operations/${index}.operationId`);
    }
    const target = `${current.ownerId}\u0000${current.targetKey}`;
    if (targets.has(target)) {
      fail("order", `$contribution.operations/${index}.targetKey`);
    }
    targets.add(target);
  }
}

function assertOrderedBlockers(blockerCodes: readonly string[]): void {
  for (let index = 0; index < blockerCodes.length; index += 1) {
    const current = blockerCodes[index];
    const previous = blockerCodes[index - 1];
    if (
      current === undefined
      || !BLOCKER_CODE_PATTERN.test(current)
      || current.length > MAXIMUM_IDENTITY_LENGTH
      || !current.isWellFormed()
      || (previous !== undefined && previous >= current)
    ) {
      fail("order", `$contribution.blockerCodes/${index}`);
    }
  }
}

/**
 * 从一个宿主领域计划创建确定性 contribution。
 *
 * operation 与 blocker 会在边界内排序；调用方对象和 payload 不会被引用保存。
 */
export function createWakeflowHostMaintenanceContribution(
  requestValue: CreateWakeflowHostMaintenanceContributionRequest,
): Readonly<WakeflowHostMaintenanceContribution> {
  let record: Readonly<Record<string, unknown>>;
  let blockerValues: readonly unknown[];
  let operationValues: readonly unknown[];
  try {
    record = parsePlainRecord(requestValue, "$request");
    blockerValues = parseDenseArray(
      record.blockerCodes,
      MAXIMUM_BLOCKERS,
      "$request.blockerCodes",
    );
    operationValues = parseDenseArray(
      record.operations,
      MAXIMUM_OPERATIONS,
      "$request.operations",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  if (
    Object.keys(record).sort().join("\u0000")
      !== "blockerCodes\u0000capabilityId\u0000hostId\u0000operations\u0000status"
    || typeof record.hostId !== "string"
    || !HOST_ID_SET.has(record.hostId)
    || (record.status !== "ready" && record.status !== "blocked")
  ) {
    fail("input", "$request");
  }
  const blockerCodes = Object.freeze(
    [...blockerValues].map((entry, index) => {
      if (typeof entry !== "string") {
        fail("identity", `$request.blockerCodes/${index}`);
      }
      return entry;
    }).sort(),
  );
  assertOrderedBlockers(blockerCodes);
  if ((record.status === "ready") !== (blockerCodes.length === 0)) {
    fail("status", "$request.status");
  }
  const operations = Object.freeze(
    operationValues.map((entry, index) => parseOperation(
      entry,
      index,
      false,
      "$request.operations",
    )).sort((left, right) => (
      left.operationId < right.operationId
        ? -1
        : left.operationId > right.operationId
          ? 1
          : 0
    )),
  );
  assertOrderedOperations(operations);
  const basis: Omit<WakeflowHostMaintenanceContribution, "contributionDigest"> =
    Object.freeze({
      kind: "WakeflowHostMaintenanceContribution",
      schemaVersion: 1,
      hostId: record.hostId as WakeflowWorkspaceHostId,
      capabilityId: parseIdentity(
        record.capabilityId,
        "$request.capabilityId",
        COMPONENT_ID_PATTERN,
      ),
      status: record.status,
      blockerCodes,
      operations,
    });
  return Object.freeze({
    ...basis,
    contributionDigest: computeWakeflowHostMaintenanceContributionDigest(basis),
  });
}

/** 把任意输入解析为严格、冻结且摘要自洽的宿主 contribution。 */
export function parseWakeflowHostMaintenanceContribution(
  value: unknown,
): Readonly<WakeflowHostMaintenanceContribution> {
  let record: Readonly<Record<string, unknown>>;
  let blockerValues: readonly unknown[];
  let operationValues: readonly unknown[];
  try {
    record = parsePlainRecord(value, "$contribution");
    blockerValues = parseDenseArray(
      record.blockerCodes,
      MAXIMUM_BLOCKERS,
      "$contribution.blockerCodes",
    );
    operationValues = parseDenseArray(
      record.operations,
      MAXIMUM_OPERATIONS,
      "$contribution.operations",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  if (
    Object.keys(record).sort().join("\u0000")
      !== "blockerCodes\u0000capabilityId\u0000contributionDigest\u0000hostId\u0000kind\u0000operations\u0000schemaVersion\u0000status"
    || record.kind !== "WakeflowHostMaintenanceContribution"
    || record.schemaVersion !== 1
    || typeof record.hostId !== "string"
    || !HOST_ID_SET.has(record.hostId)
    || (record.status !== "ready" && record.status !== "blocked")
  ) {
    fail("input", "$contribution");
  }
  const blockerCodes = Object.freeze(blockerValues.map((entry, index) => {
    if (typeof entry !== "string") {
      fail("identity", `$contribution.blockerCodes/${index}`);
    }
    return entry;
  }));
  assertOrderedBlockers(blockerCodes);
  if ((record.status === "ready") !== (blockerCodes.length === 0)) {
    fail("status", "$contribution.status");
  }
  const operations = Object.freeze(operationValues.map((entry, index) => (
    parseOperation(entry, index, true, "$contribution.operations")
  )));
  assertOrderedOperations(operations);
  const basis: Omit<WakeflowHostMaintenanceContribution, "contributionDigest"> =
    Object.freeze({
      kind: "WakeflowHostMaintenanceContribution",
      schemaVersion: 1,
      hostId: record.hostId as WakeflowWorkspaceHostId,
      capabilityId: parseIdentity(
        record.capabilityId,
        "$contribution.capabilityId",
        COMPONENT_ID_PATTERN,
      ),
      status: record.status,
      blockerCodes,
      operations,
    });
  const contributionDigest = digest(
    record.contributionDigest,
    "$contribution.contributionDigest",
  );
  if (
    computeWakeflowHostMaintenanceContributionDigest(basis)
      !== contributionDigest
  ) {
    fail("digest", "$contribution.contributionDigest");
  }
  return Object.freeze({ ...basis, contributionDigest });
}
