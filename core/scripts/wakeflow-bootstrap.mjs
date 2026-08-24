/**
 * Wakeflow 显式迁移的唯一 backend composition。
 *
 * 阅读导航：
 * - 入口合同：解析 zero-argv、bounded UTF-8 stdin 与 preview/apply/recover 请求。
 * - artifact 准入：绑定固定 launcher、完整 artifact identity 与宿主 adapter seam。
 * - 隔离准入：禁止 workspace 或任一配置目标根与已加载 artifact 发生物理职责重叠。
 * - 迁移编排：preview 只组合计划；apply/recover 委托 production migration owner graph。
 * - 激活观察：只归约宿主 observation 与 workspace cutover，不执行插件激活。
 *
 * 本文件是 facade/composition，不拥有 legacy 分类、迁移步骤、workspace mutation、
 * host effect 或 activation policy；这些职责分别留在对应的 scripts/lib owner 中。
 */

import {
  lstatSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  inspectWakeflowArtifactTree,
} from "./lib/wakeflow-artifact-tree-identity.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "./lib/wakeflow-canonical-json.mjs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import {
  createWakeflowWorkspaceActivationSubjectDigest,
  createWakeflowWorkspaceCutoverObservation,
  evaluateWakeflowHostActivationGate,
  hostActivationReportDigest,
} from "./lib/wakeflow-host-activation-gate.mjs";
import {
  validateHostActivationScopeObservation,
} from "./lib/wakeflow-host-activation-scope.mjs";
import {
  validateWakeflowMigrationApplyPlan,
} from "./lib/wakeflow-migration-apply.mjs";
import {
  loadWakeflowHostSettingsAssetsAdapter,
} from "./lib/wakeflow-host-settings-assets-owner.mjs";
import {
  inspectWakeflowMigrationInventory,
} from "./lib/wakeflow-migration-inventory.mjs";
import {
  planWakeflowMigrationPreview,
} from "./lib/wakeflow-migration-plan.mjs";
import {
  planWakeflowProductionMigration,
  recoverWakeflowProductionMigration,
  restoreWakeflowProductionMigrationComposition,
  runWakeflowProductionMigrationApply,
} from "./lib/wakeflow-migration-production.mjs";
import {
  loadWakeflowAssetBundle,
} from "./lib/wakeflow-template-renderer.mjs";

export const WAKEFLOW_BOOTSTRAP_SCHEMA_VERSION = 1;
export const WAKEFLOW_BOOTSTRAP_STDIN_LIMIT = 8 * 1024 * 1024;
export const WAKEFLOW_BOOTSTRAP_ACTION = "explicit-migration";
export const WAKEFLOW_BOOTSTRAP_MODES = Object.freeze(["preview", "apply", "recover"]);

const MODE_SET = new Set(WAKEFLOW_BOOTSTRAP_MODES);
const BOOTSTRAP_LAUNCHER_ROOT_ENV = "WAKEFLOW_BOOTSTRAP_LAUNCHER_ROOT";
const BOOTSTRAP_STDIN_CHUNK_LIMIT = 4096;
const ACTIVATION_SCOPE_ADAPTER_EXPORT = "wakeflowHostActivationScopeAdapter";
const OPERATION_ID_RE = /^workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

// ===== 错误、不可变数据与严格字段合同 =====

export class WakeflowBootstrapError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowBootstrapError";
    this.code = code;
  }
}

function fail(code, message, cause = undefined) {
  throw new WakeflowBootstrapError(code, message, { cause });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!plainObject(value)) fail("wakeflow-bootstrap-invalid-contract", `${label} must be one plain object`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) fail("wakeflow-bootstrap-invalid-contract", `${label} has an invalid field set`);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-bootstrap-invalid-contract", `${label}.${key} must be an enumerable data field`);
    }
  }
  return value;
}

function normalizeRealDirectory(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\0")
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail("wakeflow-bootstrap-invalid-root", `${label} must be one normalized absolute directory`);
  let stat;
  let real;
  try {
    stat = lstatSync(value);
    real = realpathSync(value);
  } catch (cause) {
    fail("wakeflow-bootstrap-invalid-root", `${label} is unavailable`, cause);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || real !== value) {
    fail("wakeflow-bootstrap-invalid-root", `${label} must be one exact real directory`);
  }
  return value;
}

