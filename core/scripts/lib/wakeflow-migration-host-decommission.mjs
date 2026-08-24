import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  validateWakeflowMigrationPlan,
} from "./wakeflow-migration-plan.mjs";

/**
 * T07 migration host decommission 是显式迁移中的宿主中立证据合同，不执行宿主动作。
 * Codex/Claude适配器负责重新观察workspace并产生plan/outcome；本模块只把这些观察
 * 约束到同一份T05 MigrationPlan、封闭宿主证明策略和可移植assessment中。
 *
 * 阅读导航：
 * 1. 封闭数据合同：拒绝getter、行为型数组、非NFC文本、超限文本和非canonical顺序。
 * 2. Coverage闭包：由T05 source集合重算coverage/source-set/resource-followup身份。
 * 3. Host plan：冻结每个宿主subject的source、effect、proof policy、blocker和owner-drain前置条件。
 * 4. Host outcome：把宿主观察绑定回exact subject；blocked subject不能被重签升级为成功证明。
 * 5. I3证明边界：Claude只有“精确关闭且复查不存在”可机器验证；Codex归档始终保留
 *    manual-host-gate；unknown coverage只能保持missing。
 * 6. Portable assessment：合并所有coverage但不代替host effect，也不声明routing/source已撤销。
 * 7. Canonical bytes：只序列化已经通过完整validator的plain data artifact。
 *
 * standalone validator只证明artifact内部闭合；workspace freshness仍由宿主适配器在
 * effect前后重新检查，T08对Pod等宿主资源的后续证明也不会在这里被吞并。
 */
export const WAKEFLOW_MIGRATION_HOST_DECOMMISSION_PLAN_KIND = "WakeflowMigrationHostDecommissionPlan";
export const WAKEFLOW_MIGRATION_HOST_DECOMMISSION_OUTCOME_KIND = "WakeflowMigrationHostDecommissionOutcome";
export const WAKEFLOW_MIGRATION_HOST_DECOMMISSION_ASSESSMENT_KIND = "WakeflowMigrationHostDecommissionAssessment";
export const WAKEFLOW_MIGRATION_HOST_DECOMMISSION_SCHEMA_VERSION = 1;

