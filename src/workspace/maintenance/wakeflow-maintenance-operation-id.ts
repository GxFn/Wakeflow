import { WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX } from "../../contracts/identity/wakeflow-typed-id-prefixes.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  createUuidV4,
  parseUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../../foundation/identity/uuid-v4.js";
import { WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF } from "../wakeflow-maintenance-resource-catalog.js";

/**
 * Wakeflow Workspace / Maintenance：单次 maintenance operation 的短生命周期身份。
 *
 * 该身份只关联 gate、intent（含做到第几步的计数）与显式恢复，不是业务实体，
 * 也不进入全局 durable ID kind。规范文本由固定前缀和小写 UUIDv4 组成，不从路径、
 * 时间或计划摘要派生。
 */

declare const MAINTENANCE_OPERATION_ID_BRAND: unique symbol;

export type WakeflowMaintenanceOperationId = string & {
  readonly [MAINTENANCE_OPERATION_ID_BRAND]: "WakeflowMaintenanceOperationId";
};

export type WakeflowMaintenanceOperationIdErrorReason = "format" | "factory";

/** Maintenance operation ID 解析或创建失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceOperationIdError extends ModuleError<WakeflowMaintenanceOperationIdErrorReason> {
  static override readonly code = "wakeflow-maintenance-operation-id";
}

const fail: Fail<WakeflowMaintenanceOperationIdErrorReason> = failWith(
  WakeflowMaintenanceOperationIdError,
);

/** 严格解析一个 maintenance operation ID。 */
export function parseWakeflowMaintenanceOperationId(
  value: unknown,
  errorPath = "$operationId",
): WakeflowMaintenanceOperationId {
  if (typeof value !== "string" || !value.startsWith(WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX)) {
    fail("format", errorPath);
  }
  try {
    parseUuidV4(value.slice(WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX.length), errorPath);
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("format", errorPath, error);
    throw error;
  }
  return value as WakeflowMaintenanceOperationId;
}

/** 使用密码学 UUIDv4 源创建一个 maintenance operation ID。 */
export function createWakeflowMaintenanceOperationId(
  uuidFactory?: UuidV4Factory,
): WakeflowMaintenanceOperationId {
  try {
    const uuid = uuidFactory === undefined ? createUuidV4() : createUuidV4(uuidFactory);
    return parseWakeflowMaintenanceOperationId(
      `${WAKEFLOW_MAINTENANCE_OPERATION_ID_PREFIX}${uuid}`,
    );
  } catch (error: unknown) {
    if (error instanceof UuidV4Error || error instanceof WakeflowMaintenanceOperationIdError) {
      fail("factory", "$uuidFactory", error);
    }
    throw error;
  }
}

/** 从operation ID派生这次维护唯一的事务文件（intent）的引用。 */
export function wakeflowMaintenanceIntentRef(
  operationId: WakeflowMaintenanceOperationId,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF}/${operationId}.intent.json`,
  );
}