function normalizeArtifactContext(value) {
  exactKeys(value, ["legacyOwnerRoot"], "artifactContext");
  return {
    legacyOwnerRoot: value.legacyOwnerRoot === null
      ? null
      : normalizeRealDirectory(value.legacyOwnerRoot, "legacyOwnerRoot"),
  };
}

function normalizePreviewRequest(value) {
  exactKeys(value, ["desiredModel", "identityMappings", "rootMappings"], "preview request");
  if (!plainObject(value.desiredModel) || !Array.isArray(value.identityMappings) || !Array.isArray(value.rootMappings)) {
    fail("wakeflow-bootstrap-invalid-contract", "preview request has an invalid planning shape");
  }
  return value;
}

function normalizeOperationId(value) {
  if (typeof value !== "string" || !OPERATION_ID_RE.test(value)) {
    fail("wakeflow-bootstrap-invalid-operation", "operationId must be one canonical workspace mutation ID");
  }
  return value;
}

function canonicalClone(value) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail("wakeflow-bootstrap-invalid-contract", "bootstrap request must contain only canonical JSON data", cause);
  }
}

// ===== 进程入口与请求 codec =====

/**
 * 固定 backend 的 argv 必须为空；完整迁移事实只能从 bounded stdin 进入。
 */
export function parseWakeflowBootstrapArgv(argv = []) {
  if (
    !Array.isArray(argv)
    || argv.length !== 0
    || Reflect.ownKeys(argv).some((key) => key !== "length")
  ) {
    fail(
      "wakeflow-bootstrap-invalid-argv",
      "Wakeflow bootstrap accepts zero arguments; provide one JSON request on stdin",
    );
  }
  return Object.freeze({ requestStdin: true });
}

/**
 * 将一份 JSON 请求收敛为 closed canonical data，并在任何 artifact 或 workspace 读取前
 * 验证 mode 对应的字段集合。领域计划的深层语义仍由 migration owner 校验。
 */
export function parseWakeflowBootstrapRequest(raw) {
  if (typeof raw !== "string") {
    fail("wakeflow-bootstrap-invalid-stdin", "bootstrap stdin must be one UTF-8 JSON string");
  }
  if (Buffer.byteLength(raw, "utf8") > WAKEFLOW_BOOTSTRAP_STDIN_LIMIT) {
    fail("wakeflow-bootstrap-stdin-too-large", "bootstrap stdin exceeds its bounded size");
  }
  if (!raw.trim()) fail("wakeflow-bootstrap-invalid-stdin", "bootstrap stdin is empty");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    fail("wakeflow-bootstrap-invalid-json", "bootstrap stdin must contain exactly one JSON request", cause);
  }
  if (!plainObject(parsed)) {
    fail("wakeflow-bootstrap-invalid-stdin", "bootstrap stdin request must be one JSON object");
  }
  const mode = parsed.mode;
  if (!MODE_SET.has(mode)) fail("wakeflow-bootstrap-invalid-mode", "bootstrap mode is unsupported");
  const fields = mode === "preview"
    ? ["schemaVersion", "root", "action", "mode", "artifactContext", "request"]
    : mode === "apply"
      ? ["schemaVersion", "root", "action", "mode", "artifactContext", "confirmedPlan", "planDigest"]
      : ["schemaVersion", "root", "action", "mode", "artifactContext", "confirmedPlan", "planDigest", "operationId"];
  exactKeys(parsed, fields, "bootstrap request");
  if (
    parsed.schemaVersion !== WAKEFLOW_BOOTSTRAP_SCHEMA_VERSION
    || parsed.action !== WAKEFLOW_BOOTSTRAP_ACTION
  ) fail("wakeflow-bootstrap-invalid-contract", "bootstrap schema version or action is invalid");
  parsed.root = normalizeRealDirectory(parsed.root, "workspace root");
  parsed.artifactContext = normalizeArtifactContext(parsed.artifactContext);
  if (mode === "preview") {
    parsed.request = normalizePreviewRequest(parsed.request);
  } else {
    if (typeof parsed.planDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(parsed.planDigest)) {
      fail("wakeflow-bootstrap-invalid-plan", "planDigest must be one canonical SHA-256 digest");
    }
    if (mode === "recover") parsed.operationId = normalizeOperationId(parsed.operationId);
  }
  return deepFreeze(canonicalClone(parsed));
}

