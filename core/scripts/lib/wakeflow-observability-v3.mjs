import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { runSync } from "../../lib/wakeflow-process.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
} from "./wakeflow-config-v3.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import { inspectWakeflowActiveProjection } from "./wakeflow-active-projector.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./wakeflow-host-capability.mjs";
import { createWakeflowLayoutDescriptor } from "./wakeflow-layout-descriptor.mjs";
import { inspectLedgerProjectionSource } from "./wakeflow-ledger-projector.mjs";
import { inspectWakeflowLocalLayout } from "./wakeflow-local-layout-inspection.mjs";
import {
  inspectPodClose,
  inspectPodEvidenceInventoryForLayout,
} from "./wakeflow-pod-service.mjs";
import { planWakeflowReconcileBackbone } from "./wakeflow-reconcile.mjs";
import { assertParsedWakeflowAssetBundle } from "./wakeflow-template-renderer.mjs";
import { inspectWindowBindingInventoryForLayout } from "./wakeflow-window-binding-service.mjs";
import { inspectWindowRuntimeProjectionsForLayout } from "./wakeflow-window-runtime-projector.mjs";
import { inspectWakeflowWorkspaceMutation } from "./wakeflow-workspace-mutation.mjs";
import {
  inspectTransportDemandAuthority,
  inspectTransportDemandForLayout,
} from "./wakeflow-transport-store.mjs";
import { WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND } from "./wakeflow-transport-records.mjs";
import {
  inspectWindowCoordinationLeaseInventoryForLayout,
} from "./wakeflow-window-lease-service.mjs";

/**
 * 一次只读 observation 绑定 config、storage、status 与 verification 四个投影。
 * 本模块只解释各 owner 已经提供的 descriptor/inventory/health 事实，不把“看见路径”
 * 升格为写入、修复或删除授权，也不重新实现任何 domain loader。
 *
 * 阅读导航：下面九类能力是同一次 observation 的不同观察角度，不是九套并行 authority。
 *
 * 1. 统一只读观测：inspectWakeflowObservabilityV3 负责一次采集、一次校验、一次签发。
 * 2. 核心领域接入：collectDomains 只调用 config、layout、active、ledger、identity、
 *    runtime、maintenance、reconcile 等 owner 的只读检查器。
 * 3. Transport 推进位置：inspectTransportStatus / transportFrontier 计算事实型 frontier，
 *    statusNextActions 只把未完成位置路由回真正的 owner。
 * 4. Pod 与 lease：inspectPodStatus / inspectLeaseStatus 组合 owner inventory 与 close/lease
 *    状态，不用文件存在性推断关闭、归档或释放资格。
 * 5. Storage 职责分类：buildStorageView 解释 authority、lifecycle、sensitivity 与 health，
 *    但绝不把观察结果升级为通用清理授权。
 * 6. Git 工作区观察：repositoryStatus / inspectRepositoryGit 只在已验证仓库根上执行
 *    脱敏、无可选锁、双读一致的 Git 查询。
 * 7. Verification gates：buildVerification 将 owner 事实转换为 15 个独立 gate；它只验
 *    当前一致性，不执行 repair。
 * 8. 公共调用面：文件末尾只暴露四个已签发投影的读取函数；MCP operation vocabulary
 *    与 wakeflow_status / wakeflow_view 的路由归 wakeflow-public-v3-runtime.mjs 等边界所有。
 * 9. 隐私、不可伪造与零写入：canonicalSnapshot、assertPrivateProjection、WeakMap 签发
 *    和 writesPerformed/repairsApplied=false 共同保证输出边界。
 */
export const WAKEFLOW_OBSERVATION_V3_KIND = "WakeflowObservabilityV3Observation";
export const WAKEFLOW_OBSERVATION_V3_SCHEMA_VERSION = 1;

const CONFIG_REF = "wakeflow.config.json";
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_DIRECTORY_COUNT = 10_000;
const MAX_STORAGE_ITEMS = 4_096;
const MAX_STATUS_ITEMS = 256;
const MAX_DIAGNOSTICS = 256;
const MAX_NEXT_ACTIONS = 256;
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const SAFE_CODE_RE = /^[a-z0-9][a-z0-9.-]{0,191}$/u;
const OBSERVATIONS = new WeakMap();

// descriptor 的字符串元数据属于跨 owner 合同。这里保持闭合集合，新增 vocabulary
// 若没有同时补齐 storage 语义会直接失败，而不是静默落入 generic 分类。
const KNOWN_AUTHORITIES = new Set([
  "active-authority", "active-state", "audit-hold", "demand-authority",
  "demand-identity", "durable-authority", "durable-intent", "host-evidence",
  "host-identity", "host-operation", "managed-evidence", "mutation-admission",
  "none", "pod-authority", "pre-demand-authority", "projection",
  "recovery-arbitration", "recovery-journal", "result-authority",
  "review-proposal", "runtime-admission", "runtime-lease", "task-authority",
  "test-contract", "transition-audit", "transport",
]);
const KNOWN_DESCRIPTOR_LIFECYCLES = new Set([
  "deterministic-managed-asset", "deterministic-projection", "ephemeral-lock",
  "event-fact", "incomplete-transaction-journal",
  "incomplete-transaction-tombstone", "managed-static", "managed-whole-file",
  "mixed-owned-managed-block", "mixed-owned-managed-component",
  "static-capability-root", "static-hold-root", "static-recovery-root",
  "static-secure-fallback-root", "transaction-staging-residue",
]);
const OPERATION_AUTHORITIES = new Set([
  "host-operation", "mutation-admission", "recovery-arbitration",
  "recovery-journal", "runtime-admission", "runtime-lease",
]);
const IMMUTABLE_EVENT_AUTHORITIES = new Set([
  "demand-authority", "demand-identity", "durable-intent", "host-evidence",
  "managed-evidence", "pod-authority", "result-authority", "review-proposal",
  "task-authority", "test-contract",
]);

const FORBIDDEN_STORAGE_CONCLUSIONS = Object.freeze([
  "storage-health-authorizes-repair-or-deletion",
  "empty-directory-means-unused-capability",
  "missing-event-file-means-event-completed-or-never-needed",
  "legacy-or-unknown-is-safe-to-auto-migrate",
  "projection-or-host-operation-is-non-sensitive",
]);

// ==================== 一、通用合同与安全原语（能力 1、9） ====================

/**
 * 统一承载可公开的错误码与脱敏详情；底层 cause 只用于本进程诊断。
 */
export class WakeflowObservabilityV3Error extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowObservabilityV3Error";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

// 用统一错误类型中止本次 observation，避免各领域泄露任意异常形状。
function fail(code, message, { details = {}, cause } = {}) {
  throw new WakeflowObservabilityV3Error(code, message, { details, cause });
}

