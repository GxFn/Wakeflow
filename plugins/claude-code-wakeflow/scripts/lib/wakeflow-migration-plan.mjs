import path from "node:path";
import { createHash } from "node:crypto";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import {
  validateWakeflowArtifactTreeManifest,
} from "./wakeflow-artifact-tree-identity.mjs";
import {
  normalizeWakeflowHostCapabilityProfile,
} from "./wakeflow-host-capability.mjs";
import {
  assertWakeflowId,
  parseWakeflowId,
} from "./wakeflow-identifiers.mjs";
import {
  createWakeflowLayoutDescriptor,
  freshWakeflowLayoutEntries,
} from "./wakeflow-layout-descriptor.mjs";
import {
  inspectWakeflowMigrationInventory,
} from "./wakeflow-migration-inventory.mjs";
import {
  inspectWakeflowLegacyOwnerDrain,
  validateWakeflowLegacyOwnerDrainAssessment,
} from "./wakeflow-legacy-owner-drain.mjs";

/**
 * T05 migration plan 是 T04 只读 inventory 与后续 owner/apply 之间的确定性编排合同。
 * 它不读取 caller 提交的 inventory，不执行写入，也不把 planDigest 当作授权。
 *
 * 阅读导航：
 * 1. 合同原语：关闭对象/数组、字符串、digest 与 portable ref 的输入边界。
 * 2. 目标选择：把 caller 明确给出的 opaque ID、root mapping、v3 model 与 host profile
 *    绑定为一份可重算的 target/layout snapshot；不从语义标题生成 ID。
 * 3. Archive owner 接缝：只接收 Task D owner 签发的最小 resolution，并校验其与
 *    artifact、inventory、owner-drain 和 target 的上下文一致；不复制 archive 业务校验器。
 * 4. Source action：逐 source/component 生成 keep/manual/remove/transform；目录只汇总
 *    已有 child unit，绝不以递归目录动作替代子项。
 * 5. 依赖与顺序：把 owner drain、domain correlation、host decommission、release gate
 *    分开记录，并固定五阶段 commit 与同序 resume-forward recovery。
 * 6. 自校验：validator 从已冻结的 source/root/config/target 事实重派 action、dependency、
 *    coverage、blocker 和 phase，拒绝只重签 planDigest 的语义篡改。
 * 7. 证明边界：standalone codec 只能证明 payload 内部闭合；真实 workspace freshness、
 *    artifact identity 和 owner capability 仍由 bootstrap replan 与 T06-T10 owner 证明。
 */
export const WAKEFLOW_MIGRATION_PLAN_KIND = "WakeflowExplicitMigrationPlan";
export const WAKEFLOW_MIGRATION_PLAN_SCHEMA_VERSION = 3;
export const WAKEFLOW_MIGRATION_PLAN_ACTIONS = Object.freeze([
  "keep",
  "manual",
  "remove",
  "transform",
]);
export const WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_KIND =
  "WakeflowLegacyArchiveTransformOwnerResolution";
export const WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_SCHEMA_VERSION = 1;

const SCHEMA_ID = "urn:wakeflow:internal:explicit-migration-plan:v3";
const LOGICAL_ACTION = "explicit-migration";
const LEGACY_ARCHIVE_TRANSFORM_OWNER_ID = "migration-archive-transform";
const LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_ID =
  "urn:wakeflow:internal:migration:legacy-archive-transform-plan:v1";