// 按原始字节和分片数双重计量后再 fatal decode，禁止替换字符或零字节分片耗尽资源。
async function readBoundedUtf8(stream) {
  if (stream === null || typeof stream !== "object" || stream[Symbol.asyncIterator] === undefined) {
    fail("wakeflow-bootstrap-invalid-stdin", "bootstrap stdin must be one async-readable stream");
  }
  const chunks = [];
  let total = 0;
  let chunkCount = 0;
  for await (const chunk of stream) {
    chunkCount += 1;
    if (chunkCount > BOOTSTRAP_STDIN_CHUNK_LIMIT) {
      fail(
        "wakeflow-bootstrap-stdin-too-fragmented",
        "bootstrap stdin exceeds its bounded chunk count",
      );
    }
    let bytes;
    if (Buffer.isBuffer(chunk)) {
      bytes = chunk;
    } else if (typeof chunk === "string") {
      bytes = Buffer.from(chunk, "utf8");
    } else if (chunk instanceof Uint8Array) {
      bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    } else {
      fail(
        "wakeflow-bootstrap-invalid-stdin",
        "bootstrap stdin chunks must be UTF-8 strings or byte arrays",
      );
    }
    total += bytes.length;
    if (total > WAKEFLOW_BOOTSTRAP_STDIN_LIMIT) {
      fail("wakeflow-bootstrap-stdin-too-large", "bootstrap stdin exceeds its bounded size");
    }
    chunks.push(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch (cause) {
    fail("wakeflow-bootstrap-invalid-stdin", "bootstrap stdin is not valid UTF-8", cause);
  }
}

// ===== Exact artifact、宿主 adapter 与激活 observation =====

// 一次同时冻结当前 bootstrap artifact 与用户显式提供的 legacy owner artifact identity。
function inspectArtifactContext(artifactRoot, legacyOwnerRoot) {
  let bootstrapArtifact;
  let legacyOwnerArtifact;
  try {
    bootstrapArtifact = inspectWakeflowArtifactTree({ artifactRoot });
    legacyOwnerArtifact = legacyOwnerRoot === null
      ? null
      : legacyOwnerRoot === artifactRoot
        ? bootstrapArtifact
        : inspectWakeflowArtifactTree({ artifactRoot: legacyOwnerRoot });
  } catch (cause) {
    fail("wakeflow-bootstrap-artifact-invalid", "an exact loaded artifact cannot be verified", cause);
  }
  return deepFreeze({ bootstrapArtifact, legacyOwnerArtifact });
}

function canonicalArtifactRelativePath(value, code, label) {
  if (
    typeof value !== "string"
    || !value
    || value.includes("\\")
    || path.posix.isAbsolute(value)
    || path.posix.normalize(value) !== value
    || value === "."
    || value === ".."
    || value.startsWith("../")
  ) fail(code, `${label} path is not one canonical artifact-relative ref`);
  return value;
}

/**
 * 只从 host profile 指定的 artifact-local 文件装载宿主模块。lstat/realpath 与
 * containment 同时成立后才 import，避免 symlink 或 profile 路径逃逸改变 owner。
 */
async function loadExactHostModule({ artifactRoot, relativePath, code, label }) {
  const relative = canonicalArtifactRelativePath(relativePath, code, label);
  const candidate = path.resolve(artifactRoot, ...relative.split("/"));
  const containment = path.relative(artifactRoot, candidate);
  if (!containment || containment.startsWith("..") || path.isAbsolute(containment)) {
    fail(code, `${label} escapes the exact artifact`);
  }
  let stat;
  let real;
  try {
    stat = lstatSync(candidate);
    real = realpathSync(candidate);
  } catch (cause) {
    fail(code, `${label} is unavailable`, cause);
  }
  if (stat.isSymbolicLink() || !stat.isFile() || real !== candidate) {
    fail(code, `${label} must be one exact regular artifact file`);
  }
  try {
    return await import(pathToFileURL(real).href);
  } catch (cause) {
    fail(code, `${label} cannot load`, cause);
  }
}

function normalizeActivationScopeAdapter(value) {
  const code = "wakeflow-bootstrap-activation-owner-unavailable";
  try {
    exactKeys(value, ["hostId", "pluginId", "inspect"], "activation scope host adapter");
  } catch (cause) {
    fail(code, "the loaded activation scope owner has an invalid adapter", cause);
  }
  if (
    value.hostId !== hostProfile.hostId
    || value.pluginId !== "wakeflow@gxfn"
    || typeof value.inspect !== "function"
  ) fail(code, "the loaded activation scope owner has the wrong contract");
  return Object.freeze({
    hostId: value.hostId,
    pluginId: value.pluginId,
    inspect: value.inspect,
  });
}

async function loadCurrentActivationScopeOwner(artifactRoot) {
  const configured = hostProfile?.artifact?.activationScopeHostFile;
  if (typeof configured !== "string") {
    fail(
      "wakeflow-bootstrap-activation-owner-unavailable",
      "the exact artifact does not declare its one activation scope owner",
    );
  }
  const owner = await loadExactHostModule({
    artifactRoot,
    relativePath: configured,
    code: "wakeflow-bootstrap-activation-owner-unavailable",
    label: "the exact artifact activation scope owner",
  });
  return normalizeActivationScopeAdapter(owner[ACTIVATION_SCOPE_ADAPTER_EXPORT]);
}

async function inspectCurrentActivationScope(owner, workspaceSubjectDigest) {
  let observation;
  try {
    observation = await owner.inspect({ workspaceSubjectDigest });
  } catch (cause) {
    fail(
      "wakeflow-bootstrap-activation-observation-failed",
      "the exact host activation scope could not be observed",
      cause,
    );
  }
  let normalized;
  try {
    normalized = validateHostActivationScopeObservation(observation);
  } catch (cause) {
    fail(
      "wakeflow-bootstrap-activation-observation-invalid",
      "the exact host activation scope returned an invalid observation",
      cause,
    );
  }
  if (
    normalized.hostId !== owner.hostId
    || normalized.pluginId !== owner.pluginId
    || normalized.workspaceSubjectDigest !== workspaceSubjectDigest
  ) {
    fail(
      "wakeflow-bootstrap-activation-observation-invalid",
      "the exact host activation scope observation has the wrong identity",
    );
  }
  return normalized;
}

function activationResult({
  request,
  scopeObservation,
  status,
  evidenceDigest,
}) {
  const workspaceSubjectDigest = createWakeflowWorkspaceActivationSubjectDigest({
    workspaceRoot: request.root,
  });
  const workspaceCutover = createWakeflowWorkspaceCutoverObservation({
    workspaceSubjectDigest,
    status,
    evidenceDigest,
  });
  const activationReport = evaluateWakeflowHostActivationGate({
    scopeObservation,
    currentCutover: workspaceCutover,
    manualCoverage: null,
  });
  return Object.freeze({
    workspaceCutover,
    activationReport,
    activationReportDigest: hostActivationReportDigest(activationReport),
  });
}

function publicArtifactDigests(artifacts) {
  return Object.freeze({
    bootstrapArtifactDigest: artifacts.bootstrapArtifact.artifactDigest,
    legacyOwnerArtifactDigest: artifacts.legacyOwnerArtifact?.artifactDigest ?? null,
  });
}

// ===== Loaded artifact 与迁移目标的根隔离 =====

function rootsOverlap(left, right) {
  const relation = path.relative(left, right);
  if (relation === "") return true;
  if (
    relation !== ".."
    && !relation.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relation)
  ) return true;
  const inverse = path.relative(right, left);
  return inverse === "" || (
    inverse !== ".."
    && !inverse.startsWith(`..${path.sep}`)
    && !path.isAbsolute(inverse)
  );
}

function existingRealDirectory(value) {
  try {
    const stat = lstatSync(value);
    if (!stat.isSymbolicLink() && stat.isDirectory()) return realpathSync(value);
  } catch {
    // 缺失或非法 placement 仍由 layout/fs owner 给出自己的精确错误；这里只补 artifact 隔离。
  }
  return null;
}

function protectedArtifactRoots(artifactRoot, legacyOwnerRoot) {
  return [...new Set([artifactRoot, legacyOwnerRoot].filter((entry) => entry !== null))];
}

function assertRootsOutsideArtifacts(targetRoots, artifactRoots) {
  for (const targetRoot of targetRoots) {
    const targetCandidates = [targetRoot];
    const physical = existingRealDirectory(targetRoot);
    if (physical !== null && physical !== targetRoot) targetCandidates.push(physical);
    if (targetCandidates.some((target) => artifactRoots.some((artifact) => rootsOverlap(target, artifact)))) {
      fail(
        "wakeflow-bootstrap-root-overlap",
        "migration workspace and target roots must remain outside every loaded artifact",
      );
    }
  }
}

function configuredMigrationTargetRoots(workspaceRoot, desiredModel) {
  const resolve = (portable) => path.resolve(workspaceRoot, ...portable.split("/"));
  return [
    workspaceRoot,
    resolve(desiredModel.storage.ledgerRoot),
    ...desiredModel.topology.repositories.map((entry) => resolve(entry.path)),
    ...desiredModel.topology.supportSurfaces.map((entry) => resolve(entry.path)),
  ];
}

/**
 * 保护当前执行代码及其 legacy owner 证据不被迁移 participant 当作 program、ledger、
 * repository 或 support surface。该检查只增加禁止写入的外边界，不替代 layout overlap
 * 与各 owner 的 write/CAS admission。
 */
function assertMigrationArtifactIsolation({
  workspaceRoot,
  desiredModel = null,
  artifactRoot,
  legacyOwnerRoot,
}) {
  const targets = desiredModel === null
    ? [workspaceRoot]
    : configuredMigrationTargetRoots(workspaceRoot, desiredModel);
  assertRootsOutsideArtifacts(
    targets,
    protectedArtifactRoots(artifactRoot, legacyOwnerRoot),
  );
}

function assertCurrentArtifactsAgainstConfirmedPlan(artifacts, confirmedPlan) {
  const expected = confirmedPlan.payload.artifactDigests;
  const actual = publicArtifactDigests(artifacts);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("wakeflow-bootstrap-plan-stale", "loaded artifact identity differs from the confirmed plan");
  }
}

