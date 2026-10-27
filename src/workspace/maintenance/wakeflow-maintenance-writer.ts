import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";

/**
 * Wakeflow Workspace / Maintenance：维护意图与日志的可选写者戳（C11，计划 §3.6）。
 *
 * 戳是写出记录的构建在制品清单里的发布版本与清单字节摘要，由组合根从本进程的制品身份注入并
 * 随记录持久化；盖戳之前写出的记录与没有 manifest 的测试构建都没有它，读回按 `null` 处理。
 * 它不是签名，也不授权任何执行。
 */

export interface WakeflowMaintenanceWriter {
  readonly version: string;
  readonly manifestDigest: Sha256Digest;
}

/** 写者戳准入失败的稳定、脱敏错误；消费者映射成自己的 `input`。 */
export class WakeflowMaintenanceWriterError extends Error {
  override readonly name = "WakeflowMaintenanceWriterError";
  readonly code = "wakeflow-maintenance-writer" as const;
  readonly reason = "input" as const;
  readonly path: string;

  constructor(path: string) {
    super("Wakeflow maintenance writer stamp is invalid.");
    this.path = path;
  }
}

const VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/u;
const VERSION_MAXIMUM_LENGTH = 64;

/** `undefined` 与 `null` 都表示没有戳，返回 `null`；其余必须恰好是 `{version, manifestDigest}`。 */
export function parseWakeflowMaintenanceWriter(
  value: unknown,
  path = "$writer",
): Readonly<WakeflowMaintenanceWriter> | null {
  if (value === undefined || value === null) return null;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) throw new WakeflowMaintenanceWriterError(path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "manifestDigest" ||
    keys[1] !== "version" ||
    typeof record.version !== "string" ||
    record.version.length > VERSION_MAXIMUM_LENGTH ||
    !VERSION_PATTERN.test(record.version)
  ) {
    throw new WakeflowMaintenanceWriterError(path);
  }
  let manifestDigest: Sha256Digest;
  try {
    manifestDigest = parseSha256Digest(record.manifestDigest, `${path}.manifestDigest`);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      throw new WakeflowMaintenanceWriterError(`${path}.manifestDigest`);
    }
    throw error;
  }
  return Object.freeze({ version: record.version, manifestDigest });
}
