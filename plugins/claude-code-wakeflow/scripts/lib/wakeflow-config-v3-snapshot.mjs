import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import path from "node:path";

import {
  buildWakeflowConfigV3Indexes,
  parseWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { validateWakeflowConfigRootPlacements } from "./wakeflow-layout-descriptor.mjs";

/**
 * 从调用方明确指定的工作区根，构造一次操作范围内的 v3 配置权威快照。
 *
 * 本模块只负责固定配置名的稳定读取、严格领域解析、根放置校验和常用派生值；
 * 它不缓存“当前工作区”，不写配置，不取得业务锁，也不能保证返回后配置仍未变化。
 * 任何可写 owner 仍须在自己的 lock/CAS 边界内重新加载并核对 configDigest。
 *
 * 阅读导航：exactInput / inspectWorkspaceRoot 收敛调用身份；inspectConfigSource /
 * readStableConfigBytes 关闭一次 no-follow 稳定读取；parseConfig /
 * validatePlacements 分别验证配置语义和根放置；loadWakeflowConfigV3Snapshot
 * 将同一次读取的原始字节摘要、语义摘要、模型和派生索引绑定成冻结快照。
 */
export const WAKEFLOW_CONFIG_V3_SNAPSHOT_SCHEMA_VERSION = 1;

const SNAPSHOT_KIND = "WakeflowConfigV3Snapshot";
const CONFIG_REF = "wakeflow.config.json";
// config owner 不得生成超过这个读取上限的配置；跨模块回归会锁定该生产者/消费者合同。
const MAX_CONFIG_BYTES = 1024 * 1024;
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

// ==================== 一、输入合同与稳定读取原语 ====================

/**
 * 快照层只公开稳定错误码与脱敏详情，不向上游回显原始配置内容。
 */
export class WakeflowConfigV3SnapshotError extends Error {
  constructor(code, message, { details = {} } = {}) {
    super(message);
    this.name = "WakeflowConfigV3SnapshotError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

// 将所有快照失败统一收敛到本领域错误类型。
function fail(code, message, details = {}) {
  throw new WakeflowConfigV3SnapshotError(code, message, { details });
}

// 冻结快照及其派生值，防止 caller 把一次已验证事实修改成另一种含义。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 只接受唯一的 workspaceRoot data property，并保留调用方显式 lexical root。
function exactInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("wakeflow-config-v3-snapshot-input", "config snapshot input must be one plain object");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-config-v3-snapshot-input", "config snapshot input must be one plain data object");
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 1 || keys[0] !== "workspaceRoot") {
    fail(
      "wakeflow-config-v3-snapshot-input",
      "config snapshot input must contain only workspaceRoot",
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(input, "workspaceRoot");
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail(
      "wakeflow-config-v3-snapshot-input",
      "workspaceRoot must be one enumerable data property",
    );
  }
  const workspaceRoot = descriptor.value;
  if (
    typeof workspaceRoot !== "string"
    || !workspaceRoot.trim()
    || workspaceRoot !== workspaceRoot.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(workspaceRoot)
  ) {
    fail(
      "wakeflow-config-v3-snapshot-input",
      "workspaceRoot must be one trimmed control-free path",
    );
  }
  return path.resolve(workspaceRoot);
}

// 验证 workspaceRoot 最终路径项是现存真实目录；本方法不擅自 realpath 改写身份。
function inspectWorkspaceRoot(workspaceRoot) {
  let stat;
  try {
    stat = lstatSync(workspaceRoot, { bigint: true });
  } catch {
    fail("wakeflow-config-v3-snapshot-workspace", "workspace root is unavailable");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(
      "wakeflow-config-v3-snapshot-workspace",
      "workspace root must be one real directory",
    );
  }
  // 这里只拒绝最终路径项本身为 symlink；workspaceRoot 仍保留调用方的 lexical identity。
  // 祖先 symlink 与 realpath identity 的统一属于全局 workspace context 合同，不能在此局部改写。
}

// 比较 path/descriptor 在读取前后的同一文件身份，既防替换，也拒绝 hard-link authority。
function sameFileSnapshot(left, right) {
  return (
    left.isFile()
    && right.isFile()
    && left.nlink === 1n
    && right.nlink === 1n
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
  );
}

// 对配置最终路径做首次 no-follow、单链接、普通文件和容量 admission。
function inspectConfigSource(file) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch {
    fail("wakeflow-config-v3-snapshot-source", "canonical config is unavailable");
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || before.size > BigInt(MAX_CONFIG_BYTES)
  ) {
    fail(
      "wakeflow-config-v3-snapshot-source",
      "canonical config must be one singly linked regular non-symlink file within the 1 MiB limit",
    );
  }
  // stable read 尚不等于完整的 tracked-config 健康证明。UID、mode 与 canonical pretty bytes
  // 当前由 config owner/reconcile 使用更强合同检查；是否纳入所有 runtime authority 已登记全局审查。
  return before;
}

// 在同一 descriptor 上有界读取字节，并复核 path/descriptor 前后身份没有变化。
function readStableConfigBytes(file) {
  const before = inspectConfigSource(file);
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch {
    fail("wakeflow-config-v3-snapshot-source", "canonical config cannot be opened safely");
  }

  try {
    let opened;
    try {
      opened = fstatSync(descriptor, { bigint: true });
    } catch {
      fail("wakeflow-config-v3-snapshot-source", "canonical config cannot be inspected safely");
    }
    if (
      !sameFileSnapshot(before, opened)
      || opened.size > BigInt(MAX_CONFIG_BYTES)
    ) {
      fail("wakeflow-config-v3-snapshot-source", "canonical config changed while being opened");
    }

    const chunks = [];
    let total = 0;
    while (true) {
      const remaining = MAX_CONFIG_BYTES + 1 - total;
      if (remaining <= 0) {
        fail("wakeflow-config-v3-snapshot-source", "canonical config exceeds the 1 MiB limit");
      }
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      let bytesRead;
      try {
        bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      } catch {
        fail("wakeflow-config-v3-snapshot-source", "canonical config cannot be read safely");
      }
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > MAX_CONFIG_BYTES) {
      fail("wakeflow-config-v3-snapshot-source", "canonical config exceeds the 1 MiB limit");
    }

    let afterDescriptor;
    let afterPath;
    try {
      afterDescriptor = fstatSync(descriptor, { bigint: true });
      afterPath = lstatSync(file, { bigint: true });
    } catch {
      fail("wakeflow-config-v3-snapshot-source", "canonical config changed while being read");
    }
    if (
      !sameFileSnapshot(opened, afterDescriptor)
      || !sameFileSnapshot(opened, afterPath)
      || afterDescriptor.size !== BigInt(total)
    ) {
      fail("wakeflow-config-v3-snapshot-source", "canonical config changed while being read");
    }
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(descriptor);
  }
}

// ==================== 二、配置语义与 Placement 校验 ====================

// 严格解码 UTF-8/JSON/v3 模型，并把底层细节收敛为不泄露内容的快照错误。
function parseConfig(bytes) {
  let text;
  try {
    text = UTF8_FATAL.decode(bytes);
  } catch {
    fail("wakeflow-config-v3-snapshot-encoding", "canonical config is not valid UTF-8");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("wakeflow-config-v3-snapshot-json", "canonical config is not valid JSON");
  }

  try {
    return parseWakeflowConfigV3(parsed);
  } catch {
    // snapshot 的公共错误不回显原始配置值或内部 cause；observability 可另行输出脱敏 code/pointer。
    fail("wakeflow-config-v3-snapshot-config", "canonical config is not the strict public v3 authority");
  }
}

// 使用 layout owner 检查固定根、ledger、support 与 repository 的别名和重叠。
function validatePlacements(workspaceRoot, model) {
  try {
    // 校验已存在根的 symlink/realpath 与所有根的重叠关系；允许尚未物化但词法上合法的目标根。
    validateWakeflowConfigRootPlacements({ workspaceRoot, model });
  } catch {
    fail(
      "wakeflow-config-v3-snapshot-placement",
      "canonical config has overlapping, aliased, or unsafe protocol roots",
    );
  }
}

// ==================== 三、单次 Workspace 配置快照 ====================

// 按固定顺序完成 root→bytes→model→placement，并绑定同一次读取的全部派生事实。
function loadSnapshotUnsafe(input) {
  const workspaceRoot = exactInput(input);
  inspectWorkspaceRoot(workspaceRoot);
  // 原始字节摘要必须和 model 来自同一次稳定读取。调用方因此可以同时核对
  // “配置表达字节没有切换”与“规范化业务语义没有切换”，不必再二次读取配置。
  const bytes = readStableConfigBytes(path.join(workspaceRoot, CONFIG_REF));
  const model = parseConfig(bytes);
  validatePlacements(workspaceRoot, model);
  return deepFreeze({
    schemaVersion: WAKEFLOW_CONFIG_V3_SNAPSHOT_SCHEMA_VERSION,
    kind: SNAPSHOT_KIND,
    ref: CONFIG_REF,
    model,
    indexes: buildWakeflowConfigV3Indexes(model),
    sourceDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    // 业务 freshness 绑定规范化模型语义，而非缩进、字段顺序等配置文件表现字节。
    configDigest: wakeflowConfigV3Digest(model),
    workspaceRoot,
    ledgerRoot: path.resolve(workspaceRoot, model.storage.ledgerRoot),
  });
}

/**
 * 构造一次操作范围内的配置 authority 快照。
 *
 * 返回的 sourceDigest 绑定稳定读取的原始字节，configDigest 绑定规范化语义；该快照
 * 不跨公共操作缓存，也不能替代任何 write-capable owner 在锁内进行的 freshness 复核。
 */
export function loadWakeflowConfigV3Snapshot(input = {}) {
  try {
    return loadSnapshotUnsafe(input);
  } catch (cause) {
    if (cause instanceof WakeflowConfigV3SnapshotError) throw cause;
    throw new WakeflowConfigV3SnapshotError(
      "wakeflow-config-v3-snapshot-load",
      "config snapshot load failed closed",
    );
  }
}