function assertCurrentInventoryAgainstConfirmedPlan(request, confirmedPlan) {
  let inventory;
  try {
    inventory = inspectWakeflowMigrationInventory({ workspaceRoot: request.root });
  } catch (cause) {
    fail("wakeflow-bootstrap-plan-stale", "workspace inventory cannot be reconstructed", cause);
  }
  if (inventory.inventoryDigest !== confirmedPlan.payload.inventoryDigest) {
    fail("wakeflow-bootstrap-plan-stale", "workspace inventory differs from the confirmed plan");
  }
}

async function loadProductionResources(artifactRoot) {
  try {
    const bundle = loadWakeflowAssetBundle({ wakeflowRoot: artifactRoot });
    const hostSettingsAssetsAdapter = await loadWakeflowHostSettingsAssetsAdapter({
      wakeflowRoot: artifactRoot,
      hostProfile,
    });
    return Object.freeze({ bundle, hostSettingsAssetsAdapter });
  } catch (cause) {
    fail(
      "wakeflow-bootstrap-production-owner-unavailable",
      "the exact artifact cannot load its production migration owners",
      cause,
    );
  }
}

// Apply 前用 confirmed plan 的冻结输入重建同一 migration plan，拒绝 artifact/source 漂移。
function replanMigrationPlan({ request, artifactRoot, confirmedPlan }) {
  const currentArtifacts = inspectArtifactContext(
    artifactRoot,
    request.artifactContext.legacyOwnerRoot,
  );
  assertCurrentArtifactsAgainstConfirmedPlan(currentArtifacts, confirmedPlan);
  const frozen = confirmedPlan.payload.migrationPlan;
  let current;
  try {
    current = planWakeflowMigrationPreview({
      workspaceRoot: request.root,
      artifactContext: currentArtifacts,
      desiredModel: frozen.payload.target.desiredModel,
      identityMappings: frozen.payload.identityMappings,
      rootMappings: frozen.payload.rootMappings,
      hostProfile,
      legacyArchiveTransformResolution: frozen.payload.legacyArchiveTransform,
    });
  } catch (cause) {
    fail("wakeflow-bootstrap-plan-stale", "migration plan cannot be reconstructed", cause);
  }
  if (canonicalJson(current) !== canonicalJson(frozen)) {
    fail("wakeflow-bootstrap-plan-stale", "migration plan differs from the confirmed plan");
  }
  return current;
}

