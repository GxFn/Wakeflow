/**
 * Controller-owned managed evidence的preview/apply/recover编排层。
 *
 * 能力导航：
 * - authority context：readCandidateConfig、loadContext、controllerAdmission。
 * - source/relation准入：sourceRoot、normalizeRelations。
 * - immutable plan：buildPlan、validatePlanEnvelope、rebuildPlan。
 * - state-root effect：applyManagedEvidenceImport、recoverManagedEvidenceImport。
 *
 * 本文件不扫描或发布文件本身：source capture与目录stage/publish归evidence-tree，manifest
 * codec归evidence-records，journal/event/state顺序归demand-state-service。plan digest只关闭
 * 完整预览内容，不是权限令牌；记录证据也不等于认可其内容或完成需求。
 */
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  loadWakeflowConfigV3Snapshot,
  WakeflowConfigV3SnapshotError,
} from "./wakeflow-config-v3-snapshot.mjs";
import {
  loadDemandCoreRecords,
  validateControllerEventRecord,
  validateDemandStateRecord,
  validateStateTransitionRecord,
} from "./wakeflow-demand-core-records.mjs";
import {
  commitDemandEvidenceTransition,
  recoverDemandStateTransition,
} from "./wakeflow-demand-state-service.mjs";
import {
  loadDemandArtifactByRef,
} from "./wakeflow-demand-artifact-records.mjs";
import {
  evidenceIdentity,
  inspectManagedEvidenceInventory,
  loadManagedEvidenceByRef,
  WAKEFLOW_EVIDENCE_MAX_RELATIONS,
  validateEvidenceManifest,
} from "./wakeflow-evidence-records.mjs";
import {
  inspectConfiguredEvidenceSource,
} from "./wakeflow-evidence-tree.mjs";
import {
  assertWakeflowId,
  generateWakeflowId,
} from "./wakeflow-identifiers.mjs";

const PLAN_SCHEMA_VERSION = 1;
const PLAN_KIND = "wakeflow-evidence-import-plan";
const CONFIG_FILE = "wakeflow.config.json";
const ACTIVE_CURRENT_REF = ".wakeflow-active/current";
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?Z$/u;
const T05_RELATION_KINDS = new Map([
  ["wakeflow-task-package", "task-package"],
  ["wakeflow-target-result", "target-result"],
  ["wakeflow-review-candidate", "review-candidate"],
  ["wakeflow-test-card", "test-card"],
]);

// ==================== 一、错误、闭合输入与基础标量 ====================

export class WakeflowEvidenceImporterError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message);
    this.name = "WakeflowEvidenceImporterError";
    this.code = code;
    this.details = Object.freeze({
      ...details,
      ...(cause?.code ? { causeCode: cause.code } : {}),
    });
  }
}

function importerError(code, message, details = {}, cause = undefined) {
  return new WakeflowEvidenceImporterError(code, message, { details, cause });
}

function boundaryError(cause, phase) {
  if (cause instanceof WakeflowEvidenceImporterError) return cause;
  const causeCode = typeof cause?.code === "string" ? cause.code : null;
  const code = causeCode && /^wakeflow-[a-z0-9-]+$/u.test(causeCode)
    ? causeCode
    : `wakeflow-evidence-import-${phase}`;
  return importerError(
    code,
    `managed evidence ${phase} failed closed${causeCode ? ` (${causeCode})` : ""}`,
    { causeCode },
  );
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw importerError("wakeflow-evidence-import-input", `${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw importerError("wakeflow-evidence-import-input", `${label} must be a plain data object`);
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 公开入口先复制成无行为canonical数据，避免校验过程执行调用方accessor或忽略隐藏字段。
function canonicalInputSnapshot(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    throw importerError(
      "wakeflow-evidence-import-input",
      `${label} must be canonical plain data without accessors, symbols, hidden fields, or cycles`,
      { causeCode: cause?.code ?? null },
      cause,
    );
  }
}

function frozenCanonical(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value, allowed, required, label) {
  plainObject(value, label);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw importerError("wakeflow-evidence-import-input", `${label} contains unknown field ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw importerError("wakeflow-evidence-import-input", `${label} is missing ${key}`);
    }
  }
  return value;
}

function token(value, label) {
  if (
    typeof value !== "string"
    || !value.trim()
    || value !== value.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || /[\r\n]/u.test(value)
    || Buffer.byteLength(value, "utf8") > 128
  ) {
    throw importerError(
      "wakeflow-evidence-import-input",
      `${label} must be one trimmed control-free line of at most 128 UTF-8 bytes`,
    );
  }
  return value;
}

