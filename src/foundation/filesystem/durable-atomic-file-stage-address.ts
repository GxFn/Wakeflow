import { threadId } from "node:worker_threads";
import { types } from "node:util";

import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../crypto/sha256.js";
import {
  createUuidV4,
  parseUuidV4,
  UuidV4Error,
} from "../identity/uuid-v4.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { encodeUtf8 } from "../text/utf8.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  splitPortableResourcePath,
  type PortableResourcePath,
} from "./portable-resource-path.js";

/**
 * Wakeflow Foundation / Filesystem：持久化原子文件暂存资源的自描述地址。
 *
 * 暂存文件名只携带操作类型、目标资源路径摘要、输入摘要、最终权限位，以及进程、
 * 线程和尝试标识，不泄漏目标路径或文件字节。该名称为崩溃恢复提供可验证的路由事实；
 * 暂存资源本身始终不是权威事实，名称也不能证明内容正确或允许删除。
 */

export type DurableAtomicFileStageOperation = "create" | "replace";
export type DurableAtomicFileStageOwnerState =
  | "active"
  | "inactive"
  | "unknown";

export interface DurableAtomicFileStageAddress {
  readonly operation: DurableAtomicFileStageOperation;
  readonly targetResourcePathDigest: Sha256Digest;
  readonly inputDigest: Sha256Digest;
  readonly mode: number;
  readonly pid: number;
  readonly threadId: number;
  readonly token: string;
  readonly fileName: string;
}

export type DurableAtomicFileStageAddressErrorReason =
  | "input"
  | "digest"
  | "identifier"
  | "not-issued";

const ERROR_MESSAGES = {
  "input": "Durable atomic file stage address input is invalid.",
  "digest": "Durable atomic file stage address digest is invalid.",
  "identifier": "Durable atomic file stage owner identity is invalid.",
  "not-issued": "Durable atomic file stage address was not issued by this process.",
} as const satisfies Readonly<Record<
  DurableAtomicFileStageAddressErrorReason,
  string
>>;

export class DurableAtomicFileStageAddressError extends Error {
  override readonly name = "DurableAtomicFileStageAddressError";
  readonly code = "wakeflow-durable-atomic-file-stage-address" as const;
  readonly reason: DurableAtomicFileStageAddressErrorReason;
  readonly path: string;