// ===== Preview 与已确认计划执行 =====

/**
 * Preview 组合 legacy migration plan、production owner plan 与只读 activation report；
 * 它不创建 mutation journal，也不写入任何 workspace/target root。
 */
async function executePreview(request, artifactRoot, artifacts, scopeObservation) {
  let migrationPlan;
  try {
    migrationPlan = planWakeflowMigrationPreview({
      workspaceRoot: request.root,
      artifactContext: artifacts,
      desiredModel: request.request.desiredModel,
      identityMappings: request.request.identityMappings,
      rootMappings: request.request.rootMappings,
      hostProfile,
      legacyArchiveTransformResolution: null,
    });
  } catch (cause) {
    fail("wakeflow-bootstrap-preview-failed", "migration preview could not be derived from the exact inputs", cause);
  }
  assertMigrationArtifactIsolation({
    workspaceRoot: request.root,
    desiredModel: migrationPlan.payload.target.desiredModel,
    artifactRoot,
    legacyOwnerRoot: request.artifactContext.legacyOwnerRoot,
  });
  const resources = await loadProductionResources(artifactRoot);
  let composition;
  try {
    composition = planWakeflowProductionMigration({
      workspaceRoot: request.root,
      migrationPlan,
      hostProfile,
      bundle: resources.bundle,
      hostSettingsAssetsAdapter: resources.hostSettingsAssetsAdapter,
    });
  } catch (cause) {
    fail(
      "wakeflow-bootstrap-production-plan-failed",
      "production migration owners could not derive their bounded plan",
      cause,
    );
  }
  const activation = activationResult({
    request,
    scopeObservation,
    status: "pending",
    evidenceDigest: composition.migrationApplyPlanDigest,
  });
  return deepFreeze({
    schemaVersion: WAKEFLOW_BOOTSTRAP_SCHEMA_VERSION,
    tool: "wakeflow_maintain_workspace",
    action: WAKEFLOW_BOOTSTRAP_ACTION,
    mode: "preview",
    hostId: hostProfile.hostId,
    artifactDigests: publicArtifactDigests(artifacts),
    migrationPlan,
    migrationPlanDigest: migrationPlan.planDigest,
    confirmedPlan: composition.migrationApplyPlan,
    planDigest: composition.migrationApplyPlanDigest,
    applyAdmission: {
      status: composition.status,
      reasonCodes: composition.reasonCodes,
    },
    ...activation,
  });
}

