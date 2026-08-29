import {
  createUuidV4,
  parseUuidV4,
  UuidV4Error,
  type UuidV4Factory,
  type UuidV4,
} from "../../foundation/identity/uuid-v4.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
} from "./wakeflow-maintenance-resource-catalog.js";

/**
 * Wakeflow Workspace / Maintenance：单次 maintenance operation 的短生命周期身份。
 *
 * 该身份只关联 gate、immutable intent、journal checkpoint 与显式恢复，不是业务实体，
 * 也不进入全局 durable ID kind。规范文本由固定前缀和小写 UUIDv4 组成，不从路径、
 * 时间或计划摘要派生。
 */

export const WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX =
  "maintenance_operation_" as const;

declare const MAINTENANCE_OPERATION_ID_BRAND: unique symbol;

export type WakeflowMaintenanceOperationId = string & {
  readonly [MAINTENANCE_OPERATION_ID_BRAND]: "WakeflowMaintenanceOperationId";
};

export type WakeflowMaintenanceOperationIdErrorReason =
  | "format"
  | "factory";

const ERROR_MESSAGES = {
  format: "Wakeflow maintenance operation ID is invalid.",
  factory: "Wakeflow maintenance operation ID could not be generated.",
} as const satisfies Readonly<Record<
  WakeflowMaintenanceOperationIdErrorReason,
  string
>>;

/** Maintenance operation ID 解析或创建失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceOperationIdError extends Error {
  override readonly name = "WakeflowMaintenanceOperationIdError";
  readonly code = "wakeflow-maintenance-operation-id" as const;
  readonly reason: WakeflowMaintenanceOperationIdErrorReason;
  readonly path: string;

  constructor(reason: WakeflowMaintenanceOperationIdErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowMaintenanceOperationIdErrorReason,
  path: string,
): never {
  throw new WakeflowMaintenanceOperationIdError(reason, path);
}

/** 严格解析一个 maintenance operation ID。 */
export function parseWakeflowMaintenanceOperationId(
  value: unknown,
  errorPath = "$operationId",
): WakeflowMaintenanceOperationId {
  if (
    typeof value !== "string"
    || !value.startsWith(WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX)
  ) {
    fail("format", errorPath);
  }
  try {
    parseUuidV4(
      value.slice(WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX.length),
      errorPath,
    );
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("format", errorPath);
    throw error;
  }
  return value as WakeflowMaintenanceOperationId;
}

/** 提取已经重新验证的 operation UUID，供 gate token 关联使用。 */
export function wakeflowMaintenanceOperationUuid(
  value: unknown,
): UuidV4 {
  const operationId = parseWakeflowMaintenanceOperationId(value);
  return parseUuidV4(
    operationId.slice(WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX.length),
    "$operationId",
  );
}

/** 使用密码学 UUIDv4 源创建一个 maintenance operation ID。 */
export function createWakeflowMaintenanceOperationId(
  uuidFactory?: UuidV4Factory,
): WakeflowMaintenanceOperationId {
  try {
    const uuid = uuidFactory === undefined
      ? createUuidV4()
      : createUuidV4(uuidFactory);
    return parseWakeflowMaintenanceOperationId(
      `${WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX}${uuid}`,
    );
  } catch (error: unknown) {
    if (
      error instanceof UuidV4Error
      || error instanceof WakeflowMaintenanceOperationIdError
    ) {
      fail("factory", "$uuidFactory");
    }
    throw error;
  }
}

/** 从operation ID派生唯一immutable intent引用。 */
export function wakeflowMaintenanceIntentRef(
  value: unknown,
): PortableResourcePath {
  const operationId = parseWakeflowMaintenanceOperationId(value);
  return parsePortableResourcePath(
    `${WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF}/${operationId}.intent.json`,
  );
}

/** 从operation ID派生唯一mutable journal引用。 */
export function wakeflowMaintenanceJournalRef(
  value: unknown,
): PortableResourcePath {
  const operationId = parseWakeflowMaintenanceOperationId(value);
  return parsePortableResourcePath(
    `${WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF}/${operationId}.journal.json`,
  );
}