// 递归冻结签发数据，防止调用方在不同投影读取之间篡改同一次观测结果。
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 为 ID、key 和 canonical 输出提供与 locale 无关的稳定排序。
function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 仅接受普通数据对象，拒绝数组、类实例及带自定义原型的输入。
function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 校验公共输入的精确字段集合，并拒绝 getter 等可在读取期间执行代码的属性。
function exactDataObject(value, expected, label) {
  if (!plainObject(value)) fail("wakeflow-observability-contract", `${label} must be one plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail("wakeflow-observability-contract", `${label} has an invalid field set`, {
      details: { expected, actual: actual.map(String) },
    });
  }
  const result = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-observability-contract", `${label}.${key} must be one enumerable data property`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

// 将数据收敛为可复制、可摘要的 canonical JSON 快照。
function canonicalSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-observability-canonical", `${label} must be bounded canonical JSON data`, { cause });
  }
}

// 计算带算法前缀的字节摘要，供来源一致性和脱敏引用使用。
function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

// 只保留闭合字符集内的错误码，其他异常统一映射到调用点的安全码。
function safeCode(value, fallback) {
  return typeof value === "string" && SAFE_CODE_RE.test(value) ? value : fallback;
}

// 只保留有界 JSON Pointer，避免错误对象把任意路径或控制字符带入投影。
function safePointer(value) {
  if (
    typeof value !== "string"
    || value.length > 512
    || !value.startsWith("$")
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) return "$";
  return value;
}

// 比较一次 no-follow 读取前后的 inode 元数据，识别替换、改写与竞态。
function sameStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

// 校验宿主、资源包、适配器与真实 workspace root，生成内部不可变输入。
function normalizeInput(value) {
  const input = exactDataObject(
    value,
    ["workspaceRoot", "hostProfile", "bundle", "language", "hostSettingsAssetsAdapter"],
    "observability input",
  );
  if (
    typeof input.workspaceRoot !== "string"
    || !input.workspaceRoot.trim()
    || input.workspaceRoot !== input.workspaceRoot.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(input.workspaceRoot)
  ) {
    fail("wakeflow-observability-input", "workspaceRoot must be one trimmed control-free path");
  }
  if (!new Set(["en", "zh"]).has(input.language)) {
    fail("wakeflow-observability-input", "language must be en or zh");
  }
  try {
    assertParsedWakeflowAssetBundle(input.bundle);
  } catch (cause) {
    fail("wakeflow-observability-input", "bundle must be one parsed Wakeflow asset bundle", { cause });
  }
  let profile;
  try {
    profile = normalizeWakeflowHostCapabilityProfile(input.hostProfile);
  } catch (cause) {
    fail("wakeflow-observability-input", "hostProfile must be one valid Wakeflow host profile", { cause });
  }
  const hostOwnerApplicable = profile.capabilities.settings.applicable
    || profile.capabilities.assets.applicable;
  if (
    (hostOwnerApplicable && (
      !plainObject(input.hostSettingsAssetsAdapter)
      || input.hostSettingsAssetsAdapter.hostId !== profile.hostId
      || typeof input.hostSettingsAssetsAdapter.planMaintenance !== "function"
      || typeof input.hostSettingsAssetsAdapter.createMutationParticipant !== "function"
    ))
    || (!hostOwnerApplicable && input.hostSettingsAssetsAdapter !== null)
  ) {
    fail(
      "wakeflow-observability-input",
      "hostSettingsAssetsAdapter must exactly match the current host applicability",
    );
  }
  const workspaceRoot = path.resolve(input.workspaceRoot);
  let stat;
  try {
    stat = lstatSync(workspaceRoot, { bigint: true });
  } catch (cause) {
    fail("wakeflow-observability-workspace", "workspace root is unavailable", { cause });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-observability-workspace", "workspace root must be one real directory");
  }
  let realWorkspaceRoot;
  try {
    realWorkspaceRoot = realpathSync(workspaceRoot);
  } catch (cause) {
    fail("wakeflow-observability-workspace", "workspace root cannot be resolved safely", { cause });
  }
  return Object.freeze({
    workspaceRoot,
    realWorkspaceRoot,
    rawHostProfile: input.hostProfile,
    profile,
    bundle: input.bundle,
    language: input.language,
    hostSettingsAssetsAdapter: input.hostSettingsAssetsAdapter,
  });
}

// ==================== 二、配置 authority 与观测一致性（能力 1、2） ====================

// 严格 config owner 失败后的只读诊断读取：有界、no-follow，并检测读取期变化。
function diagnosticRead(file) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (cause) {
    return cause?.code === "ENOENT"
      ? { status: "absent", bytes: null, sourceDigest: null, issueCode: null }
      : {
          status: "unavailable",
          bytes: null,
          sourceDigest: null,
          issueCode: "wakeflow-observability-config-stat",
        };
  }
  if (before.isSymbolicLink() || !before.isFile() || before.size > BigInt(MAX_CONFIG_BYTES)) {
    return {
      status: "unsafe",
      bytes: null,
      sourceDigest: null,
      issueCode: before.isSymbolicLink()
        ? "wakeflow-observability-config-symlink"
        : before.size > BigInt(MAX_CONFIG_BYTES)
          ? "wakeflow-observability-config-too-large"
          : "wakeflow-observability-config-wrong-type",
    };
  }
  let descriptor = null;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameStat(before, opened)) {
      return {
        status: "unstable",
        bytes: null,
        sourceDigest: null,
        issueCode: "wakeflow-observability-config-unstable",
      };
    }
    const bytes = readFileSync(descriptor);
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (
      bytes.length !== Number(opened.size)
      || !sameStat(opened, afterDescriptor)
      || !sameStat(opened, afterPath)
    ) {
      return {
        status: "unstable",
        bytes: null,
        sourceDigest: null,
        issueCode: "wakeflow-observability-config-unstable",
      };
    }
    return {
      status: "current",
      bytes,
      sourceDigest: digestBytes(bytes),
      issueCode: null,
    };
  } catch {
    return {
      status: "unavailable",
      bytes: null,
      sourceDigest: null,
      issueCode: "wakeflow-observability-config-read",
    };
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Read-only observation is already fail-closed by the captured source tuple.
      }
    }
  }
}

// 优先取得 config owner 的稳定 v3 快照；失败时只分类未初始化、迁移或损坏状态。
function inspectConfigAuthority(normalized) {
  const file = path.join(normalized.workspaceRoot, CONFIG_REF);
  // 先走 config owner 的单次稳定读取；成功时 sourceDigest 与 configDigest
  // 必然绑定同一组字节。只有严格读取失败后才进入脱敏诊断路径。
  try {
    const snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: normalized.workspaceRoot });
    return Object.freeze({
      status: "valid",
      snapshot,
      sourceDigest: snapshot.sourceDigest,
      diagnostics: [],
    });
  } catch (cause) {
    const strictIssue = safeCode(cause?.code, "wakeflow-observability-config-invalid");
    const source = diagnosticRead(file);
    if (source.status === "absent") {
      return Object.freeze({ status: "uninitialized", snapshot: null, sourceDigest: null, diagnostics: [] });
    }
    return inspectInvalidConfigSource(source, strictIssue);
  }
}

// 解释严格读取失败后的原始字节，但绝不把 v1/v2 或无效 JSON 降级为可运行配置。
function inspectInvalidConfigSource(source, strictIssue) {
  const diagnostics = [];
  if (strictIssue !== null) diagnostics.push({ code: strictIssue, pointer: "$" });
  if (source.issueCode !== null) diagnostics.push({ code: source.issueCode, pointer: "$" });
  if (source.status !== "current") {
    return Object.freeze({
      status: "invalid",
      snapshot: null,
      sourceDigest: source.sourceDigest,
      diagnostics: Object.freeze(diagnostics),
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(UTF8_FATAL.decode(source.bytes));
  } catch {
    diagnostics.push({ code: "wakeflow-observability-config-json", pointer: "$" });
    return Object.freeze({
      status: "invalid",
      snapshot: null,
      sourceDigest: source.sourceDigest,
      diagnostics: Object.freeze(diagnostics),
    });
  }
  if (
    plainObject(parsed)
    && Number.isInteger(parsed.schemaVersion)
    && parsed.schemaVersion >= 1
    && parsed.schemaVersion <= 2
  ) {
    return Object.freeze({
      status: "migration-required",
      snapshot: null,
      sourceDigest: source.sourceDigest,
      sourceSchemaVersion: parsed.schemaVersion,
      diagnostics: Object.freeze([{ code: "wakeflow-config-migration-required", pointer: "$/schemaVersion" }]),
    });
  }
  try {
    parseWakeflowConfigV3(parsed);
  } catch (cause) {
    diagnostics.push({
      code: safeCode(cause?.code, "wakeflow-observability-config-schema"),
      pointer: safePointer(cause?.path),
    });
  }
  return Object.freeze({
    status: "invalid",
    snapshot: null,
    sourceDigest: source.sourceDigest,
    diagnostics: Object.freeze(diagnostics),
  });
}

// 领域采集完成后复读配置，并交叉核对 active/reconcile 摘要，拒绝混合时点投影。
function assertObservationConfigCoherence(normalized, config, domains) {
  if (config.status !== "valid") return;
  let confirmed;
  try {
    confirmed = loadWakeflowConfigV3Snapshot({ workspaceRoot: normalized.workspaceRoot });
  } catch (cause) {
    fail(
      "wakeflow-observability-config-unstable",
      "config authority changed during the observation",
      { cause },
    );
  }
  const activeDigest = domains.active.status === "available"
    ? domains.active.value.configDigest
    : config.snapshot.configDigest;
  const reconcileModelDigest = domains.reconcile.status === "available"
    ? domains.reconcile.value.config?.modelDigest
    : config.snapshot.configDigest;
  const reconcileBytesDigest = domains.reconcile.status === "available"
    ? domains.reconcile.value.config?.bytesDigest
    : config.sourceDigest;
  if (
    confirmed.configDigest !== config.snapshot.configDigest
    || confirmed.sourceDigest !== config.sourceDigest
    || activeDigest !== config.snapshot.configDigest
    || reconcileModelDigest !== config.snapshot.configDigest
    || reconcileBytesDigest !== config.sourceDigest
  ) {
    fail(
      "wakeflow-observability-config-unstable",
      "config authority was not coherent across the observation",
    );
  }
}

// 将单个 owner 的异常隔离为 unavailable 领域结果，不让任意异常破坏其他投影。
function domainRead(name, reader) {
  try {
    return Object.freeze({ name, status: "available", value: reader(), issueCode: null });
  } catch (cause) {
    return Object.freeze({
      name,
      status: "unavailable",
      value: null,
      issueCode: safeCode(cause?.code, `wakeflow-observability-${name}-unavailable`),
    });
  }
}

// Transport/Pod 依赖 active demand 清单时，强制要求完整且健康的 active authority。
function activeDemandsOrFail(active, owner) {
  if (
    active.status !== "available"
    || active.value.axes.sourceHealth !== "complete"
    || active.value.axes.storageHealth !== "healthy"
  ) {
    fail(
      `wakeflow-observability-${owner}-active-source`,
      `${owner} observation requires one healthy active authority inventory`,
    );
  }
  return active.value.demands;
}

// ==================== 三、领域 owner 采集（能力 2、3、4） ====================

// 汇总严格或诊断 transport inventory 中四类 transport 记录数量。
function transportCounts(entries) {
  return Object.fromEntries(["groups", "packets", "envelopes", "runs"].map((kind) => [
    kind,
    entries[kind].length,
  ]));
}

// 根据 group→packet→envelope→run→result 的缺口确定当前推进 frontier。
function transportFrontier(inventory, progress) {
  const counts = transportCounts(inventory.entries);
  const packetIds = new Set(inventory.entries.packets.map((entry) => entry.record.packetId));
  const requiredPacketIds = new Set(inventory.entries.groups.flatMap((entry) => (
    entry.record.members.map((member) => member.packetId)
  )));
  const targetEnvelopePacketIds = new Set(inventory.entries.envelopes
    .filter((entry) => entry.record.artifactKind === WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND)
    .map((entry) => entry.record.packetId));
  const runDeliveryIds = new Set(inventory.entries.runs.map((entry) => entry.record.deliveryId));
  const pending = {
    packets: [...requiredPacketIds].filter((id) => !packetIds.has(id)).length,
    envelopes: [...packetIds].filter((id) => !targetEnvelopePacketIds.has(id)).length,
    runs: inventory.entries.envelopes.filter((entry) => !runDeliveryIds.has(entry.record.deliveryId)).length,
    results: progress?.pendingResultCount ?? null,
  };
  const frontier = counts.groups === 0
    ? "not-started"
    : pending.packets > 0
      ? "group-to-packet"
      : pending.envelopes > 0
        ? "packet-to-envelope"
        : pending.runs > 0
          ? "envelope-to-run"
          : pending.results > 0
            ? "run-to-result"
            : "current";
  return { counts, pending, frontier };
}

// 逐个 active demand 读取 transport；严格 authority 失败时仅返回 unknown 诊断事实。
function inspectTransportStatus(normalized, snapshot, active) {
  return activeDemandsOrFail(active, "transport").map((demand) => {
    const input = {
      workspaceRoot: normalized.workspaceRoot,
      programId: snapshot.model.program.programId,
      demandId: demand.demandId,
    };
    try {
      const inventory = inspectTransportDemandAuthority(input);
      return {
        demandId: demand.demandId,
        status: inventory.status,
        ...transportFrontier(inventory, demand.progress),
        issueCodes: [],
        inventoryDigest: inventory.inventoryDigest,
      };
    } catch {
      const inventory = inspectTransportDemandForLayout(input);
      return {
        demandId: demand.demandId,
        status: inventory.status,
        counts: transportCounts(inventory.entries),
        pending: { packets: null, envelopes: null, runs: null, results: demand.progress?.pendingResultCount ?? null },
        frontier: "unknown",
        issueCodes: [...new Set(inventory.issues.map((entry) => safeCode(
          entry.code,
          "wakeflow-transport-diagnostic-invalid",
        )))].sort(lexicalCompare),
        inventoryDigest: inventory.inventoryDigest,
      };
    }
  }).sort((left, right) => lexicalCompare(left.demandId, right.demandId));
}

// 读取共享窗口 lease owner inventory，并只投影路由所需的有界字段。
function inspectLeaseStatus(common) {
  const inventory = inspectWindowCoordinationLeaseInventoryForLayout(common);
  return {
    status: inventory.status,
    inventoryDigest: inventory.inventoryDigest,
    items: inventory.leases.map(({ lease }) => ({
      leaseId: lease.leaseId,
      windowId: lease.windowId,
      demandId: lease.demandId,
      targetTaskId: lease.targetTaskId,
      deliveryId: lease.deliveryId,
      acquiredAt: lease.acquiredAt,
      expiresAt: lease.expiresAt,
    })).sort((left, right) => lexicalCompare(left.windowId, right.windowId)),
  };
}

// 交叉关联 Pod evidence inventory、isolated demand 与 close authority，识别缺失或重复关联。
function inspectPodStatus(normalized, snapshot, active) {
  const inventory = inspectPodEvidenceInventoryForLayout({
    workspaceRoot: normalized.workspaceRoot,
    expectedProgramId: snapshot.model.program.programId,
    hostId: normalized.profile.hostId,
  });
  const closeByPodId = new Map();
  const demandIssues = [];
  for (const demand of activeDemandsOrFail(active, "pod")) {
    if (demand.placement !== "isolated") continue;
    const close = inspectPodClose({
      workspaceRoot: normalized.workspaceRoot,
      stateRoot: path.join(normalized.workspaceRoot, ".wakeflow-active", "current", demand.demandId),
      expectedProgramId: snapshot.model.program.programId,
    });
    const closeIssueCodes = [...new Set((close.blockingReasons ?? []).map((entry) => safeCode(
      entry.code,
      "wakeflow-pod-close-invalid",
    )))].sort(lexicalCompare);
    if (typeof close.podId !== "string") {
      demandIssues.push({
        demandId: demand.demandId,
        closeStatus: close.status,
        issueCodes: closeIssueCodes.length > 0
          ? closeIssueCodes
          : ["wakeflow-pod-close-authority-unavailable"],
      });
      continue;
    }
    if (closeByPodId.has(close.podId)) {
      demandIssues.push({
        demandId: demand.demandId,
        closeStatus: close.status,
        issueCodes: ["wakeflow-pod-active-linkage-duplicate"],
      });
      continue;
    }
    closeByPodId.set(close.podId, { demandId: demand.demandId, close });
  }
  const items = inventory.pods.map((pod) => {
    const counts = {};
    for (const record of pod.records) counts[record.kind] = (counts[record.kind] ?? 0) + 1;
    const close = closeByPodId.get(pod.podId)?.close ?? null;
    return {
      podId: pod.podId,
      linkage: pod.linkage,
      recordCount: pod.recordCount,
      recordCounts: Object.fromEntries(sortedEntries(counts)),
      phase: close?.podPhase ?? "unknown",
      closeStatus: close?.status ?? "unknown",
      archiveEligible: close?.archiveEligible ?? false,
      blockingReasonCodes: (close?.blockingReasons ?? [])
        .map((entry) => safeCode(entry.code, "pod-status-unknown"))
        .sort(lexicalCompare),
    };
  }).sort((left, right) => lexicalCompare(left.podId, right.podId));
  const inventoryPodIds = new Set(inventory.pods.map((entry) => entry.podId));
  for (const [podId, closeEntry] of closeByPodId) {
    if (inventoryPodIds.has(podId)) continue;
    demandIssues.push({
      demandId: closeEntry.demandId,
      closeStatus: closeEntry.close.status,
      issueCodes: ["wakeflow-pod-evidence-missing"],
    });
  }
  demandIssues.sort((left, right) => lexicalCompare(left.demandId, right.demandId));
  return {
    status: inventory.status,
    issueCodes: [...new Set(inventory.issues.map((entry) => safeCode(
      entry.code,
      "wakeflow-pod-inventory-invalid",
    )))].sort(lexicalCompare),
    inventoryDigest: inventory.inventoryDigest,
    demandIssues,
    items,
  };
}

// 一次调用所有适用领域的只读 owner；此处只编排结果，不复制各领域解析规则。
function collectDomains(normalized, config) {
  if (config.status !== "valid") return Object.freeze({});
  const snapshot = config.snapshot;
  const descriptor = createWakeflowLayoutDescriptor({
    model: snapshot.model,
    hostProfile: normalized.rawHostProfile,
  });
  const common = {
    workspaceRoot: normalized.workspaceRoot,
    model: snapshot.model,
    configDigest: snapshot.configDigest,
    hostProfile: normalized.rawHostProfile,
  };
  const local = domainRead("local-layout", () => inspectWakeflowLocalLayout({
    workspaceRoot: normalized.workspaceRoot,
    model: snapshot.model,
    layoutDescriptor: descriptor,
    hostProfile: normalized.rawHostProfile,
  }));
  const active = domainRead("active-projection", () => inspectWakeflowActiveProjection({
    workspaceRoot: normalized.workspaceRoot,
    bundle: normalized.bundle,
    language: normalized.language,
  }));
  const ledger = domainRead("ledger", () => inspectLedgerProjectionSource({
    ledgerRoot: snapshot.ledgerRoot,
    programId: snapshot.model.program.programId,
    programDisplayName: snapshot.model.program.displayName,
  }));
  const transport = domainRead("transport", () => inspectTransportStatus(
    normalized,
    snapshot,
    active,
  ));
  const leases = domainRead("leases", () => inspectLeaseStatus(common));
  const pods = normalized.profile.capabilities.pod.applicable
    ? domainRead("pods", () => inspectPodStatus(normalized, snapshot, active))
    : Object.freeze({
        name: "pods",
        status: "not-applicable",
        value: null,
        issueCode: null,
      });
  const binding = domainRead("window-identity", () => inspectWindowBindingInventoryForLayout({
    workspaceRoot: normalized.workspaceRoot,
    programId: snapshot.model.program.programId,
    hostId: normalized.profile.hostId,
    configDigest: snapshot.configDigest,
    windowIds: snapshot.model.topology.windows.map((entry) => entry.windowId),
    hostProfile: normalized.rawHostProfile,
  }));
  const windowRuntime = domainRead("window-runtime", () => inspectWindowRuntimeProjectionsForLayout(common));
  const maintenance = domainRead("maintenance", () => inspectWakeflowWorkspaceMutation({
    workspaceRoot: normalized.workspaceRoot,
  }));
  const reconcile = domainRead("reconcile", () => planWakeflowReconcileBackbone({
    workspaceRoot: normalized.workspaceRoot,
    hostProfile: normalized.rawHostProfile,
    bundle: normalized.bundle,
    language: normalized.language,
    hostSettingsAssetsAdapter: normalized.hostSettingsAssetsAdapter,
  }));
  return Object.freeze({
    descriptor,
    local,
    active,
    ledger,
    transport,
    leases,
    pods,
    binding,
    windowRuntime,
    maintenance,
    reconcile,
  });
}

// ==================== 四、Config View 投影 ====================

// 将 window 的类型化 root 引用解析为配置内的 portable rootRef，不访问文件系统。
function rootRefForWindow(window, model) {
  if (window.root.kind === "program") return ".";
  if (window.root.kind === "repository") {
    return model.topology.repositories.find((entry) => entry.repositoryId === window.root.repositoryId)?.path ?? null;
  }
  return model.topology.supportSurfaces.find((entry) => entry.surfaceId === window.root.surfaceId)?.path ?? null;
}

// 对对象条目按 key 稳定排序，保证投影摘要与输入枚举顺序无关。
function sortedEntries(value) {
  return Object.entries(value).sort(([left], [right]) => lexicalCompare(left, right));
}

// 从宿主 launch 配置中选择可公开、可移植的配置字段。
function launchConfigView(value) {
  if (!plainObject(value)) return null;
  return {
    ...(plainObject(value.modelByRole)
      ? { modelByRole: Object.fromEntries(sortedEntries(value.modelByRole)) }
      : {}),
    ...(plainObject(value.reasoningEffortByRole)
      ? { reasoningEffortByRole: Object.fromEntries(sortedEntries(value.reasoningEffortByRole)) }
      : {}),
    ...(typeof value.permissionMode === "string" ? { permissionMode: value.permissionMode } : {}),
  };
}

// 标明配置字段来自 durable input、固定协议、宿主默认值还是派生 placement。
function configValueSources(model) {
  const pointers = [
    ["$/program", "durable-input"],
    ["$/storage/ledgerRoot", "durable-input"],
    ["$/governance", "durable-input"],
    ["$/topology/repositories", "durable-input"],
    ["$/topology/supportSurfaces", "durable-input"],
    ["$/topology/windows", "durable-input"],
    ["$/fixedProtocolRoots", "fixed-protocol"],
    ["$/runtimeProfile", "host-profile-default"],
  ];
  for (const [index] of model.topology.windows.entries()) {
    pointers.push([`$/topology/windows/${index}/rootRef`, "derived-placement"]);
  }
  if (Object.keys(model.hosts).length > 0) pointers.push(["$/hosts", "durable-input"]);
  return pointers
    .map(([pointer, source]) => ({ pointer, source }))
    .sort((left, right) => lexicalCompare(left.pointer, right.pointer));
}

// 为未初始化、待迁移或无效配置生成固定形状的不可用 Config View。
function unavailableConfigView(config) {
  return {
    kind: "WakeflowConfigView",
    schemaVersion: 1,
    status: config.status,
    configRef: CONFIG_REF,
    configDigest: null,
    sourceDigest: config.sourceDigest,
    program: null,
    topology: { repositories: [], supportSurfaces: [], windows: [] },
    storage: null,
    governance: null,
    hosts: [],
    runtimeProfile: null,
    fixedProtocolRoots: [".wakeflow-active", ".wakeflow-local"],
    valueSources: [],
    diagnostics: config.diagnostics,
    ...(config.status === "migration-required"
      ? {
          migration: {
            sourceSchemaVersion: config.sourceSchemaVersion,
            requiredCapability: "explicit-wakeflow-v3-migrator",
          },
        }
      : {}),
  };
}

// 将有效 config authority 投影成按稳定 ID 排序的公开配置视图。
function buildConfigView(normalized, config) {
  if (config.status !== "valid") return unavailableConfigView(config);
  const { model, configDigest } = config.snapshot;
  const repositories = [...model.topology.repositories]
    .sort((left, right) => lexicalCompare(left.repositoryId, right.repositoryId))
    .map((entry) => ({
      repositoryId: entry.repositoryId,
      path: entry.path,
      displayName: entry.displayName,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      instructionManagement: entry.instructionManagement,
      residueExceptionCount: entry.validation?.residueExceptions?.length ?? 0,
    }));
  const supportSurfaces = [...model.topology.supportSurfaces]
    .sort((left, right) => lexicalCompare(left.surfaceId, right.surfaceId))
    .map((entry) => ({
      surfaceId: entry.surfaceId,
      capability: entry.capability,
      path: entry.path,
      displayName: entry.displayName,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ownership: entry.ownership,
      ...(entry.instructionManagement === undefined
        ? {}
        : { instructionManagement: entry.instructionManagement }),
    }));
  const windows = [...model.topology.windows]
    .sort((left, right) => lexicalCompare(left.windowId, right.windowId))
    .map((entry) => ({
      windowId: entry.windowId,
      role: entry.role,
      displayName: entry.displayName,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      root: entry.root,
      rootRef: rootRefForWindow(entry, model),
    }));
  const hosts = sortedEntries(model.hosts).map(([hostId, value]) => ({
    hostId,
    ...(value.launch === undefined ? {} : { launch: launchConfigView(value.launch) }),
    ...(value.tmux === undefined
      ? {}
      : { tmux: { configured: true, configuredFields: Object.keys(value.tmux).sort(lexicalCompare) } }),
  }));
  const capabilities = sortedEntries(normalized.profile.capabilities).map(([name, capability]) => ({
    name,
    applicable: capability.applicable,
    realization: capability.realization,
  }));
  return {
    kind: "WakeflowConfigView",
    schemaVersion: 1,
    status: "valid",
    configRef: CONFIG_REF,
    configDigest,
    sourceDigest: config.sourceDigest,
    program: model.program,
    topology: { repositories, supportSurfaces, windows },
    storage: { ledgerRoot: model.storage.ledgerRoot },
    governance: model.governance,
    hosts,
    runtimeProfile: {
      hostId: normalized.profile.hostId,
      hostDirName: normalized.profile.hostDirName,
      capabilities,
    },
    fixedProtocolRoots: [".wakeflow-active", ".wakeflow-local"],
    valueSources: configValueSources(model),
    diagnostics: [],
  };
}

// ==================== 五、Storage 职责与健康投影（能力 5） ====================

// 将 bigint 权限位格式化为稳定的四位八进制字符串。
function modeString(stat) {
  return `0${Number(stat.mode & 0o777n).toString(8).padStart(3, "0")}`;
}

// 将文件系统 stat 收敛为 storage 合同允许的节点类型。
function nodeType(stat) {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "other";
}

// 沿 workspace 内的 portable 路径逐层 no-follow 检查类型、权限与有界目录计数。
function inspectPathChain(realWorkspaceRoot, portableRef, { countDirectory = false } = {}) {
  const target = path.resolve(realWorkspaceRoot, ...portableRef.split("/"));
  const root = path.parse(target).root;
  const segments = path.relative(root, target).split(path.sep).filter(Boolean);
  let current = root;
  let finalStat = null;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = lstatSync(current, { bigint: true });
    } catch (cause) {
      if (cause?.code === "ENOENT") return { state: "absent", type: null, mode: null };
      return { state: "unreadable", type: null, mode: null };
    }
    if (stat.isSymbolicLink()) return { state: "present", type: "symlink", mode: modeString(stat) };
    if (index < segments.length - 1 && !stat.isDirectory()) {
      return { state: "blocked-by-ancestor", type: nodeType(stat), mode: modeString(stat) };
    }
    finalStat = stat;
  }
  if (finalStat === null) return { state: "unreadable", type: null, mode: null };
  const type = nodeType(finalStat);
  const actual = {
    state: "present",
    type,
    mode: modeString(finalStat),
    ...(type === "file"
      ? finalStat.size <= BigInt(Number.MAX_SAFE_INTEGER)
        ? { byteCount: Number(finalStat.size), byteCountOverflow: false }
        : { byteCount: null, byteCountOverflow: true }
      : {}),
  };
  if (type !== "directory" || !countDirectory) return actual;
  let directory = null;
  try {
    directory = opendirSync(target);
    let entryCount = 0;
    let truncated = false;
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      if (entryCount === MAX_DIRECTORY_COUNT) {
        truncated = true;
        break;
      }
      entryCount += 1;
    }
    directory.closeSync();
    directory = null;
    const after = lstatSync(target, { bigint: true });
    if (!sameStat(finalStat, after)) return { state: "unstable", type: "directory", mode: modeString(after) };
    return { ...actual, entryCount, truncated };
  } catch {
    return { state: "unreadable", type: "directory", mode: actual.mode };
  } finally {
    if (directory !== null) {
      try {
        directory.closeSync();
      } catch {
        // The bounded observation already reports the directory as unreadable.
      }
    }
  }
}

// 根据 descriptor 的闭合 authority/lifecycle 词汇确定资源的语义类别。
function storageClass(entry) {
  if (!KNOWN_AUTHORITIES.has(entry.authority) || !KNOWN_DESCRIPTOR_LIFECYCLES.has(entry.lifecycle)) {
    fail("wakeflow-observability-layout-vocabulary", "layout descriptor metadata is not covered");
  }
  if (entry.key === "workspace.config") return "durable-input";
  if (entry.authority === "projection") return "projection";
  if (entry.authority === "transport") return "transport";
  if (entry.authority === "host-identity" || entry.key.startsWith("event.identity.")) return "identity";
  if (
    OPERATION_AUTHORITIES.has(entry.authority)
    // archive tombstone 没有独立 authority，但它是必须由 archive owner 精确
    // 恢复/释放的事务状态，不能降级为 generic reconcile work surface。
    || entry.lifecycle === "transaction-staging-residue"
    || entry.lifecycle === "incomplete-transaction-tombstone"
  ) return "operation";
  if (entry.key.startsWith("event.audit.") || entry.authority === "audit-hold") return "audit";
  if (
    entry.authority === "host-evidence"
    || entry.key.includes("evidence")
    || entry.key.startsWith("event.pod.")
  ) return "evidence";
  if (entry.lifecycle === "deterministic-managed-asset") return "managed-asset";
  if (entry.authority !== "none") return "authority";
  return "work-surface";
}

// 将 descriptor createTiming/key 翻译为真正触发创建的 owner 事件，而非初始化猜测。
function createTrigger(entry) {
  if (explicitProductHostAuthorization(entry)) return "explicit-product-host-authorization";
  if (entry.createTiming !== "event-only") {
    if (entry.createTiming === "reference-only") return "owner-provided";
    if (entry.createTiming === "current-host") return "initialize-current-host";
    return "initialize-static";
  }
  if (entry.key.startsWith("event.identity.")) return "register";
  if (entry.key.startsWith("event.transport.")) return "dispatch";
  if (entry.key.startsWith("event.coordination.")) return "delivery-admission";
  if (entry.key.startsWith("event.maintenance.")) return "maintenance-operation";
  if (
    entry.key === "event.demand.transaction.archive"
    || entry.key.startsWith("event.demand.archive.")
  ) return "archive";
  if (entry.key.includes("result")) return "result";
  if (entry.key.startsWith("event.pod.")) return "Pod-event";
  if (entry.key.startsWith("event.audit.")) return "preserve";
  if (entry.key.startsWith("event.ledger.archive")) return "archive";
  if (entry.key.startsWith("event.ledger.requirement.")) return "promote-requirement";
  if (entry.key.startsWith("event.ledger.confirmation.")) return "confirm-goal-stage";
  if (entry.key.startsWith("event.demand.publication.")) return "demand-create";
  if (entry.key === "event.demand.root" || entry.key === "event.demand.identity") return "demand-create";
  if (entry.key === "event.demand.authority") return "freeze-demand-authority";
  if (entry.key === "event.demand.state" || entry.key === "event.demand.controller-events") {
    return "state-transition";
  }
  if (entry.key === "event.demand.index" || entry.key === "event.demand.progress") return "projection";
  if (/^event\.demand\..+\.root$/u.test(entry.key)) return "demand-capability";
  if (entry.key === "event.demand.task-package") return "task-package-create";
  if (entry.key.includes("target-result")) return "result";
  if (entry.key === "event.demand.review-candidate") return "review";
  if (entry.key === "event.demand.test-card") return "test-card-create";
  if (entry.key.startsWith("event.demand.evidence.")) return "evidence-import";
  if (entry.key === "event.demand.transaction.create") return "demand-create";
  if (entry.key === "event.demand.transaction.state-transition") return "state-transition";
  if (entry.key.startsWith("event.demand.pod.")) return "Pod-design";
  return "owner-event";
}

// 判断产品仓库宿主面是否要求维护请求中的显式授权。
function explicitProductHostAuthorization(entry) {
  return typeof entry.condition === "string"
    && entry.condition.split("+").includes("explicit-product-host-surface-authorization");
}

// 区分静态必需、派生必需、owner 可选以及事件尚未发生四种预期存在状态。
function expectedPresence(entry) {
  if (entry.createTiming === "event-only") return "deferred-until-event";
  if (entry.createTiming === "reference-only" || explicitProductHostAuthorization(entry)) {
    return "optional-owner-content";
  }
  if (entry.authority === "projection") return "required-derived";
  return "required-static";
}

// 按路径与语义分类投影敏感度，mixed-owned tracked surface 仍保持 public。
function sensitivity(entry) {
  if (
    entry.key.includes("payload")
    || entry.key.includes("test-access.plan")
    || entry.key.includes("prompt")
    || entry.key.includes("evidence")
  ) return "payload-private";
  if (
    entry.path.startsWith(".wakeflow-local/runtime/hosts/")
    || entry.key.startsWith("event.identity.")
    || entry.key.startsWith("event.keep-live.")
    || entry.key.startsWith("event.locator.")
  ) return "host-secret";
  if (entry.path.startsWith(".wakeflow-local/")) return "workspace-private";
  // mixed-owned 表示 Wakeflow 只维护文件中的受管 block/component，不改变该文件
  // 仍属于 tracked portable surface；不能因为 ownership 是混合的就误报为私有。
  return (entry.tracking === "tracked" || entry.tracking === "tracked-mixed-owned")
    ? "public"
    : "workspace-private";
}

// 把 owner lifecycle 投影为 regenerable、immutable、append-only 或 explicit-release 等语义。
function projectedLifecycle(entry, itemClass) {
  // storage 生命周期只描述 owner 合同，不授权 generic cleanup。
  if (itemClass === "projection" || itemClass === "managed-asset") return "regenerable";
  if (itemClass === "transport") return "archive-gated";
  if (itemClass === "operation" || entry.authority === "audit-hold") return "explicit-release";
  if (entry.authority === "transition-audit") return "append-only";
  if (
    entry.createTiming === "event-only"
    && (IMMUTABLE_EVENT_AUTHORITIES.has(entry.authority) || entry.authority === "durable-authority")
  ) return "immutable";
  if (entry.createTiming === "event-only") return "event-retained";
  if (itemClass === "durable-input" || itemClass === "identity") return "mutable-snapshot";
  if (entry.authority !== "none") return "append-only";
  return "mutable-snapshot";
}

// 给 storage item 指回唯一负责处理它的 owner capability，不产生通用修复动作。
function ownerAction(itemClass, entry) {
  if (itemClass === "projection" || itemClass === "managed-asset") return "reconcile";
  if (itemClass === "identity") return "register";
  if (itemClass === "transport") return "inspect-or-archive";
  if (itemClass === "audit") return "inspect-or-release";
  if (itemClass === "operation") return "inspect-owner-operation";
  if (itemClass === "durable-input") return "inspect-config";
  if (entry.createTiming === "reference-only") return "inspect-owner-root";
  return "inspect-or-reconcile";
}

// 将 local-layout owner 的静态、受管与初始投影库存按 portable path 建索引。
function localItemsByPath(local) {
  if (local.status !== "available") return new Map();
  return new Map([
    ...local.value.items.staticDirectories,
    ...local.value.items.managedFiles,
    ...local.value.items.initialProjections,
  ].map((entry) => [entry.path, entry]));
}

// 将 local-layout 已观察到的事件按 descriptor key 建多值索引，跳过已证明 deferred 的项。
function localEventsByKey(local) {
  const result = new Map();
  if (local.status !== "available") return result;
  for (const event of local.value.items.events) {
    if (event.classification === "deferred") continue;
    const keys = typeof event.key === "string"
      ? [event.key]
      : Array.isArray(event.matchedKeys)
        ? event.matchedKeys
        : [];
    for (const key of keys) {
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(event);
    }
  }
  return result;
}

// 把 reconcile action 的 configured root 与 ref 合成为 portable logical path。
function actionLogicalPath(action) {
  const joined = path.posix.join(action.root.configuredPath, action.ref);
  return path.posix.normalize(joined);
}

// 将 reconcile 文件动作按 logical path 建索引，并优先保留非 current 动作。
function reconcileActionsByPath(reconcile) {
  const result = new Map();
  if (reconcile.status !== "available" || reconcile.value.aggregatePlan === null) return result;
  for (const action of reconcile.value.aggregatePlan.payload.filesystemActions) {
    const logicalPath = actionLogicalPath(action);
    const previous = result.get(logicalPath);
    if (previous === undefined || previous.action === "current") result.set(logicalPath, action);
  }
  return result;
}

// 判断 reconcile 是否证明某个 owner component 当前且无需任何维护步骤。
function reconcileOwnerCurrent(reconcile, componentId, owner) {
  if (
    reconcile.status !== "available"
    || reconcile.value.status !== "ready"
    || reconcile.value.aggregatePlan === null
    || reconcile.value.aggregatePlan.payload.steps.length !== 0
  ) return false;
  return reconcile.value.ownerGraph.some((entry) => (
    entry.componentId === componentId
    && entry.owner === owner
    && entry.availability === "available"
  ));
}

// 将 local-layout 的领域分类映射为 Storage View 的统一 health 词汇。
function localHealth(classification) {
  const mapping = {
    current: "current",
    "owner-validated": "current",
    missing: "missing",
    "delegated-missing": "missing",
    "blocked-by-ancestor": "blocked-reference",
    unreadable: "schema-invalid",
    unstable: "schema-invalid",
    symlink: "symlink",
    "wrong-type": "wrong-type",
    "foreign-owner": "permission-drift",
    "permission-drift": "permission-drift",
    "unsafe-mode": "permission-drift",
    "delegated-drift": "digest-mismatch",
    "owner-validator-invalid": "schema-invalid",
    "owner-validator-stale": "digest-mismatch",
    "owner-validator-pending": "blocked-reference",
    // owner 已验证的在途操作是合法 runtime 状态，不是孤儿残留；是否允许维护
    // 由 mutation/reconcile admission 单独判断。
    "owner-validated-active-operation": "current",
  };
  return mapping[classification] ?? "unknown";
}

// 对非 local 资源依据实际节点存在性、类型、权限及空能力根计算 health。
function healthFromActual(entry, actual) {
  if (actual.state === "absent") {
    return entry.createTiming === "reference-only" ? "blocked-reference" : "missing";
  }
  if (actual.state === "blocked-by-ancestor") return "blocked-reference";
  if (actual.state === "unreadable" || actual.state === "unstable") return "schema-invalid";
  if (actual.type === "symlink") return "symlink";
  if (actual.type !== entry.pathKind) return "wrong-type";
  if (actual.mode !== entry.mode) return "permission-drift";
  if (
    actual.type === "directory"
    && actual.entryCount === 0
    && new Set(["static-capability-root", "static-hold-root", "static-recovery-root"]).has(entry.lifecycle)
  ) return "empty-ready";
  return "current";
}

// 用 reconcile 的 owner 动作补充 drift 语义，但不覆盖安全类阻塞状态。
function healthFromAction(health, action) {
  if (!action || new Set(["symlink", "wrong-type", "permission-drift", "schema-invalid"]).has(health)) {
    return health;
  }
  if (action.action === "current") return health;
  if (action.action === "create-managed") return "missing";
  if (action.action === "update-managed") return "digest-mismatch";
  if (action.action === "blocked") return "blocked-reference";
  return health;
}

// 对 payload/prompt 等私有模式隐藏 logical path，仅保留不可逆 pattern digest。
function redactedPattern(entry, itemSensitivity) {
  const redact = itemSensitivity === "payload-private" && (
    entry.key.includes("payload")
    || entry.key.includes("test-access.plan")
    || entry.key.includes("prompt")
  );
  if (!redact) return { logicalPath: entry.path, patternDigest: null };
  return { logicalPath: null, patternDigest: digestBytes(Buffer.from(entry.path, "utf8")) };
}

// 将 ledger owner 的真实成员计数映射到 descriptor event key。
function ledgerEventInventory(ledger) {
  if (ledger.status !== "available") return null;
  const counts = ledger.value.counts;
  return new Map([
    ["event.ledger.requirement.root", counts.requirements],
    ["event.ledger.requirement.record", counts.requirements],
    ["event.ledger.requirement.document", counts.requirementDocuments],
    ["event.ledger.confirmation.root", counts.confirmations],
    ["event.ledger.confirmation.record", counts.confirmations],
    ["event.ledger.confirmation.document", counts.confirmationDocuments],
    ["event.ledger.archive.root", counts.archives],
    ["event.ledger.archive.manifest", counts.archives],
    ["event.ledger.archive.payload", counts.archivePayloads],
  ]);
}

// 将 active projector 提供的 storage inventory 映射到 descriptor event key。
function activeEventInventory(active) {
  if (active.status !== "available" || active.value.storageInventory.status !== "observed") {
    return null;
  }
  return new Map(active.value.storageInventory.entries.map((entry) => [entry.key, entry]));
}

// 用 owner inventory 解释 event 是否已创建；无法取得 owner 事实时保持 unknown。
function eventObservation(entry, eventsByKey, domains, ledgerEvents, activeEvents) {
  const matches = eventsByKey.get(entry.key) ?? [];
  if (matches.length > 0) {
    const healths = matches.map((event) => localHealth(event.classification));
    const bad = healths.find((health) => !new Set(["current", "empty-ready"]).has(health));
    return {
      actual: { state: "owner-inventory", count: matches.length },
      health: bad ?? "current",
    };
  }
  let owned = null;
  if (entry.key.startsWith("event.demand.") || entry.key.startsWith("event.active.")) {
    owned = activeEvents?.get(entry.key) ?? null;
  }
  else if (entry.key.startsWith("event.ledger.")) {
    const count = ledgerEvents?.get(entry.key);
    if (count !== undefined) owned = { count, health: "current" };
  } else if (entry.path.startsWith(".wakeflow-local/")) {
    // local-layout inspector 已递归闭合当前 host/shared 事件树；deferred 表示
    // owner 证明当前没有实例，而不是“没有检查”。
    if (domains.local.status === "available") owned = { count: 0, health: "current" };
  }
  if (owned !== null) return {
    actual: { state: "owner-inventory", count: owned.count },
    health: owned.count === 0 && owned.health === "current"
      ? "not-created-yet"
      : owned.health,
  };
  return {
    actual: { state: "owner-inventory-unavailable", count: null },
    health: "unknown",
  };
}

// 为当前宿主不适用的 capability 生成显式 not-applicable 项，避免误报 missing。
function capabilityItems(profile) {
  return sortedEntries(profile.capabilities)
    .filter(([, capability]) => !capability.applicable)
    .map(([name, capability]) => ({
      key: `capability.${name}`,
      logicalPath: null,
      patternDigest: null,
      owner: "host-profile",
      class: name === "identity" ? "identity" : "operation",
      createTrigger: "host-capability",
      applicability: {
        status: "not-applicable",
        reason: capability.realization,
        capability: name,
      },
      expectedPresence: "optional-owner-content",
      actual: { state: "not-applicable" },
      health: "not-applicable",
      sensitivity: "host-secret",
      lifecycle: "explicit-release",
      ownerAction: "inspect-host-capability",
    }));
}

// 按指定字段生成稳定排序的聚合计数。
function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[item[key]] = (counts[item[key]] ?? 0) + 1;
  return Object.fromEntries(sortedEntries(counts));
}

// 对公共集合实施统一上限，并返回总数、截断标记与后续 cursor。
function bounded(values, maximum) {
  return {
    items: values.slice(0, maximum),
    count: values.length,
    truncated: values.length > maximum,
    cursor: values.length > maximum ? `offset:${maximum}` : null,
  };
}

// 汇总并去重 local-layout 边界与 blocker，同时过滤已由 owner 证明合法的在途操作。
function localDiagnostics(local, reconcile) {
  if (local.status !== "available") {
    return [{ domain: "local-layout", code: local.issueCode, ref: null, refDigest: null }];
  }
  const hostSettingsCurrent = reconcileOwnerCurrent(
    reconcile,
    "host-settings-assets",
    "host-settings-assets-owner",
  );
  const values = [
    ...local.value.blockers.filter((entry) => !(
      hostSettingsCurrent
      && entry.classification === "owner-validator-pending"
      && entry.owner === "host-settings-assets-owner"
    )).filter((entry) => entry.classification !== "owner-validated-active-operation").map((entry) => ({
      domain: "local-layout",
      code: entry.classification,
      ref: entry.path ?? null,
      refDigest: entry.pathDigest ?? null,
      owner: entry.owner,
    })),
    ...local.value.items.boundaries
      .filter((entry) => entry.classification !== "foreign-host-surface")
      .map((entry) => ({
      domain: "local-layout-boundary",
      code: entry.classification,
      ref: entry.path ?? null,
      refDigest: entry.pathDigest ?? null,
      owner: entry.classification === "legacy" ? "generated-file-migrator" : "user-review",
      })),
  ];
  const deduplicated = new Map(values.map((entry) => [canonicalJson(entry), entry]));
  return [...deduplicated.values()].sort((left, right) => lexicalCompare(canonicalJson(left), canonicalJson(right)));
}

// 组合 descriptor、owner inventories、实际路径和 reconcile 计划，生成只读 Storage View。
function buildStorageView(normalized, config, domains) {
  if (config.status !== "valid") {
    return {
      kind: "WakeflowStorageView",
      schemaVersion: 1,
      status: "unavailable",
      configStatus: config.status,
      configDigest: null,
      layoutDigest: null,
      hostId: normalized.profile.hostId,
      overall: "unavailable",
      items: [],
      itemCollection: { count: 0, truncated: false, cursor: null },
      diagnostics: config.diagnostics,
      diagnosticCollection: {
        count: config.diagnostics.length,
        truncated: false,
        cursor: null,
      },
      summary: { byClass: {}, byHealth: {} },
      forbiddenConclusions: FORBIDDEN_STORAGE_CONCLUSIONS,
    };
  }
  const localByPath = localItemsByPath(domains.local);
  const eventsByKey = localEventsByKey(domains.local);
  const ledgerEvents = ledgerEventInventory(domains.ledger);
  const activeEvents = activeEventInventory(domains.active);
  const actionsByPath = reconcileActionsByPath(domains.reconcile);
  const hostSettingsCurrent = reconcileOwnerCurrent(
    domains.reconcile,
    "host-settings-assets",
    "host-settings-assets-owner",
  );
  const items = domains.descriptor.entries.map((entry) => {
    const itemClass = storageClass(entry);
    const itemSensitivity = sensitivity(entry);
    const location = redactedPattern(entry, itemSensitivity);
    let actual;
    let health;
    if (explicitProductHostAuthorization(entry)) {
      // 本次 public view 没有携带维护请求中的 authorizedRepositoryIds。
      // 因此即使产品仓库里恰好存在同名文件，也不能把“存在”解释成 Wakeflow 授权。
      actual = { state: "not-applicable" };
      health = "not-applicable";
    } else if (entry.createTiming === "event-only") {
      ({ actual, health } = eventObservation(
        entry,
        eventsByKey,
        domains,
        ledgerEvents,
        activeEvents,
      ));
    } else if (entry.path.startsWith(".wakeflow-local")) {
      const local = localByPath.get(entry.path);
      actual = local?.actual === null || local === undefined
        ? { state: "absent" }
        : {
            state: "present",
            type: local.actual.type,
            mode: local.actual.mode,
            ...(local.actual.linkCount === null ? {} : { linkCount: local.actual.linkCount }),
          };
      health = local === undefined
        ? domains.local.status === "available" ? "unknown" : "schema-invalid"
        : hostSettingsCurrent
          && entry.owner === "host-settings-assets-owner"
          && local.classification === "delegated-current-shape"
          ? "current"
          : localHealth(local.classification);
    } else {
      actual = inspectPathChain(normalized.realWorkspaceRoot, entry.path, {
        countDirectory: new Set([
          "static-capability-root",
          "static-hold-root",
          "static-recovery-root",
        ]).has(entry.lifecycle),
      });
      health = healthFromActual(entry, actual);
      health = healthFromAction(health, actionsByPath.get(path.posix.normalize(entry.path)));
    }
    const conditionalInactive = explicitProductHostAuthorization(entry)
      && health === "not-applicable";
    return {
      key: entry.key,
      ...location,
      owner: entry.owner,
      class: itemClass,
      createTrigger: createTrigger(entry),
      applicability: {
        status: conditionalInactive ? "not-applicable" : "applicable",
        reason: entry.condition ?? "layout-descriptor",
        capability: entry.capability,
      },
      expectedPresence: expectedPresence(entry),
      actual,
      health,
      sensitivity: itemSensitivity,
      lifecycle: projectedLifecycle(entry, itemClass),
      ownerAction: ownerAction(itemClass, entry),
    };
  });
  items.push(...capabilityItems(normalized.profile));
  items.sort((left, right) => lexicalCompare(left.key, right.key));
  const itemSlice = bounded(items, MAX_STORAGE_ITEMS);
  const diagnostics = localDiagnostics(domains.local, domains.reconcile);
  for (const domain of [
    domains.active,
    domains.ledger,
    domains.transport,
    domains.leases,
    ...(domains.pods.status === "not-applicable" ? [] : [domains.pods]),
    domains.binding,
    domains.windowRuntime,
    domains.maintenance,
    domains.reconcile,
  ]) {
    if (domain.status !== "available") diagnostics.push({
      domain: domain.name,
      code: domain.issueCode,
      ref: null,
      refDigest: null,
    });
  }
  diagnostics.sort((left, right) => lexicalCompare(canonicalJson(left), canonicalJson(right)));
  const diagnosticSlice = bounded(diagnostics, MAX_DIAGNOSTICS);
  const blocking = items.some((entry) => new Set([
    "wrong-type",
    "symlink",
    "schema-invalid",
    "orphan",
    "unknown",
    "blocked-reference",
  ]).has(entry.health));
  const drift = items.some((entry) => new Set([
    "missing",
    "permission-drift",
    "digest-mismatch",
  ]).has(entry.health));
  const reconcileCurrent = domains.reconcile.status === "available"
    && domains.reconcile.value.status === "ready"
    && domains.reconcile.value.aggregatePlan !== null
    && domains.reconcile.value.aggregatePlan.payload.steps.length === 0;
  const overall = blocking || diagnostics.length > 0 || itemSlice.truncated
    ? "blocked"
    : drift || !reconcileCurrent
      ? "drift"
      : "healthy";
  return {
    kind: "WakeflowStorageView",
    schemaVersion: 1,
    status: "observed",
    configStatus: "valid",
    configDigest: config.snapshot.configDigest,
    layoutDigest: domains.descriptor.layoutDigest,
    hostId: normalized.profile.hostId,
    overall,
    items: itemSlice.items,
    itemCollection: {
      count: itemSlice.count,
      truncated: itemSlice.truncated,
      cursor: itemSlice.cursor,
    },
    diagnostics: diagnosticSlice.items,
    diagnosticCollection: {
      count: diagnosticSlice.count,
      truncated: diagnosticSlice.truncated,
      cursor: diagnosticSlice.cursor,
    },
    summary: {
      byClass: countBy(items, "class"),
      byHealth: countBy(items, "health"),
    },
    forbiddenConclusions: FORBIDDEN_STORAGE_CONCLUSIONS,
  };
}

// ==================== 六、Verification gates（能力 7） ====================

// 构造一个固定字段的 verification gate；gate 只表达判定与证据，不携带修复权。
function gate(name, owner, status, code, evidence = []) {
  return { name, owner, status, code, evidence };
}

// 将 owner domain 的 available/unavailable 与领域谓词统一转换为 gate 结果。
function domainGate(domain, name, owner, predicate, failureCode, evidence = []) {
  if (domain.status !== "available") {
    return gate(name, owner, "unavailable", domain.issueCode, evidence);
  }
  return predicate(domain.value)
    ? gate(name, owner, "pass", "current", evidence)
    : gate(name, owner, "fail", failureCode, evidence);
}

// 从 Storage View 选择配置声明的 repository root 项，供仓库根 gate 使用。
function repositoryRootHealth(storage) {
  return storage.items.filter((entry) => /^repository\.[^.]+\.root$/u.test(entry.key));
}

// 接受健康 local layout，或仅剩已被 reconcile owner 证明 current 的宿主委托项。
function localLayoutVerificationCurrent(local, reconcile) {
  if (local.overall === "healthy") return true;
  return local.overall === "partial-owner-validation"
    && reconcileOwnerCurrent(
      reconcile,
      "host-settings-assets",
      "host-settings-assets-owner",
    )
    && local.blockers.length > 0
    && local.blockers.every((entry) => (
      entry.classification === "owner-validator-pending"
      && entry.owner === "host-settings-assets-owner"
    ));
}

// 生成配置、各 owner authority、projection、drift 与 storage 共 15 个独立 gate。
function buildVerification(config, domains, storage) {
  const gates = [];
  gates.push(gate(
    "config-authority",
    "config-service",
    config.status === "valid" ? "pass" : "fail",
    config.status === "valid" ? "current" : `config-${config.status}`,
    [{ ref: CONFIG_REF, digest: config.status === "valid" ? config.snapshot.configDigest : config.sourceDigest }],
  ));
  if (config.status === "valid") {
    gates.push(domainGate(
      domains.local,
      "local-layout",
      "layout-manager",
      (value) => localLayoutVerificationCurrent(value, domains.reconcile),
      "local-layout-not-healthy",
      [{ ref: ".wakeflow-local", digest: domains.local.value?.inspectionDigest ?? null }],
    ));
    gates.push(domainGate(
      domains.active,
      "active-authority",
      "demand-authority-service",
      (value) => value.axes.sourceHealth === "complete" && value.axes.storageHealth === "healthy",
      "active-authority-not-current",
      [{ ref: ".wakeflow-active/current", digest: domains.active.value?.source?.authorityDigest ?? null }],
    ));
    gates.push(domainGate(
      domains.ledger,
      "ledger-authority",
      "ledger-service",
      (value) => value.programId === config.snapshot.model.program.programId,
      "ledger-authority-not-current",
      [{ ref: config.snapshot.model.storage.ledgerRoot, digest: domains.ledger.value?.sourceDigest ?? null }],
    ));
    gates.push(domainGate(
      domains.transport,
      "transport-authority",
      "delivery-runtime",
      (value) => value.every((entry) => entry.issueCodes.length === 0),
      "transport-authority-not-current",
      [{ ref: ".wakeflow-local/runtime/shared/transport/demands", digest: null }],
    ));
    gates.push(domainGate(
      domains.leases,
      "coordination-leases",
      "lease-manager",
      (value) => new Set(["empty", "current"]).has(value.status),
      "coordination-lease-layout-not-current",
      [{
        ref: ".wakeflow-local/runtime/shared/coordination/window-leases",
        digest: domains.leases.value?.inventoryDigest ?? null,
      }],
    ));
    gates.push(domains.pods.status === "not-applicable"
      ? gate("pod-evidence", "core-pod-service", "pass", "not-applicable", [])
      : domainGate(
          domains.pods,
          "pod-evidence",
          "core-pod-service",
          (value) => value.status !== "degraded"
            && value.issueCodes.length === 0
            && value.demandIssues.length === 0,
          "pod-evidence-not-current",
          [{
            ref: domains.pods.value?.inventoryDigest ? "pod-evidence" : null,
            digest: domains.pods.value?.inventoryDigest ?? null,
          }],
        ));
    gates.push(domainGate(
      domains.active,
      "active-projection",
      "active-projector",
      (value) => value.axes.projectionStatus === "current",
      "active-projection-not-current",
      [{ ref: ".wakeflow-active", digest: domains.active.value?.source?.fingerprint ?? null }],
    ));
    gates.push(domainGate(
      domains.binding,
      "window-identity",
      "window-registration-service",
      (value) => new Set(["empty", "current"]).has(value.status),
      "window-identity-layout-not-current",
      [{ ref: domains.binding.value?.identityRootRef ?? null, digest: domains.binding.value?.inventoryDigest ?? null }],
    ));
    gates.push(domainGate(
      domains.windowRuntime,
      "window-runtime-projection",
      "runtime-projection-builder",
      (value) => value.projectionStatus === "current",
      "window-runtime-projection-not-current",
      [{ ref: domains.windowRuntime.value?.projectionRootRef ?? null, digest: domains.windowRuntime.value?.inventoryDigest ?? null }],
    ));
    gates.push(domainGate(
      domains.maintenance,
      "maintenance-gate",
      "mutation-gate-manager",
      (value) => value.state === "idle",
      "maintenance-not-idle",
      [{ ref: ".wakeflow-local/runtime/maintenance", digest: null }],
    ));
    gates.push(domainGate(
      domains.reconcile,
      "owner-contract",
      "maintenance-action-coordinator",
      (value) => value.status === "ready" && value.aggregatePlan !== null && value.blockers.length === 0,
      "owner-contract-blocked",
      [{ ref: CONFIG_REF, digest: domains.reconcile.value?.aggregatePlanDigest ?? null }],
    ));
    gates.push(domainGate(
      domains.reconcile,
      "managed-drift",
      "maintenance-action-coordinator",
      (value) => value.aggregatePlan !== null && value.aggregatePlan.payload.steps.length === 0,
      "managed-drift-present",
      [{ ref: CONFIG_REF, digest: domains.reconcile.value?.aggregatePlanDigest ?? null }],
    ));
    const repositoryRoots = repositoryRootHealth(storage);
    gates.push(gate(
      "repository-roots",
      "repository-owner",
      repositoryRoots.every((entry) => new Set(["current", "empty-ready"]).has(entry.health))
        ? "pass"
        : "fail",
      repositoryRoots.every((entry) => new Set(["current", "empty-ready"]).has(entry.health))
        ? "current"
        : "repository-root-unavailable",
      repositoryRoots.map((entry) => ({ ref: entry.logicalPath, digest: null })),
    ));
    gates.push(gate(
      "storage-inventory",
      "layout-manager",
      storage.overall === "healthy" ? "pass" : "fail",
      storage.overall === "healthy" ? "current" : `storage-${storage.overall}`,
      [{ ref: ".wakeflow-local", digest: domains.local.value?.inspectionDigest ?? null }],
    ));
  }
  gates.sort((left, right) => lexicalCompare(left.name, right.name));
  return {
    kind: "WakeflowWorkspaceV3Verification",
    schemaVersion: 1,
    configDigest: config.status === "valid" ? config.snapshot.configDigest : null,
    ok: gates.length > 0 && gates.every((entry) => entry.status === "pass"),
    gates,
    summary: {
      pass: gates.filter((entry) => entry.status === "pass").length,
      fail: gates.filter((entry) => entry.status === "fail").length,
      unavailable: gates.filter((entry) => entry.status === "unavailable").length,
    },
    repairsApplied: false,
  };
}

// ==================== 七、Status 领域摘要与下一动作（能力 3、4） ====================

// 将一组 local event classification 汇总为 empty/healthy/degraded/blocked。
function classificationHealth(values) {
  if (values.length === 0) return "empty";
  const healths = values.map((entry) => localHealth(entry.classification));
  if (healths.some((entry) => new Set(["schema-invalid", "orphan", "unknown"]).has(entry))) return "blocked";
  if (healths.some((entry) => new Set(["digest-mismatch", "blocked-reference"]).has(entry))) return "degraded";
  return "healthy";
}

// 从 local-layout inventory 中提取指定事件前缀的健康度与在途 operation 数量。
function localDomainSummary(local, prefixes) {
  if (local.status !== "available") {
    return {
      health: "unavailable",
      eventCount: 0,
      activeOperationCount: 0,
      issueCode: local.issueCode,
    };
  }
  const events = local.value.items.events.filter((entry) => (
    entry.classification !== "deferred"
    && (typeof entry.key === "string" ? [entry.key] : entry.matchedKeys ?? [])
      .some((key) => prefixes.some((prefix) => key.startsWith(prefix)))
  ));
  return {
    health: classificationHealth(events),
    eventCount: events.length,
    activeOperationCount: events.filter((entry) => (
      entry.classification === "owner-validated-active-operation"
    )).length,
    issueCode: null,
  };
}

// 将每个 demand 的 transport frontier 压缩成有界 Status 领域摘要。
function transportDomainSummary(domain) {
  if (domain.status !== "available") {
    return {
      health: "unavailable",
      items: [],
      collection: { count: 0, truncated: false, cursor: null },
      issueCode: domain.issueCode,
    };
  }
  const collection = bounded(domain.value, MAX_STATUS_ITEMS);
  return {
    health: domain.value.every((entry) => entry.issueCodes.length === 0)
      ? "healthy"
      : "degraded",
    items: collection.items,
    collection: {
      count: collection.count,
      truncated: collection.truncated,
      cursor: collection.cursor,
    },
    issueCode: null,
  };
}

// 将 lease owner inventory 压缩成有界摘要，并保持 owner 原始 status/digest。
function leaseDomainSummary(domain) {
  if (domain.status !== "available") {
    return {
      health: "unavailable",
      status: "unavailable",
      items: [],
      collection: { count: 0, truncated: false, cursor: null },
      inventoryDigest: null,
      issueCode: domain.issueCode,
    };
  }
  const collection = bounded(domain.value.items, MAX_STATUS_ITEMS);
  return {
    health: new Set(["empty", "current"]).has(domain.value.status) ? "healthy" : "degraded",
    status: domain.value.status,
    items: collection.items,
    collection: {
      count: collection.count,
      truncated: collection.truncated,
      cursor: collection.cursor,
    },
    inventoryDigest: domain.value.inventoryDigest,
    issueCode: null,
  };
}

// 将 Pod inventory、close 阻塞与 demand 关联问题压缩成宿主适用感知摘要。
function podDomainSummary(domain) {
  if (domain.status === "not-applicable") {
    return {
      health: "not-applicable",
      status: "not-applicable",
      items: [],
      collection: { count: 0, truncated: false, cursor: null },
      inventoryDigest: null,
      issueCodes: [],
      demandIssues: [],
    };
  }
  if (domain.status !== "available") {
    return {
      health: "unavailable",
      status: "unavailable",
      items: [],
      collection: { count: 0, truncated: false, cursor: null },
      inventoryDigest: null,
      issueCodes: [domain.issueCode],
      demandIssues: [],
    };
  }
  const collection = bounded(domain.value.items, MAX_STATUS_ITEMS);
  const damaged = domain.value.status === "degraded"
    || domain.value.issueCodes.length > 0
    || domain.value.demandIssues.length > 0
    || domain.value.items.some((entry) => (
      entry.linkage === "structural-invalid" || entry.closeStatus === "damaged"
    ));
  return {
    health: damaged ? "degraded" : "healthy",
    status: domain.value.status,
    items: collection.items,
    collection: {
      count: collection.count,
      truncated: collection.truncated,
      cursor: collection.cursor,
    },
    inventoryDigest: domain.value.inventoryDigest,
    issueCodes: domain.value.issueCodes,
    demandIssues: domain.value.demandIssues,
  };
}

// 按配置窗口左连接 identity authority 与 runtime projection，不把 projection 当 identity。
function statusWindows(config, domains) {
  const bindingByWindow = new Map(
    domains.binding.status === "available"
      ? domains.binding.value.bindings.map((entry) => [entry.windowId, entry])
      : [],
  );
  const runtimeByWindow = new Map(
    domains.windowRuntime.status === "available"
      ? domains.windowRuntime.value.windows.map((entry) => [entry.windowId, entry])
      : [],
  );
  return [...config.snapshot.model.topology.windows]
    .sort((left, right) => lexicalCompare(left.windowId, right.windowId))
    .map((window) => {
      const binding = bindingByWindow.get(window.windowId);
      const runtime = runtimeByWindow.get(window.windowId);
      return {
        windowId: window.windowId,
        role: window.role,
        identityStatus: domains.binding.status !== "available"
          ? "unavailable"
          : binding === undefined
            ? "unregistered"
            : "registered",
        ...(binding === undefined ? {} : {
          bindingId: binding.bindingId,
          identityRef: binding.identityRef,
          identityBindingDigest: binding.identityBindingDigest,
        }),
        runtimeProjectionStatus: runtime?.status ?? "unavailable",
        runtimeProjectionDigest: runtime?.expectedDigest ?? null,
      };
    });
}

// ==================== 八、仓库 Git 只读观察（能力 6） ====================

// 通过统一进程原语执行有界 Git 查询，并禁止 Git 的可选 index 锁/刷新写入。
function gitResult(root, args) {
  try {
    const result = runSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      // `git status` may otherwise refresh and rewrite the index as an optional
      // optimization. Observability must remain byte-for-byte read-only.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: result.status === 0,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
    };
  } catch {
    return { ok: false, stdout: "" };
  }
}

// 读取一次脱敏 Git 快照：只返回仓库类型、脏记录数量、HEAD 与上下游偏差。
function readRepositoryGitSnapshot(root) {
  const inside = gitResult(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") return { status: "not-repository" };
  const top = gitResult(root, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || path.resolve(top.stdout.trim()) !== root) return { status: "nested-worktree" };
  const head = gitResult(root, ["rev-parse", "--verify", "HEAD"]);
  if (!head.ok || !/^[0-9a-f]{40,64}$/u.test(head.stdout.trim())) {
    return { status: "unborn", dirty: null, changeRecordCount: null, head: null };
  }
  const worktree = gitResult(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=normal",
    "--ignore-submodules=none",
  ]);
  if (!worktree.ok) return { status: "unavailable" };
  const changes = worktree.stdout.split("\0").filter(Boolean).length;
  const upstream = gitResult(root, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  let ahead = null;
  let behind = null;
  const upstreamStatus = upstream.ok ? "configured" : "none";
  if (upstream.ok) {
    const divergence = gitResult(root, [
      "rev-list",
      "--left-right",
      "--count",
      "HEAD...@{upstream}",
    ]);
    const match = divergence.stdout.trim().match(/^(\d+)\s+(\d+)$/u);
    if (!divergence.ok || match === null) return { status: "unavailable" };
    ahead = Number(match[1]);
    behind = Number(match[2]);
  }
  return {
    status: changes === 0 ? "clean" : "dirty",
    dirty: changes > 0,
    changeRecordCount: changes,
    head: head.stdout.trim(),
    upstreamStatus,
    ahead,
    behind,
  };
}

// 连续读取两次 Git 状态；只有完全一致才发布，否则标记 raced。
function inspectRepositoryGit(root) {
  // Git 没有跨多条命令的一次性 snapshot API。连续读取两次，只在结果完全一致时
  // 发布，避免把恰逢 checkout/commit 的混合时点误报成一个确定状态。
  const first = readRepositoryGitSnapshot(root);
  const second = readRepositoryGitSnapshot(root);
  return canonicalJson(first) === canonicalJson(second)
    ? first
    : { status: "raced" };
}

// 仅对 Storage View 已证明为真实目录的配置仓库执行 Git 观察。
function repositoryStatus(normalized, config, storage) {
  const byKey = new Map(storage.items.map((entry) => [entry.key, entry]));
  return [...config.snapshot.model.topology.repositories]
    .sort((left, right) => lexicalCompare(left.repositoryId, right.repositoryId))
    .map((repository) => {
      const item = byKey.get(`repository.${repository.repositoryId}.root`);
      // Git 读取只要求已经由 storage inspection 证明目标是一个真实目录；权限漂移
      // 仍需原样报告，但不应遮蔽该仓库可安全取得的只读 Git 事实。
      const git = item?.actual.state === "present" && item.actual.type === "directory"
        ? inspectRepositoryGit(path.resolve(normalized.realWorkspaceRoot, repository.path))
        : { status: "unavailable" };
      return {
        repositoryId: repository.repositoryId,
        rootRef: repository.path,
        health: item?.health ?? "unavailable",
        git,
      };
    });
}

// ==================== 九、统一 Status 与已签发投影（能力 1、8、9） ====================

// 以 canonical JSON 为键去重 next action，保留完整 owner/capability 路由信息。
function addAction(actions, value) {
  actions.set(canonicalJson(value), value);
}

// 从配置、各领域 frontier/blocker 与 storage 诊断生成有界建议；这里只路由，不执行。
function statusNextActions(config, domains, storage, windows, repositories = []) {
  const actions = new Map();
  if (config.status !== "valid") {
    addAction(actions, {
      owner: config.status === "migration-required" ? "generated-file-migrator" : "config-service",
      capability: config.status === "migration-required" ? "migrate-config" : "inspect-config",
      reason: `config-${config.status}`,
      sourceRefs: [{ ref: CONFIG_REF, digest: config.sourceDigest }],
    });
    return bounded([...actions.values()], MAX_NEXT_ACTIONS);
  }
  for (const window of windows) {
    if (window.identityStatus === "unregistered") addAction(actions, {
      owner: "window-registration-service",
      capability: "register-window",
      reason: "configured-window-unregistered",
      sourceRefs: [{ ref: CONFIG_REF, digest: config.snapshot.configDigest }],
      subject: { kind: "window", value: window.windowId },
    });
  }
  for (const repository of repositories) {
    const diverged = (repository.git.ahead ?? 0) > 0 || (repository.git.behind ?? 0) > 0;
    if (repository.git.status === "clean" && !diverged) continue;
    addAction(actions, {
      owner: "repository-owner",
      capability: "inspect-repository-git",
      reason: diverged ? "repository-git-divergence" : `repository-git-${repository.git.status}`,
      sourceRefs: [{ ref: repository.rootRef, digest: null }],
      subject: { kind: "repository", value: repository.repositoryId },
    });
  }
  if (domains.reconcile.status === "available") {
    for (const blocker of domains.reconcile.value.blockers) addAction(actions, {
      owner: blocker.owner,
      capability: "inspect-owner-blocker",
      reason: blocker.code,
      sourceRefs: [],
      subject: blocker.subject,
    });
    for (const action of domains.reconcile.value.aggregatePlan?.payload.filesystemActions ?? []) {
      if (action.action === "current") continue;
      addAction(actions, {
        owner: action.owner,
        capability: action.action === "blocked" ? "inspect-owner-blocker" : "reconcile-owned-resource",
        reason: action.reasonCode,
        sourceRefs: [{ ref: action.resourceRef, digest: action.source.digest ?? null }],
        subject: { kind: "resource", value: action.resourceRef },
      });
    }
  } else {
    addAction(actions, {
      owner: "maintenance-action-coordinator",
      capability: "inspect-reconcile-contract",
      reason: domains.reconcile.issueCode,
      sourceRefs: [{ ref: CONFIG_REF, digest: config.snapshot.configDigest }],
    });
  }
  if (domains.active.status === "available") {
    for (const issue of domains.active.value.issues) addAction(actions, {
      owner: "demand-authority-service",
      capability: "inspect-active-authority",
      reason: safeCode(issue.code, "active-authority-issue"),
      sourceRefs: [{ ref: issue.ref ?? ".wakeflow-active/current", digest: null }],
    });
  }
  if (domains.transport.status === "available") {
    const route = {
      "not-started": ["controller", "prepare-delivery"],
      "group-to-packet": ["delivery-runtime", "publish-dispatch-packet"],
      "packet-to-envelope": ["delivery-runtime", "prepare-delivery-envelope"],
      "envelope-to-run": ["delivery-recorder", "record-delivery-outcome"],
      "run-to-result": ["result-service", "record-target-result"],
      unknown: ["delivery-runtime", "inspect-transport-authority"],
    };
    for (const demand of domains.transport.value) {
      if (demand.frontier === "current") continue;
      const [owner, capability] = route[demand.frontier] ?? route.unknown;
      addAction(actions, {
        owner,
        capability,
        reason: `transport-${demand.frontier}`,
        sourceRefs: [{
          ref: `.wakeflow-local/runtime/shared/transport/demands/${demand.demandId}`,
          digest: demand.inventoryDigest,
        }],
        subject: { kind: "demand", value: demand.demandId },
      });
    }
  }
  if (domains.leases.status === "available") {
    for (const lease of domains.leases.value.items) addAction(actions, {
      owner: "lease-manager",
      capability: "inspect-or-release-window-lease",
      reason: "window-lease-held",
      sourceRefs: [{
        ref: ".wakeflow-local/runtime/shared/coordination/window-leases",
        digest: domains.leases.value.inventoryDigest,
      }],
      subject: { kind: "window", value: lease.windowId },
    });
  }
  if (domains.pods.status === "available") {
    for (const pod of domains.pods.value.items) {
      for (const reason of pod.blockingReasonCodes) addAction(actions, {
        owner: "core-pod-service",
        capability: "inspect-pod-lifecycle",
        reason,
        sourceRefs: [{ ref: "pod-evidence", digest: domains.pods.value.inventoryDigest }],
        subject: { kind: "pod", value: pod.podId },
      });
    }
    for (const issue of domains.pods.value.demandIssues) {
      for (const reason of issue.issueCodes) addAction(actions, {
        owner: "core-pod-service",
        capability: "inspect-pod-lifecycle",
        reason,
        sourceRefs: [{ ref: ".wakeflow-active/current", digest: domains.pods.value.inventoryDigest }],
        subject: { kind: "demand", value: issue.demandId },
      });
    }
  }
  for (const diagnostic of storage.diagnostics) addAction(actions, {
    owner: diagnostic.owner ?? "user-review",
    capability: "inspect-storage-observation",
    reason: safeCode(diagnostic.code, "storage-observation-issue"),
    sourceRefs: [{ ref: diagnostic.ref, digest: diagnostic.refDigest }],
  });
  const sorted = [...actions.values()].sort((left, right) => lexicalCompare(canonicalJson(left), canonicalJson(right)));
  return bounded(sorted, MAX_NEXT_ACTIONS);
}

// 判断 local-layout 是否只剩 owner 已验证的合法在途 operation。
function localHasOnlyValidatedActiveOperations(local) {
  return local.status === "available"
    && local.value.blockers.length > 0
    && local.value.blockers.every((entry) => (
      entry.classification === "owner-validated-active-operation"
    ));
}

// 综合 authority、维护态、storage、verification 与 owner domain，生成唯一总体状态。
function buildStatus(normalized, config, domains, storage, verification) {
  if (config.status !== "valid") {
    const actionCollection = statusNextActions(config, domains, storage, []);
    return {
      kind: "WakeflowStatusV3",
      schemaVersion: 1,
      overall: config.status === "invalid" ? "degraded" : config.status,
      config: {
        status: config.status,
        configRef: CONFIG_REF,
        configDigest: null,
        sourceDigest: config.sourceDigest,
      },
      domains: {},
      nextActions: actionCollection.items,
      nextActionCollection: {
        count: actionCollection.count,
        truncated: actionCollection.truncated,
        cursor: actionCollection.cursor,
      },
      writesPerformed: false,
    };
  }
  const active = domains.active.status === "available" ? domains.active.value : null;
  const windows = statusWindows(config, domains);
  const repositories = repositoryStatus(normalized, config, storage);
  const windowCollection = bounded(windows, MAX_STATUS_ITEMS);
  const repositoryCollection = bounded(repositories, MAX_STATUS_ITEMS);
  const demandCollection = bounded(active?.demands ?? [], MAX_STATUS_ITEMS);
  const transport = transportDomainSummary(domains.transport);
  const leases = leaseDomainSummary(domains.leases);
  const pods = podDomainSummary(domains.pods);
  const hostOperations = localDomainSummary(domains.local, ["event.keep-live.", "event.host."]);
  const maintenance = domains.maintenance.status === "available"
    ? {
        health: domains.maintenance.value.state === "idle" ? "healthy" : "maintenance",
        state: domains.maintenance.value.state,
        lockPresent: domains.maintenance.value.lock !== null,
        operationCount: domains.maintenance.value.operations.length,
      }
    : { health: "unavailable", state: "unavailable", lockPresent: false, operationCount: 0 };
  const reconcile = domains.reconcile.status === "available"
    ? {
        health: domains.reconcile.value.status === "ready" ? "healthy" : "blocked",
        status: domains.reconcile.value.status,
        blockerCount: domains.reconcile.value.blockers.length,
        pendingStepCount: domains.reconcile.value.aggregatePlan?.payload.steps.length ?? 0,
        aggregatePlanDigest: domains.reconcile.value.aggregatePlanDigest,
      }
    : {
        health: "unavailable",
        status: "unavailable",
        blockerCount: 1,
        pendingStepCount: 0,
        aggregatePlanDigest: null,
      };
  const activeOrientation = active?.axes.orientation ?? "degraded";
  const maintenanceActive = domains.maintenance.status === "available"
    && !new Set(["idle", "absent", "bootstrap-prefix"]).has(domains.maintenance.value.state);
  const activeOperationOnly = localHasOnlyValidatedActiveOperations(domains.local);
  const reconcileBlockedOnlyByActiveOperation = activeOperationOnly
    && domains.reconcile.status === "available"
    && domains.reconcile.value.status === "blocked"
    && domains.reconcile.value.blockers.length === 1
    && domains.reconcile.value.blockers[0].code === "reconcile-local-layout-blocked";
  const ownerDomainDegraded = transport.health !== "healthy"
    || leases.health !== "healthy"
    || !new Set(["healthy", "not-applicable"]).has(pods.health);
  const hardBlocked = storage.overall === "blocked"
    || (domains.reconcile.status === "available"
      && domains.reconcile.value.status === "blocked"
      && !reconcileBlockedOnlyByActiveOperation)
    || activeOrientation === "blocked";
  const overall = maintenanceActive
    ? "maintenance"
    : hardBlocked
      ? "blocked"
      : !verification.ok || ownerDomainDegraded || activeOrientation === "degraded"
        ? "degraded"
        : activeOrientation === "active"
          ? "active"
          : "idle";
  const actionCollection = statusNextActions(config, domains, storage, windows, repositories);
  return {
    kind: "WakeflowStatusV3",
    schemaVersion: 1,
    overall,
    config: {
      status: "valid",
      configRef: CONFIG_REF,
      configDigest: config.snapshot.configDigest,
      programId: config.snapshot.model.program.programId,
    },
    domains: {
      repositories: {
        health: repositories.every((entry) => new Set(["current", "empty-ready"]).has(entry.health))
          ? "healthy"
          : "degraded",
        items: repositoryCollection.items,
        collection: {
          count: repositoryCollection.count,
          truncated: repositoryCollection.truncated,
          cursor: repositoryCollection.cursor,
        },
      },
      activeDemands: active === null
        ? {
            health: "unavailable",
            orientation: "degraded",
            items: [],
            collection: { count: 0, truncated: false, cursor: null },
          }
        : {
            health: active.axes.sourceHealth === "complete" && active.axes.storageHealth === "healthy"
              ? "healthy"
              : "degraded",
            orientation: active.axes.orientation,
            items: demandCollection.items,
            collection: {
              count: demandCollection.count,
              truncated: demandCollection.truncated,
              cursor: demandCollection.cursor,
            },
          },
      windowIdentity: {
        health: domains.binding.status === "available" ? "healthy" : "unavailable",
        hostId: config.snapshot === null ? null : domains.descriptor.host.hostId,
        windows: windowCollection.items,
        collection: {
          count: windowCollection.count,
          truncated: windowCollection.truncated,
          cursor: windowCollection.cursor,
        },
      },
      windowRuntime: domains.windowRuntime.status === "available"
        ? {
            health: domains.windowRuntime.value.projectionStatus === "current" ? "healthy" : "degraded",
            projectionStatus: domains.windowRuntime.value.projectionStatus,
            inventoryDigest: domains.windowRuntime.value.inventoryDigest,
          }
        : { health: "unavailable", projectionStatus: "unavailable", inventoryDigest: null },
      transport,
      leases,
      pods,
      hostOperations,
      projections: {
        health: active?.axes.projectionStatus === "current"
          && domains.windowRuntime.status === "available"
          && domains.windowRuntime.value.projectionStatus === "current"
          ? "healthy"
          : "degraded",
        active: active?.axes.projectionStatus ?? "unavailable",
        windowRuntime: domains.windowRuntime.status === "available"
          ? domains.windowRuntime.value.projectionStatus
          : "unavailable",
      },
      maintenance,
      ownershipContract: reconcile,
      verification: {
        health: verification.ok ? "healthy" : "degraded",
        pass: verification.summary.pass,
        fail: verification.summary.fail,
        unavailable: verification.summary.unavailable,
      },
    },
    nextActions: actionCollection.items,
    nextActionCollection: {
      count: actionCollection.count,
      truncated: actionCollection.truncated,
      cursor: actionCollection.cursor,
    },
    writesPerformed: false,
  };
}

// 给单份 projection 附加同一次 observation 的摘要，并再次 canonicalize/freeze。
function attachObservationDigest(projection, observationDigest) {
  return deepFreeze(canonicalSnapshot({ ...projection, observationDigest }, projection.kind));
}

// 对完整投影做最终私密路径扫描，阻止 lexical/real workspace root 外泄。
function assertPrivateProjection(value, normalized) {
  const encoded = canonicalJson(value);
  if (
    encoded.includes(normalized.workspaceRoot)
    || encoded.includes(normalized.realWorkspaceRoot)
  ) {
    fail("wakeflow-observability-private-data", "observability projection leaked its workspace root");
  }
}

// 只接受本进程 WeakMap 中登记的原始 observation 对象，拒绝克隆或伪造凭据。
function issuedObservation(value) {
  const input = exactDataObject(value, ["observation"], "observability projection input");
  if (!plainObject(input.observation) || !OBSERVATIONS.has(input.observation)) {
    fail(
      "wakeflow-observability-authority",
      "observation must be the exact immutable result issued by inspectWakeflowObservabilityV3",
    );
  }
  return OBSERVATIONS.get(input.observation);
}

/**
 * 执行唯一一次完整只读观测。
 *
 * 顺序固定为：输入收敛 → 配置快照 → 领域采集 → 配置一致性复查 → 四投影生成
 * → 隐私检查 → 统一摘要签发。返回值只是不可伪造的 observation 凭据，不直接暴露
 * 内部 owner 结果，也不会写入、修复或删除任何 workspace 内容。
 */
export function inspectWakeflowObservabilityV3(value = {}) {
  const normalized = normalizeInput(value);
  const config = inspectConfigAuthority(normalized);
  const domains = collectDomains(normalized, config);
  assertObservationConfigCoherence(normalized, config, domains);
  const configView = buildConfigView(normalized, config);
  const storageView = buildStorageView(normalized, config, domains);
  const verification = buildVerification(config, domains, storageView);
  const status = buildStatus(normalized, config, domains, storageView, verification);
  const unsignedProjections = canonicalSnapshot({
    configView,
    storageView,
    status,
    verification,
  }, "Wakeflow observability projections");
  assertPrivateProjection(unsignedProjections, normalized);
  const observationDigest = canonicalJsonDigest(unsignedProjections);
  if (!DIGEST_RE.test(observationDigest)) {
    fail("wakeflow-observability-digest", "observation digest is invalid");
  }
  const projections = deepFreeze({
    configView: attachObservationDigest(configView, observationDigest),
    storageView: attachObservationDigest(storageView, observationDigest),
    status: attachObservationDigest(status, observationDigest),
    verification: attachObservationDigest(verification, observationDigest),
  });
  assertPrivateProjection(projections, normalized);
  const observation = deepFreeze({
    kind: WAKEFLOW_OBSERVATION_V3_KIND,
    schemaVersion: WAKEFLOW_OBSERVATION_V3_SCHEMA_VERSION,
    observationDigest,
  });
  OBSERVATIONS.set(observation, projections);
  return observation;
}

/**
 * 读取已签发 observation 对应的 Config View；不重新访问 workspace。
 */
export function projectWakeflowConfigView(value = {}) {
  return issuedObservation(value).configView;
}

/**
 * 读取已签发 observation 对应的 Storage View；不赋予 repair/delete 权限。
 */
export function projectWakeflowStorageView(value = {}) {
  return issuedObservation(value).storageView;
}

/**
 * 读取已签发 observation 对应的统一 Status；不重新计算或推进任何流程。
 */
export function projectWakeflowStatus(value = {}) {
  return issuedObservation(value).status;
}

/**
 * 读取已签发 observation 对应的 15-gate Verification；始终不应用修复。
 */
export function verifyWakeflowWorkspaceV3(value = {}) {
  return issuedObservation(value).verification;
}