/**
 * Apply/recover 只接受完整 confirmed plan 与 digest。实际五阶段写入、checkpoint 和
 * resume-forward 都由 production migration/workspace mutation owner 执行。
 */
async function admitConfirmedRequest(request, artifactRoot, artifacts, scopeObservation) {
  let confirmedPlan;
  try {
    confirmedPlan = validateWakeflowMigrationApplyPlan(request.confirmedPlan);
  } catch (cause) {
    fail("wakeflow-bootstrap-invalid-plan", "confirmedPlan is not one closed migration apply plan", cause);
  }
  if (canonicalJsonDigest(confirmedPlan) !== request.planDigest) {
    fail("wakeflow-bootstrap-invalid-plan", "planDigest differs from the complete confirmed plan");
  }
  if (confirmedPlan.payload.status !== "ready") {
    fail("wakeflow-bootstrap-confirmed-plan-blocked", "the confirmed migration apply plan is blocked");
  }
  assertMigrationArtifactIsolation({
    workspaceRoot: request.root,
    desiredModel: confirmedPlan.payload.migrationPlan.payload.target.desiredModel,
    artifactRoot,
    legacyOwnerRoot: request.artifactContext.legacyOwnerRoot,
  });
  assertCurrentArtifactsAgainstConfirmedPlan(artifacts, confirmedPlan);
  let composition;
  try {
    composition = restoreWakeflowProductionMigrationComposition({
      migrationApplyPlan: confirmedPlan,
    });
  } catch (cause) {
    fail(
      "wakeflow-bootstrap-invalid-plan",
      "confirmedPlan is not one production migration composition",
      cause,
    );
  }
  const resources = await loadProductionResources(artifactRoot);
  let result;
  try {
    if (request.mode === "apply") {
      assertCurrentInventoryAgainstConfirmedPlan(request, confirmedPlan);
      const replan = () => {
        const migrationPlan = replanMigrationPlan({ request, artifactRoot, confirmedPlan });
        return planWakeflowProductionMigration({
          workspaceRoot: request.root,
          migrationPlan,
          hostProfile,
          bundle: resources.bundle,
          hostSettingsAssetsAdapter: resources.hostSettingsAssetsAdapter,
        });
      };
      result = await runWakeflowProductionMigrationApply({
        workspaceRoot: request.root,
        composition,
        hostProfile,
        bundle: resources.bundle,
        hostSettingsAssetsAdapter: resources.hostSettingsAssetsAdapter,
        replan,
      });
    } else {
      result = await recoverWakeflowProductionMigration({
        workspaceRoot: request.root,
        operationId: request.operationId,
        composition,
        hostProfile,
        bundle: resources.bundle,
        hostSettingsAssetsAdapter: resources.hostSettingsAssetsAdapter,
      });
    }
  } catch (cause) {
    if (
      cause?.code === "wakeflow-bootstrap-plan-stale"
      || cause?.code === "wakeflow-production-migration-stale"
      || cause?.code === "wakeflow-migration-apply-stale"
      || cause?.code === "wakeflow-mutation-plan-stale"
    ) fail("wakeflow-bootstrap-plan-stale", "production migration facts changed", cause);
    const recoveryRequired = cause?.code === "wakeflow-mutation-recovery-required";
    fail(
      recoveryRequired
        ? "wakeflow-bootstrap-recovery-required"
        : request.mode === "apply"
          ? "wakeflow-bootstrap-apply-failed"
          : "wakeflow-bootstrap-recovery-failed",
      recoveryRequired
        ? "production migration stopped at a durable checkpoint and requires explicit recovery"
        : `production migration ${request.mode} failed inside its exact owner graph`,
      cause,
    );
  }
  const expectedTerminalStatus = request.mode === "apply" ? "completed" : "recovered";
  const activation = activationResult({
    request,
    scopeObservation,
    status: result?.status === expectedTerminalStatus ? "v3-ready" : "pending",
    evidenceDigest: canonicalJsonDigest({
      migrationPlanDigest: confirmedPlan.payload.migrationPlanDigest,
      planDigest: request.planDigest,
      mode: request.mode,
      result,
    }),
  });
  return deepFreeze({
    schemaVersion: WAKEFLOW_BOOTSTRAP_SCHEMA_VERSION,
    tool: "wakeflow_maintain_workspace",
    action: WAKEFLOW_BOOTSTRAP_ACTION,
    mode: request.mode,
    hostId: hostProfile.hostId,
    artifactDigests: publicArtifactDigests(artifacts),
    migrationPlanDigest: confirmedPlan.payload.migrationPlanDigest,
    planDigest: request.planDigest,
    result,
    ...activation,
  });
}