function timestamp(value, label) {
  token(value, label);
  const match = value.match(TIMESTAMP_RE);
  if (!match || Number.isNaN(Date.parse(value))) {
    throw importerError("wakeflow-evidence-import-time", `${label} must be one real UTC RFC3339 instant`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    throw importerError("wakeflow-evidence-import-digest", `${label} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

// ==================== 二、config、state-root与Controller authority context ====================

// 每次调用重新读取strict v3 config；不缓存“当前workspace”或跨操作复用authority。
function readCandidateConfig(configPath) {
  if (typeof configPath !== "string" || !configPath.trim() || path.basename(configPath) !== CONFIG_FILE) {
    throw importerError(
      "wakeflow-evidence-import-config",
      `configPath must name the canonical ${CONFIG_FILE}`,
    );
  }
  const absolute = path.resolve(configPath);
  let snapshot;
  try {
    snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: path.dirname(absolute) });
  } catch (cause) {
    if (cause instanceof WakeflowConfigV3SnapshotError) {
      if (cause.code === "wakeflow-config-v3-snapshot-placement") {
        throw importerError(
          "wakeflow-evidence-import-config-placement",
          "current v3 config has overlapping, aliased, or unsafe protocol roots",
          { causeCode: cause.code },
        );
      }
      throw importerError(
        "wakeflow-evidence-import-config",
        `${CONFIG_FILE} cannot be loaded as one strict v3 candidate`,
        { causeCode: cause.code },
      );
    }
    throw importerError(
      "wakeflow-evidence-import-config",
      `${CONFIG_FILE} cannot be loaded as one strict v3 candidate`,
    );
  }
  return Object.freeze({
    config: snapshot.model,
    configPath: absolute,
    configDigest: snapshot.configDigest,
    workspaceRoot: snapshot.workspaceRoot,
    ledgerRoot: snapshot.ledgerRoot,
    indexes: snapshot.indexes,
  });
}

function ledgerRootFor(configContext) {
  return configContext.ledgerRoot
    ?? path.resolve(configContext.workspaceRoot, configContext.config.storage.ledgerRoot);
}

function assertCanonicalStateRoot(configContext, stateRoot, demandId) {
  if (typeof stateRoot !== "string" || !stateRoot.trim()) {
    throw importerError("wakeflow-evidence-import-state-root", "stateRoot must be a non-empty path");
  }
  const expected = path.resolve(
    configContext.workspaceRoot,
    ACTIVE_CURRENT_REF,
    demandId,
  );
  const actual = path.resolve(stateRoot);
  if (actual !== expected) {
    throw importerError(
      "wakeflow-evidence-import-state-root",
      "stateRoot must be the canonical current root for the typed demand",
      { demandId },
    );
  }
  return actual;
}

function assertEvidenceClosure(loaded) {
  const inventory = inspectManagedEvidenceInventory({
    stateRoot: loaded.paths.stateRoot,
    expectedProgramId: loaded.demand.programId,
    expectedDemandId: loaded.demand.demandId,
    expectedDemandDigest: loaded.digests.demand,
    expectedEvidence: loaded.state.evidence,
  });
  if (!inventory.healthy) {
    throw importerError(
      "wakeflow-evidence-import-inventory",
      "managed evidence inventory is not in exact committed closure",
      { issues: inventory.issues },
    );
  }
}

// 同时关闭config、canonical demand root、core stack和全部既有evidence inventory。
function loadContext({
  configPath,
  stateRoot,
  expectedProgramId = null,
  loadedDemandCore = null,
} = {}) {
  const configContext = readCandidateConfig(configPath);
  const programId = expectedProgramId === null
    ? configContext.config.program.programId
    : assertWakeflowId(expectedProgramId, "program", "$expectedProgramId");
  if (programId !== configContext.config.program.programId) {
    throw importerError(
      "wakeflow-evidence-import-program",
      "expectedProgramId differs from the current v3 config",
    );
  }
  const provisional = loadedDemandCore ?? loadDemandCoreRecords({
    stateRoot,
    expectedProgramId: programId,
    ledgerRoot: ledgerRootFor(configContext),
  });
  if (
    provisional.demand.programId !== programId
    || provisional.paths.stateRoot !== path.resolve(stateRoot)
  ) {
    throw importerError(
      "wakeflow-evidence-import-state-root",
      "locked demand records differ from the requested program or state root",
    );
  }
  const canonicalStateRoot = assertCanonicalStateRoot(configContext, stateRoot, provisional.demand.demandId);
  assertEvidenceClosure(provisional);
  return Object.freeze({
    ...configContext,
    expectedProgramId: programId,
    ledgerRoot: ledgerRootFor(configContext),
    stateRoot: canonicalStateRoot,
    loaded: provisional,
  });
}

function controllerAdmission(context, controllerWindowId) {
  assertWakeflowId(controllerWindowId, "window", "$controllerWindowId");
  if (controllerWindowId !== context.indexes.controllerWindow.windowId) {
    throw importerError(
      "wakeflow-evidence-import-controller",
      "controllerWindowId must be the exact Controller window in the current v3 config",
    );
  }
  return controllerWindowId;
}

// ==================== 三、source root与same-demand relation准入 ====================

// 只把typed config root解析成物理读取根；locator source不会触发网络或Git操作。
function sourceRoot(context, source) {
  if (source.kind === "git-commit") {
    if (!context.indexes.repositoryById[source.repositoryId]) {
      throw importerError(
        "wakeflow-evidence-import-source-root",
        "Git evidence locator repositoryId is not configured",
      );
    }
    return null;
  }
  if (source.kind !== "managed-path") return null;
  const root = plainObject(source.root, "source.root");
  if (root.kind === "repository") {
    const repository = context.indexes.repositoryById[root.repositoryId];
    if (!repository) {
      throw importerError("wakeflow-evidence-import-source-root", "source repositoryId is not configured");
    }
    return path.resolve(context.workspaceRoot, repository.path);
  }
  if (root.kind === "support-surface") {
    const surface = context.indexes.surfaceById[root.surfaceId];
    if (!surface) {
      throw importerError("wakeflow-evidence-import-source-root", "source surfaceId is not configured");
    }
    return path.resolve(context.workspaceRoot, surface.path);
  }
  throw importerError(
    "wakeflow-evidence-import-source-root",
    "managed evidence source root must be one typed repository or support surface",
  );
}

function normalizeRelations(relations, context) {
  if (!Array.isArray(relations) || relations.length > WAKEFLOW_EVIDENCE_MAX_RELATIONS) {
    throw importerError("wakeflow-evidence-import-relation", "relations must be an array with at most 256 entries");
  }
  const normalized = relations.map((relation, index) => {
    plainObject(relation, `relations[${index}]`);
    if (relation.kind === "artifact") {
      exactKeys(
        relation,
        ["kind", "artifactKind", "artifactId", "ref", "digest"],
        ["kind", "artifactKind", "artifactId", "ref", "digest"],
        `relations[${index}]`,
      );
      const idType = T05_RELATION_KINDS.get(relation.artifactKind);
      if (!idType) {
        throw importerError(
          "wakeflow-evidence-import-relation",
          "artifact relation kind must be one T05 immutable artifact kind",
        );
      }
      const artifactId = assertWakeflowId(relation.artifactId, idType, `$relations/${index}/artifactId`);
      digest(relation.digest, `relations[${index}].digest`);
      loadDemandArtifactByRef({
        stateRoot: context.stateRoot,
        ref: relation.ref,
        digest: relation.digest,
        expectedArtifactKind: relation.artifactKind,
        expectedArtifactId: artifactId,
        expectedProgramId: context.expectedProgramId,
        expectedDemandId: context.loaded.demand.demandId,
      });
      return Object.freeze({
        kind: "artifact",
        artifactKind: relation.artifactKind,
        artifactId,
        ref: relation.ref,
        digest: relation.digest,
      });
    }
    if (relation.kind === "controller-event") {
      exactKeys(
        relation,
        ["kind", "eventId", "digest"],
        ["kind", "eventId", "digest"],
        `relations[${index}]`,
      );
      const eventId = token(relation.eventId, `relations[${index}].eventId`);
      digest(relation.digest, `relations[${index}].digest`);
      const event = context.loaded.events.find((entry) => entry.eventId === eventId);
      if (!event || canonicalJsonDigest(event) !== relation.digest) {
        throw importerError(
          "wakeflow-evidence-import-relation",
          "controller-event relation must bind one exact event in this demand",
        );
      }
      return Object.freeze({
        kind: "controller-event",
        eventId,
        digest: relation.digest,
      });
    }
    throw importerError(
      "wakeflow-evidence-import-relation",
      "relation kind must be artifact or controller-event",
    );
  });
  normalized.sort((left, right) => lexicalCompare(canonicalJson(left), canonicalJson(right)));
  const keys = normalized.map((entry) => canonicalJson(entry));
  if (new Set(keys).size !== keys.length) {
    throw importerError("wakeflow-evidence-import-relation", "relations must be unique");
  }
  return Object.freeze(normalized);
}

function fixedIdentity({ evidenceId, capturedAt, uuidFactory, clock }) {
  const id = evidenceId === null
    ? generateWakeflowId("evidence", uuidFactory)
    : assertWakeflowId(evidenceId, "evidence", "$evidenceId");
  const instant = capturedAt === null ? clock() : capturedAt;
  return Object.freeze({ evidenceId: id, capturedAt: timestamp(instant, "capturedAt") });
}

// evidence记录只推进revision并追加事实，不改变当前业务state或产生验收决定。
function buildEventAndState({ context, manifest, identity }) {
  const artifact = evidenceIdentity(manifest);
  const eventId = `event-evidence-recorded-${identity.evidenceId}`;
  const reason = `Recorded managed evidence ${identity.evidenceId}.`;
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId,
    demandId: context.loaded.demand.demandId,
    createdAt: identity.capturedAt,
    actor: "controller",
    command: "record-evidence",
    type: "evidence.recorded",
    previousRevision: context.loaded.state.revision,
    nextRevision: context.loaded.state.revision + 1,
    from: context.loaded.state.state,
    to: context.loaded.state.state,
    reason,
    decisionSummary: "Managed evidence was recorded as immutable review input; this event does not establish acceptance.",
    changedArtifacts: [{
      artifactKind: artifact.artifactKind,
      artifactId: artifact.artifactId,
      ref: artifact.ref,
      digest: artifact.digest,
    }],
  });
  const eventDigest = canonicalJsonDigest(event);
  const evidence = [
    ...context.loaded.state.evidence,
    { evidenceId: identity.evidenceId, ref: artifact.ref, digest: artifact.digest },
  ].sort((left, right) => lexicalCompare(left.evidenceId, right.evidenceId));
  const state = validateDemandStateRecord({
    ...context.loaded.state,
    revision: event.nextRevision,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: { eventId: event.eventId, eventDigest },
    evidence,
  });
  return Object.freeze({ event, eventDigest, state, stateDigest: canonicalJsonDigest(state) });
}

// ==================== 四、immutable import plan构造与preview ====================

// 构造完整source/config/state/manifest/event/transaction闭包；调用本身不写文件。
function buildPlan({
  stateRoot,
  configPath,
  controllerWindowId,
  kind,
  source,
  relations = [],
  sensitivity = "internal",
  controllerReviewedOpaque = false,
  evidenceId = null,
  capturedAt = null,
  uuidFactory = randomUUID,
  clock = () => new Date().toISOString(),
} = {}, contextOverride = null) {
  const context = contextOverride ?? loadContext({ configPath, stateRoot });
  const admittedController = controllerAdmission(context, controllerWindowId);
  const evidenceKind = token(kind, "kind");
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw importerError("wakeflow-evidence-import-source", "source must be one strict evidence source object");
  }
  if (!new Set(["public", "internal"]).has(sensitivity)) {
    throw importerError("wakeflow-evidence-import-sensitivity", "sensitivity must be public or internal");
  }
  if (typeof controllerReviewedOpaque !== "boolean") {
    throw importerError(
      "wakeflow-evidence-import-sensitivity",
      "controllerReviewedOpaque must be boolean",
    );
  }
  const identity = fixedIdentity({ evidenceId, capturedAt, uuidFactory, clock });
  const normalizedRelations = normalizeRelations(relations, context);
  let inspected;
  let resolvedSourceRoot = null;
  if (source.kind === "managed-path") {
    resolvedSourceRoot = sourceRoot(context, source);
    inspected = inspectConfiguredEvidenceSource({
      root: resolvedSourceRoot,
      source,
      sensitivity,
      controllerReviewedOpaque,
    });
  } else {
    sourceRoot(context, source);
    if (controllerReviewedOpaque) {
      throw importerError(
        "wakeflow-evidence-import-sensitivity",
        "locator-only evidence cannot claim an opaque payload review",
      );
    }
    inspected = Object.freeze({
      source,
      privacyScan: Object.freeze({
        schemaVersion: 1,
        disposition: "passed",
        findingCounts: Object.freeze([]),
      }),
      sourceSnapshot: Object.freeze({
        type: "locator",
        digest: source?.verification?.digest,
      }),
    });
  }
  const manifest = validateEvidenceManifest({
    schemaVersion: 1,
    artifactKind: "wakeflow-evidence",
    programId: context.loaded.demand.programId,
    demandId: context.loaded.demand.demandId,
    demandRef: "demand.json",
    demandDigest: context.loaded.digests.demand,
    evidenceId: identity.evidenceId,
    kind: evidenceKind,
    capturedAt: identity.capturedAt,
    recordedBy: {
      windowId: admittedController,
      role: "controller",
      configDigest: context.configDigest,
    },
    source: inspected.source,
    sensitivity,
    privacyScan: inspected.privacyScan,
    relations: normalizedRelations,
    ...(inspected.payload ? { payload: inspected.payload } : {}),
    ...(inspected.controllerReviewedOpaque ? { controllerReviewedOpaque: true } : {}),
  });
  const artifact = evidenceIdentity(manifest);
  if (context.loaded.state.evidence.some((entry) => entry.evidenceId === identity.evidenceId)) {
    throw importerError("wakeflow-evidence-import-conflict", "evidenceId is already present in current state");
  }
  const transition = buildEventAndState({ context, manifest, identity });
  const transaction = validateStateTransitionRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: context.loaded.demand.demandId,
    command: transition.event.command,
    createdAt: transition.event.createdAt,
    expectedPreviousRevision: context.loaded.state.revision,
    expectedPreviousStateDigest: context.loaded.digests.state,
    previousState: context.loaded.state,
    nextEvent: transition.event,
    nextEventDigest: transition.eventDigest,
    nextState: transition.state,
    nextStateDigest: transition.stateDigest,
    artifactWrites: [{ ...artifact, value: manifest }],
  }, {
    demand: context.loaded.demand,
    currentState: context.loaded.state,
    ledgerRoot: context.ledgerRoot,
  });
  const plan = frozenCanonical({
    schemaVersion: PLAN_SCHEMA_VERSION,
    artifactKind: PLAN_KIND,
    programId: context.expectedProgramId,
    demandId: context.loaded.demand.demandId,
    evidenceId: identity.evidenceId,
    capturedAt: identity.capturedAt,
    eventId: transition.event.eventId,
    configSnapshot: {
      programId: context.expectedProgramId,
      digest: context.configDigest,
    },
    stateSnapshot: {
      revision: context.loaded.state.revision,
      digest: context.loaded.digests.state,
    },
    sourceSnapshot: inspected.sourceSnapshot,
    controllerWindowId: admittedController,
    manifest,
    nextEvent: transition.event,
    nextState: transition.state,
    transaction,
    paths: {
      journalRef: "transactions/state-transition.json",
      stageRootRef: `evidence/.${identity.evidenceId}.wakeflow-stage`,
      evidenceRootRef: `evidence/${identity.evidenceId}`,
      manifestRef: artifact.ref,
    },
  });
  return Object.freeze({ context, plan, resolvedSourceRoot });
}

/**
 * 预览一次证据导入，冻结程序生成identity/time、source/config/state快照和完整事务计划。
 * preview严格零写入；返回的planDigest只用于完整性复验。
 */
export function planManagedEvidenceImport(input = {}) {
  input = canonicalInputSnapshot(input, "previewInput");
  exactKeys(
    input,
    [
      "stateRoot",
      "configPath",
      "controllerWindowId",
      "kind",
      "source",
      "relations",
      "sensitivity",
      "controllerReviewedOpaque",
    ],
    ["stateRoot", "configPath", "controllerWindowId", "kind", "source"],
    "previewInput",
  );
  try {
    const plan = buildPlan(input).plan;
    return deepFreeze({ plan, planDigest: canonicalJsonDigest(plan) });
  } catch (cause) {
    throw boundaryError(cause, "preview");
  }
}

// ==================== 五、plan codec与apply时完整重推 ====================

// 验证调用方交回的完整plan内部所有identity、path、event、state和transaction交叉关系。
function validatePlanEnvelope(plan, planDigest) {
  exactKeys(plan, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "evidenceId",
    "capturedAt",
    "eventId",
    "configSnapshot",
    "stateSnapshot",
    "sourceSnapshot",
    "controllerWindowId",
    "manifest",
    "nextEvent",
    "nextState",
    "transaction",
    "paths",
  ], [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "evidenceId",
    "capturedAt",
    "eventId",
    "configSnapshot",
    "stateSnapshot",
    "sourceSnapshot",
    "controllerWindowId",
    "manifest",
    "nextEvent",
    "nextState",
    "transaction",
    "paths",
  ], "plan");
  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION || plan.artifactKind !== PLAN_KIND) {
    throw importerError("wakeflow-evidence-import-plan", "unsupported evidence import plan");
  }
  assertWakeflowId(plan.programId, "program", "$plan/programId");
  assertWakeflowId(plan.demandId, "demand", "$plan/demandId");
  assertWakeflowId(plan.evidenceId, "evidence", "$plan/evidenceId");
  assertWakeflowId(plan.controllerWindowId, "window", "$plan/controllerWindowId");
  timestamp(plan.capturedAt, "plan.capturedAt");
  token(plan.eventId, "plan.eventId");
  exactKeys(
    plan.configSnapshot,
    ["programId", "digest"],
    ["programId", "digest"],
    "plan.configSnapshot",
  );
  assertWakeflowId(plan.configSnapshot.programId, "program", "$plan/configSnapshot/programId");
  digest(plan.configSnapshot.digest, "plan.configSnapshot.digest");
  exactKeys(
    plan.stateSnapshot,
    ["revision", "digest"],
    ["revision", "digest"],
    "plan.stateSnapshot",
  );
  if (!Number.isInteger(plan.stateSnapshot.revision) || plan.stateSnapshot.revision < 1) {
    throw importerError("wakeflow-evidence-import-plan", "plan state revision must be a positive integer");
  }
  digest(plan.stateSnapshot.digest, "plan.stateSnapshot.digest");
  exactKeys(
    plan.paths,
    ["journalRef", "stageRootRef", "evidenceRootRef", "manifestRef"],
    ["journalRef", "stageRootRef", "evidenceRootRef", "manifestRef"],
    "plan.paths",
  );
  plainObject(plan.sourceSnapshot, "plan.sourceSnapshot");
  if (plan.sourceSnapshot.type === "locator") {
    exactKeys(plan.sourceSnapshot, ["type", "digest"], ["type", "digest"], "plan.sourceSnapshot");
  } else {
    exactKeys(
      plan.sourceSnapshot,
      ["type", "digest", "fileCount", "directoryCount", "totalBytes"],
      ["type", "digest", "fileCount", "directoryCount", "totalBytes"],
      "plan.sourceSnapshot",
    );
    if (!new Set(["file", "tree"]).has(plan.sourceSnapshot.type)) {
      throw importerError("wakeflow-evidence-import-plan", "managed source snapshot type must be file or tree");
    }
    for (const field of ["fileCount", "directoryCount", "totalBytes"]) {
      if (!Number.isInteger(plan.sourceSnapshot[field]) || plan.sourceSnapshot[field] < 0) {
        throw importerError("wakeflow-evidence-import-plan", `plan sourceSnapshot.${field} must be non-negative`);
      }
    }
  }
  digest(plan.sourceSnapshot.digest, "plan.sourceSnapshot.digest");
  digest(planDigest, "planDigest");
  if (canonicalJsonDigest(plan) !== planDigest) {
    throw importerError("wakeflow-evidence-import-plan", "planDigest does not match the full canonical plan");
  }
  const evidence = validateEvidenceManifest(plan.manifest);
  const identity = evidenceIdentity(evidence);
  const event = validateControllerEventRecord(plan.nextEvent);
  const state = validateDemandStateRecord(plan.nextState);
  const transaction = exactKeys(
    plan.transaction,
    [
      "schemaVersion",
      "artifactKind",
      "demandId",
      "command",
      "createdAt",
      "expectedPreviousRevision",
      "expectedPreviousStateDigest",
      "previousState",
      "nextEvent",
      "nextEventDigest",
      "nextState",
      "nextStateDigest",
      "artifactWrites",
    ],
    [
      "schemaVersion",
      "artifactKind",
      "demandId",
      "command",
      "createdAt",
      "expectedPreviousRevision",
      "expectedPreviousStateDigest",
      "previousState",
      "nextEvent",
      "nextEventDigest",
      "nextState",
      "nextStateDigest",
      "artifactWrites",
    ],
    "plan.transaction",
  );
  if (
    plan.programId !== evidence.programId
    || plan.demandId !== evidence.demandId
    || plan.configSnapshot.programId !== plan.programId
    || plan.controllerWindowId !== evidence.recordedBy.windowId
    || plan.configSnapshot.digest !== evidence.recordedBy.configDigest
    || plan.evidenceId !== evidence.evidenceId
    || plan.capturedAt !== evidence.capturedAt
    || plan.eventId !== event.eventId
    || plan.demandId !== event.demandId
    || plan.programId !== state.programId
    || plan.demandId !== state.demandId
    || plan.stateSnapshot.revision !== transaction.expectedPreviousRevision
    || plan.stateSnapshot.digest !== transaction.expectedPreviousStateDigest
    || canonicalJsonDigest(transaction.previousState) !== plan.stateSnapshot.digest
    || transaction.nextEventDigest !== canonicalJsonDigest(event)
    || transaction.nextStateDigest !== canonicalJsonDigest(state)
    || plan.paths.manifestRef !== identity.ref
    || plan.paths.evidenceRootRef !== `evidence/${identity.artifactId}`
    || plan.paths.stageRootRef !== `evidence/.${identity.artifactId}.wakeflow-stage`
    || plan.paths.journalRef !== "transactions/state-transition.json"
    || canonicalJson(transaction.nextEvent) !== canonicalJson(event)
    || canonicalJson(transaction.nextState) !== canonicalJson(state)
    || transaction.artifactWrites.length !== 1
    || transaction.artifactWrites[0].artifactKind !== identity.artifactKind
    || transaction.artifactWrites[0].artifactId !== identity.artifactId
    || transaction.artifactWrites[0].ref !== identity.ref
    || transaction.artifactWrites[0].digest !== identity.digest
    || canonicalJson(transaction.artifactWrites[0].value) !== canonicalJson(evidence)
  ) {
    throw importerError("wakeflow-evidence-import-plan", "plan identities, paths, event, state, or transaction differ");
  }
  const expectedSourceSnapshot = evidence.source.kind === "managed-path"
    ? { type: evidence.source.expectedType, digest: evidence.source.expectedDigest }
    : { type: "locator", digest: evidence.source.verification.digest };
  if (
    plan.sourceSnapshot.type !== expectedSourceSnapshot.type
    || plan.sourceSnapshot.digest !== expectedSourceSnapshot.digest
  ) {
    throw importerError("wakeflow-evidence-import-plan", "plan source snapshot differs from its manifest source");
  }
  if (evidence.source.kind === "managed-path" && (
    plan.sourceSnapshot.fileCount !== evidence.payload.files.length
    || plan.sourceSnapshot.directoryCount !== evidence.payload.directories.length - 1
    || plan.sourceSnapshot.totalBytes !== evidence.payload.totalBytes
  )) {
    throw importerError(
      "wakeflow-evidence-import-plan",
      "plan source snapshot counts differ from its closed payload inventory",
    );
  }
  return Object.freeze({ evidence, identity, event, state, transaction });
}

function rebuildPlan(plan, runtimeContext, contextOverride = null) {
  return buildPlan({
    stateRoot: runtimeContext.stateRoot,
    configPath: runtimeContext.configPath,
    controllerWindowId: plan.controllerWindowId,
    kind: plan.manifest.kind,
    source: plan.manifest.source,
    relations: plan.manifest.relations,
    sensitivity: plan.manifest.sensitivity,
    controllerReviewedOpaque: plan.manifest.controllerReviewedOpaque === true,
    evidenceId: plan.manifest.evidenceId,
    capturedAt: plan.manifest.capturedAt,
  }, contextOverride);
}

// apply先在锁外关闭当前context，再由state service在锁内重新准入并重推同一plan。
function applyManagedEvidenceImportUnsafe(input = {}) {
  exactKeys(
    input,
    ["plan", "planDigest", "runtimeContext"],
    ["plan", "planDigest", "runtimeContext"],
    "applyInput",
  );
  const { plan, planDigest, runtimeContext } = input;
  const validated = validatePlanEnvelope(plan, planDigest);
  exactKeys(
    runtimeContext,
    ["stateRoot", "configPath", "expectedProgramId"],
    ["stateRoot", "configPath"],
    "runtimeContext",
  );
  const current = loadContext({
    configPath: runtimeContext.configPath,
    stateRoot: runtimeContext.stateRoot,
    expectedProgramId: runtimeContext.expectedProgramId ?? plan.programId,
  });
  if (current.configDigest !== plan.configSnapshot.digest) {
    throw importerError("wakeflow-evidence-import-plan-stale", "current config differs from the preview plan");
  }
  if (
    current.expectedProgramId !== plan.programId
    || current.loaded.demand.demandId !== plan.demandId
  ) {
    throw importerError("wakeflow-evidence-import-plan-stale", "current program or demand differs from the preview plan");
  }
  controllerAdmission(current, plan.controllerWindowId);
  validateStateTransitionRecord(validated.transaction, {
    demand: current.loaded.demand,
    currentState: validated.transaction.previousState,
    ledgerRoot: current.ledgerRoot,
  });
  const committed = commitDemandEvidenceTransition({
    stateRoot: current.stateRoot,
    expectedProgramId: current.expectedProgramId,
    ledgerRoot: current.ledgerRoot,
    expectedPrevious: {
      revision: plan.stateSnapshot.revision,
      stateDigest: plan.stateSnapshot.digest,
    },
    evidence: validated.evidence,
    event: validated.event,
    nextState: validated.state,
    admitWhileLocked({ loaded, replayCandidate }) {
      const locked = loadContext({
        configPath: runtimeContext.configPath,
        stateRoot: runtimeContext.stateRoot,
        expectedProgramId: runtimeContext.expectedProgramId ?? plan.programId,
        loadedDemandCore: loaded,
      });
      if (
        locked.configDigest !== plan.configSnapshot.digest
        || locked.expectedProgramId !== plan.programId
        || locked.loaded.demand.demandId !== plan.demandId
      ) {
        throw importerError(
          "wakeflow-evidence-import-plan-stale",
          "current config, program, or demand differs from the preview plan inside the state lock",
        );
      }
      controllerAdmission(locked, plan.controllerWindowId);
      if (replayCandidate) {
        return Object.freeze({ resolvedSourceRoot: null });
      }
      const rebuilt = rebuildPlan(plan, runtimeContext, locked);
      if (canonicalJson(rebuilt.plan) !== canonicalJson(plan)) {
        throw importerError(
          "wakeflow-evidence-import-plan-stale",
          "current config, demand state, relations, or source no longer reproduces the preview plan",
        );
      }
      return Object.freeze({ resolvedSourceRoot: rebuilt.resolvedSourceRoot });
    },
  });
  return Object.freeze({
    ...committed,
    status: committed.created ? "recorded" : "already-recorded",
    plan,
    evidenceId: validated.identity.artifactId,
    ref: validated.identity.ref,
    digest: validated.identity.digest,
    planDigest,
    eventRef: `controller-events.jsonl#${validated.event.eventId}`,
    stateRevision: validated.state.revision,
    findings: Object.freeze({ count: 0, codes: Object.freeze([]) }),
    blockers: Object.freeze([]),
  });
}

/**
 * 应用一份精确preview plan，经唯一demand state journal发布evidence、event与next state。
 * exact replay只返回already-recorded，不重发effect或把不同plan绑定到同一evidence ID。
 */
export function applyManagedEvidenceImport(input = {}) {
  try {
    return applyManagedEvidenceImportUnsafe(canonicalInputSnapshot(input, "applyInput"));
  } catch (cause) {
    throw boundaryError(cause, "apply");
  }
}

// ==================== 六、显式journal recovery ====================

// recovery仍重读current config；只有缺失stage bytes时才重新解析并复验原managed source。
function recoveryConfigContext({ configPath, stateRoot, expectedProgramId }, loaded) {
  const configContext = readCandidateConfig(configPath);
  if (configContext.config.program.programId !== expectedProgramId) {
    throw importerError(
      "wakeflow-evidence-import-recovery-config",
      "current config program differs from the admitted recovery program",
    );
  }
  assertCanonicalStateRoot(configContext, stateRoot, loaded.demand.demandId);
  return configContext;
}

function recoverySourceResolver(runtimeContext) {
  return (write, { loaded }) => {
    const configContext = recoveryConfigContext(runtimeContext, loaded);
    if (write.value.recordedBy.configDigest !== configContext.configDigest) {
      throw importerError(
        "wakeflow-evidence-import-recovery-config",
        "pending evidence transition belongs to a different config digest",
      );
    }
    controllerAdmission(configContext, write.value.recordedBy.windowId);
    return sourceRoot(configContext, write.value.source);
  };
}

function recoveryAdmission(runtimeContext) {
  return ({ loaded }) => {
    recoveryConfigContext(runtimeContext, loaded);
    return Object.freeze({ admitted: true });
  };
}

function recoverManagedEvidenceImportUnsafe(runtimeContext = {}) {
  exactKeys(
    runtimeContext,
    ["stateRoot", "configPath", "expectedProgramId"],
    ["stateRoot", "configPath"],
    "runtimeContext",
  );
  const configContext = readCandidateConfig(runtimeContext.configPath);
  const expectedProgramId = runtimeContext.expectedProgramId === undefined
    ? configContext.config.program.programId
    : assertWakeflowId(runtimeContext.expectedProgramId, "program", "$expectedProgramId");
  if (expectedProgramId !== configContext.config.program.programId) {
    throw importerError(
      "wakeflow-evidence-import-recovery-config",
      "expectedProgramId differs from the current v3 config",
    );
  }
  if (typeof runtimeContext.stateRoot !== "string" || !runtimeContext.stateRoot.trim()) {
    throw importerError(
      "wakeflow-evidence-import-state-root",
      "runtimeContext.stateRoot must be a non-empty path",
    );
  }
  const stateRoot = path.resolve(runtimeContext.stateRoot);
  const demandId = assertWakeflowId(path.basename(stateRoot), "demand", "$stateRoot/demandId");
  assertCanonicalStateRoot(configContext, stateRoot, demandId);
  const recovered = recoverDemandStateTransition({
    stateRoot,
    expectedProgramId,
    ledgerRoot: ledgerRootFor(configContext),
    resolveEvidenceSource: recoverySourceResolver({
      configPath: runtimeContext.configPath,
      stateRoot,
      expectedProgramId,
    }),
    expectedArtifactKind: "wakeflow-evidence",
    admitRecoveryWhileLocked: recoveryAdmission({
      configPath: runtimeContext.configPath,
      stateRoot,
      expectedProgramId,
    }),
  });
  if (recovered.artifact?.artifactKind !== "wakeflow-evidence") return recovered;
  return Object.freeze({
    ...recovered,
    evidenceId: recovered.artifact.artifactId,
    ref: recovered.artifact.ref,
    digest: recovered.artifact.digest,
  });
}

/**
 * 恢复当前state root中一份exact evidence state-transition journal。
 * 已发布final root是恢复authority；event可见后缺失root不会从source补写。
 */
export function recoverManagedEvidenceImport(runtimeContext = {}) {
  try {
    return recoverManagedEvidenceImportUnsafe(canonicalInputSnapshot(runtimeContext, "runtimeContext"));
  } catch (cause) {
    throw boundaryError(cause, "recovery");
  }
}