  constructor(
    reason: DurableAtomicFileStageAddressErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const STAGE_PREFIX = ".wakeflow-atomic-";
const STAGE_PATTERN = /^(?:\.wakeflow-atomic-)(?<operation>create|replace)-(?<target>[0-9a-f]{64})-(?<input>[0-9a-f]{64})-m(?<mode>[0-7]{3})__(?<pid>[1-9][0-9]*)-(?<threadId>0|[1-9][0-9]*)-(?<attempt>[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$/u;
const ACTIVE_STAGE_TOKENS = new Set<string>();
const ISSUED_STAGE_ADDRESSES = new WeakSet<object>();

function fail(
  reason: DurableAtomicFileStageAddressErrorReason,
  path: string,
): never {
  throw new DurableAtomicFileStageAddressError(reason, path);
}

function parseOperation(value: unknown): DurableAtomicFileStageOperation {
  if (value !== "create" && value !== "replace") {
    fail("input", "$operation");
  }
  return value;
}

function parseMode(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 0
    || value > 0o777
  ) {
    fail("input", "$mode");
  }
  return value;
}

function parseDigestHex(value: unknown, path: string): Sha256Digest {
  if (typeof value !== "string") fail("digest", path);
  try {
    return parseSha256Digest(`sha256:${value}`, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function digestHex(value: Sha256Digest): string {
  return value.slice("sha256:".length);
}

function parseOwnerInteger(
  value: string | undefined,
  allowZero: boolean,
  path: string,
): number {
  if (value === undefined) fail("identifier", path);
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < (allowZero ? 0 : 1)
  ) {
    fail("identifier", path);
  }
  return parsed;
}

/** 计算目标可移植引用的脱敏、稳定暂存路由摘要。 */
export function computeDurableAtomicFileStageTargetDigest(
  value: unknown,
): Sha256Digest {
  let resourcePath: PortableResourcePath;
  try {
    resourcePath = parsePortableResourcePath(value, "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("input", "$resourcePath");
    }
    throw error;
  }
  const resourceName = splitPortableResourcePath(resourcePath).at(-1);
  if (
    resourceName === undefined
    || hasDurableAtomicFileStagePrefix(resourceName)
  ) {
    fail("input", "$resourcePath");
  }
  return computeSha256Digest(encodeUtf8(resourcePath, "$resourcePath"));
}

/** 判断名称是否占用 Wakeflow 原子暂存文件保留前缀；该结果不代表格式已经有效。 */
export function hasDurableAtomicFileStagePrefix(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(STAGE_PREFIX);
}

/** 解析自描述原子暂存文件名；不授予清理权限。 */
export function parseDurableAtomicFileStageFileName(
  value: unknown,
): Readonly<DurableAtomicFileStageAddress> {
  if (typeof value !== "string") fail("input", "$fileName");
  const groups = STAGE_PATTERN.exec(value)?.groups;
  if (groups === undefined) fail("input", "$fileName");
  const operation = parseOperation(groups.operation);
  const pid = parseOwnerInteger(groups.pid, false, "$/pid");
  const candidateThreadId = parseOwnerInteger(
    groups.threadId,
    true,
    "$/threadId",
  );
  const attempt = groups.attempt;
  if (attempt === undefined) fail("identifier", "$/attempt");
  try {
    parseUuidV4(attempt, "$/attempt");
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("identifier", "$/attempt");
    throw error;
  }
  const token = `${pid}-${candidateThreadId}-${attempt}`;
  return Object.freeze({
    operation,
    targetResourcePathDigest: parseDigestHex(groups.target, "$/target"),
    inputDigest: parseDigestHex(groups.input, "$/input"),
    mode: parseMode(Number.parseInt(groups.mode ?? "", 8)),
    pid,
    threadId: candidateThreadId,
    token,
    fileName: value,
  });
}

/** 把暂存地址放入目标的同一父目录；本函数不会创建或观察文件。 */
export function durableAtomicFileStageRef(
  targetResourcePathValue: unknown,
  addressValue: Readonly<DurableAtomicFileStageAddress>,
): PortableResourcePath {
  let targetResourcePath: PortableResourcePath;
  try {
    targetResourcePath = parsePortableResourcePath(
      targetResourcePathValue,
      "$resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("input", "$resourcePath");
    }
    throw error;
  }
  const address = parseDurableAtomicFileStageFileName(addressValue.fileName);
  const segments = splitPortableResourcePath(targetResourcePath);
  return parsePortableResourcePath(
    [...segments.slice(0, -1), address.fileName].join("/"),
    "$stageResourcePath",
  );
}

/** 为一次原子写入签发并登记进程内活动暂存地址。 */
export function issueDurableAtomicFileStageAddress(
  operationValue: unknown,
  resourcePathValue: unknown,
  inputDigestValue: unknown,
  modeValue: unknown,
): Readonly<DurableAtomicFileStageAddress> {
  const operation = parseOperation(operationValue);
  const targetResourcePathDigest =
    computeDurableAtomicFileStageTargetDigest(resourcePathValue);
  let inputDigest: Sha256Digest;
  try {
    inputDigest = parseSha256Digest(inputDigestValue, "$inputDigest");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", "$inputDigest");
    throw error;
  }
  const mode = parseMode(modeValue);
  let attempt: string;
  try {
    attempt = createUuidV4();
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("identifier", "$/attempt");
    throw error;
  }
  const token = `${process.pid}-${threadId}-${attempt}`;
  const fileName = `${STAGE_PREFIX}${operation}-${digestHex(
    targetResourcePathDigest,
  )}-${digestHex(inputDigest)}-m${mode.toString(8).padStart(3, "0")}__${token}.tmp`;
  const address = parseDurableAtomicFileStageFileName(fileName);
  ACTIVE_STAGE_TOKENS.add(address.token);
  ISSUED_STAGE_ADDRESSES.add(address);
  return address;
}

/** 结束本进程签发的暂存地址所有者生命周期；不会操作任何文件。 */
export function releaseDurableAtomicFileStageAddress(
  value: Readonly<DurableAtomicFileStageAddress>,
): void {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !Object.isFrozen(value)
    || !ISSUED_STAGE_ADDRESSES.has(value)
  ) {
    fail("not-issued", "$address");
  }
  ACTIVE_STAGE_TOKENS.delete(value.token);
  ISSUED_STAGE_ADDRESSES.delete(value);
}

/** 保守判断暂存资源所有者状态；未知或仍在活动时，恢复流程都不得删除资源。 */
export function readDurableAtomicFileStageOwnerState(
  value: Readonly<DurableAtomicFileStageAddress>,
): DurableAtomicFileStageOwnerState {
  const address = parseDurableAtomicFileStageFileName(value.fileName);
  if (address.pid === process.pid) {
    if (address.threadId !== threadId) return "unknown";
    return ACTIVE_STAGE_TOKENS.has(address.token) ? "active" : "inactive";
  }
  try {
    process.kill(address.pid, 0);
    return "active";
  } catch (error: unknown) {
    return readNodeSystemErrorCode(error) === "ESRCH" ? "inactive" : "unknown";
  }
}