// ===== 可复用 composition 入口与结构化 stdin/stdout facade =====

/**
 * 构造一次显式迁移调用。这里绑定 artifact、host adapter 和 activation observation，
 * 但不允许调用者替换内部 module 路径或 owner 实现。
 */
export async function runWakeflowBootstrap(options = {}) {
  exactKeys(options, ["argv", "artifactRoot", "rawRequest"], "bootstrap run options");
  parseWakeflowBootstrapArgv(options.argv);
  const artifactRoot = normalizeRealDirectory(options.artifactRoot, "bootstrap artifact root");
  const request = parseWakeflowBootstrapRequest(options.rawRequest);
  assertMigrationArtifactIsolation({
    workspaceRoot: request.root,
    artifactRoot,
    legacyOwnerRoot: request.artifactContext.legacyOwnerRoot,
  });
  const artifacts = inspectArtifactContext(
    artifactRoot,
    request.artifactContext.legacyOwnerRoot,
  );
  // 当前production明确阻断host cohort；未被计划消费的decommission owner不在这里预加载。
  const activationOwner = await loadCurrentActivationScopeOwner(artifactRoot);
  const workspaceSubjectDigest = createWakeflowWorkspaceActivationSubjectDigest({
    workspaceRoot: request.root,
  });
  const scopeObservation = await inspectCurrentActivationScope(
    activationOwner,
    workspaceSubjectDigest,
  );
  if (request.mode === "preview") {
    return executePreview(request, artifactRoot, artifacts, scopeObservation);
  }
  return admitConfirmedRequest(request, artifactRoot, artifacts, scopeObservation);
}