const HOST_IDS = new Set(["codex", "claude-code"]);
const ASSESSMENT_HOST_IDS = new Set([...HOST_IDS, "unknown"]);
const EFFECTS = new Set(["archive", "close", "none"]);
const PROOF_POLICIES = new Set([
  "exact-close-and-absence",
  "manual-host-gate",
  "source-freeze-only",
]);
const PLAN_STATUSES = new Set(["blocked", "ready"]);
const SUBJECT_OUTCOME_STATUSES = new Set([
  "blocked",
  "machine-verified",
  "manual-host-gate",
  "not-applicable",
]);
const EFFECT_STATUSES = new Set(["failed", "not-attempted", "succeeded", "unavailable"]);
const PROOF_KINDS = new Set([
  "archive-observed",
  "exact-post-close-absence",
  "none",
  "source-freeze-only",
]);
const REASON_CODES = new Set([
  "claude-close-failed",
  "claude-postclose-ambiguous",
  "claude-postclose-present",
  "claude-preclose-ambiguous",
  "claude-preclose-missing",
  "codex-archive-failed",
  "codex-archive-observed-instance-confirmation-required",
  "codex-archive-unavailable",
  "codex-instance-confirmation-required",
  "plan-blocked",
  "source-freeze-only",
]);
const ASSESSMENT_STATUSES = new Set(["blocked", "manual-host-gate", "satisfied"]);
const ASSESSMENT_COVERAGE_STATUSES = new Set([
  "blocked",
  "machine-verified",
  "manual-host-gate",
  "missing",
  "not-applicable",
]);
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const PRIVATE_PATH_RE = /(?:^|[\s"'`(])(?:\/(?:Users|home|private|var\/folders)\/[^\s"'`)]*|[A-Za-z]:\\Users\\[^\s"'`)]*)/u;
const MAX_ITEMS = 100_000;

// ==================== 一、封闭数据合同与canonical原语 ====================

/** 统一承载T07错误码、JSON pointer和脱敏详情。 */
export class WakeflowMigrationHostDecommissionError extends Error {
  constructor(code, message, { errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowMigrationHostDecommissionError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

// 统一失败出口；调用方只接收稳定错误码，不接收机器私有路径或原始host handle。
function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowMigrationHostDecommissionError(code, `${message} at ${errorPath}`, {
    errorPath,
    details,
    cause,
  });
}

// 冻结已经标准化的plain data，防止签发后被调用方原地改写。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// Digest相关排序固定使用code-unit顺序，避免locale差异。
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 输出唯一且稳定排序的集合表示，供blocker/source ID闭包使用。
function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

// 只接受普通对象或null-prototype对象，拒绝class instance与数组。
function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 校验封闭字段集，并保证每个字段都是可枚举own data property而非getter。
function exactObject(value, fields, errorPath, code = "wakeflow-migration-host-decommission-contract") {
  if (!plainObject(value)) fail(code, "expected one plain data object", { errorPath });
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
      fail(code, "fields must be enumerable data properties", { errorPath: `${errorPath}/${field}` });
    }
  }
  return value;
}

// 拒绝稀疏、超限及携带hidden/Symbol/额外属性的行为型数组。
function denseArray(value, errorPath) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    fail("wakeflow-migration-host-decommission-contract", "expected one bounded array", { errorPath });
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(key)
      || Number(key) >= value.length
    ) {
      fail("wakeflow-migration-host-decommission-contract", "arrays cannot carry additional or behavioral properties", {
        errorPath,
      });
    }
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail("wakeflow-migration-host-decommission-contract", "sparse arrays are not allowed", { errorPath: `${errorPath}/${index}` });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-migration-host-decommission-contract", "array entries must be enumerable data properties", { errorPath: `${errorPath}/${index}` });
    }
    result.push(descriptor.value);
  }
  return result;
}

// 校验统一的sha256:前缀摘要格式。
function digest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-migration-host-decommission-digest", "expected one canonical SHA-256 digest", { errorPath });
  }
  return value;
}

// 仅在合同明确允许“尚无证据”时接受null摘要。
function nullableDigest(value, errorPath) {
  return value === null ? null : digest(value, errorPath);
}

// 文本必须trim稳定、NFC、无控制字符，并按UTF-8字节而非JS字符数限长。
function boundedText(value, errorPath) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value !== value.normalize("NFC")
    || Buffer.byteLength(value, "utf8") > 512
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) fail("wakeflow-migration-host-decommission-contract", "expected one bounded control-free string", { errorPath });
  return value;
}

// 校验已经canonical排序且无重复的字符串或digest数组；validator不静默重排外部artifact。
function canonicalStrings(value, errorPath, { allowEmpty = true, digestValues = false } = {}) {
  const entries = denseArray(value, errorPath).map((entry, index) => (
    digestValues ? digest(entry, `${errorPath}/${index}`) : boundedText(entry, `${errorPath}/${index}`)
  ));
  if (!allowEmpty && entries.length === 0) {
    fail("wakeflow-migration-host-decommission-contract", "array cannot be empty", { errorPath });
  }
  if (canonicalJson(entries) !== canonicalJson(sortedUnique(entries))) {
    fail("wakeflow-migration-host-decommission-order", "array must be unique and lexically ordered", { errorPath });
  }
  return entries;
}

// 同时校验条目身份的唯一性和lexical顺序。
function canonicalOrder(values, keyFor, errorPath) {
  const keys = values.map(keyFor);
  if (canonicalJson(keys) !== canonicalJson(sortedUnique(keys))) {
    fail("wakeflow-migration-host-decommission-order", "entries must have unique lexical identities", { errorPath });
  }
}

// Plan/outcome只允许当前存在真实宿主适配器的两个host ID。
function hostId(value, errorPath) {
  if (!HOST_IDS.has(value)) {
    fail("wakeflow-migration-host-decommission-host", "host is outside the closed migration host set", { errorPath });
  }
  return value;
}

// Assessment额外允许T05无法归属到已知适配器的unknown coverage。
function assessmentHostId(value, errorPath) {
  if (!ASSESSMENT_HOST_IDS.has(value)) {
    fail("wakeflow-migration-host-decommission-assessment", "assessment host is outside the closed migration coverage set", { errorPath });
  }
  return value;
}

// 与MigrationPlan的coverageId公式保持同源，避免host/source改写后只重签外层摘要。
function coverageIdFor(selectedHostId, sourceIds) {
  return canonicalJsonDigest({
    evidenceDigest: null,
    hostId: selectedHostId,
    sourceIds,
    status: "required",
  });
}

// Effect能力由宿主边界固定：Codex可archive，Claude可close，两者都可只冻结source。
function hostEffectCompatible(selectedHostId, effect) {
  return effect === "none"
    || (selectedHostId === "codex" && effect === "archive")
    || (selectedHostId === "claude-code" && effect === "close");
}

// Codex归档的四种观察结果均只能落到manual-host-gate，且字段组合必须精确匹配。
function codexManualGateValid(value) {
  return value.status === "manual-host-gate"
    && value.postCloseAttempts === 0
    && (
      (value.effectStatus === "succeeded"
        && value.proof === "archive-observed"
        && value.reasonCode === "codex-archive-observed-instance-confirmation-required")
      || (value.effectStatus === "not-attempted"
        && value.proof === "none"
        && value.reasonCode === "codex-instance-confirmation-required")
      || (value.effectStatus === "unavailable"
        && value.proof === "none"
        && value.reasonCode === "codex-archive-unavailable")
      || (value.effectStatus === "failed"
        && value.proof === "none"
        && value.reasonCode === "codex-archive-failed")
    );
}

// 最终portable artifact不得泄露本机绝对路径；宿主handle本就不进入本合同。
function canonicalPrivacy(value, errorPath) {
  const serialized = canonicalJson(value);
  if (PRIVATE_PATH_RE.test(serialized)) {
    fail("wakeflow-migration-host-decommission-privacy", "portable artifact contains a machine-private absolute path", { errorPath });
  }
  return value;
}

// ==================== 二、T05 coverage与上游证据闭包 ====================

// 从已验证MigrationPlan中提取所选宿主唯一的一组decommission coverage。
function coverageFromMigrationPlan(migrationPlan, requestedHostId) {
  const matches = migrationPlan.payload.decommissionCoverage.filter((entry) => entry.hostId === requestedHostId);
  if (matches.length !== 1) {
    fail("wakeflow-migration-host-decommission-coverage", "migration plan must contain exactly one coverage group for the selected host", {
      errorPath: "$/migrationPlan/payload/decommissionCoverage",
      details: { hostId: requestedHostId, matches: matches.length },
    });
  }
  return matches[0];
}

// 用source的物理摘要、模式、类型和历史版本重算所选source集合身份。
function sourceSetDigestFromMigrationPlan(migrationPlan, sourceIds) {
  const byId = new Map(migrationPlan.payload.sources.map((source) => [source.sourceId, source]));
  const tuples = sourceIds.map((sourceId) => {
    const source = byId.get(sourceId);
    if (!source) {
      fail("wakeflow-migration-host-decommission-coverage", "coverage references a missing migration source", {
        errorPath: "$/migrationPlan/payload/sources",
        details: { sourceId },
      });
    }
    if (
      source.resource.kind !== "host-identity"
      || !source.blockerCodes.some((code) => code.includes("host-decommission"))
    ) {
      fail("wakeflow-migration-host-decommission-coverage", "coverage includes a source that is not an explicit host identity prerequisite", {
        errorPath: "$/migrationPlan/payload/sources",
        details: { sourceId },
      });
    }
    return {
      digest: source.source.digest,
      mode: source.source.mode,
      sourceId,
      sourceKind: source.sourceKind,
      sourceVersion: source.sourceVersion,
      type: source.source.type,
    };
  });
  return canonicalJsonDigest(tuples);
}

// Pod等仍由宿主拥有的资源证明保持为T08前置依赖，不在T07中伪装成已处理。
function resourceFollowupDependencyIdsFromMigrationPlan(migrationPlan) {
  return migrationPlan.payload.dependencies
    .filter((dependency) => (
      dependency.code === "migration-host-decommission-resource-proof-required"
      && dependency.phase === "precondition"
      && dependency.status === "required"
    ))
    .map((dependency) => dependency.dependencyId)
    .sort(compareText);
}

// ==================== 三、宿主decommission plan ====================

// 把宿主适配器给出的subject候选标准化为source-bound、host-bound的冻结subject。
function normalizeSubjectInput(value, index, selectedHostId, coverageIds) {
  const errorPath = `$/subjects/${index}`;
  exactObject(value, ["blockerCodes", "effect", "proofPolicy", "sourceIds"], errorPath);
  if (!EFFECTS.has(value.effect) || !PROOF_POLICIES.has(value.proofPolicy)) {
    fail("wakeflow-migration-host-decommission-subject", "subject effect or proof policy is unsupported", { errorPath });
  }
  if (
    (value.effect === "archive" && (selectedHostId !== "codex" || value.proofPolicy !== "manual-host-gate"))
    || (value.effect === "close" && (selectedHostId !== "claude-code" || value.proofPolicy !== "exact-close-and-absence"))
    || (value.effect === "none" && value.proofPolicy !== "source-freeze-only")
  ) {
    fail("wakeflow-migration-host-decommission-subject", "subject effect exceeds its host proof policy", { errorPath });
  }
  const sourceIds = sortedUnique(denseArray(value.sourceIds, `${errorPath}/sourceIds`)
    .map((entry, sourceIndex) => digest(entry, `${errorPath}/sourceIds/${sourceIndex}`)));
  if (sourceIds.length === 0 || sourceIds.some((sourceId) => !coverageIds.has(sourceId))) {
    fail("wakeflow-migration-host-decommission-subject", "subject must cover at least one selected coverage source", { errorPath: `${errorPath}/sourceIds` });
  }
  const blockerCodes = sortedUnique(denseArray(value.blockerCodes, `${errorPath}/blockerCodes`)
    .map((entry, blockerIndex) => boundedText(entry, `${errorPath}/blockerCodes/${blockerIndex}`)));
  const subjectIdentity = { hostId: selectedHostId, sourceIds };
  const subjectId = canonicalJsonDigest(subjectIdentity);
  const unsigned = {
    blockerCodes,
    effect: value.effect,
    proofPolicy: value.proofPolicy,
    sourceIds,
    state: blockerCodes.length === 0 ? "ready" : "blocked",
    subjectId,
  };
  return { ...unsigned, subjectDigest: canonicalJsonDigest(unsigned) };
}

// 重新派生subjectId/state/digest，拒绝只重签外层plan的subject篡改。
function validateSubject(value, index, selectedHostId, coverageIds) {
  const errorPath = `$/subjects/${index}`;
  exactObject(value, [
    "blockerCodes",
    "effect",
    "proofPolicy",
    "sourceIds",
    "state",
    "subjectDigest",
    "subjectId",
  ], errorPath);
  const normalized = normalizeSubjectInput({
    blockerCodes: canonicalStrings(value.blockerCodes, `${errorPath}/blockerCodes`),
    effect: value.effect,
    proofPolicy: value.proofPolicy,
    sourceIds: canonicalStrings(value.sourceIds, `${errorPath}/sourceIds`, { allowEmpty: false, digestValues: true }),
  }, index, selectedHostId, coverageIds);
  if (
    value.state !== normalized.state
    || value.subjectId !== normalized.subjectId
    || value.subjectDigest !== normalized.subjectDigest
  ) {
    fail("wakeflow-migration-host-decommission-subject", "subject identity, digest, or state is stale", { errorPath });
  }
  return normalized;
}

// 形成planDigest覆盖的完整unsigned投影；字段顺序只服务canonical序列化。
function planUnsigned(value) {
  return {
    artifactDigests: value.artifactDigests,
    artifactKind: WAKEFLOW_MIGRATION_HOST_DECOMMISSION_PLAN_KIND,
    blockerCodes: value.blockerCodes,
    coverage: value.coverage,
    hostId: value.hostId,
    inventoryDigest: value.inventoryDigest,
    migrationPlanDigest: value.migrationPlanDigest,
    ownerDrainAssessmentDigest: value.ownerDrainAssessmentDigest,
    resourceFollowupDependencyIds: value.resourceFollowupDependencyIds,
    schemaVersion: WAKEFLOW_MIGRATION_HOST_DECOMMISSION_SCHEMA_VERSION,
    sourceSetDigest: value.sourceSetDigest,
    status: value.status,
    subjects: value.subjects,
    unassignedSourceIds: value.unassignedSourceIds,
  };
}

/**
 * 将T05 MigrationPlan事实与一个宿主适配器的只读观察合成为HostDecommissionPlan。
 * 这里不读取workspace、不执行archive/close，也不替宿主适配器推断subject。
 */
export function createMigrationHostDecommissionPlan(value = {}) {
  exactObject(value, ["blockerCodes", "hostId", "migrationPlan", "subjects"], "$", "wakeflow-migration-host-decommission-input");
  const migrationPlan = validateWakeflowMigrationPlan(value.migrationPlan);
  const selectedHostId = hostId(value.hostId, "$/hostId");
  const coverage = coverageFromMigrationPlan(migrationPlan, selectedHostId);
  const coverageIds = new Set(coverage.sourceIds);
  const subjects = denseArray(value.subjects, "$/subjects")
    .map((subject, index) => normalizeSubjectInput(subject, index, selectedHostId, coverageIds))
    .sort((left, right) => compareText(left.subjectId, right.subjectId));
  canonicalOrder(subjects, (subject) => subject.subjectId, "$/subjects");
  const assigned = new Set();
  const duplicateAssignments = new Set();
  for (const subject of subjects) {
    for (const sourceId of subject.sourceIds) {
      if (assigned.has(sourceId)) duplicateAssignments.add(sourceId);
      else assigned.add(sourceId);
    }
  }
  if (duplicateAssignments.size > 0) {
    fail("wakeflow-migration-host-decommission-coverage", "one source cannot belong to multiple decommission subjects", {
      errorPath: "$/subjects",
      details: { sourceIds: [...duplicateAssignments].sort(compareText) },
    });
  }
  const unassignedSourceIds = coverage.sourceIds.filter((sourceId) => !assigned.has(sourceId));
  const resourceFollowupDependencyIds = resourceFollowupDependencyIdsFromMigrationPlan(migrationPlan);
  const blockerCodes = sortedUnique([
    ...denseArray(value.blockerCodes, "$/blockerCodes")
      .map((entry, index) => boundedText(entry, `$/blockerCodes/${index}`)),
    ...(migrationPlan.payload.ownerDrain?.summary.ownerDrainSatisfied === true
      ? []
      : ["migration-legacy-owner-drain-not-satisfied"]),
    ...(unassignedSourceIds.length === 0 ? [] : ["migration-host-source-unassigned"]),
    ...(resourceFollowupDependencyIds.length === 0 ? [] : ["migration-host-resource-followup-unresolved"]),
    ...subjects.flatMap((subject) => subject.blockerCodes),
  ]);
  const unsigned = planUnsigned({
    artifactDigests: {
      bootstrapArtifactDigest: migrationPlan.payload.artifacts.bootstrapArtifactDigest,
      legacyOwnerArtifactDigest: migrationPlan.payload.artifacts.legacyOwnerArtifactDigest,
    },
    blockerCodes,
    coverage: {
      coverageId: coverage.coverageId,
      sourceIds: coverage.sourceIds,
    },
    hostId: selectedHostId,
    inventoryDigest: migrationPlan.payload.inventory.inventoryDigest,
    migrationPlanDigest: migrationPlan.planDigest,
    ownerDrainAssessmentDigest: migrationPlan.payload.ownerDrain?.assessmentDigest ?? null,
    resourceFollowupDependencyIds,
    sourceSetDigest: sourceSetDigestFromMigrationPlan(migrationPlan, coverage.sourceIds),
    status: blockerCodes.length === 0 ? "ready" : "blocked",
    subjects,
    unassignedSourceIds,
  });
  return validateMigrationHostDecommissionPlan({
    ...unsigned,
    planDigest: canonicalJsonDigest(unsigned),
  });
}

/** 校验plan内部完整闭包；不单独证明它仍对应当前workspace。 */
export function validateMigrationHostDecommissionPlan(value) {
  exactObject(value, [
    "artifactDigests",
    "artifactKind",
    "blockerCodes",
    "coverage",
    "hostId",
    "inventoryDigest",
    "migrationPlanDigest",
    "ownerDrainAssessmentDigest",
    "planDigest",
    "resourceFollowupDependencyIds",
    "schemaVersion",
    "sourceSetDigest",
    "status",
    "subjects",
    "unassignedSourceIds",
  ], "$", "wakeflow-migration-host-decommission-plan");
  if (
    value.artifactKind !== WAKEFLOW_MIGRATION_HOST_DECOMMISSION_PLAN_KIND
    || value.schemaVersion !== WAKEFLOW_MIGRATION_HOST_DECOMMISSION_SCHEMA_VERSION
  ) fail("wakeflow-migration-host-decommission-plan", "plan kind or schema version is invalid");
  const selectedHostId = hostId(value.hostId, "$/hostId");
  exactObject(value.artifactDigests, ["bootstrapArtifactDigest", "legacyOwnerArtifactDigest"], "$/artifactDigests");
  const artifactDigests = {
    bootstrapArtifactDigest: digest(value.artifactDigests.bootstrapArtifactDigest, "$/artifactDigests/bootstrapArtifactDigest"),
    legacyOwnerArtifactDigest: nullableDigest(value.artifactDigests.legacyOwnerArtifactDigest, "$/artifactDigests/legacyOwnerArtifactDigest"),
  };
  exactObject(value.coverage, ["coverageId", "sourceIds"], "$/coverage");
  const sourceIds = canonicalStrings(value.coverage.sourceIds, "$/coverage/sourceIds", { allowEmpty: false, digestValues: true });
  const coverage = {
    coverageId: digest(value.coverage.coverageId, "$/coverage/coverageId"),
    sourceIds,
  };
  if (coverage.coverageId !== coverageIdFor(selectedHostId, sourceIds)) {
    fail("wakeflow-migration-host-decommission-coverage", "coverage identity differs from its host and source set", {
      errorPath: "$/coverage/coverageId",
    });
  }
  const coverageIds = new Set(sourceIds);
  const subjects = denseArray(value.subjects, "$/subjects")
    .map((subject, index) => validateSubject(subject, index, selectedHostId, coverageIds));
  canonicalOrder(subjects, (subject) => subject.subjectId, "$/subjects");
  const assignments = subjects.flatMap((subject) => subject.sourceIds);
  if (new Set(assignments).size !== assignments.length) {
    fail("wakeflow-migration-host-decommission-coverage", "one source belongs to multiple subjects", { errorPath: "$/subjects" });
  }
  const assigned = new Set(assignments);
  const expectedUnassigned = sourceIds.filter((sourceId) => !assigned.has(sourceId));
  const unassignedSourceIds = canonicalStrings(value.unassignedSourceIds, "$/unassignedSourceIds", { digestValues: true });
  if (canonicalJson(expectedUnassigned) !== canonicalJson(unassignedSourceIds)) {
    fail("wakeflow-migration-host-decommission-coverage", "unassigned source closure is stale", { errorPath: "$/unassignedSourceIds" });
  }
  const blockerCodes = canonicalStrings(value.blockerCodes, "$/blockerCodes");
  const resourceFollowupDependencyIds = canonicalStrings(
    value.resourceFollowupDependencyIds,
    "$/resourceFollowupDependencyIds",
    { digestValues: true },
  );
  if (
    (unassignedSourceIds.length > 0) !== blockerCodes.includes("migration-host-source-unassigned")
    || (resourceFollowupDependencyIds.length > 0) !== blockerCodes.includes("migration-host-resource-followup-unresolved")
    || subjects.some((subject) => subject.blockerCodes.some((code) => !blockerCodes.includes(code)))
  ) fail("wakeflow-migration-host-decommission-plan", "plan blockers do not close subject/source failures", { errorPath: "$/blockerCodes" });
  if (!PLAN_STATUSES.has(value.status) || value.status !== (blockerCodes.length === 0 ? "ready" : "blocked")) {
    fail("wakeflow-migration-host-decommission-plan", "plan status differs from blockers", { errorPath: "$/status" });
  }
  const normalized = planUnsigned({
    artifactDigests,
    blockerCodes,
    coverage,
    hostId: selectedHostId,
    inventoryDigest: digest(value.inventoryDigest, "$/inventoryDigest"),
    migrationPlanDigest: digest(value.migrationPlanDigest, "$/migrationPlanDigest"),
    ownerDrainAssessmentDigest: nullableDigest(value.ownerDrainAssessmentDigest, "$/ownerDrainAssessmentDigest"),
    resourceFollowupDependencyIds,
    sourceSetDigest: digest(value.sourceSetDigest, "$/sourceSetDigest"),
    status: value.status,
    subjects,
    unassignedSourceIds,
  });
  if (digest(value.planDigest, "$/planDigest") !== canonicalJsonDigest(normalized)) {
    fail("wakeflow-migration-host-decommission-digest", "planDigest differs from the complete canonical plan", { errorPath: "$/planDigest" });
  }
  return deepFreeze(canonicalPrivacy({ ...normalized, planDigest: value.planDigest }, "$"));
}

/**
 * 把plan绑定回exact T05 MigrationPlan，复核artifact、coverage、owner-drain和T08依赖。
 * Host-specific source freshness仍由Codex/Claude适配器的双重观察负责。
 */
export function assertMigrationHostDecommissionPlanAgainstMigrationPlan(value = {}) {
  exactObject(value, ["migrationPlan", "plan"], "$", "wakeflow-migration-host-decommission-input");
  const plan = validateMigrationHostDecommissionPlan(value.plan);
  const migrationPlan = validateWakeflowMigrationPlan(value.migrationPlan);
  const coverage = coverageFromMigrationPlan(migrationPlan, plan.hostId);
  const ownerDrainBlockerRequired = migrationPlan.payload.ownerDrain?.summary.ownerDrainSatisfied !== true;
  if (
    plan.migrationPlanDigest !== migrationPlan.planDigest
    || plan.inventoryDigest !== migrationPlan.payload.inventory.inventoryDigest
    || plan.ownerDrainAssessmentDigest !== (migrationPlan.payload.ownerDrain?.assessmentDigest ?? null)
    || canonicalJson(plan.artifactDigests) !== canonicalJson({
      bootstrapArtifactDigest: migrationPlan.payload.artifacts.bootstrapArtifactDigest,
      legacyOwnerArtifactDigest: migrationPlan.payload.artifacts.legacyOwnerArtifactDigest,
    })
    || plan.coverage.coverageId !== coverage.coverageId
    || canonicalJson(plan.coverage.sourceIds) !== canonicalJson(coverage.sourceIds)
    || canonicalJson(plan.resourceFollowupDependencyIds) !== canonicalJson(resourceFollowupDependencyIdsFromMigrationPlan(migrationPlan))
    || plan.sourceSetDigest !== sourceSetDigestFromMigrationPlan(migrationPlan, coverage.sourceIds)
    || plan.blockerCodes.includes("migration-legacy-owner-drain-not-satisfied") !== ownerDrainBlockerRequired
  ) {
    fail("wakeflow-migration-host-decommission-stale", "host decommission plan differs from its exact migration plan", { errorPath: "$" });
  }
  return plan;
}

// ==================== 四、宿主outcome与I3证明策略 ====================

// 将一条宿主观察绑定到冻结subject，并按effect/proof策略重算完整outcome条目。
function normalizeSubjectOutcome(value, index, subject, selectedHostId) {
  const errorPath = `$/subjectOutcomes/${index}`;
  exactObject(value, ["effectStatus", "evidenceDigest", "postCloseAttempts", "proof", "reasonCode", "status", "subjectId"], errorPath);
  if (value.subjectId !== subject.subjectId || !SUBJECT_OUTCOME_STATUSES.has(value.status)) {
    fail("wakeflow-migration-host-decommission-outcome", "subject outcome identity or status is invalid", { errorPath });
  }
  if (!EFFECT_STATUSES.has(value.effectStatus) || !PROOF_KINDS.has(value.proof)) {
    fail("wakeflow-migration-host-decommission-outcome", "subject effect/proof is outside the closed vocabulary", { errorPath });
  }
  if (!Number.isInteger(value.postCloseAttempts) || value.postCloseAttempts < 0 || value.postCloseAttempts > 8) {
    fail("wakeflow-migration-host-decommission-outcome", "postCloseAttempts must be an integer from 0 through 8", { errorPath: `${errorPath}/postCloseAttempts` });
  }
  if (value.reasonCode !== null && !REASON_CODES.has(value.reasonCode)) {
    fail("wakeflow-migration-host-decommission-outcome", "reasonCode is outside the closed vocabulary", { errorPath: `${errorPath}/reasonCode` });
  }
  const evidenceDigest = digest(value.evidenceDigest, `${errorPath}/evidenceDigest`);
  const base = {
    effect: subject.effect,
    effectStatus: value.effectStatus,
    evidenceDigest,
    postCloseAttempts: value.postCloseAttempts,
    proof: value.proof,
    reasonCode: value.reasonCode,
    status: value.status,
    subjectDigest: subject.subjectDigest,
    subjectId: subject.subjectId,
  };
  const valid = hostEffectCompatible(selectedHostId, subject.effect)
    && (subject.state === "blocked"
    ? value.status === "blocked" && value.effectStatus === "not-attempted" && value.proof === "none" && value.reasonCode === "plan-blocked" && value.postCloseAttempts === 0
    : subject.effect === "none"
      ? value.status === "not-applicable" && value.effectStatus === "not-attempted" && value.proof === "source-freeze-only" && value.reasonCode === "source-freeze-only" && value.postCloseAttempts === 0
      : subject.effect === "archive"
        ? codexManualGateValid(value)
        : value.status === "machine-verified"
          ? value.effectStatus === "succeeded" && value.proof === "exact-post-close-absence" && value.postCloseAttempts >= 1 && value.reasonCode === null
          : value.status === "blocked"
            && value.proof === "none"
            && value.reasonCode?.startsWith("claude-"));
  if (!valid) {
    fail("wakeflow-migration-host-decommission-outcome", "subject outcome exceeds its frozen effect/proof policy", { errorPath });
  }
  const unsigned = { ...base };
  return { ...unsigned, outcomeDigest: canonicalJsonDigest(unsigned) };
}

// 汇总subject状态；任何blocked优先于manual/machine，不能被成功条目稀释。
function outcomeSummary(subjects) {
  const counts = Object.fromEntries([...SUBJECT_OUTCOME_STATUSES].map((status) => [status, 0]));
  for (const subject of subjects) counts[subject.status] += 1;
  const status = counts.blocked > 0
    ? "blocked"
    : counts["manual-host-gate"] > 0
      ? "manual-host-gate"
      : counts["machine-verified"] > 0
        ? "machine-verified"
        : "not-applicable";
  return {
    blockedCount: counts.blocked,
    machineVerifiedCount: counts["machine-verified"],
    manualHostGateCount: counts["manual-host-gate"],
    notApplicableCount: counts["not-applicable"],
    status,
    subjectCount: subjects.length,
  };
}

// 明确保留routing/source尚待迁移确认，T07 outcome本身不执行撤销或释放。
function outcomeUnsigned(value) {
  return {
    artifactKind: WAKEFLOW_MIGRATION_HOST_DECOMMISSION_OUTCOME_KIND,
    hostId: value.hostId,
    inventoryDigest: value.inventoryDigest,
    migrationPlanDigest: value.migrationPlanDigest,
    planDigest: value.planDigest,
    routingRevocation: "pending-migration-acknowledgement",
    schemaVersion: WAKEFLOW_MIGRATION_HOST_DECOMMISSION_SCHEMA_VERSION,
    sourceDisposition: "pending-migration-acknowledgement",
    sourceSetDigest: value.sourceSetDigest,
    subjectOutcomes: value.subjectOutcomes,
    summary: value.summary,
  };
}

/** 从exact plan与全量宿主观察创建一个HostDecommissionOutcome。 */
export function createMigrationHostDecommissionOutcome(value = {}) {
  exactObject(value, ["plan", "subjectOutcomes"], "$", "wakeflow-migration-host-decommission-input");
  const plan = validateMigrationHostDecommissionPlan(value.plan);
  const bySubject = new Map(plan.subjects.map((subject) => [subject.subjectId, subject]));
  const raw = denseArray(value.subjectOutcomes, "$/subjectOutcomes");
  if (raw.length !== plan.subjects.length) {
    fail("wakeflow-migration-host-decommission-outcome", "outcome must cover every frozen subject exactly once", { errorPath: "$/subjectOutcomes" });
  }
  const subjectOutcomes = raw.map((entry, index) => {
    const errorPath = `$/subjectOutcomes/${index}`;
    exactObject(entry, ["effectStatus", "evidenceDigest", "postCloseAttempts", "proof", "reasonCode", "status", "subjectId"], errorPath);
    const subjectIdDescriptor = Object.getOwnPropertyDescriptor(entry, "subjectId");
    const subject = bySubject.get(subjectIdDescriptor.value);
    if (!subject) fail("wakeflow-migration-host-decommission-outcome", "outcome references an unknown subject", { errorPath: `$/subjectOutcomes/${index}/subjectId` });
    return normalizeSubjectOutcome(entry, index, subject, plan.hostId);
  }).sort((left, right) => compareText(left.subjectId, right.subjectId));
  canonicalOrder(subjectOutcomes, (entry) => entry.subjectId, "$/subjectOutcomes");
  const unsigned = outcomeUnsigned({
    hostId: plan.hostId,
    inventoryDigest: plan.inventoryDigest,
    migrationPlanDigest: plan.migrationPlanDigest,
    planDigest: plan.planDigest,
    sourceSetDigest: plan.sourceSetDigest,
    subjectOutcomes,
    summary: outcomeSummary(subjectOutcomes),
  });
  return validateMigrationHostDecommissionOutcome({
    ...unsigned,
    outcomeDigest: canonicalJsonDigest(unsigned),
  });
}

/**
 * 校验portable outcome的宿主/effect/status字段矩阵和摘要闭包。
 * 由于standalone outcome不携带完整subject plan，随后仍必须调用AgainstPlan复核。
 */
export function validateMigrationHostDecommissionOutcome(value) {
  exactObject(value, [
    "artifactKind",
    "hostId",
    "inventoryDigest",
    "migrationPlanDigest",
    "outcomeDigest",
    "planDigest",
    "routingRevocation",
    "schemaVersion",
    "sourceDisposition",
    "sourceSetDigest",
    "subjectOutcomes",
    "summary",
  ], "$", "wakeflow-migration-host-decommission-outcome");
  if (
    value.artifactKind !== WAKEFLOW_MIGRATION_HOST_DECOMMISSION_OUTCOME_KIND
    || value.schemaVersion !== WAKEFLOW_MIGRATION_HOST_DECOMMISSION_SCHEMA_VERSION
    || value.routingRevocation !== "pending-migration-acknowledgement"
    || value.sourceDisposition !== "pending-migration-acknowledgement"
  ) fail("wakeflow-migration-host-decommission-outcome", "outcome identity or acknowledgement boundary is invalid");
  const selectedHostId = hostId(value.hostId, "$/hostId");
  const subjectOutcomes = denseArray(value.subjectOutcomes, "$/subjectOutcomes").map((entry, index) => {
    const at = `$/subjectOutcomes/${index}`;
    exactObject(entry, ["effect", "effectStatus", "evidenceDigest", "outcomeDigest", "postCloseAttempts", "proof", "reasonCode", "status", "subjectDigest", "subjectId"], at);
    if (!EFFECTS.has(entry.effect) || !EFFECT_STATUSES.has(entry.effectStatus) || !PROOF_KINDS.has(entry.proof) || !SUBJECT_OUTCOME_STATUSES.has(entry.status)) {
      fail("wakeflow-migration-host-decommission-outcome", "subject outcome vocabulary is invalid", { errorPath: at });
    }
    if (!Number.isInteger(entry.postCloseAttempts) || entry.postCloseAttempts < 0 || entry.postCloseAttempts > 8) {
      fail("wakeflow-migration-host-decommission-outcome", "postCloseAttempts is invalid", { errorPath: `${at}/postCloseAttempts` });
    }
    if (entry.reasonCode !== null && !REASON_CODES.has(entry.reasonCode)) {
      fail("wakeflow-migration-host-decommission-outcome", "reasonCode is invalid", { errorPath: `${at}/reasonCode` });
    }
    const normalized = {
      effect: entry.effect,
      effectStatus: entry.effectStatus,
      evidenceDigest: digest(entry.evidenceDigest, `${at}/evidenceDigest`),
      postCloseAttempts: entry.postCloseAttempts,
      proof: entry.proof,
      reasonCode: entry.reasonCode,
      status: entry.status,
      subjectDigest: digest(entry.subjectDigest, `${at}/subjectDigest`),
      subjectId: digest(entry.subjectId, `${at}/subjectId`),
    };
    if (!hostEffectCompatible(selectedHostId, normalized.effect)) {
      fail("wakeflow-migration-host-decommission-outcome", "subject effect is incompatible with the selected host", { errorPath: `${at}/effect` });
    }
    const planBlocked = normalized.status === "blocked"
      && normalized.effectStatus === "not-attempted"
      && normalized.postCloseAttempts === 0
      && normalized.proof === "none"
      && normalized.reasonCode === "plan-blocked";
    const sourceFreezeOnly = normalized.effect === "none"
      && normalized.status === "not-applicable"
      && normalized.effectStatus === "not-attempted"
      && normalized.postCloseAttempts === 0
      && normalized.proof === "source-freeze-only"
      && normalized.reasonCode === "source-freeze-only";
    const codexManualGate = selectedHostId === "codex"
      && normalized.effect === "archive"
      && codexManualGateValid(normalized);
    const claudeMachineProof = selectedHostId === "claude-code"
      && normalized.effect === "close"
      && normalized.status === "machine-verified"
      && normalized.effectStatus === "succeeded"
      && normalized.postCloseAttempts >= 1
      && normalized.proof === "exact-post-close-absence"
      && normalized.reasonCode === null;
    const claudeBlocked = selectedHostId === "claude-code"
      && normalized.effect === "close"
      && normalized.status === "blocked"
      && normalized.proof === "none"
      && normalized.reasonCode?.startsWith("claude-");
    if (!(planBlocked || sourceFreezeOnly || codexManualGate || claudeMachineProof || claudeBlocked)) {
      fail("wakeflow-migration-host-decommission-outcome", "subject outcome exceeds the standalone host proof boundary", { errorPath: at });
    }
    if (digest(entry.outcomeDigest, `${at}/outcomeDigest`) !== canonicalJsonDigest(normalized)) {
      fail("wakeflow-migration-host-decommission-digest", "subject outcome digest is stale", { errorPath: `${at}/outcomeDigest` });
    }
    return { ...normalized, outcomeDigest: entry.outcomeDigest };
  });
  canonicalOrder(subjectOutcomes, (entry) => entry.subjectId, "$/subjectOutcomes");
  exactObject(value.summary, ["blockedCount", "machineVerifiedCount", "manualHostGateCount", "notApplicableCount", "status", "subjectCount"], "$/summary");
  const summary = outcomeSummary(subjectOutcomes);
  if (canonicalJson(value.summary) !== canonicalJson(summary)) {
    fail("wakeflow-migration-host-decommission-outcome", "outcome summary differs from subject outcomes", { errorPath: "$/summary" });
  }
  const unsigned = outcomeUnsigned({
    hostId: selectedHostId,
    inventoryDigest: digest(value.inventoryDigest, "$/inventoryDigest"),
    migrationPlanDigest: digest(value.migrationPlanDigest, "$/migrationPlanDigest"),
    planDigest: digest(value.planDigest, "$/planDigest"),
    sourceSetDigest: digest(value.sourceSetDigest, "$/sourceSetDigest"),
    subjectOutcomes,
    summary,
  });
  if (digest(value.outcomeDigest, "$/outcomeDigest") !== canonicalJsonDigest(unsigned)) {
    fail("wakeflow-migration-host-decommission-digest", "outcomeDigest differs from the complete canonical outcome", { errorPath: "$/outcomeDigest" });
  }
  return deepFreeze(canonicalPrivacy({ ...unsigned, outcomeDigest: value.outcomeDigest }, "$"));
}

/**
 * 将outcome的每一条观察重新套用exact plan subject规则；缺条目、换effect、
 * blocked→machine重签或subject digest漂移都会作为stale失败。
 */
export function assertMigrationHostDecommissionOutcomeAgainstPlan(value = {}) {
  exactObject(value, ["outcome", "plan"], "$", "wakeflow-migration-host-decommission-input");
  const plan = validateMigrationHostDecommissionPlan(value.plan);
  const outcome = validateMigrationHostDecommissionOutcome(value.outcome);
  const envelopeDiffers = (
    outcome.hostId !== plan.hostId
    || outcome.inventoryDigest !== plan.inventoryDigest
    || outcome.migrationPlanDigest !== plan.migrationPlanDigest
    || outcome.planDigest !== plan.planDigest
    || outcome.sourceSetDigest !== plan.sourceSetDigest
    || canonicalJson(outcome.subjectOutcomes.map((entry) => entry.subjectId))
      !== canonicalJson(plan.subjects.map((entry) => entry.subjectId))
  );
  if (envelopeDiffers) {
    fail("wakeflow-migration-host-decommission-stale", "outcome differs from its exact decommission plan");
  }
  const bySubject = new Map(plan.subjects.map((subject) => [subject.subjectId, subject]));
  let rebound;
  try {
    rebound = outcome.subjectOutcomes.map((entry, index) => {
      const subject = bySubject.get(entry.subjectId);
      if (!subject) {
        fail("wakeflow-migration-host-decommission-stale", "outcome references a subject outside its exact plan", {
          errorPath: `$/outcome/subjectOutcomes/${index}/subjectId`,
        });
      }
      return normalizeSubjectOutcome({
        effectStatus: entry.effectStatus,
        evidenceDigest: entry.evidenceDigest,
        postCloseAttempts: entry.postCloseAttempts,
        proof: entry.proof,
        reasonCode: entry.reasonCode,
        status: entry.status,
        subjectId: entry.subjectId,
      }, index, subject, plan.hostId);
    });
  } catch (error) {
    if (error instanceof WakeflowMigrationHostDecommissionError && error.code === "wakeflow-migration-host-decommission-stale") throw error;
    fail("wakeflow-migration-host-decommission-stale", "outcome exceeds its exact decommission plan", { cause: error });
  }
  if (canonicalJson(rebound) !== canonicalJson(outcome.subjectOutcomes)) {
    fail("wakeflow-migration-host-decommission-stale", "outcome subject evidence differs from its exact decommission plan");
  }
  return outcome;
}

// ==================== 五、全宿主assessment与portable序列化 ====================

// 汇总coverage结论；missing/blocked优先，manual gate不会被标记为satisfied。
function assessmentSummary(coverage) {
  const blockedCount = coverage.filter((entry) => entry.status === "blocked" || entry.status === "missing").length;
  const manualHostGateCount = coverage.filter((entry) => entry.status === "manual-host-gate").length;
  return {
    blockedCount,
    coverageCount: coverage.length,
    decommissionSatisfied: blockedCount === 0 && manualHostGateCount === 0,
    manualHostGateCount,
    status: blockedCount > 0 ? "blocked" : manualHostGateCount > 0 ? "manual-host-gate" : "satisfied",
  };
}

// 形成assessmentDigest覆盖的完整unsigned投影。
function assessmentUnsigned(value) {
  return {
    artifactKind: WAKEFLOW_MIGRATION_HOST_DECOMMISSION_ASSESSMENT_KIND,
    coverage: value.coverage,
    inventoryDigest: value.inventoryDigest,
    migrationPlanDigest: value.migrationPlanDigest,
    schemaVersion: WAKEFLOW_MIGRATION_HOST_DECOMMISSION_SCHEMA_VERSION,
    summary: value.summary,
  };
}

/**
 * 以T05 decommissionCoverage为全集合并已冻结plan/outcome；缺失或unknown均保持missing。
 */
export function assessMigrationHostDecommission(value = {}) {
  exactObject(value, ["migrationPlan", "outcomes", "plans"], "$", "wakeflow-migration-host-decommission-input");
  const migrationPlan = validateWakeflowMigrationPlan(value.migrationPlan);
  const plans = denseArray(value.plans, "$/plans")
    .map((plan) => assertMigrationHostDecommissionPlanAgainstMigrationPlan({ migrationPlan, plan }));
  canonicalOrder(plans, (entry) => entry.hostId, "$/plans");
  const outcomes = denseArray(value.outcomes, "$/outcomes").map(validateMigrationHostDecommissionOutcome);
  canonicalOrder(outcomes, (entry) => entry.hostId, "$/outcomes");
  const byPlanHost = new Map(plans.map((plan) => [plan.hostId, plan]));
  const byHost = new Map(outcomes.map((outcome) => [outcome.hostId, outcome]));
  for (const outcome of outcomes) {
    const plan = byPlanHost.get(outcome.hostId);
    if (plan === undefined) {
      fail("wakeflow-migration-host-decommission-coverage", "outcome has no exact frozen host plan", {
        errorPath: "$/outcomes",
        details: { hostId: outcome.hostId },
      });
    }
    assertMigrationHostDecommissionOutcomeAgainstPlan({ outcome, plan });
  }
  const coverage = migrationPlan.payload.decommissionCoverage.map((entry) => {
    const plan = byPlanHost.get(entry.hostId) ?? null;
    const outcome = byHost.get(entry.hostId) ?? null;
    const matching = plan !== null
      && outcome !== null
      && outcome.planDigest === plan.planDigest
      && outcome.migrationPlanDigest === migrationPlan.planDigest
      && outcome.inventoryDigest === migrationPlan.payload.inventory.inventoryDigest;
    return {
      coverageId: entry.coverageId,
      hostId: entry.hostId,
      outcomeDigest: matching ? outcome.outcomeDigest : null,
      planDigest: plan?.planDigest ?? null,
      sourceIds: entry.sourceIds,
      status: !matching ? "missing" : plan.status === "blocked" ? "blocked" : outcome.summary.status,
    };
  });
  const unsigned = assessmentUnsigned({
    coverage,
    inventoryDigest: migrationPlan.payload.inventory.inventoryDigest,
    migrationPlanDigest: migrationPlan.planDigest,
    summary: assessmentSummary(coverage),
  });
  return validateMigrationHostDecommissionAssessment({
    ...unsigned,
    assessmentDigest: canonicalJsonDigest(unsigned),
  });
}

/** 校验coverage身份、唯一宿主、证据存在性及I3宿主/状态矩阵。 */
export function validateMigrationHostDecommissionAssessment(value) {
  exactObject(value, ["artifactKind", "assessmentDigest", "coverage", "inventoryDigest", "migrationPlanDigest", "schemaVersion", "summary"], "$", "wakeflow-migration-host-decommission-assessment");
  if (
    value.artifactKind !== WAKEFLOW_MIGRATION_HOST_DECOMMISSION_ASSESSMENT_KIND
    || value.schemaVersion !== WAKEFLOW_MIGRATION_HOST_DECOMMISSION_SCHEMA_VERSION
  ) fail("wakeflow-migration-host-decommission-assessment", "assessment kind or schema version is invalid");
  const coverage = denseArray(value.coverage, "$/coverage").map((entry, index) => {
    const at = `$/coverage/${index}`;
    exactObject(entry, ["coverageId", "hostId", "outcomeDigest", "planDigest", "sourceIds", "status"], at);
    if (!ASSESSMENT_COVERAGE_STATUSES.has(entry.status)) {
      fail("wakeflow-migration-host-decommission-assessment", "coverage status is invalid", { errorPath: `${at}/status` });
    }
    return {
      coverageId: digest(entry.coverageId, `${at}/coverageId`),
      hostId: assessmentHostId(entry.hostId, `${at}/hostId`),
      outcomeDigest: nullableDigest(entry.outcomeDigest, `${at}/outcomeDigest`),
      planDigest: nullableDigest(entry.planDigest, `${at}/planDigest`),
      sourceIds: canonicalStrings(entry.sourceIds, `${at}/sourceIds`, { allowEmpty: false, digestValues: true }),
      status: entry.status,
    };
  });
  for (const [index, entry] of coverage.entries()) {
    const at = `$/coverage/${index}`;
    if (
      (entry.status === "missing" && entry.outcomeDigest !== null)
      || (entry.status !== "missing" && (entry.outcomeDigest === null || entry.planDigest === null))
      || (entry.outcomeDigest !== null && entry.planDigest === null)
    ) {
      fail("wakeflow-migration-host-decommission-assessment", "coverage status differs from its exact plan/outcome evidence", { errorPath: at });
    }
    if (entry.coverageId !== coverageIdFor(entry.hostId, entry.sourceIds)) {
      fail("wakeflow-migration-host-decommission-assessment", "coverage identity differs from its host and source set", {
        errorPath: `${at}/coverageId`,
      });
    }
    if (
      (entry.hostId === "unknown" && (
        entry.status !== "missing"
        || entry.planDigest !== null
        || entry.outcomeDigest !== null
      ))
      || (entry.hostId === "codex" && entry.status === "machine-verified")
      || (entry.hostId === "claude-code" && entry.status === "manual-host-gate")
    ) {
      fail("wakeflow-migration-host-decommission-assessment", "coverage status exceeds the I3 host proof boundary", { errorPath: at });
    }
  }
  canonicalOrder(coverage, (entry) => entry.coverageId, "$/coverage");
  if (new Set(coverage.map((entry) => entry.hostId)).size !== coverage.length) {
    fail("wakeflow-migration-host-decommission-assessment", "assessment contains duplicate host coverage", {
      errorPath: "$/coverage",
    });
  }
  exactObject(value.summary, ["blockedCount", "coverageCount", "decommissionSatisfied", "manualHostGateCount", "status"], "$/summary");
  const summary = assessmentSummary(coverage);
  if (!ASSESSMENT_STATUSES.has(value.summary.status) || canonicalJson(value.summary) !== canonicalJson(summary)) {
    fail("wakeflow-migration-host-decommission-assessment", "assessment summary differs from coverage", { errorPath: "$/summary" });
  }
  const unsigned = assessmentUnsigned({
    coverage,
    inventoryDigest: digest(value.inventoryDigest, "$/inventoryDigest"),
    migrationPlanDigest: digest(value.migrationPlanDigest, "$/migrationPlanDigest"),
    summary,
  });
  if (digest(value.assessmentDigest, "$/assessmentDigest") !== canonicalJsonDigest(unsigned)) {
    fail("wakeflow-migration-host-decommission-digest", "assessmentDigest differs from the complete canonical assessment", { errorPath: "$/assessmentDigest" });
  }
  return deepFreeze(canonicalPrivacy({ ...unsigned, assessmentDigest: value.assessmentDigest }, "$"));
}

/**
 * 先通过own data descriptor选择validator，再输出单换行canonical UTF-8 bytes；
 * 分派过程不会执行调用方提供的artifactKind getter。
 */
export function migrationHostDecommissionCanonicalBytes(value) {
  if (!plainObject(value)) {
    fail("wakeflow-migration-host-decommission-contract", "artifact must be one plain data object", { errorPath: "$" });
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "artifactKind");
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail("wakeflow-migration-host-decommission-contract", "artifactKind must be an enumerable data property", { errorPath: "$/artifactKind" });
  }
  if (descriptor.value === WAKEFLOW_MIGRATION_HOST_DECOMMISSION_PLAN_KIND) {
    return Buffer.from(`${canonicalJson(validateMigrationHostDecommissionPlan(value))}\n`, "utf8");
  }
  if (descriptor.value === WAKEFLOW_MIGRATION_HOST_DECOMMISSION_OUTCOME_KIND) {
    return Buffer.from(`${canonicalJson(validateMigrationHostDecommissionOutcome(value))}\n`, "utf8");
  }
  if (descriptor.value === WAKEFLOW_MIGRATION_HOST_DECOMMISSION_ASSESSMENT_KIND) {
    return Buffer.from(`${canonicalJson(validateMigrationHostDecommissionAssessment(value))}\n`, "utf8");
  }
  fail("wakeflow-migration-host-decommission-contract", "artifact kind is unsupported", { errorPath: "$/artifactKind" });
}