const LEGACY_ARCHIVE_TRANSFORM_SOURCE_BLOCKERS = new Set([
  "legacy-domain-correlation-required",
  "migration-domain-correlation-required",
]);
const LEGACY_ARCHIVE_TRANSFORM_PREREQUISITES = Object.freeze({
  "archive-wrap": new Set(["domain-chain-correlation", "pod-source-set-correlation"]),
  "audit-preserve": new Set(["inactive-source-proof", "preservation-manifest-validation"]),
});
const ACTION_SET = new Set(WAKEFLOW_MIGRATION_PLAN_ACTIONS);
const ENTITY_TYPES = Object.freeze(["program", "repository", "surface", "window"]);
const ENTITY_TYPE_SET = new Set(ENTITY_TYPES);
const ROOT_TARGET_KINDS = new Set([
  "active",
  "ledger",
  "local",
  "none",
  "program",
  "repository",
  "surface",
]);
const PHASES = Object.freeze([
  "target-authority",
  "archive-or-preservation",
  "managed-surfaces",
  "derived-projections",
  "exact-source-release",
]);
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const MODE_RE = /^0[0-7]{3}$/u;
const SAFE_PORTABLE_COMPONENT_RE = /^[A-Za-z0-9._-]{1,160}$/u;
const MAX_PLAN_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 100_000;
const SOURCE_TYPES = new Set([
  "block-device",
  "character-device",
  "directory",
  "fifo",
  "file",
  "socket",
  "special",
  "symlink",
  "unreadable",
]);
const IDENTITY_SLOT_TYPES = Object.freeze({
  program: new Set(["workspace-name"]),
  repository: new Set(["absolute-path", "relative-path", "repository-name", "window-name"]),
  surface: new Set(["absolute-path", "relative-path", "window-name"]),
  window: new Set(["window-name"]),
});
const PHYSICAL_BLOCKER_PARTS = Object.freeze([
  "classifier-failed",
  "collision",
  "context-conflict",
  "entry-limit",
  "file-limit",
  "path-escape",
  "root-escape",
  "source-classifier-byte-limit",
  "source-file-limit",
  "source-manual",
  "source-multiple-links",
  "source-owner-mismatch",
  "source-size-unrepresentable",
  "source-special-node",
  "source-symlink",
  "source-total-byte-limit",
  "source-type-mismatch",
  "source-unreadable",
  "source-unrecognized",
  "source-unsafe-ref",
  "source-unstable",
  "special-node",
  "symlink-ancestor",
  "total-byte-limit",
  "type-mismatch",
]);
const DOMAIN_DEPENDENCY_RE = /(?:drain|required|correlation|decommission|closure|readback|validation|proof|retired|committed|published|ready|detached|cleanup)/u;
const PRIVATE_PATH_RE = /(?:^|[\s"'`(])(?:\/(?:Users|home|private|var\/folders)\/[^\s"'`)]*|[A-Za-z]:\\Users\\[^\s"'`)]*)/u;

// ==================== 一、封闭数据合同与canonical原语 ====================

/** 统一输出T05错误码、JSON pointer与脱敏详情。 */
export class WakeflowMigrationPlanError extends Error {
  constructor(code, message, { errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowMigrationPlanError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowMigrationPlanError(code, `${message} at ${errorPath}`, {
    errorPath,
    details,
    cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, fields, errorPath, code = "wakeflow-migration-plan-contract") {
  if (!plainObject(value)) fail(code, "expected a plain data object", { errorPath });
  const keys = Reflect.ownKeys(value);
  const actual = keys.map(String).sort(compareText);
  const expected = [...fields].sort(compareText);
  if (
    keys.some((key) => typeof key !== "string")
    || canonicalJson(actual) !== canonicalJson(expected)
  ) {
    fail(code, "object fields differ from the closed contract", {
      errorPath,
      details: { actual, expected },
    });
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, "fields must be enumerable data properties", {
        errorPath: `${errorPath}/${field}`,
      });
    }
  }
  return value;
}

function denseArray(value, errorPath, code = "wakeflow-migration-plan-contract") {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    fail(code, "expected one bounded array", { errorPath });
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(key)
      || Number(key) >= value.length
    ) fail(code, "arrays cannot contain hidden, symbol, or additional properties", { errorPath });
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(code, "sparse arrays are not allowed", { errorPath: `${errorPath}/${index}` });
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, "array entries must be enumerable data properties", { errorPath: `${errorPath}/${index}` });
    }
    result.push(descriptor.value);
  }
  return result;
}

function canonicalClone(value, label) {
  let encoded;
  try {
    encoded = canonicalJson(value);
  } catch (cause) {
    fail("wakeflow-migration-plan-canonical", `${label} is not canonical JSON data`, { cause });
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_PLAN_BYTES) {
    fail("wakeflow-migration-plan-limit", `${label} exceeds the bounded plan size`);
  }
  return JSON.parse(encoded);
}

function digest(value, errorPath, code = "wakeflow-migration-plan-contract") {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail(code, "expected a canonical SHA-256 digest", { errorPath });
  }
  return value;
}

function nullableDigest(value, errorPath, code = "wakeflow-migration-plan-contract") {
  return value === null ? null : digest(value, errorPath, code);
}

function text(value, errorPath, code = "wakeflow-migration-plan-contract") {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value !== value.normalize("NFC")
    || Buffer.byteLength(value, "utf8") > 4096
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) fail(code, "expected one bounded control-free string", { errorPath });
  return value;
}

function nullableText(value, errorPath, code = "wakeflow-migration-plan-contract") {
  return value === null ? null : text(value, errorPath, code);
}

function portableRef(value, errorPath, code = "wakeflow-migration-plan-contract") {
  text(value, errorPath, code);
  if (
    value !== value.normalize("NFC")
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || path.posix.normalize(value) !== value
    || value.split("/").some((component) => (
      component === ""
      || component === ".."
      || !SAFE_PORTABLE_COMPONENT_RE.test(component)
    ))
  ) fail(code, "expected one normalized portable ref", { errorPath });
  return value;
}

function portableLayoutPath(value, errorPath) {
  text(value, errorPath, "wakeflow-migration-plan-target");
  if (
    value !== value.normalize("NFC")
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || path.posix.normalize(value) !== value
    || value.split("/").some((component) => (
      component === ""
      || (component !== ".." && !SAFE_PORTABLE_COMPONENT_RE.test(component))
    ))
  ) fail("wakeflow-migration-plan-target", "expected one normalized portable layout path", { errorPath });
  return value;
}

function canonicalOrder(values, selector, errorPath, code) {
  const actual = values.map(selector);
  const expected = [...actual].sort(compareText);
  if (new Set(actual).size !== actual.length || canonicalJson(actual) !== canonicalJson(expected)) {
    fail(code, "collection must be unique and lexically ordered", { errorPath });
  }
}

function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value !== value.normalize("NFC")
    || Buffer.byteLength(value, "utf8") > 4096
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail("wakeflow-migration-plan-input", "workspaceRoot must be one normalized absolute path", { errorPath: "$/workspaceRoot" });
  return value;
}

function normalizeArtifactIdentity(value, errorPath) {
  exactObject(value, ["artifactDigest", "manifest"], errorPath, "wakeflow-migration-plan-artifact");
  const artifactDigest = digest(value.artifactDigest, `${errorPath}/artifactDigest`, "wakeflow-migration-plan-artifact");
  let manifest;
  try {
    manifest = validateWakeflowArtifactTreeManifest(value.manifest);
  } catch (cause) {
    fail("wakeflow-migration-plan-artifact", "artifact manifest is invalid", { errorPath: `${errorPath}/manifest`, cause });
  }
  if (canonicalJsonDigest(manifest) !== artifactDigest) {
    fail("wakeflow-migration-plan-artifact", "artifact digest differs from its exact complete manifest", { errorPath });
  }
  return { artifactDigest, manifest };
}

function normalizeArtifactContext(value) {
  exactObject(
    value,
    ["bootstrapArtifact", "legacyOwnerArtifact"],
    "$/artifactContext",
    "wakeflow-migration-plan-artifact",
  );
  return {
    bootstrapArtifact: normalizeArtifactIdentity(value.bootstrapArtifact, "$/artifactContext/bootstrapArtifact"),
    legacyOwnerArtifact: value.legacyOwnerArtifact === null
      ? null
      : normalizeArtifactIdentity(value.legacyOwnerArtifact, "$/artifactContext/legacyOwnerArtifact"),
  };
}

// ==================== 二、opaque identity、root mapping与目标layout ====================

// 从strict v3 model列出必须由caller逐项确认的全部typed实体，不生成任何新ID。
function targetEntities(model) {
  return [
    { entityType: "program", targetId: model.program.programId },
    ...model.topology.repositories.map((entry) => ({ entityType: "repository", targetId: entry.repositoryId })),
    ...model.topology.supportSurfaces.map((entry) => ({ entityType: "surface", targetId: entry.surfaceId })),
    ...model.topology.windows.map((entry) => ({ entityType: "window", targetId: entry.windowId })),
  ].sort((left, right) => compareText(`${left.entityType}:${left.targetId}`, `${right.entityType}:${right.targetId}`));
}

/**
 * 把classifier冻结的typed slot与调用方提供的opaque v3 ID逐项绑定。
 * 这里只证明映射证据和目标类型闭合，不从slot文本推导或选择任何新ID。
 */
function normalizeIdentityMappings(values, inventory, model) {
  const sources = new Map(inventory.sources.map((source) => [source.sourceId, source]));
  const expected = targetEntities(model);
  const expectedKeys = new Set(expected.map((entry) => `${entry.entityType}:${entry.targetId}`));
  const mappings = denseArray(values, "$/identityMappings", "wakeflow-migration-plan-identity-mapping")
    .map((value, index) => {
      const at = `$/identityMappings/${index}`;
      exactObject(value, ["entityType", "targetId", "sourceId", "slots"], at, "wakeflow-migration-plan-identity-mapping");
      if (!ENTITY_TYPE_SET.has(value.entityType)) {
        fail("wakeflow-migration-plan-identity-mapping", "mapping entityType is unsupported", { errorPath: `${at}/entityType` });
      }
      try {
        assertWakeflowId(value.targetId, value.entityType, `${at}/targetId`);
      } catch (cause) {
        fail("wakeflow-migration-plan-identity-mapping", "mapping targetId has the wrong typed identity", { errorPath: `${at}/targetId`, cause });
      }
      const sourceId = digest(value.sourceId, `${at}/sourceId`, "wakeflow-migration-plan-identity-mapping");
      const source = sources.get(sourceId);
      if (!source?.classification) {
        fail("wakeflow-migration-plan-identity-mapping", "mapping source lacks a strict classifier result", { errorPath: `${at}/sourceId` });
      }
      const sourceSlots = new Map(source.classification.typedSlots.map((slot) => [slot.id, slot]));
      const slots = denseArray(value.slots, `${at}/slots`, "wakeflow-migration-plan-identity-mapping")
        .map((slot, slotIndex) => {
          const slotAt = `${at}/slots/${slotIndex}`;
          exactObject(slot, ["slotId", "valueDigest"], slotAt, "wakeflow-migration-plan-identity-mapping");
          const slotId = text(slot.slotId, `${slotAt}/slotId`, "wakeflow-migration-plan-identity-mapping");
          const valueDigest = digest(slot.valueDigest, `${slotAt}/valueDigest`, "wakeflow-migration-plan-identity-mapping");
          const observed = sourceSlots.get(slotId);
          if (!observed || observed.valueDigest !== valueDigest) {
            fail("wakeflow-migration-plan-identity-mapping", "mapping slot differs from exact classified source evidence", { errorPath: slotAt });
          }
          if (!IDENTITY_SLOT_TYPES[value.entityType].has(observed.type)) {
            fail("wakeflow-migration-plan-identity-mapping", "mapping slot type cannot identify this target entity", {
              errorPath: `${slotAt}/slotId`,
              details: { entityType: value.entityType, slotType: observed.type },
            });
          }
          return { slotId, valueDigest };
        });
      if (slots.length === 0) {
        fail("wakeflow-migration-plan-identity-mapping", "each target identity needs exact source slot evidence", { errorPath: `${at}/slots` });
      }
      canonicalOrder(slots, (slot) => slot.slotId, `${at}/slots`, "wakeflow-migration-plan-identity-mapping");
      return { entityType: value.entityType, targetId: value.targetId, sourceId, slots };
    });
  canonicalOrder(
    mappings,
    (mapping) => `${mapping.entityType}:${mapping.targetId}`,
    "$/identityMappings",
    "wakeflow-migration-plan-identity-mapping",
  );
  const actualKeys = new Set(mappings.map((entry) => `${entry.entityType}:${entry.targetId}`));
  if (
    mappings.length !== expected.length
    || actualKeys.size !== expectedKeys.size
    || [...expectedKeys].some((key) => !actualKeys.has(key))
  ) fail("wakeflow-migration-plan-identity-mapping", "identity mappings do not cover every exact desired entity", { errorPath: "$/identityMappings" });
  const rawUuids = mappings.map((mapping) => parseWakeflowId(mapping.targetId).uuid);
  if (new Set(rawUuids).size !== rawUuids.length) {
    fail("wakeflow-migration-plan-identity-collision", "target identities reuse one UUID across typed domains", { errorPath: "$/identityMappings" });
  }
  return mappings;
}

function normalizeRootTarget(value, model, errorPath) {
  exactObject(value, ["kind", "targetId"], errorPath, "wakeflow-migration-plan-root-mapping");
  if (!ROOT_TARGET_KINDS.has(value.kind)) {
    fail("wakeflow-migration-plan-root-mapping", "root target kind is unsupported", { errorPath: `${errorPath}/kind` });
  }
  const typed = value.kind === "program"
    ? "program"
    : value.kind === "repository"
      ? "repository"
      : value.kind === "surface"
        ? "surface"
        : null;
  if ((typed === null) !== (value.targetId === null)) {
    fail("wakeflow-migration-plan-root-mapping", "root targetId differs from its target kind", { errorPath });
  }
  if (typed !== null) {
    try {
      assertWakeflowId(value.targetId, typed, `${errorPath}/targetId`);
    } catch (cause) {
      fail("wakeflow-migration-plan-root-mapping", "root targetId is invalid", { errorPath: `${errorPath}/targetId`, cause });
    }
    const allowed = new Set(targetEntities(model)
      .filter((entry) => entry.entityType === typed)
      .map((entry) => entry.targetId));
    if (!allowed.has(value.targetId)) {
      fail("wakeflow-migration-plan-root-mapping", "root targetId is absent from the desired model", { errorPath: `${errorPath}/targetId` });
    }
  }
  return { kind: value.kind, targetId: value.targetId };
}

function rootTargetKey(target) {
  return `${target.kind}:${target.targetId ?? ""}`;
}

function compatibleRootTargetKinds(root) {
  if (root.rootKind.startsWith("old-")) return new Set(["none"]);
  if (root.rootKind.includes("active-root")) return new Set(["active", "none"]);
  if (root.rootKind.includes("local-root")) return new Set(["local", "none"]);
  if (root.rootKind.includes("ledger")) return new Set(["ledger", "none"]);
  if (root.rootKind === "config-source") return new Set(["none", "program"]);
  if (["design-support", "test-support"].includes(root.surfaceKind)) {
    return new Set(["none", "surface"]);
  }
  if (root.surfaceKind === "product-repository") return new Set(["none", "repository"]);
  if (root.rootKind === "configured-storage-path") {
    return new Set(["active", "ledger", "none", "program"]);
  }
  return new Set(["none", "program"]);
}

/**
 * 要求每个T04 root恰有一个职责兼容的目标；重叠物理root必须指向同一目标。
 * `none`是显式“不映射”，并不等于已授权删除该root。
 */
function normalizeRootMappings(values, inventory, model) {
  const roots = new Map(inventory.roots.map((root) => [root.rootId, root]));
  const mappings = denseArray(values, "$/rootMappings", "wakeflow-migration-plan-root-mapping")
    .map((value, index) => {
      const at = `$/rootMappings/${index}`;
      exactObject(value, ["rootId", "target"], at, "wakeflow-migration-plan-root-mapping");
      const rootId = digest(value.rootId, `${at}/rootId`, "wakeflow-migration-plan-root-mapping");
      if (!roots.has(rootId)) {
        fail("wakeflow-migration-plan-root-mapping", "mapping references an unknown inventory root", { errorPath: `${at}/rootId` });
      }
      const root = roots.get(rootId);
      const target = normalizeRootTarget(value.target, model, `${at}/target`);
      if (!compatibleRootTargetKinds(root).has(target.kind)) {
        fail("wakeflow-migration-plan-root-mapping", "root target kind crosses its physical responsibility", {
          errorPath: `${at}/target/kind`,
          details: { rootKind: root.rootKind, surfaceKind: root.surfaceKind, targetKind: target.kind },
        });
      }
      return { rootId, target };
    });
  canonicalOrder(mappings, (mapping) => mapping.rootId, "$/rootMappings", "wakeflow-migration-plan-root-mapping");
  if (mappings.length !== roots.size || mappings.some((mapping) => !roots.has(mapping.rootId))) {
    fail("wakeflow-migration-plan-root-mapping", "root mappings do not cover every inventory root", { errorPath: "$/rootMappings" });
  }
  const byRoot = new Map(mappings.map((mapping) => [mapping.rootId, mapping]));
  const physical = new Map();
  for (const root of inventory.roots.filter((entry) => entry.exists)) {
    const key = canonicalJson({ location: root.location, type: root.type, digest: root.digest });
    const targets = physical.get(key) ?? new Set();
    targets.add(rootTargetKey(byRoot.get(root.rootId).target));
    physical.set(key, targets);
  }
  if ([...physical.values()].some((targets) => targets.size > 1)) {
    fail("wakeflow-migration-plan-root-conflict", "overlapping claims map one physical root to different target identities", { errorPath: "$/rootMappings" });
  }
  return mappings;
}

function portableHostProfile(normalizedHost) {
  return {
    hostId: normalizedHost.hostId,
    memoryFile: normalizedHost.memoryFile,
    runtime: { hostDirName: normalizedHost.hostDirName },
    capabilities: normalizedHost.capabilities,
  };
}

/** 从strict v3 model与窄化host profile重建可移植目标及完整layout快照。 */
function targetSnapshot(model, hostProfile) {
  let normalizedHost;
  let descriptor;
  let profile;
  try {
    normalizedHost = normalizeWakeflowHostCapabilityProfile(hostProfile);
    profile = portableHostProfile(normalizedHost);
    descriptor = createWakeflowLayoutDescriptor({ model, hostProfile: profile });
  } catch (cause) {
    fail("wakeflow-migration-plan-target", "desired host/layout target is invalid", { cause });
  }
  const desiredConfigBytes = Buffer.from(serializeWakeflowConfigV3(model), "utf8");
  const layoutEntries = freshWakeflowLayoutEntries(descriptor).map((entry) => ({
    authority: entry.authority,
    createTiming: entry.createTiming,
    key: entry.key,
    owner: entry.owner,
    path: entry.path,
    pathKind: entry.pathKind,
  })).sort((left, right) => compareText(left.key, right.key));
  return {
    desiredModel: model,
    desiredModelDigest: wakeflowConfigV3Digest(model),
    desiredConfigBytesDigest: canonicalByteDigest(desiredConfigBytes),
    desiredConfigDerivationDigest: canonicalJsonDigest({
      owner: "config-writer",
      desiredModel: model,
    }),
    hostId: normalizedHost.hostId,
    hostProfile: profile,
    hostProfileDigest: canonicalJsonDigest(normalizedHost),
    layoutDigest: descriptor.layoutDigest,
    layoutEntries,
  };
}

// ==================== 三、legacy archive owner resolution与source-set事实 ====================

// Resolution只冻结Task D owner的最小索引；完整owner plan仍在T08 phase snapshot中校验。
/**
 * 校验Task D archive owner签发的最小resolution形状与自含digest。
 * 业务archive plan本身仍由其owner校验；T05不复制另一套归档状态机。
 */
function normalizeLegacyArchiveTransformOwnerResolution(value) {
  if (value === null) return null;
  const resolution = canonicalClone(value, "legacyArchiveTransformResolution");
  exactObject(resolution, [
    "kind",
    "schemaVersion",
    "ownerId",
    "ownerPlanSchemaId",
    "ownerPlanDigest",
    "programId",
    "configDigest",
    "ledgerRootRef",
    "legacyOwnerArtifactDigest",
    "migrationInventoryDigest",
    "ownerDrainAssessmentDigest",
    "archiveImportInventoryDigest",
    "archives",
    "coveredSourceIds",
    "holds",
    "resolutionDigest",
  ], "$/legacyArchiveTransformResolution", "wakeflow-migration-plan-transform-owner");
  if (
    resolution.kind !== WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_KIND
    || resolution.schemaVersion
      !== WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_SCHEMA_VERSION
    || resolution.ownerId !== LEGACY_ARCHIVE_TRANSFORM_OWNER_ID
    || resolution.ownerPlanSchemaId !== LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_ID
  ) {
    fail(
      "wakeflow-migration-plan-transform-owner",
      "legacy archive transform owner resolution identity is invalid",
      { errorPath: "$/legacyArchiveTransformResolution" },
    );
  }
  try {
    assertWakeflowId(
      resolution.programId,
      "program",
      "$/legacyArchiveTransformResolution/programId",
    );
  } catch (cause) {
    fail(
      "wakeflow-migration-plan-transform-owner",
      "legacy archive transform owner program identity is invalid",
      { errorPath: "$/legacyArchiveTransformResolution/programId", cause },
    );
  }
  for (const field of [
    "ownerPlanDigest",
    "configDigest",
    "legacyOwnerArtifactDigest",
    "migrationInventoryDigest",
    "ownerDrainAssessmentDigest",
    "archiveImportInventoryDigest",
    "resolutionDigest",
  ]) digest(
    resolution[field],
    `$/legacyArchiveTransformResolution/${field}`,
    "wakeflow-migration-plan-transform-owner",
  );
  portableLayoutPath(
    resolution.ledgerRootRef,
    "$/legacyArchiveTransformResolution/ledgerRootRef",
  );
  const archives = denseArray(
    resolution.archives,
    "$/legacyArchiveTransformResolution/archives",
    "wakeflow-migration-plan-transform-owner",
  );
  if (archives.length === 0) {
    fail(
      "wakeflow-migration-plan-transform-owner",
      "legacy archive transform owner resolution must cover at least one strict archive import",
      { errorPath: "$/legacyArchiveTransformResolution/archives" },
    );
  }
  for (const [index, archive] of archives.entries()) {
    const at = `$/legacyArchiveTransformResolution/archives/${index}`;
    exactObject(
      archive,
      ["archiveImportId", "archiveSourceId", "archiveTreeDigest"],
      at,
      "wakeflow-migration-plan-transform-owner",
    );
    for (const field of ["archiveImportId", "archiveSourceId", "archiveTreeDigest"]) {
      digest(archive[field], `${at}/${field}`, "wakeflow-migration-plan-transform-owner");
    }
  }
  canonicalOrder(
    archives,
    (entry) => entry.archiveImportId,
    "$/legacyArchiveTransformResolution/archives",
    "wakeflow-migration-plan-transform-owner",
  );
  if (new Set(archives.map((entry) => entry.archiveSourceId)).size !== archives.length) {
    fail(
      "wakeflow-migration-plan-transform-owner",
      "legacy archive transform owner resolution reuses one archive source",
      { errorPath: "$/legacyArchiveTransformResolution/archives" },
    );
  }
  const coveredSourceIds = denseArray(
    resolution.coveredSourceIds,
    "$/legacyArchiveTransformResolution/coveredSourceIds",
    "wakeflow-migration-plan-transform-owner",
  );
  coveredSourceIds.forEach((sourceId, index) => digest(
    sourceId,
    `$/legacyArchiveTransformResolution/coveredSourceIds/${index}`,
    "wakeflow-migration-plan-transform-owner",
  ));
  canonicalOrder(
    coveredSourceIds,
    (entry) => entry,
    "$/legacyArchiveTransformResolution/coveredSourceIds",
    "wakeflow-migration-plan-transform-owner",
  );
  if (archives.some((archive) => !coveredSourceIds.includes(archive.archiveSourceId))) {
    fail(
      "wakeflow-migration-plan-transform-owner",
      "legacy archive transform owner source coverage omits an archive root",
      { errorPath: "$/legacyArchiveTransformResolution/coveredSourceIds" },
    );
  }
  const holds = denseArray(
    resolution.holds,
    "$/legacyArchiveTransformResolution/holds",
    "wakeflow-migration-plan-transform-owner",
  );
  for (const [index, hold] of holds.entries()) {
    const at = `$/legacyArchiveTransformResolution/holds/${index}`;
    exactObject(
      hold,
      ["sourceId", "sourceDigest", "preservationId", "holdPlanDigest"],
      at,
      "wakeflow-migration-plan-transform-owner",
    );
    for (const field of ["sourceId", "sourceDigest", "holdPlanDigest"]) {
      digest(hold[field], `${at}/${field}`, "wakeflow-migration-plan-transform-owner");
    }
    try {
      assertWakeflowId(hold.preservationId, "preservation", `${at}/preservationId`);
    } catch (cause) {
      fail(
        "wakeflow-migration-plan-transform-owner",
        "legacy archive transform hold preservation identity is invalid",
        { errorPath: `${at}/preservationId`, cause },
      );
    }
  }
  canonicalOrder(
    holds,
    (entry) => entry.sourceId,
    "$/legacyArchiveTransformResolution/holds",
    "wakeflow-migration-plan-transform-owner",
  );
  if (new Set(holds.map((entry) => entry.preservationId)).size !== holds.length) {
    fail(
      "wakeflow-migration-plan-transform-owner",
      "legacy archive transform owner resolution reuses one preservation identity",
      { errorPath: "$/legacyArchiveTransformResolution/holds" },
    );
  }
  if (holds.some((entry) => !coveredSourceIds.includes(entry.sourceId))) {
    fail(
      "wakeflow-migration-plan-transform-owner",
      "legacy archive transform hold is outside the exact owner source coverage",
      { errorPath: "$/legacyArchiveTransformResolution/holds" },
    );
  }
  const { resolutionDigest, ...unsigned } = resolution;
  if (resolutionDigest !== canonicalJsonDigest(unsigned)) {
    fail(
      "wakeflow-migration-plan-transform-owner",
      "legacy archive transform owner resolution digest differs from its complete facts",
      { errorPath: "$/legacyArchiveTransformResolution/resolutionDigest" },
    );
  }
  if (PRIVATE_PATH_RE.test(canonicalJson(resolution))) {
    fail(
      "wakeflow-migration-plan-privacy",
      "legacy archive transform owner resolution contains a machine-private absolute path",
      { errorPath: "$/legacyArchiveTransformResolution" },
    );
  }
  return deepFreeze(resolution);
}

export function validateWakeflowLegacyArchiveTransformOwnerResolution(value) {
  return normalizeLegacyArchiveTransformOwnerResolution(value);
}

function assertLegacyArchiveTransformResolutionContext(
  resolution,
  { artifacts, inventory, ownerDrain, target },
) {
  if (resolution === null) return null;
  if (
    ownerDrain === null
    || ownerDrain.summary.ownerDrainSatisfied !== true
    || resolution.programId !== target.desiredModel.program.programId
    || resolution.configDigest !== target.desiredModelDigest
    || resolution.ledgerRootRef !== target.desiredModel.storage.ledgerRoot
    || resolution.legacyOwnerArtifactDigest !== artifacts.legacyOwnerArtifact?.artifactDigest
    || resolution.migrationInventoryDigest !== inventory.inventoryDigest
    || resolution.ownerDrainAssessmentDigest !== ownerDrain.assessmentDigest
  ) {
    fail(
      "wakeflow-migration-plan-transform-owner",
      "legacy archive transform owner resolution differs from T04/T05/T06 target authority",
      { errorPath: "$/legacyArchiveTransformResolution" },
    );
  }
  const sources = new Map(inventory.sources.map((source) => [source.sourceId, source]));
  const ownerDomainSourceIds = new Set(ownerDrain.domains
    .filter((domain) => ["pod", "transport"].includes(domain.domain))
    .flatMap((domain) => domain.sourceIds));
  const archiveRootSourceIds = new Set(resolution.archives.map((archive) => archive.archiveSourceId));
  for (const [index, sourceId] of resolution.coveredSourceIds.entries()) {
    if (
      !sources.has(sourceId)
      || (!ownerDomainSourceIds.has(sourceId) && !archiveRootSourceIds.has(sourceId))
    ) {
      fail(
        "wakeflow-migration-plan-transform-owner",
        "legacy archive transform resolution contains an unowned source",
        { errorPath: `$/legacyArchiveTransformResolution/coveredSourceIds/${index}` },
      );
    }
  }
  for (const [index, archive] of resolution.archives.entries()) {
    const source = sources.get(archive.archiveSourceId);
    if (
      !source
      || source.type !== "directory"
      || source.digest !== archive.archiveTreeDigest
    ) {
      fail(
        "wakeflow-migration-plan-transform-owner",
        "legacy archive transform resolution names a stale archive source",
        { errorPath: `$/legacyArchiveTransformResolution/archives/${index}` },
      );
    }
  }
  for (const [index, hold] of resolution.holds.entries()) {
    const source = sources.get(hold.sourceId);
    if (
      !source
      || source.type !== "directory"
      || source.digest !== hold.sourceDigest
    ) {
      fail(
        "wakeflow-migration-plan-transform-owner",
        "legacy archive transform resolution names a stale preservation source",
        { errorPath: `$/legacyArchiveTransformResolution/holds/${index}` },
      );
    }
  }
  return resolution;
}

function configSourceFacts(inventory) {
  return inventory.configSources.map((source) => ({
    baseEvidence: source.baseEvidence,
    blockerCodes: source.blockerCodes,
    intentDigest: source.intentDigest,
    rawDigest: source.rawDigest,
    scope: source.scope,
    sourceId: source.sourceId,
    topologyDigest: source.topologyDigest,
  })).sort((left, right) => compareText(left.sourceId, right.sourceId));
}

// ==================== 四、逐source动作、依赖、coverage与阶段派生 ====================

function canonicalByteDigest(bytes) {
  // canonicalJsonDigest hashes JSON values; target CAS must bind exact bytes.
  return `sha256:${createHash("sha256")
    .update(bytes)
    .digest("hex")}`;
}

function rootDiff(inventory, rootMappings) {
  const byRoot = new Map(rootMappings.map((mapping) => [mapping.rootId, mapping.target]));
  return inventory.roots.map((root) => {
    const target = byRoot.get(root.rootId);
    const manual = root.exists && (
      target.kind === "none"
      || root.blockerCodes.length > 0
    );
    return {
      blockerCodes: root.blockerCodes,
      digest: root.digest,
      disposition: !root.exists ? "absent" : manual ? "manual" : "mapped",
      exists: root.exists,
      location: root.location,
      ownership: root.ownership,
      rootId: root.rootId,
      rootKind: root.rootKind,
      scanMode: root.scanMode,
      sourceCount: root.sourceCount,
      surfaceKind: root.surfaceKind,
      target,
      type: root.type,
    };
  }).sort((left, right) => compareText(left.rootId, right.rootId));
}

function sourceRootDisposition(source, mappingByRoot) {
  const targets = source.rootIds
    .map((rootId) => mappingByRoot.get(rootId)?.target ?? null)
    .filter((target) => target !== null);
  const unique = new Set(targets.map(rootTargetKey));
  if (targets.length === 0 || (unique.size === 1 && targets[0].kind === "none")) {
    return { manualCode: "migration-root-unmapped", target: null };
  }
  if (unique.size > 1) return { manualCode: "migration-source-root-conflict", target: null };
  return { manualCode: null, target: targets[0] };
}

function sourcePhysicalManualCode(source) {
  // Hashed private locations are safe to report but cannot identify an exact
  // CAS target for a later apply. Their owning host must resolve them in the
  // decommission task; this preview never guesses the hidden path.
  if (source.path === null) return "migration-source-private-unlocatable";
  if (!new Set(["file", "directory"]).has(source.type) || source.digest === null) {
    return source.blockerCodes.find((code) => code.startsWith("migration-source-"))
      ?? "migration-source-physical-manual";
  }
  if (!source.classification && source.type === "file") return "migration-source-unrecognized";
  if (source.classification?.confidence === "unknown") return "migration-source-unrecognized";
  if (source.classification?.defaultDisposition?.action === "manual") return "migration-source-manual";
  return source.blockerCodes.find((code) => (
    code === "legacy-old-root-unsupported"
    || PHYSICAL_BLOCKER_PARTS.some((part) => code.includes(part))
  )) ?? null;
}

function sourceNode(source) {
  return {
    digest: source.digest,
    mode: source.mode,
    size: source.size,
    type: source.type,
  };
}

function planClassification(value) {
  if (value === null) return null;
  return {
    ...value,
    blockerCodes: [...new Set(value.blockerCodes)].sort(compareText),
    components: [...value.components].sort((left, right) => compareText(left.selector, right.selector)),
    defaultDisposition: {
      ...value.defaultDisposition,
      prerequisites: [...new Set(value.defaultDisposition.prerequisites)].sort(compareText),
      releaseGates: [...new Set(value.defaultDisposition.releaseGates)].sort(compareText),
    },
    originCandidates: [...new Set(value.originCandidates)].sort(compareText),
    producerRoutes: [...new Set(value.producerRoutes)].sort(compareText),
    typedSlots: [...value.typedSlots].sort((left, right) => compareText(left.id, right.id)),
  };
}

function unitId(sourceId, scope, selector) {
  return canonicalJsonDigest({ sourceId, scope, selector });
}

function sameSourceTarget(source) {
  return {
    digest: source.digest,
    kind: "same-source",
    mode: source.mode,
    sourceId: source.sourceId,
    type: source.type,
  };
}

function configTarget(target) {
  return {
    derivationDigest: target.desiredConfigDerivationDigest,
    digest: target.desiredConfigBytesDigest,
    kind: "managed-file",
    mode: "0644",
    owner: "config-writer",
    ref: "wakeflow.config.json",
    root: { kind: "program", targetId: target.desiredModel.program.programId },
    type: "file",
  };
}

function descendantSourceIds(inventory, rootSourceIds) {
  const covered = new Set(rootSourceIds);
  const queue = [...rootSourceIds];
  const sources = new Map(inventory.sources.map((source) => [source.sourceId, source]));
  for (let index = 0; index < queue.length; index += 1) {
    const source = sources.get(queue[index]);
    if (!source) continue;
    for (const childSourceId of source.childSourceIds) {
      if (covered.has(childSourceId)) continue;
      covered.add(childSourceId);
      queue.push(childSourceId);
    }
  }
  return covered;
}

function legacyArchiveTransformCoverage(inventory, resolution) {
  if (resolution === null) {
    return Object.freeze({ archiveWrapSourceIds: new Set(), auditPreserveSourceIds: new Set() });
  }
  const archiveWrapSourceIds = new Set(resolution.coveredSourceIds);
  const auditPreserveSourceIds = descendantSourceIds(
    inventory,
    resolution.holds.map((hold) => hold.sourceId),
  );
  return Object.freeze({ archiveWrapSourceIds, auditPreserveSourceIds });
}

function legacyArchiveTransformCovers(coverage, sourceId, route) {
  if (route === "archive-wrap") return coverage.archiveWrapSourceIds.has(sourceId);
  if (route === "audit-preserve") return coverage.auditPreserveSourceIds.has(sourceId);
  return false;
}

function legacyArchiveTransformTarget(resolution) {
  return {
    kind: "migration-transform-owner",
    ownerId: resolution.ownerId,
    ownerPlanDigest: resolution.ownerPlanDigest,
    resolutionDigest: resolution.resolutionDigest,
  };
}

/**
 * 将一个非目录source的classifier候选收敛为可执行、保留或人工unit。
 * 物理/config blocker优先于classifier建议；transform缺少精确owner时必须降为manual。
 */
function deriveFileUnits(
  source,
  {
    configFact,
    durableConfigSourceIds,
    legacyArchiveTransform,
    legacyArchiveTransformCoverage: transformCoverage,
    rootDisposition,
    target,
  },
) {
  const classification = source.classification;
  const configManual = source.resource.kind === "config-source"
    ? configFact?.blockerCodes.find((code) => !code.includes("owner-drain")) ?? null
    : null;
  const physicalManual = sourcePhysicalManualCode(source) ?? configManual ?? rootDisposition.manualCode;
  const components = classification?.components ?? [];
  const candidates = components.length === 0
    ? [{
        action: classification?.defaultDisposition?.action ?? "manual",
        rawDigest: source.digest,
        route: classification?.defaultDisposition?.route ?? "manual-owner-choice",
        scope: "whole-source",
        selector: null,
      }]
    : components.map((component) => ({
        action: component.action,
        rawDigest: component.rawDigest,
        route: component.route,
        scope: "component",
        selector: component.selector,
      }));
  return candidates.map((candidate) => {
    // Classifier facts can repeat a gate when several catalog rules converge on
    // the same source. The plan is a set-valued authority contract, so collapse
    // those facts before assigning stable dependency identities.
    const prerequisites = [...new Set(
      classification?.defaultDisposition?.prerequisites ?? [],
    )].sort(compareText);
    const releaseGates = [...new Set(
      classification?.defaultDisposition?.releaseGates ?? [],
    )].sort(compareText);
    let action = candidate.action;
    let route = candidate.route;
    let targetNode = null;
    let reasonCode = "migration-classifier-disposition";
    if (physicalManual !== null) {
      action = "manual";
      route = "manual-owner-choice";
      reasonCode = physicalManual;
    } else if (candidate.action === "keep") {
      targetNode = candidate.scope === "component"
        ? {
            digest: candidate.rawDigest,
            kind: "same-component",
            mode: source.mode,
            selector: candidate.selector,
            sourceId: source.sourceId,
            type: source.type,
          }
        : sameSourceTarget(source);
      reasonCode = "migration-exact-source-kept";
    } else if (candidate.action === "remove") {
      targetNode = { kind: "absent" };
      reasonCode = "migration-exact-source-release-planned";
    } else if (
      candidate.action === "transform"
      && candidate.scope === "whole-source"
      && candidate.route === "schema-map"
      && durableConfigSourceIds.has(source.sourceId)
      && source.resource.kind === "config-source"
    ) {
      targetNode = configTarget(target);
      reasonCode = "migration-v3-config-schema-map";
    } else if (
      candidate.action === "transform"
      && legacyArchiveTransform !== null
      && legacyArchiveTransformCovers(transformCoverage, source.sourceId, candidate.route)
    ) {
      targetNode = legacyArchiveTransformTarget(legacyArchiveTransform);
      reasonCode = "migration-legacy-archive-transform-owner-resolved";
    } else if (candidate.action === "transform") {
      action = "manual";
      route = "manual-owner-choice";
      reasonCode = "migration-target-owner-unresolved";
    } else {
      action = "manual";
      route = "manual-owner-choice";
      reasonCode = "migration-source-manual";
    }
    return {
      action,
      prerequisites,
      reasonCode,
      releaseGates,
      route,
      scope: candidate.scope,
      selector: candidate.selector,
      sourceDigest: candidate.rawDigest,
      suggestedAction: candidate.action,
      suggestedRoute: candidate.route,
      target: targetNode,
      unitId: unitId(source.sourceId, candidate.scope, candidate.selector),
    };
  }).sort((left, right) => compareText(left.unitId, right.unitId));
}

function sourceWorkspaceRefs(source, rootsById) {
  if (source.path === null) return [];
  const result = new Set();
  for (const rootId of source.rootIds) {
    const rootPath = rootsById.get(rootId)?.location?.path;
    if (typeof rootPath !== "string") continue;
    let candidate;
    if (source.path === ".") candidate = rootPath;
    else if (source.path === rootPath || source.path.startsWith(`${rootPath}/`)) candidate = source.path;
    else candidate = path.posix.join(rootPath, source.path);
    const normalized = path.posix.normalize(candidate);
    if (normalized && normalized !== ".") result.add(normalized);
  }
  return [...result].sort(compareText);
}

function sourceDepth(source, sourceById, cache = new Map()) {
  if (cache.has(source.sourceId)) return cache.get(source.sourceId);
  const chain = [];
  let cursor = source;
  while (cursor !== null && !cache.has(cursor.sourceId)) {
    chain.push(cursor);
    cursor = cursor.parentSourceId === null ? null : sourceById.get(cursor.parentSourceId) ?? null;
  }
  let depth = cursor === null ? -1 : cache.get(cursor.sourceId);
  while (chain.length > 0) {
    depth += 1;
    cache.set(chain.pop().sourceId, depth);
  }
  return cache.get(source.sourceId);
}

function directoryUnit(source, action, route, reasonCode) {
  return {
    action,
    prerequisites: action === "remove" ? ["child-source-release-closure"] : [],
    reasonCode,
    releaseGates: action === "remove" ? ["exact-source-cas"] : [],
    route,
    scope: "directory",
    selector: null,
    sourceDigest: source.digest,
    suggestedAction: action,
    suggestedRoute: route,
    target: action === "keep"
      ? sameSourceTarget(source)
      : action === "remove"
        ? { kind: "absent" }
        : null,
    unitId: unitId(source.sourceId, "directory", null),
  };
}

/**
 * 自底向上派生整棵source树：文件先决策，目录只根据真实target目录和child闭包汇总。
 * root mapping本身不是keep证明，也不会把未覆盖child隐式纳入递归动作。
 */
function deriveSources(inventory, rootMappings, target, legacyArchiveTransform) {
  const mappings = new Map(rootMappings.map((entry) => [entry.rootId, entry]));
  const rootsById = new Map(inventory.roots.map((root) => [root.rootId, root]));
  const sourceById = new Map(inventory.sources.map((source) => [source.sourceId, source]));
  const configFactsBySourceId = new Map(inventory.configSources.map((entry) => [entry.sourceId, entry]));
  const durableConfigSourceIds = new Set(inventory.configSources
    .filter((entry) => (
      entry.scope === "durable"
      && entry.rawDigest !== null
      && entry.intentDigest !== null
      && entry.topologyDigest !== null
      && entry.blockerCodes.length === 0
    ))
    .map((entry) => entry.sourceId));
  const targetDirectories = new Set(target.layoutEntries
    .filter((entry) => entry.pathKind === "directory")
    .map((entry) => path.posix.normalize(entry.path)));
  const transformCoverage = legacyArchiveTransformCoverage(
    inventory,
    legacyArchiveTransform,
  );
  const derived = new Map();

  for (const source of inventory.sources.filter((entry) => entry.type !== "directory")) {
    const rootDisposition = sourceRootDisposition(source, mappings);
    const units = deriveFileUnits(source, {
      configFact: configFactsBySourceId.get(source.sourceId) ?? null,
      durableConfigSourceIds,
      legacyArchiveTransform,
      legacyArchiveTransformCoverage: transformCoverage,
      rootDisposition,
      target,
    });
    derived.set(source.sourceId, {
      releasable: units.every((unit) => (
        unit.action === "remove"
        && source.blockerCodes.length === 0
      )),
      units,
    });
  }

  const depthCache = new Map();
  const directories = inventory.sources.filter((entry) => entry.type === "directory")
    .sort((left, right) => (
      sourceDepth(right, sourceById, depthCache) - sourceDepth(left, sourceById, depthCache)
      || compareText(left.sourceId, right.sourceId)
    ));
  for (const source of directories) {
    const rootDisposition = sourceRootDisposition(source, mappings);
    const physicalManual = sourcePhysicalManualCode(source) ?? rootDisposition.manualCode;
    const children = source.childSourceIds.map((childId) => derived.get(childId)).filter(Boolean);
    const protectedTarget = sourceWorkspaceRefs(source, rootsById).some((ref) => targetDirectories.has(ref));
    let unit;
    if (physicalManual !== null) {
      unit = directoryUnit(source, "manual", "manual-owner-choice", physicalManual);
    } else if (protectedTarget) {
      unit = directoryUnit(source, "keep", "keep", "migration-target-directory-retained");
    } else if (children.length === 0) {
      unit = directoryUnit(source, "manual", "manual-owner-choice", "migration-empty-directory-owner-unresolved");
    } else if (children.every((child) => child.releasable)) {
      unit = directoryUnit(source, "remove", "remove-exact", "migration-child-release-closure-planned");
    } else if (children.some((child) => child.units.some((entry) => entry.action === "manual"))) {
      unit = directoryUnit(source, "manual", "manual-owner-choice", "migration-child-release-unresolved");
    } else {
      unit = directoryUnit(source, "keep", "keep", "migration-child-target-retained");
    }
    derived.set(source.sourceId, {
      releasable: unit.action === "remove" && source.blockerCodes.length === 0,
      units: [unit],
    });
  }

  return inventory.sources.map((source) => ({
    blockerCodes: source.blockerCodes,
    childSourceIds: source.childSourceIds,
    classification: planClassification(source.classification),
    consumers: source.consumers,
    owner: source.owner,
    parentSourceId: source.parentSourceId,
    path: source.path,
    pathDigest: source.pathDigest,
    privacy: source.privacy,
    resource: source.resource,
    rootIds: source.rootIds,
    source: sourceNode(source),
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    sourceVersion: source.sourceVersion,
    surfaceKind: source.surfaceKind,
    units: derived.get(source.sourceId)?.units ?? [directoryUnit(
      source,
      "manual",
      "manual-owner-choice",
      "migration-source-unresolved",
    )],
  })).sort((left, right) => compareText(left.sourceId, right.sourceId));
}

function dependencyKind(code) {
  if (code.includes("host-decommission")) return "host-decommission";
  if (code.includes("owner-drain") || code.includes("legacy-owner-drain")) return "owner-drain";
  if (code.includes("correlation")) return "domain-correlation";
  return "owner-prerequisite";
}

function legacyArchiveTransformUnit(unit) {
  return unit.action === "transform"
    && unit.target?.kind === "migration-transform-owner"
    && unit.target.ownerId === LEGACY_ARCHIVE_TRANSFORM_OWNER_ID
    ? unit
    : null;
}

function legacyArchiveTransformPrerequisiteSatisfied(code, unit) {
  const resolved = legacyArchiveTransformUnit(unit);
  return resolved !== null
    && LEGACY_ARCHIVE_TRANSFORM_PREREQUISITES[resolved.route]?.has(code) === true;
}

function legacyArchiveTransformSourceEvidence(source, code) {
  if (!LEGACY_ARCHIVE_TRANSFORM_SOURCE_BLOCKERS.has(code)) return null;
  const resolved = source.units.map(legacyArchiveTransformUnit).find((unit) => unit !== null);
  return resolved?.target.resolutionDigest ?? null;
}

/** 只有全部durable及其local overlay形成完整、无冲突source-set时才满足配置关联。 */
function durableConfigCorrelationSatisfied(inventory) {
  const durable = inventory.configSources.filter((entry) => entry.scope === "durable");
  if (durable.length === 0 || !durable.every((entry) => (
    entry.rawDigest !== null
    && entry.intentDigest !== null
    && entry.topologyDigest !== null
    && entry.blockerCodes.length === 0
  ))) return false;
  return inventory.configSources
    .filter((entry) => entry.scope === "local-overlay")
    .every((entry) => (
      entry.rawDigest !== null
      && entry.intentDigest !== null
      && entry.topologyDigest !== null
      && entry.baseEvidence === "matched-durable-source"
      && entry.blockerCodes.every((code) => code.includes("owner-drain"))
    ));
}

/** 将unit prerequisite、release gate与owner/host follow-up分别冻结为可追踪依赖。 */
function deriveDependencies(sources, inventory, ownerDrain) {
  const groups = new Map();
  const add = ({ phase, code, sourceId, unitId, status, evidenceDigest }) => {
    const key = `${phase}:${code}:${status}:${evidenceDigest ?? ""}`;
    const group = groups.get(key) ?? {
      code,
      evidenceDigest,
      kind: phase === "release-gate" ? "release-gate" : dependencyKind(code),
      phase,
      sourceIds: new Set(),
      status,
      unitIds: new Set(),
    };
    if (sourceId !== null) group.sourceIds.add(sourceId);
    if (unitId !== null) group.unitIds.add(unitId);
    groups.set(key, group);
  };
  for (const source of sources) {
    for (const unit of source.units) {
      for (const code of unit.prerequisites) {
        const internallySatisfied = code === "config-source-set-correlation"
          && durableConfigCorrelationSatisfied(inventory);
        const ownerDrainSatisfied = dependencyKind(code) === "owner-drain"
          && ownerDrain?.summary.ownerDrainSatisfied === true;
        const transformOwnerSatisfied = legacyArchiveTransformPrerequisiteSatisfied(code, unit);
        add({
          phase: "precondition",
          code,
          sourceId: source.sourceId,
          unitId: unit.unitId,
          status: internallySatisfied || ownerDrainSatisfied || transformOwnerSatisfied
            ? "satisfied"
            : "required",
          evidenceDigest: internallySatisfied
            ? inventory.inventoryDigest
            : ownerDrainSatisfied
              ? ownerDrain.assessmentDigest
              : transformOwnerSatisfied
                ? unit.target.resolutionDigest
                : null,
        });
      }
      for (const code of unit.releaseGates) {
        add({
          phase: "release-gate",
          code,
          sourceId: source.sourceId,
          unitId: unit.unitId,
          status: "planned",
          evidenceDigest: null,
        });
      }
    }
    for (const code of source.blockerCodes.filter((entry) => DOMAIN_DEPENDENCY_RE.test(entry))) {
      const ownerDrainSatisfied = dependencyKind(code) === "owner-drain"
        && ownerDrain?.summary.ownerDrainSatisfied === true;
      const transformOwnerEvidence = legacyArchiveTransformSourceEvidence(source, code);
      add({
        phase: "precondition",
        code,
        sourceId: source.sourceId,
        unitId: null,
        status: ownerDrainSatisfied || transformOwnerEvidence !== null ? "satisfied" : "required",
        evidenceDigest: ownerDrainSatisfied
          ? ownerDrain.assessmentDigest
          : transformOwnerEvidence,
      });
    }
  }
  for (const domain of ownerDrain?.domains.filter((entry) => entry.status === "drained-with-host-followup") ?? []) {
    const coveredSourceIds = domain.sourceIds.filter((sourceId) => sources.some((source) => source.sourceId === sourceId));
    if (coveredSourceIds.length === 0) {
      add({
        phase: "precondition",
        code: "migration-host-decommission-resource-proof-required",
        sourceId: null,
        unitId: null,
        status: "required",
        evidenceDigest: null,
      });
    } else {
      for (const sourceId of coveredSourceIds) {
        add({
          phase: "precondition",
          code: "migration-host-decommission-resource-proof-required",
          sourceId,
          unitId: null,
          status: "required",
          evidenceDigest: null,
        });
      }
    }
  }
  return [...groups.values()].map((group) => {
    const sourceIds = [...group.sourceIds].sort(compareText);
    const unitIds = [...group.unitIds].sort(compareText);
    const unsigned = {
      code: group.code,
      evidenceDigest: group.evidenceDigest,
      kind: group.kind,
      phase: group.phase,
      sourceIds,
      status: group.status,
      unitIds,
    };
    return { dependencyId: canonicalJsonDigest(unsigned), ...unsigned };
  }).sort((left, right) => compareText(left.dependencyId, right.dependencyId));
}

function inferHostId(source) {
  const value = `${source.sourceKind ?? ""}:${source.path ?? ""}`.toLowerCase();
  if (value.includes("claude")) return "claude-code";
  if (value.includes("codex")) return "codex";
  return "unknown";
}

function deriveDecommissionCoverage(sources) {
  const groups = new Map();
  for (const source of sources.filter((entry) => (
    entry.blockerCodes.some((code) => code.includes("host-decommission"))
  ))) {
    const hostId = inferHostId(source);
    const sourceIds = groups.get(hostId) ?? [];
    sourceIds.push(source.sourceId);
    groups.set(hostId, sourceIds);
  }
  return [...groups].map(([hostId, values]) => {
    const sourceIds = [...new Set(values)].sort(compareText);
    const unsigned = {
      evidenceDigest: null,
      hostId,
      sourceIds,
      status: "required",
    };
    return { coverageId: canonicalJsonDigest(unsigned), ...unsigned };
  }).sort((left, right) => compareText(left.coverageId, right.coverageId));
}

function phaseFor(unit) {
  if (unit.action === "remove") return "exact-source-release";
  if (unit.action !== "transform") return null;
  if (unit.route === "archive-wrap" || unit.route === "audit-preserve") return "archive-or-preservation";
  if (unit.route === "managed-merge") return "managed-surfaces";
  if (unit.route === "rebuild-derived") return "derived-projections";
  return "target-authority";
}

function deriveCommitPhases(sources) {
  const byPhase = new Map(PHASES.map((phase) => [phase, []]));
  for (const source of sources) {
    for (const unit of source.units) {
      const phase = phaseFor(unit);
      if (phase !== null) byPhase.get(phase).push(unit.unitId);
    }
  }
  return PHASES.map((phase, ordinal) => ({
    ordinal,
    phase,
    unitIds: [...new Set(byPhase.get(phase))].sort(compareText),
  }));
}

/** 聚合事实、人工unit与未满足依赖；已由精确owner证实的临时blocker不会重复阻塞。 */
function deriveBlockers({ artifacts, inventory, roots, sources, dependencies, ownerDrain }) {
  const entries = [];
  const transformResolvedSourceIds = new Set(sources
    .filter((source) => source.units.some((unit) => legacyArchiveTransformUnit(unit) !== null))
    .map((source) => source.sourceId));
  const add = (value) => {
    const unsigned = {
      code: value.code,
      dependencyId: value.dependencyId ?? null,
      rootId: value.rootId ?? null,
      sourceId: value.sourceId ?? null,
      unitId: value.unitId ?? null,
    };
    entries.push({ blockerId: canonicalJsonDigest(unsigned), ...unsigned });
  };
  if (artifacts.legacyOwnerArtifact === null) add({ code: "migration-legacy-owner-required" });
  for (const blocker of inventory.blockers) {
    // T04 reports facts without executing an owner. Once T06 has independently
    // proved that exact owner domain closed, retain the source fact in the
    // inventory and dependency evidence but do not keep its provisional drain
    // blocker active. Physical/manual blockers and host follow-up remain.
    if (
      dependencyKind(blocker.code) === "owner-drain"
      && ownerDrain?.summary.ownerDrainSatisfied === true
    ) continue;
    const unresolvedSourceIds = LEGACY_ARCHIVE_TRANSFORM_SOURCE_BLOCKERS.has(blocker.code)
      ? blocker.sourceIds.filter((sourceId) => !transformResolvedSourceIds.has(sourceId))
      : blocker.sourceIds;
    if (blocker.sourceIds.length > 0 && unresolvedSourceIds.length === 0) continue;
    add({
      code: blocker.code,
      sourceId: unresolvedSourceIds.length === 1 ? unresolvedSourceIds[0] : null,
      rootId: blocker.rootIds.length === 1 ? blocker.rootIds[0] : null,
    });
  }
  for (const root of roots.filter((entry) => entry.disposition === "manual")) {
    add({ code: root.blockerCodes[0] ?? "migration-root-manual", rootId: root.rootId });
  }
  for (const source of sources) {
    for (const unit of source.units.filter((entry) => entry.action === "manual")) {
      add({ code: unit.reasonCode, sourceId: source.sourceId, unitId: unit.unitId });
    }
  }
  for (const dependency of dependencies.filter((entry) => entry.status === "required")) {
    add({ code: dependency.code, dependencyId: dependency.dependencyId });
  }
  for (const domain of ownerDrain?.domains ?? []) {
    for (const code of domain.blockerCodes) {
      add({
        code,
        sourceId: domain.sourceIds.length === 1 ? domain.sourceIds[0] : null,
      });
    }
  }
  const unique = new Map(entries.map((entry) => [entry.blockerId, entry]));
  return [...unique.values()].sort((left, right) => compareText(left.blockerId, right.blockerId));
}

/**
 * 在同一workspace inventory前后快照之间编译T05计划，全程零写入。
 * 第二次inventory若漂移则整体失败，避免返回跨时刻拼接的preview。
 */
function buildPlan(input) {
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const artifacts = normalizeArtifactContext(input.artifactContext);
  let model;
  try {
    model = parseWakeflowConfigV3(canonicalClone(input.desiredModel, "desiredModel"));
  } catch (cause) {
    fail("wakeflow-migration-plan-target", "desiredModel is not a strict v3 config", { errorPath: "$/desiredModel", cause });
  }
  const firstInventory = inspectWakeflowMigrationInventory({ workspaceRoot });
  const ownerDrain = artifacts.legacyOwnerArtifact === null
    ? null
    : inspectWakeflowLegacyOwnerDrain({
        legacyOwnerArtifact: artifacts.legacyOwnerArtifact,
        workspaceRoot,
      });
  if (ownerDrain !== null && ownerDrain.inventory.inventoryDigest !== firstInventory.inventoryDigest) {
    fail("wakeflow-migration-plan-stale", "owner-drain evidence differs from the selected workspace inventory");
  }
  const identityMappings = normalizeIdentityMappings(input.identityMappings, firstInventory, model);
  const rootMappings = normalizeRootMappings(input.rootMappings, firstInventory, model);
  const target = targetSnapshot(model, input.hostProfile);
  const legacyArchiveTransform = assertLegacyArchiveTransformResolutionContext(
    normalizeLegacyArchiveTransformOwnerResolution(input.legacyArchiveTransformResolution),
    {
      artifacts,
      inventory: firstInventory,
      ownerDrain,
      target,
    },
  );
  const roots = rootDiff(firstInventory, rootMappings);
  const sources = deriveSources(
    firstInventory,
    rootMappings,
    target,
    legacyArchiveTransform,
  );
  const dependencies = deriveDependencies(sources, firstInventory, ownerDrain);
  const decommissionCoverage = deriveDecommissionCoverage(sources);
  const blockers = deriveBlockers({ artifacts, inventory: firstInventory, roots, sources, dependencies, ownerDrain });
  const commitPhases = deriveCommitPhases(sources);
  const recoveryPhases = commitPhases.map((entry) => ({ ...entry, strategy: "resume-forward" }));
  const secondInventory = inspectWakeflowMigrationInventory({ workspaceRoot });
  if (secondInventory.inventoryDigest !== firstInventory.inventoryDigest) {
    fail("wakeflow-migration-plan-stale", "workspace inventory changed while preview was derived");
  }
  const payload = {
    action: LOGICAL_ACTION,
    artifacts: {
      bootstrapArtifactDigest: artifacts.bootstrapArtifact.artifactDigest,
      legacyOwnerArtifactDigest: artifacts.legacyOwnerArtifact?.artifactDigest ?? null,
    },
    blockers,
    commitPhases,
    decommissionCoverage,
    dependencies,
    identityMappings,
    inventory: {
      configSources: configSourceFacts(firstInventory),
      inventoryDigest: firstInventory.inventoryDigest,
      rootCount: firstInventory.roots.length,
      sourceCount: firstInventory.sources.length,
    },
    kind: WAKEFLOW_MIGRATION_PLAN_KIND,
    legacyArchiveTransform,
    ownerDrain,
    recoveryPhases,
    rootDiff: roots,
    rootMappings,
    schemaVersion: WAKEFLOW_MIGRATION_PLAN_SCHEMA_VERSION,
    sources,
    status: blockers.length === 0 ? "ready" : "blocked",
    target,
  };
  const unsigned = { schemaId: SCHEMA_ID, payload };
  return { ...unsigned, planDigest: canonicalJsonDigest(unsigned) };
}

// ==================== 五、完整plan重验与防重签篡改 ====================

/** 重新编译host/layout目标并逐字比较；digest格式正确本身不能证明target真实闭合。 */
function validateTarget(value) {
  exactObject(value, [
    "desiredModel",
    "desiredModelDigest",
    "desiredConfigBytesDigest",
    "desiredConfigDerivationDigest",
    "hostId",
    "hostProfile",
    "hostProfileDigest",
    "layoutDigest",
    "layoutEntries",
  ], "$/payload/target");
  let model;
  try {
    model = parseWakeflowConfigV3(value.desiredModel);
  } catch (cause) {
    fail("wakeflow-migration-plan-target", "target desiredModel is invalid", {
      errorPath: "$/payload/target/desiredModel",
      cause,
    });
  }
  if (
    wakeflowConfigV3Digest(model) !== digest(value.desiredModelDigest, "$/payload/target/desiredModelDigest")
    || canonicalByteDigest(Buffer.from(serializeWakeflowConfigV3(model), "utf8"))
      !== digest(value.desiredConfigBytesDigest, "$/payload/target/desiredConfigBytesDigest")
    || canonicalJsonDigest({ owner: "config-writer", desiredModel: model })
      !== digest(value.desiredConfigDerivationDigest, "$/payload/target/desiredConfigDerivationDigest")
  ) fail("wakeflow-migration-plan-target", "target config digests differ from desiredModel", { errorPath: "$/payload/target" });
  for (const field of ["hostProfileDigest", "layoutDigest"]) digest(value[field], `$/payload/target/${field}`);
  text(value.hostId, "$/payload/target/hostId");
  const layoutEntries = denseArray(value.layoutEntries, "$/payload/target/layoutEntries");
  canonicalOrder(layoutEntries, (entry) => entry.key, "$/payload/target/layoutEntries", "wakeflow-migration-plan-target");
  for (const [index, entry] of layoutEntries.entries()) {
    const at = `$/payload/target/layoutEntries/${index}`;
    exactObject(entry, ["authority", "createTiming", "key", "owner", "path", "pathKind"], at);
    for (const field of ["authority", "createTiming", "key", "owner"]) text(entry[field], `${at}/${field}`);
    portableLayoutPath(entry.path, `${at}/path`);
    if (!new Set(["directory", "file", "pattern"]).has(entry.pathKind)) {
      fail("wakeflow-migration-plan-target", "layout entry pathKind is invalid", { errorPath: `${at}/pathKind` });
    }
  }
  const expected = targetSnapshot(model, value.hostProfile);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail(
      "wakeflow-migration-plan-target",
      "target host profile, layout descriptor, and projected entries are not one recomputable snapshot",
      { errorPath: "$/payload/target" },
    );
  }
  return model;
}

function validateClassification(value, source, errorPath) {
  if (value === null) return;
  exactObject(value, [
    "artifact",
    "blockerCodes",
    "canonicalClassifierDigest",
    "components",
    "confidence",
    "defaultDisposition",
    "lifecycleConclusion",
    "originCandidates",
    "producerRoutes",
    "rawDigest",
    "typedSlots",
  ], errorPath);
  exactObject(value.artifact, ["format", "kind", "schema"], `${errorPath}/artifact`);
  text(value.artifact.format, `${errorPath}/artifact/format`);
  text(value.artifact.kind, `${errorPath}/artifact/kind`);
  nullableText(value.artifact.schema, `${errorPath}/artifact/schema`);
  nullableDigest(value.canonicalClassifierDigest, `${errorPath}/canonicalClassifierDigest`);
  digest(value.rawDigest, `${errorPath}/rawDigest`);
  if (value.rawDigest !== source.source.digest) {
    fail("wakeflow-migration-plan-source", "classification digest differs from the exact source node", { errorPath: `${errorPath}/rawDigest` });
  }
  if (!new Set(["component-known", "exact-known", "typed-known", "unknown"]).has(value.confidence)) {
    fail("wakeflow-migration-plan-source", "classification confidence is invalid", { errorPath: `${errorPath}/confidence` });
  }
  if (value.lifecycleConclusion !== "unresolved") {
    fail("wakeflow-migration-plan-source", "classifier facts cannot claim a lifecycle conclusion", { errorPath: `${errorPath}/lifecycleConclusion` });
  }
  for (const field of ["blockerCodes", "originCandidates", "producerRoutes"]) {
    const entries = denseArray(value[field], `${errorPath}/${field}`)
      .map((entry, index) => text(entry, `${errorPath}/${field}/${index}`));
    canonicalOrder(entries, (entry) => entry, `${errorPath}/${field}`, "wakeflow-migration-plan-source");
  }
  exactObject(value.defaultDisposition, ["action", "prerequisites", "releaseGates", "route"], `${errorPath}/defaultDisposition`);
  if (!ACTION_SET.has(value.defaultDisposition.action)) {
    fail("wakeflow-migration-plan-source", "classifier disposition action is invalid", { errorPath: `${errorPath}/defaultDisposition/action` });
  }
  text(value.defaultDisposition.route, `${errorPath}/defaultDisposition/route`);
  for (const field of ["prerequisites", "releaseGates"]) {
    const entries = denseArray(value.defaultDisposition[field], `${errorPath}/defaultDisposition/${field}`)
      .map((entry, index) => text(entry, `${errorPath}/defaultDisposition/${field}/${index}`));
    // Historical catalogs can converge on the same gate more than once. The
    // plan unit normalizes those facts, but the source evidence remains exact.
    const normalized = [...new Set(entries)].sort(compareText);
    const unitValues = source.units.flatMap((unit) => unit[field]);
    if (normalized.some((entry) => !unitValues.includes(entry))) {
      fail("wakeflow-migration-plan-source", "source unit omitted a classifier dependency", { errorPath: `${errorPath}/defaultDisposition/${field}` });
    }
  }
  const components = denseArray(value.components, `${errorPath}/components`);
  canonicalOrder(components, (entry) => entry.selector, `${errorPath}/components`, "wakeflow-migration-plan-source");
  for (const [index, component] of components.entries()) {
    const at = `${errorPath}/components/${index}`;
    exactObject(component, ["action", "canonicalClassifierDigest", "componentKind", "rawDigest", "route", "selector"], at);
    if (!ACTION_SET.has(component.action)) fail("wakeflow-migration-plan-source", "component action is invalid", { errorPath: `${at}/action` });
    nullableDigest(component.canonicalClassifierDigest, `${at}/canonicalClassifierDigest`);
    digest(component.rawDigest, `${at}/rawDigest`);
    text(component.componentKind, `${at}/componentKind`);
    text(component.route, `${at}/route`);
    text(component.selector, `${at}/selector`);
  }
  const slots = denseArray(value.typedSlots, `${errorPath}/typedSlots`);
  canonicalOrder(slots, (entry) => entry.id, `${errorPath}/typedSlots`, "wakeflow-migration-plan-source");
  for (const [index, slot] of slots.entries()) {
    const at = `${errorPath}/typedSlots/${index}`;
    exactObject(slot, ["id", "sensitivity", "type", "valueDigest"], at);
    text(slot.id, `${at}/id`);
    text(slot.sensitivity, `${at}/sensitivity`);
    text(slot.type, `${at}/type`);
    digest(slot.valueDigest, `${at}/valueDigest`);
  }
  if (value.confidence === "unknown") {
    if (
      value.artifact.kind !== "unknown"
      || value.artifact.schema !== null
      || value.canonicalClassifierDigest !== null
      || components.length !== 0
      || slots.length !== 0
      || value.defaultDisposition.action !== "manual"
      || value.defaultDisposition.route !== "manual-owner-choice"
      || value.defaultDisposition.prerequisites.length !== 0
      || value.defaultDisposition.releaseGates.length !== 0
    ) fail("wakeflow-migration-plan-source", "unknown classifier evidence is not fail-closed", { errorPath });
  } else if (value.confidence === "component-known") {
    if (components.length === 0) {
      fail("wakeflow-migration-plan-source", "component-known classifier evidence needs a component partition", { errorPath: `${errorPath}/components` });
    }
  } else if (components.length !== 0 || value.canonicalClassifierDigest === null) {
    fail("wakeflow-migration-plan-source", "whole-source classifier evidence has an invalid component/digest tuple", { errorPath });
  }
}

function validateUnit(unit, source, legacyArchiveTransform, errorPath) {
  exactObject(unit, [
    "action",
    "prerequisites",
    "reasonCode",
    "releaseGates",
    "route",
    "scope",
    "selector",
    "sourceDigest",
    "suggestedAction",
    "suggestedRoute",
    "target",
    "unitId",
  ], errorPath);
  if (!ACTION_SET.has(unit.action) || !ACTION_SET.has(unit.suggestedAction)) {
    fail("wakeflow-migration-plan-action", "source unit action is unsupported", { errorPath: `${errorPath}/action` });
  }
  digest(unit.unitId, `${errorPath}/unitId`);
  nullableDigest(unit.sourceDigest, `${errorPath}/sourceDigest`);
  text(unit.route, `${errorPath}/route`);
  text(unit.suggestedRoute, `${errorPath}/suggestedRoute`);
  text(unit.reasonCode, `${errorPath}/reasonCode`);
  if (!new Set(["whole-source", "component", "directory"]).has(unit.scope)) {
    fail("wakeflow-migration-plan-action", "source unit scope is unsupported", { errorPath: `${errorPath}/scope` });
  }
  if ((unit.scope === "component") !== (unit.selector !== null)) {
    fail("wakeflow-migration-plan-action", "component selector differs from unit scope", { errorPath });
  }
  if (unit.selector !== null) text(unit.selector, `${errorPath}/selector`);
  for (const [field, values] of [["prerequisites", unit.prerequisites], ["releaseGates", unit.releaseGates]]) {
    const entries = denseArray(values, `${errorPath}/${field}`).map((entry, index) => text(entry, `${errorPath}/${field}/${index}`));
    canonicalOrder(entries, (entry) => entry, `${errorPath}/${field}`, "wakeflow-migration-plan-action");
  }
  const expectedId = unitId(source.sourceId, unit.scope, unit.selector);
  if (unit.unitId !== expectedId) fail("wakeflow-migration-plan-action", "source unit identity is stale", { errorPath: `${errorPath}/unitId` });
  if (unit.action === "manual") {
    if (unit.target !== null) fail("wakeflow-migration-plan-target", "manual source unit cannot claim a target", { errorPath: `${errorPath}/target` });
    return;
  }
  if (!plainObject(unit.target)) fail("wakeflow-migration-plan-target", "non-manual source unit requires a target", { errorPath: `${errorPath}/target` });
  if (unit.action === "remove") {
    exactObject(unit.target, ["kind"], `${errorPath}/target`);
    if (unit.target.kind !== "absent") fail("wakeflow-migration-plan-target", "remove target must be absent", { errorPath: `${errorPath}/target` });
  } else if (unit.action === "keep") {
    if (!new Set(["same-source", "same-component"]).has(unit.target.kind)) {
      fail("wakeflow-migration-plan-target", "keep target must preserve exact source bytes", { errorPath: `${errorPath}/target` });
    }
    if (unit.target.sourceId !== source.sourceId) fail("wakeflow-migration-plan-target", "keep target refers to another source", { errorPath: `${errorPath}/target/sourceId` });
    if (unit.target.kind === "same-source") {
      exactObject(unit.target, ["digest", "kind", "mode", "sourceId", "type"], `${errorPath}/target`);
      if (
        unit.target.digest !== source.source.digest
        || unit.target.mode !== source.source.mode
        || unit.target.type !== source.source.type
        || unit.sourceDigest !== source.source.digest
      ) fail("wakeflow-migration-plan-target", "keep target differs from exact source node", { errorPath: `${errorPath}/target` });
    } else {
      exactObject(unit.target, ["digest", "kind", "mode", "selector", "sourceId", "type"], `${errorPath}/target`);
      if (
        unit.target.digest !== unit.sourceDigest
        || unit.target.mode !== source.source.mode
        || unit.target.selector !== unit.selector
        || unit.target.type !== source.source.type
      ) fail("wakeflow-migration-plan-target", "component keep target differs from exact component evidence", { errorPath: `${errorPath}/target` });
    }
  } else if (unit.target.kind === "migration-transform-owner") {
    exactObject(unit.target, [
      "kind",
      "ownerId",
      "ownerPlanDigest",
      "resolutionDigest",
    ], `${errorPath}/target`);
    if (
      legacyArchiveTransform === null
      || unit.suggestedAction !== "transform"
      || !new Set(["archive-wrap", "audit-preserve"]).has(unit.route)
      || unit.target.ownerId !== legacyArchiveTransform.ownerId
      || unit.target.ownerPlanDigest !== legacyArchiveTransform.ownerPlanDigest
      || unit.target.resolutionDigest !== legacyArchiveTransform.resolutionDigest
    ) {
      fail(
        "wakeflow-migration-plan-target",
        "migration transform target differs from the exact legacy archive owner resolution",
        { errorPath: `${errorPath}/target` },
      );
    }
  } else {
    exactObject(unit.target, [
      "derivationDigest",
      "digest",
      "kind",
      "mode",
      "owner",
      "ref",
      "root",
      "type",
    ], `${errorPath}/target`);
    if (unit.target.kind !== "managed-file" || unit.target.type !== "file") {
      fail("wakeflow-migration-plan-target", "transform target must be one resolved managed file", { errorPath: `${errorPath}/target/kind` });
    }
    for (const field of ["digest", "derivationDigest"]) digest(unit.target[field], `${errorPath}/target/${field}`);
    if (typeof unit.target.mode !== "string" || !MODE_RE.test(unit.target.mode)) {
      fail("wakeflow-migration-plan-target", "managed target mode is invalid", { errorPath: `${errorPath}/target/mode` });
    }
    text(unit.target.owner, `${errorPath}/target/owner`);
    portableRef(unit.target.ref, `${errorPath}/target/ref`, "wakeflow-migration-plan-target");
    exactObject(unit.target.root, ["kind", "targetId"], `${errorPath}/target/root`);
    text(unit.target.root.kind, `${errorPath}/target/root/kind`);
    if (unit.target.root.targetId !== null) text(unit.target.root.targetId, `${errorPath}/target/root/targetId`);
  }
}

function validateSources(values, inventory, legacyArchiveTransform) {
  const sources = denseArray(values, "$/payload/sources");
  canonicalOrder(sources, (source) => source.sourceId, "$/payload/sources", "wakeflow-migration-plan-source");
  const byId = new Map();
  for (const [index, source] of sources.entries()) {
    const at = `$/payload/sources/${index}`;
    exactObject(source, [
      "blockerCodes",
      "childSourceIds",
      "classification",
      "consumers",
      "owner",
      "parentSourceId",
      "path",
      "pathDigest",
      "privacy",
      "resource",
      "rootIds",
      "source",
      "sourceId",
      "sourceKind",
      "sourceVersion",
      "surfaceKind",
      "units",
    ], at);
    digest(source.sourceId, `${at}/sourceId`);
    if (byId.has(source.sourceId)) fail("wakeflow-migration-plan-source", "duplicate sourceId", { errorPath: `${at}/sourceId` });
    byId.set(source.sourceId, source);
    if (source.parentSourceId !== null) digest(source.parentSourceId, `${at}/parentSourceId`);
    const normalizedLists = {};
    for (const field of ["childSourceIds", "rootIds", "blockerCodes", "consumers"]) {
      const entries = denseArray(source[field], `${at}/${field}`)
        .map((entry, entryIndex) => field === "childSourceIds" || field === "rootIds"
          ? digest(entry, `${at}/${field}/${entryIndex}`)
          : text(entry, `${at}/${field}/${entryIndex}`));
      canonicalOrder(entries, (entry) => entry, `${at}/${field}`, "wakeflow-migration-plan-source");
      normalizedLists[field] = entries;
    }
    exactObject(source.source, ["digest", "mode", "size", "type"], `${at}/source`);
    nullableDigest(source.source.digest, `${at}/source/digest`);
    if (source.source.mode !== null && (typeof source.source.mode !== "string" || !MODE_RE.test(source.source.mode))) {
      fail("wakeflow-migration-plan-source", "source mode is invalid", { errorPath: `${at}/source/mode` });
    }
    if (!SOURCE_TYPES.has(source.source.type)) {
      fail("wakeflow-migration-plan-source", "source type is invalid", { errorPath: `${at}/source/type` });
    }
    if (source.source.type === "unreadable") {
      if (source.source.digest !== null || source.source.mode !== null || source.source.size !== null) {
        fail("wakeflow-migration-plan-source", "unreadable source facts must remain an exact null tuple", { errorPath: `${at}/source` });
      }
    } else if (!Number.isSafeInteger(source.source.size) || source.source.size < 0) {
      fail("wakeflow-migration-plan-source", "source size is invalid", { errorPath: `${at}/source/size` });
    }
    nullableText(source.path, `${at}/path`);
    nullableDigest(source.pathDigest, `${at}/pathDigest`);
    if (source.path !== null) portableRef(source.path, `${at}/path`, "wakeflow-migration-plan-source");
    if ((source.path === null) !== (source.pathDigest !== null)) {
      fail("wakeflow-migration-plan-source", "source path privacy tuple is inconsistent", { errorPath: `${at}/path` });
    }
    if (normalizedLists.rootIds.length === 0) {
      fail("wakeflow-migration-plan-source", "every physical source must belong to at least one inventory root", { errorPath: `${at}/rootIds` });
    }
    const expectedSourceId = canonicalJsonDigest({
      digest: source.source.digest,
      path: source.path,
      pathDigest: source.pathDigest,
      rootIds: normalizedLists.rootIds,
      size: source.source.size,
      type: source.source.type,
    });
    if (source.sourceId !== expectedSourceId) {
      fail("wakeflow-migration-plan-source", "sourceId differs from its exact physical identity", { errorPath: `${at}/sourceId` });
    }
    for (const field of ["owner", "privacy", "surfaceKind"]) text(source[field], `${at}/${field}`);
    nullableText(source.sourceKind, `${at}/sourceKind`);
    nullableText(source.sourceVersion, `${at}/sourceVersion`);
    exactObject(source.resource, ["kind", "state"], `${at}/resource`);
    text(source.resource.kind, `${at}/resource/kind`);
    text(source.resource.state, `${at}/resource/state`);
    const units = denseArray(source.units, `${at}/units`);
    if (units.length === 0) fail("wakeflow-migration-plan-source", "every source needs at least one unit", { errorPath: `${at}/units` });
    canonicalOrder(units, (unit) => unit.unitId, `${at}/units`, "wakeflow-migration-plan-action");
    units.forEach((unit, unitIndex) => validateUnit(
      unit,
      source,
      legacyArchiveTransform,
      `${at}/units/${unitIndex}`,
    ));
    validateClassification(source.classification, source, `${at}/classification`);
    const expectedSourceKind = source.classification?.artifact.kind ?? source.source.type;
    const expectedSourceVersion = source.classification?.artifact.schema ?? null;
    if (source.sourceKind !== expectedSourceKind || source.sourceVersion !== expectedSourceVersion) {
      fail("wakeflow-migration-plan-source", "source kind/version differs from classifier and physical facts", { errorPath: at });
    }
    if (source.classification?.blockerCodes.some((code) => !source.blockerCodes.includes(code))) {
      fail("wakeflow-migration-plan-source", "source blockers omit classifier evidence", { errorPath: `${at}/blockerCodes` });
    }
  }
  for (const source of sources) {
    if (source.parentSourceId !== null) {
      const parent = byId.get(source.parentSourceId);
      if (!parent || parent.source.type !== "directory" || !parent.childSourceIds.includes(source.sourceId)) {
        fail("wakeflow-migration-plan-source", "source parent/child closure is broken", { errorPath: `$/payload/sources/${source.sourceId}` });
      }
    }
    for (const childId of source.childSourceIds) {
      if (byId.get(childId)?.parentSourceId !== source.sourceId) {
        fail("wakeflow-migration-plan-source", "source child/parent closure is broken", { errorPath: `$/payload/sources/${source.sourceId}` });
      }
    }
  }
  const finalized = new Set();
  for (const source of sources) {
    if (finalized.has(source.sourceId)) continue;
    const chain = [];
    const visiting = new Set();
    let cursor = source;
    while (cursor !== null && !finalized.has(cursor.sourceId)) {
      if (visiting.has(cursor.sourceId)) {
        fail("wakeflow-migration-plan-source", "source hierarchy contains a cycle", {
          errorPath: `$/payload/sources/${cursor.sourceId}/parentSourceId`,
        });
      }
      visiting.add(cursor.sourceId);
      chain.push(cursor.sourceId);
      cursor = cursor.parentSourceId === null ? null : byId.get(cursor.parentSourceId) ?? null;
    }
    for (const sourceId of chain) finalized.add(sourceId);
  }
  if (sources.length !== inventory.sourceCount) fail("wakeflow-migration-plan-source", "inventory source count differs from source plan", { errorPath: "$/payload/sources" });
  return sources;
}

function validateConfigSources(values, sources) {
  const bySourceId = new Map(sources.map((source) => [source.sourceId, source]));
  const entries = denseArray(values, "$/payload/inventory/configSources");
  canonicalOrder(entries, (entry) => entry.sourceId, "$/payload/inventory/configSources", "wakeflow-migration-plan-source");
  for (const [index, entry] of entries.entries()) {
    const at = `$/payload/inventory/configSources/${index}`;
    exactObject(entry, [
      "baseEvidence",
      "blockerCodes",
      "intentDigest",
      "rawDigest",
      "scope",
      "sourceId",
      "topologyDigest",
    ], at);
    digest(entry.sourceId, `${at}/sourceId`);
    nullableDigest(entry.rawDigest, `${at}/rawDigest`);
    nullableDigest(entry.intentDigest, `${at}/intentDigest`);
    nullableDigest(entry.topologyDigest, `${at}/topologyDigest`);
    if (!new Set(["durable", "local-overlay"]).has(entry.scope)) {
      fail("wakeflow-migration-plan-source", "config source scope is invalid", { errorPath: `${at}/scope` });
    }
    if (!new Set([
      null,
      "matched-durable-source",
      "mismatched-durable-intent",
      "mismatched-durable-source",
      "missing",
    ]).has(entry.baseEvidence)) {
      fail("wakeflow-migration-plan-source", "config base evidence is invalid", { errorPath: `${at}/baseEvidence` });
    }
    if ((entry.scope === "durable") !== (entry.baseEvidence === null)) {
      fail("wakeflow-migration-plan-source", "config base evidence differs from source scope", { errorPath: `${at}/baseEvidence` });
    }
    const blockerCodes = denseArray(entry.blockerCodes, `${at}/blockerCodes`)
      .map((code, codeIndex) => text(code, `${at}/blockerCodes/${codeIndex}`));
    canonicalOrder(blockerCodes, (code) => code, `${at}/blockerCodes`, "wakeflow-migration-plan-source");
    const source = bySourceId.get(entry.sourceId);
    const absentPhysicalFact = source === undefined
      && entry.rawDigest === null
      && entry.intentDigest === null
      && entry.topologyDigest === null
      && blockerCodes.length > 0;
    if (!absentPhysicalFact && (
      !source
      || source.resource.kind !== "config-source"
      || source.source.digest !== entry.rawDigest
    )) {
      fail("wakeflow-migration-plan-source", "config source fact differs from its source node", { errorPath: at });
    }
  }
  return entries;
}

function inventoryBlockersFromPlan(roots, sources, configSources) {
  const groups = new Map();
  const physicalSourceIds = new Set(sources.map((source) => source.sourceId));
  const add = (code, sourceId = null, rootId = null) => {
    const group = groups.get(code) ?? { code, rootIds: new Set(), sourceIds: new Set() };
    if (sourceId !== null) group.sourceIds.add(sourceId);
    if (rootId !== null) group.rootIds.add(rootId);
    groups.set(code, group);
  };
  for (const root of roots) for (const code of root.blockerCodes) add(code, null, root.rootId);
  for (const source of sources) for (const code of source.blockerCodes) add(code, source.sourceId, null);
  for (const source of configSources) for (const code of source.blockerCodes) {
    add(code, physicalSourceIds.has(source.sourceId) ? source.sourceId : null, null);
  }
  return [...groups.values()].map((group) => ({
    code: group.code,
    rootIds: [...group.rootIds].sort(compareText),
    sourceIds: [...group.sourceIds].sort(compareText),
  })).sort((left, right) => compareText(left.code, right.code));
}

function validateRootDiff(values, model, expectedCount) {
  const roots = denseArray(values, "$/payload/rootDiff");
  canonicalOrder(roots, (root) => root.rootId, "$/payload/rootDiff", "wakeflow-migration-plan-root-mapping");
  if (roots.length !== expectedCount) {
    fail("wakeflow-migration-plan-root-mapping", "root diff count differs from inventory", { errorPath: "$/payload/rootDiff" });
  }
  for (const [index, root] of roots.entries()) {
    const at = `$/payload/rootDiff/${index}`;
    exactObject(root, [
      "blockerCodes",
      "digest",
      "disposition",
      "exists",
      "location",
      "ownership",
      "rootId",
      "rootKind",
      "scanMode",
      "sourceCount",
      "surfaceKind",
      "target",
      "type",
    ], at);
    digest(root.rootId, `${at}/rootId`);
    nullableDigest(root.digest, `${at}/digest`);
    if (typeof root.exists !== "boolean") fail("wakeflow-migration-plan-root-mapping", "root exists flag is invalid", { errorPath: `${at}/exists` });
    if (!Number.isSafeInteger(root.sourceCount) || root.sourceCount < 0) {
      fail("wakeflow-migration-plan-root-mapping", "root source count is invalid", { errorPath: `${at}/sourceCount` });
    }
    for (const field of ["ownership", "rootKind", "scanMode", "surfaceKind"]) text(root[field], `${at}/${field}`);
    nullableText(root.type, `${at}/type`);
    const blockerCodes = denseArray(root.blockerCodes, `${at}/blockerCodes`)
      .map((code, codeIndex) => text(code, `${at}/blockerCodes/${codeIndex}`));
    canonicalOrder(blockerCodes, (code) => code, `${at}/blockerCodes`, "wakeflow-migration-plan-root-mapping");
    exactObject(root.location, ["kind", "path", "pathDigest"], `${at}/location`);
    if (!new Set(["configured-private", "workspace-relative"]).has(root.location.kind)) {
      fail("wakeflow-migration-plan-root-mapping", "root location kind is invalid", { errorPath: `${at}/location/kind` });
    }
    nullableText(root.location.path, `${at}/location/path`);
    nullableDigest(root.location.pathDigest, `${at}/location/pathDigest`);
    if (root.location.path !== null) portableRef(root.location.path, `${at}/location/path`, "wakeflow-migration-plan-root-mapping");
    if (root.location.kind === "configured-private") {
      if (root.location.path !== null || root.location.pathDigest === null) {
        fail("wakeflow-migration-plan-root-mapping", "private root location must remain digest-only", { errorPath: `${at}/location` });
      }
    } else if ((root.location.path === null) === (root.location.pathDigest === null)) {
      fail("wakeflow-migration-plan-root-mapping", "workspace root location must expose either path or fallback digest", { errorPath: `${at}/location` });
    }
    const target = normalizeRootTarget(root.target, model, `${at}/target`);
    const expectedDisposition = !root.exists
      ? "absent"
      : target.kind === "none" || blockerCodes.length > 0
        ? "manual"
        : "mapped";
    if (root.disposition !== expectedDisposition) {
      fail("wakeflow-migration-plan-root-mapping", "root disposition differs from exact root evidence", { errorPath: `${at}/disposition` });
    }
    if (!root.exists && (root.digest !== null || root.type !== null || root.sourceCount !== 0)) {
      fail("wakeflow-migration-plan-root-mapping", "absent root carries observed node facts", { errorPath: at });
    }
  }
  return roots;
}

function validateDependencies(values, sources) {
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const unitIds = new Set(sources.flatMap((source) => source.units.map((unit) => unit.unitId)));
  const entries = denseArray(values, "$/payload/dependencies");
  canonicalOrder(entries, (entry) => entry.dependencyId, "$/payload/dependencies", "wakeflow-migration-plan-order");
  for (const [index, entry] of entries.entries()) {
    const at = `$/payload/dependencies/${index}`;
    exactObject(entry, ["code", "dependencyId", "evidenceDigest", "kind", "phase", "sourceIds", "status", "unitIds"], at);
    text(entry.code, `${at}/code`);
    text(entry.kind, `${at}/kind`);
    if (!new Set(["precondition", "release-gate"]).has(entry.phase)) {
      fail("wakeflow-migration-plan-order", "dependency phase is invalid", { errorPath: `${at}/phase` });
    }
    if (!new Set(["planned", "required", "satisfied"]).has(entry.status)) {
      fail("wakeflow-migration-plan-order", "dependency status is invalid", { errorPath: `${at}/status` });
    }
    nullableDigest(entry.evidenceDigest, `${at}/evidenceDigest`);
    if ((entry.status === "satisfied") !== (entry.evidenceDigest !== null)) {
      fail("wakeflow-migration-plan-order", "dependency evidence differs from status", { errorPath: `${at}/evidenceDigest` });
    }
    if ((entry.phase === "release-gate") !== (entry.status === "planned")) {
      fail("wakeflow-migration-plan-order", "release gates must remain planned until apply", { errorPath: at });
    }
    for (const [field, known] of [["sourceIds", sourceIds], ["unitIds", unitIds]]) {
      const ids = denseArray(entry[field], `${at}/${field}`)
        .map((id, idIndex) => digest(id, `${at}/${field}/${idIndex}`));
      canonicalOrder(ids, (id) => id, `${at}/${field}`, "wakeflow-migration-plan-order");
      if (ids.some((id) => !known.has(id))) {
        fail("wakeflow-migration-plan-order", "dependency references an unknown source unit", { errorPath: `${at}/${field}` });
      }
    }
    const unsigned = {
      code: entry.code,
      evidenceDigest: entry.evidenceDigest,
      kind: entry.kind,
      phase: entry.phase,
      sourceIds: entry.sourceIds,
      status: entry.status,
      unitIds: entry.unitIds,
    };
    if (digest(entry.dependencyId, `${at}/dependencyId`) !== canonicalJsonDigest(unsigned)) {
      fail("wakeflow-migration-plan-order", "dependency identity differs from its canonical facts", { errorPath: `${at}/dependencyId` });
    }
  }
  return entries;
}

function validateDecommissionCoverage(values, sources) {
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const entries = denseArray(values, "$/payload/decommissionCoverage");
  canonicalOrder(entries, (entry) => entry.coverageId, "$/payload/decommissionCoverage", "wakeflow-migration-plan-order");
  for (const [index, entry] of entries.entries()) {
    const at = `$/payload/decommissionCoverage/${index}`;
    exactObject(entry, ["coverageId", "evidenceDigest", "hostId", "sourceIds", "status"], at);
    text(entry.hostId, `${at}/hostId`);
    if (entry.status !== "required" || entry.evidenceDigest !== null) {
      fail("wakeflow-migration-plan-order", "T05 cannot claim host decommission proof", { errorPath: at });
    }
    const ids = denseArray(entry.sourceIds, `${at}/sourceIds`)
      .map((id, idIndex) => digest(id, `${at}/sourceIds/${idIndex}`));
    canonicalOrder(ids, (id) => id, `${at}/sourceIds`, "wakeflow-migration-plan-order");
    if (ids.length === 0 || ids.some((id) => !sourceIds.has(id))) {
      fail("wakeflow-migration-plan-order", "decommission coverage references unknown sources", { errorPath: `${at}/sourceIds` });
    }
    const unsigned = {
      evidenceDigest: null,
      hostId: entry.hostId,
      sourceIds: entry.sourceIds,
      status: "required",
    };
    if (digest(entry.coverageId, `${at}/coverageId`) !== canonicalJsonDigest(unsigned)) {
      fail("wakeflow-migration-plan-order", "decommission coverage identity is stale", { errorPath: `${at}/coverageId` });
    }
  }
  const expected = deriveDecommissionCoverage(sources);
  if (canonicalJson(entries) !== canonicalJson(expected)) {
    fail("wakeflow-migration-plan-order", "decommission coverage differs from source ownership", { errorPath: "$/payload/decommissionCoverage" });
  }
  return entries;
}

function validateBlockers(values, { roots, sources, dependencies, artifacts }) {
  const rootIds = new Set(roots.map((root) => root.rootId));
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const unitIds = new Set(sources.flatMap((source) => source.units.map((unit) => unit.unitId)));
  const dependencyIds = new Set(dependencies.map((entry) => entry.dependencyId));
  const entries = denseArray(values, "$/payload/blockers");
  canonicalOrder(entries, (entry) => entry.blockerId, "$/payload/blockers", "wakeflow-migration-plan-order");
  for (const [index, entry] of entries.entries()) {
    const at = `$/payload/blockers/${index}`;
    exactObject(entry, ["blockerId", "code", "dependencyId", "rootId", "sourceId", "unitId"], at);
    text(entry.code, `${at}/code`);
    for (const [field, known] of [["dependencyId", dependencyIds], ["rootId", rootIds], ["sourceId", sourceIds], ["unitId", unitIds]]) {
      nullableDigest(entry[field], `${at}/${field}`);
      if (entry[field] !== null && !known.has(entry[field])) {
        fail("wakeflow-migration-plan-order", "blocker references an unknown plan fact", { errorPath: `${at}/${field}` });
      }
    }
    const unsigned = {
      code: entry.code,
      dependencyId: entry.dependencyId,
      rootId: entry.rootId,
      sourceId: entry.sourceId,
      unitId: entry.unitId,
    };
    if (digest(entry.blockerId, `${at}/blockerId`) !== canonicalJsonDigest(unsigned)) {
      fail("wakeflow-migration-plan-order", "blocker identity differs from its canonical facts", { errorPath: `${at}/blockerId` });
    }
  }
  for (const source of sources) for (const unit of source.units) {
    if (unit.action === "manual" && !entries.some((entry) => entry.unitId === unit.unitId)) {
      fail("wakeflow-migration-plan-status", "manual source unit lacks an explicit blocker", { errorPath: "$/payload/blockers" });
    }
  }
  for (const dependency of dependencies.filter((entry) => entry.status === "required")) {
    if (!entries.some((entry) => entry.dependencyId === dependency.dependencyId)) {
      fail("wakeflow-migration-plan-status", "required dependency lacks an explicit blocker", { errorPath: "$/payload/blockers" });
    }
  }
  if (artifacts.legacyOwnerArtifactDigest === null && !entries.some((entry) => entry.code === "migration-legacy-owner-required")) {
    fail("wakeflow-migration-plan-status", "missing legacy owner artifact lacks an explicit blocker", { errorPath: "$/payload/blockers" });
  }
  return entries;
}

/**
 * 重验closed payload，并从冻结事实重派target、action、dependency、coverage和phase。
 * 该校验防止调用方仅重算planDigest后篡改语义，但不替代当前workspace重新盘点。
 */
function validatePlan(value) {
  const plan = canonicalClone(value, "migration plan");
  exactObject(plan, ["schemaId", "payload", "planDigest"], "$", "wakeflow-migration-plan-contract");
  if (plan.schemaId !== SCHEMA_ID) fail("wakeflow-migration-plan-contract", "migration plan schema identity is invalid", { errorPath: "$/schemaId" });
  digest(plan.planDigest, "$/planDigest");
  const unsigned = { schemaId: plan.schemaId, payload: plan.payload };
  if (canonicalJsonDigest(unsigned) !== plan.planDigest) fail("wakeflow-migration-plan-digest", "planDigest differs from the complete canonical payload", { errorPath: "$/planDigest" });
  exactObject(plan.payload, [
    "action",
    "artifacts",
    "blockers",
    "commitPhases",
    "decommissionCoverage",
    "dependencies",
    "identityMappings",
    "inventory",
    "kind",
    "legacyArchiveTransform",
    "ownerDrain",
    "recoveryPhases",
    "rootDiff",
    "rootMappings",
    "schemaVersion",
    "sources",
    "status",
    "target",
  ], "$/payload");
  if (
    plan.payload.kind !== WAKEFLOW_MIGRATION_PLAN_KIND
    || plan.payload.schemaVersion !== WAKEFLOW_MIGRATION_PLAN_SCHEMA_VERSION
    || plan.payload.action !== LOGICAL_ACTION
    || !new Set(["ready", "blocked"]).has(plan.payload.status)
  ) fail("wakeflow-migration-plan-contract", "migration plan identity or status is invalid", { errorPath: "$/payload" });
  exactObject(plan.payload.artifacts, ["bootstrapArtifactDigest", "legacyOwnerArtifactDigest"], "$/payload/artifacts");
  digest(plan.payload.artifacts.bootstrapArtifactDigest, "$/payload/artifacts/bootstrapArtifactDigest");
  nullableDigest(plan.payload.artifacts.legacyOwnerArtifactDigest, "$/payload/artifacts/legacyOwnerArtifactDigest");
  const ownerDrain = plan.payload.ownerDrain === null
    ? null
    : validateWakeflowLegacyOwnerDrainAssessment(plan.payload.ownerDrain);
  if ((ownerDrain === null) !== (plan.payload.artifacts.legacyOwnerArtifactDigest === null)) {
    fail("wakeflow-migration-plan-owner-drain", "owner-drain evidence presence differs from legacy artifact identity", { errorPath: "$/payload/ownerDrain" });
  }
  if (
    ownerDrain !== null
    && ownerDrain.artifact.legacyOwnerArtifactDigest !== plan.payload.artifacts.legacyOwnerArtifactDigest
  ) {
    fail("wakeflow-migration-plan-owner-drain", "owner-drain evidence belongs to another legacy artifact", { errorPath: "$/payload/ownerDrain/artifact" });
  }
  exactObject(plan.payload.inventory, ["configSources", "inventoryDigest", "rootCount", "sourceCount"], "$/payload/inventory");
  digest(plan.payload.inventory.inventoryDigest, "$/payload/inventory/inventoryDigest");
  if (!Number.isSafeInteger(plan.payload.inventory.rootCount) || !Number.isSafeInteger(plan.payload.inventory.sourceCount)) {
    fail("wakeflow-migration-plan-contract", "inventory counts are invalid", { errorPath: "$/payload/inventory" });
  }
  if (
    ownerDrain !== null
    && (
      ownerDrain.inventory.inventoryDigest !== plan.payload.inventory.inventoryDigest
      || ownerDrain.inventory.sourceCount !== plan.payload.inventory.sourceCount
    )
  ) fail("wakeflow-migration-plan-owner-drain", "owner-drain evidence differs from plan inventory", { errorPath: "$/payload/ownerDrain/inventory" });
  const model = validateTarget(plan.payload.target);
  const legacyArchiveTransform = normalizeLegacyArchiveTransformOwnerResolution(
    plan.payload.legacyArchiveTransform,
  );
  const sources = validateSources(
    plan.payload.sources,
    plan.payload.inventory,
    legacyArchiveTransform,
  );
  const configSources = validateConfigSources(plan.payload.inventory.configSources, sources);
  const fakeInventory = { sources };
  normalizeIdentityMappings(plan.payload.identityMappings, fakeInventory, model);
  const rootDiffValues = validateRootDiff(plan.payload.rootDiff, model, plan.payload.inventory.rootCount);
  for (const root of rootDiffValues) {
    const expectedSourceCount = sources.filter((source) => source.rootIds.includes(root.rootId)).length;
    if (root.sourceCount !== expectedSourceCount) {
      fail("wakeflow-migration-plan-root-mapping", "root sourceCount differs from source membership", {
        errorPath: `$/payload/rootDiff/${root.rootId}/sourceCount`,
      });
    }
  }
  const fakeRootInventory = { roots: rootDiffValues };
  const rootMappings = normalizeRootMappings(plan.payload.rootMappings, fakeRootInventory, model);
  const mappingByRoot = new Map(rootMappings.map((entry) => [entry.rootId, entry.target]));
  if (rootDiffValues.some((root) => canonicalJson(root.target) !== canonicalJson(mappingByRoot.get(root.rootId)))) {
    fail("wakeflow-migration-plan-root-mapping", "root diff target differs from the selected root mapping", { errorPath: "$/payload/rootDiff" });
  }
  const rawSources = sources.map((source) => ({
    ...source,
    digest: source.source.digest,
    mode: source.source.mode,
    size: source.source.size,
    type: source.source.type,
  }));
  const inventoryBlockers = inventoryBlockersFromPlan(rootDiffValues, rawSources, configSources);
  const derivationInventory = {
    blockers: inventoryBlockers,
    configSources,
    inventoryDigest: plan.payload.inventory.inventoryDigest,
    roots: rootDiffValues,
    sources: rawSources,
  };
  assertLegacyArchiveTransformResolutionContext(legacyArchiveTransform, {
    artifacts: {
      legacyOwnerArtifact: plan.payload.artifacts.legacyOwnerArtifactDigest === null
        ? null
        : { artifactDigest: plan.payload.artifacts.legacyOwnerArtifactDigest },
    },
    inventory: derivationInventory,
    ownerDrain,
    target: plan.payload.target,
  });
  const expectedSources = deriveSources(
    derivationInventory,
    rootMappings,
    plan.payload.target,
    legacyArchiveTransform,
  );
  if (canonicalJson(expectedSources) !== canonicalJson(sources)) {
    fail("wakeflow-migration-plan-action", "source actions differ from exact classifier/root/target facts", { errorPath: "$/payload/sources" });
  }
  const dependencies = validateDependencies(plan.payload.dependencies, sources);
  const expectedDependencies = deriveDependencies(sources, derivationInventory, ownerDrain);
  if (canonicalJson(expectedDependencies) !== canonicalJson(dependencies)) {
    fail("wakeflow-migration-plan-order", "dependencies differ from exact source facts", { errorPath: "$/payload/dependencies" });
  }
  validateDecommissionCoverage(plan.payload.decommissionCoverage, sources);
  const blockers = validateBlockers(plan.payload.blockers, {
    roots: rootDiffValues,
    sources,
    dependencies,
    artifacts: plan.payload.artifacts,
    ownerDrain,
  });
  const expectedBlockers = deriveBlockers({
    artifacts: {
      legacyOwnerArtifact: plan.payload.artifacts.legacyOwnerArtifactDigest === null ? null : {},
    },
    inventory: { blockers: inventoryBlockers },
    roots: rootDiffValues,
    sources,
    dependencies,
    ownerDrain,
  });
  if (canonicalJson(expectedBlockers) !== canonicalJson(blockers)) {
    fail("wakeflow-migration-plan-status", "blockers differ from exact source and dependency facts", { errorPath: "$/payload/blockers" });
  }
  const commitPhases = deriveCommitPhases(sources);
  if (canonicalJson(commitPhases) !== canonicalJson(plan.payload.commitPhases)) {
    fail("wakeflow-migration-plan-order", "commit phases differ from source units", { errorPath: "$/payload/commitPhases" });
  }
  const expectedRecovery = commitPhases.map((entry) => ({ ...entry, strategy: "resume-forward" }));
  if (canonicalJson(expectedRecovery) !== canonicalJson(plan.payload.recoveryPhases)) {
    fail("wakeflow-migration-plan-order", "recovery phases must resume the exact commit plan forward", { errorPath: "$/payload/recoveryPhases" });
  }
  const manualUnits = sources.flatMap((source) => source.units).filter((unit) => unit.action === "manual");
  const required = dependencies.filter((entry) => entry.status === "required");
  const expectedStatus = blockers.length === 0 && manualUnits.length === 0 && required.length === 0
    ? "ready"
    : "blocked";
  if (plan.payload.status !== expectedStatus) fail("wakeflow-migration-plan-status", "plan status differs from blockers and unresolved dependencies", { errorPath: "$/payload/status" });
  const serialized = canonicalJson(plan);
  if (PRIVATE_PATH_RE.test(serialized)) fail("wakeflow-migration-plan-privacy", "canonical plan contains a machine-private absolute path");
  return deepFreeze(plan);
}

// ==================== 六、唯一公开preview/codec入口 ====================

/**
 * 对一个execution-only workspaceRoot执行两次T04 inventory，并生成零写入migration preview。
 * caller只能提供目标model、显式mapping、host profile和可选strict archive resolution。
 */
export function planWakeflowMigrationPreview(value) {
  exactObject(value, [
    "workspaceRoot",
    "artifactContext",
    "desiredModel",
    "identityMappings",
    "rootMappings",
    "hostProfile",
    "legacyArchiveTransformResolution",
  ], "$", "wakeflow-migration-plan-input");
  return validatePlan(buildPlan(value));
}

/** 重验一份portable migration plan的完整内部语义闭包。 */
export function validateWakeflowMigrationPlan(value) {
  return validatePlan(value);
}

/** 返回经完整重验后的planDigest；digest不是apply授权令牌。 */
export function wakeflowMigrationPlanDigest(value) {
  return validatePlan(value).planDigest;
}

/** 仅表示T05计划当前零blocker/零manual，不替代bootstrap与owner apply admission。 */
export function isWakeflowMigrationPlanApplicable(value) {
  return validatePlan(value).payload.status === "ready";
}