function publicError(error) {
  if (error instanceof WakeflowBootstrapError) {
    return Object.freeze({ code: error.code, message: error.message });
  }
  return Object.freeze({
    code: "wakeflow-bootstrap-failed",
    message: "Wakeflow bootstrap failed inside its bounded exact-artifact boundary",
  });
}

/**
 * 读取一次 bounded stdin、执行 composition，并只向 stdout 写一份稳定 JSON envelope。
 * 内部 cause、路径和宿主私有证据不会穿透公开错误面。
 */
export async function runWakeflowBootstrapStdin(options = {}) {
  exactKeys(options, ["argv", "artifactRoot", "stdin", "stdout"], "bootstrap stdin options");
  const stdout = options.stdout;
  const write = stdout?.write;
  if (stdout === null || typeof write !== "function") {
    fail("wakeflow-bootstrap-invalid-stdout", "bootstrap stdout must provide write()");
  }
  // 在首次await前绑定输出effect，避免调用方在stdin读取期间替换已准入的writer。
  const writeOutput = (value) => Reflect.apply(write, stdout, [value]);
  try {
    const rawRequest = await readBoundedUtf8(options.stdin);
    const result = await runWakeflowBootstrap({
      argv: options.argv,
      artifactRoot: options.artifactRoot,
      rawRequest,
    });
    writeOutput(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
    return Object.freeze({ exitCode: 0, result });
  } catch (error) {
    const serialized = publicError(error);
    writeOutput(`${JSON.stringify({ ok: false, error: serialized }, null, 2)}\n`);
    return Object.freeze({ exitCode: 1, error: serialized });
  }
}

// ===== 固定 launcher 进程入口 =====

// backend 只能把自己的 real path 解释为 artifact identity，不能相信 cwd 或 request 字段。
function directArtifactRoot() {
  let backend;
  try {
    backend = realpathSync(fileURLToPath(import.meta.url));
  } catch (cause) {
    fail("wakeflow-bootstrap-artifact-invalid", "bootstrap backend real path is unavailable", cause);
  }
  const artifactRoot = realpathSync(path.resolve(path.dirname(backend), ".."));
  if (path.relative(artifactRoot, backend) !== "scripts/wakeflow-bootstrap.mjs") {
    fail("wakeflow-bootstrap-artifact-invalid", "bootstrap backend is outside its fixed artifact location");
  }
  return artifactRoot;
}

/**
 * Shell launcher 注入自己解析出的 physical artifact root；backend 再与自身 real path
 * 双向核对。缺少该上下文的直接 `node scripts/...` 调用不会进入 stdin 或迁移编排。
 */
function assertDirectLauncherContext(artifactRoot) {
  const declared = process.env[BOOTSTRAP_LAUNCHER_ROOT_ENV];
  if (typeof declared !== "string" || !declared) {
    fail(
      "wakeflow-bootstrap-launcher-required",
      "bootstrap backend must be started by its fixed artifact launcher",
    );
  }
  let stat;
  let real;
  try {
    stat = lstatSync(declared);
    real = realpathSync(declared);
  } catch (cause) {
    fail(
      "wakeflow-bootstrap-launcher-invalid",
      "bootstrap launcher supplied an invalid artifact root",
      cause,
    );
  }
  if (
    declared !== declared.trim()
    || declared.includes("\0")
    || !path.isAbsolute(declared)
    || path.resolve(declared) !== declared
    || stat.isSymbolicLink()
    || !stat.isDirectory()
    || real !== declared
    || declared !== artifactRoot
  ) {
    fail(
      "wakeflow-bootstrap-launcher-invalid",
      "bootstrap launcher and backend do not belong to the same exact artifact",
    );
  }
}

function isDirectExecution() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  let artifactRoot;
  try {
    artifactRoot = directArtifactRoot();
    assertDirectLauncherContext(artifactRoot);
    const completed = await runWakeflowBootstrapStdin({
      argv: process.argv.slice(2),
      artifactRoot,
      stdin: process.stdin,
      stdout: process.stdout,
    });
    process.exitCode = completed.exitCode;
  } catch (error) {
    const serialized = publicError(error);
    process.stdout.write(`${JSON.stringify({ ok: false, error: serialized }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
