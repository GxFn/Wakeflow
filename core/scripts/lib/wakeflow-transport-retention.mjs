// 本模块只负责“已归档需求的 transport 根是否可以释放”这一条维护编排链。
// 业务终态与归档事实来自 business-archive，实时物理清单来自 transport-store，未关闭的执行占用来自 window lease。
// 模块产出可复核的零写计划，并把已确认的删除步骤交给 workspace-mutation；它不生成 transport 记录，
// 不自行判定业务验收，也不绕过 transport-store participant 直接删除目录。
import path from "node:path";

import { inspectDemandBusinessArchive } from "./wakeflow-business-archive-service.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  createTransportDemandReleaseParticipant,
  inspectTransportDemandAuthority,
} from "./wakeflow-transport-store.mjs";
import {
  inspectWindowCoordinationLeaseInventory,
} from "./wakeflow-window-lease-service.mjs";
import {
  recoverWakeflowWorkspaceMutation,
  runWakeflowMaintenanceMutation,
} from "./wakeflow-workspace-mutation.mjs";

const PLAN_SCHEMA_ID = "urn:wakeflow:internal:maintenance:transport-retention-plan:v1";
const PLAN_KIND = "wakeflow-transport-retention-plan";
const STEP_ID = "release-archived-transport-demand";
const DEMANDS_ROOT_REF = ".wakeflow-local/runtime/shared/transport/demands";
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const OPERATION_ID_RE = /^workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TOKEN_RE = /^[a-z][a-z0-9-]{0,127}$/u;
const BLOCKER_SCOPES = new Set(["archive", "lease", "transport", "member"]);
const DISPOSITIONS = new Set(["blocked", "eligible", "source-absent"]);
const DIRECTORY_NAMES = Object.freeze(["groups", "packets", "envelopes", "runs"]);

// 对外错误只暴露 retention 领域码；底层异常对象保留为 cause，details 仅投影可公开的稳定标识。
export class WakeflowTransportRetentionError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowTransportRetentionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowTransportRetentionError(code, message, { details, cause });
}

function causeCode(cause) {
  return typeof cause?.code === "string" && TOKEN_RE.test(cause.code)
    ? cause.code
    : "unknown";
}

function safeCauseDetails(cause) {
  const details = { causeCode: causeCode(cause) };
  const operationId = cause?.details?.operationId;
  if (typeof operationId === "string" && OPERATION_ID_RE.test(operationId)) {
    details.operationId = operationId;
  }
  return details;
}

function wrap(cause, operation) {
  if (cause instanceof WakeflowTransportRetentionError) throw cause;
  const code = causeCode(cause);
  const mapped = operation === "recovery"
    ? "wakeflow-transport-retention-recovery-required"
    : code.includes("stale") || code.includes("cas-mismatch")
    ? "wakeflow-transport-retention-stale"
    : code.includes("recovery") || code.includes("manual") || code.includes("durability")
      ? "wakeflow-transport-retention-recovery-required"
      : code.includes("blocked")
        ? "wakeflow-transport-retention-blocked"
        : "wakeflow-transport-retention-authority";
  throw new WakeflowTransportRetentionError(
    mapped,
    `transport retention ${operation} failed closed`,
    { details: safeCauseDetails(cause), cause },
  );
}

// 计划与返回值均冻结，防止调用方在摘要确认后继续修改同一对象。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenClone(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 公开输入只接纳自有、可枚举的数据字段；准入检查本身不得执行 getter 或忽略 Symbol/隐藏字段。
function exactDataFields(value, required, optional, label) {
  if (!isPlainObject(value)) {
    fail("wakeflow-transport-retention-contract", `${label} must be one plain data object`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("wakeflow-transport-retention-contract", `${label} cannot contain symbol fields`);
  }
  for (const key of keys) {
    if (!allowed.has(key)) {
      fail("wakeflow-transport-retention-contract", `${label} contains an unknown field`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-transport-retention-contract", `${label}.${key} must be an enumerable data field`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-transport-retention-contract", `${label} is missing a required field`);
    }
  }
  return value;
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-transport-retention-contract", `${label} must be a canonical sha256 digest`);
  }
  return value;
}

function assertPortableRef(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value.startsWith("/")
    || value.includes("\\")
    || value.includes("//")
    || value.endsWith("/")
    || path.posix.normalize(value) !== value
    || value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    fail("wakeflow-transport-retention-contract", `${label} must be a portable canonical ref`);
  }
  return value;
}

// workspaceRoot 是调用定位信息，不进入可移植计划；这里只做路径文本收敛，不证明目录可信。
function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail("wakeflow-transport-retention-contract", "workspaceRoot must be a trimmed path");
  }
  return path.resolve(value);
}

// preview 只需要四元 authority；apply/recovery 另外携带用户确认的精确计划和摘要。
function normalizeAuthorityInput(input, label) {
  exactDataFields(
    input,
    ["workspaceRoot", "expectedProgramId", "demandId", "archiveId"],
    [],
    label,
  );
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(input.workspaceRoot),
    expectedProgramId: assertWakeflowId(
      input.expectedProgramId,
      "program",
      "$input/expectedProgramId",
    ),
    demandId: assertWakeflowId(input.demandId, "demand", "$input/demandId"),
    archiveId: assertWakeflowId(input.archiveId, "archive", "$input/archiveId"),
  });
}

function normalizeApplyInput(input) {
  exactDataFields(
    input,
    [
      "workspaceRoot",
      "expectedProgramId",
      "demandId",
      "archiveId",
      "plan",
      "planDigest",
    ],
    ["acquireTimeoutMs"],
    "transport retention apply input",
  );
  const authority = normalizeAuthorityInput({
    workspaceRoot: input.workspaceRoot,
    expectedProgramId: input.expectedProgramId,
    demandId: input.demandId,
    archiveId: input.archiveId,
  }, "transport retention apply authority");
  if (
    Object.hasOwn(input, "acquireTimeoutMs")
    && (!Number.isSafeInteger(input.acquireTimeoutMs) || input.acquireTimeoutMs < 0)
  ) {
    fail(
      "wakeflow-transport-retention-contract",
      "acquireTimeoutMs must be one non-negative safe integer",
    );
  }
  return Object.freeze({
    ...authority,
    plan: input.plan,
    planDigest: assertDigest(input.planDigest, "planDigest"),
    ...(Object.hasOwn(input, "acquireTimeoutMs")
      ? { acquireTimeoutMs: input.acquireTimeoutMs }
      : {}),
  });
}

function normalizeRecoveryInput(input) {
  exactDataFields(
    input,
    [
      "workspaceRoot",
      "expectedProgramId",
      "demandId",
      "archiveId",
      "operationId",
      "plan",
      "planDigest",
    ],
    [],
    "transport retention recovery input",
  );
  const authority = normalizeAuthorityInput({
    workspaceRoot: input.workspaceRoot,
    expectedProgramId: input.expectedProgramId,
    demandId: input.demandId,
    archiveId: input.archiveId,
  }, "transport retention recovery authority");
  if (typeof input.operationId !== "string" || !OPERATION_ID_RE.test(input.operationId)) {
    fail("wakeflow-transport-retention-contract", "operationId is not a workspace mutation ID");
  }
  return Object.freeze({
    ...authority,
    operationId: input.operationId,
    plan: input.plan,
    planDigest: assertDigest(input.planDigest, "planDigest"),
  });
}

// 归档检查结果只投影计划重验所需的稳定摘要，不把完整业务归档复制进维护计划。
function compactArchiveInspection(inspection) {
  return deepFreeze({
    status: "verified",
    archiveId: inspection.archiveId,
    manifestRef: inspection.manifest.ref,
    manifestDigest: inspection.manifest.digest,
    transportSummary: {
      memberRef: inspection.transport.memberRef,
      memberDigest: inspection.transport.memberDigest,
      sourceStatus: inspection.transport.summary.sourceStatus,
      inventoryDigest: inspection.transport.summary.inventoryDigest,
    },
  });
}

function archiveUnavailable(archiveId) {
  return Object.freeze({ status: "unavailable", archiveId });
}

function addBlocker(target, code, scope) {
  if (!TOKEN_RE.test(code) || !BLOCKER_SCOPES.has(scope)) {
    fail("wakeflow-transport-retention-contract", "internal retention blocker is invalid");
  }
  target.set(`${scope}:${code}`, Object.freeze({ code, scope }));
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// blocker 顺序进入计划摘要，必须使用跨机器一致的 code-unit 顺序。
function sortedBlockers(blockers) {
  return Object.freeze([...blockers.values()].sort((left, right) => (
    lexicalCompare(left.scope, right.scope) || lexicalCompare(left.code, right.code)
  )));
}

// archive summary 与 live inventory 只按 transport-store 的 portable ref/digest 视图比较。
function projectTransportEntries(summary) {
  return deepFreeze(Object.fromEntries(DIRECTORY_NAMES.map((directoryName) => [
    directoryName,
    summary[directoryName].map((entry) => ({ ref: entry.ref, digest: entry.digest })),
  ])));
}

function projectInventoryEntries(inventory) {
  return deepFreeze(Object.fromEntries(DIRECTORY_NAMES.map((directoryName) => [
    directoryName,
    inventory.entries[directoryName].map((entry) => ({ ref: entry.ref, digest: entry.digest })),
  ])));
}

function transportInventoryMatchesArchive(inventory, summary) {
  return inventory.status === summary.sourceStatus
    && inventory.inventoryDigest === summary.inventoryDigest
    && canonicalJson(projectInventoryEntries(inventory)) === canonicalJson(projectTransportEntries(summary));
}

function matchingDemandLeases(inventory, demandId) {
  return inventory.leases.filter((entry) => entry.lease.demandId === demandId);
}

// 从已冻结归档验证每个非取消成员都存在 accepted + confirmed 的投递尾项；这里不代替 Controller review。
function settlementBlockers(inspection) {
  const blockers = new Map();
  const summary = inspection.transport.summary;
  const stateTargets = new Map(
    inspection.archivedState.targetTasks.map((target) => [target.targetTaskId, target]),
  );
  const packets = new Map(summary.packets.map((packet) => [packet.packetId, packet]));
  const targetEnvelopesByPacket = new Map();
  const runsByDelivery = new Map();
  for (const run of summary.runs) {
    const runs = runsByDelivery.get(run.deliveryId) ?? [];
    runs.push(run);
    runsByDelivery.set(run.deliveryId, runs);
    if (run.transportStatus === "ambiguous") {
      addBlocker(blockers, "ambiguous-delivery-run", "transport");
    } else if (run.transportStatus === "rejected-before-send") {
      addBlocker(blockers, "rejected-delivery-run", "transport");
    } else if (run.readback.status !== "confirmed") {
      addBlocker(blockers, "unconfirmed-delivery-run", "transport");
    }
  }
  for (const runs of runsByDelivery.values()) {
    runs.sort((left, right) => left.attemptOrdinal - right.attemptOrdinal);
  }
  for (const envelope of summary.envelopes) {
    const runs = runsByDelivery.get(envelope.deliveryId) ?? [];
    if (envelope.artifactKind === "wakeflow-controller-return-envelope") {
      if (runs.length === 0) {
        addBlocker(blockers, "pending-controller-return", "transport");
      }
      continue;
    }
    const envelopes = targetEnvelopesByPacket.get(envelope.packet.id) ?? [];
    envelopes.push(envelope);
    targetEnvelopesByPacket.set(envelope.packet.id, envelopes);
  }

  for (const group of summary.groups) {
    for (const member of group.members) {
      const target = stateTargets.get(member.targetTaskId);
      if (!target) {
        addBlocker(blockers, "orphan-group-target", "member");
        continue;
      }
      const packet = packets.get(member.packetId);
      if (!packet) {
        if (!["cancelled", "superseded"].includes(target.lifecycleStatus)) {
          addBlocker(blockers, "missing-group-packet", "member");
        }
        continue;
      }
      if (["cancelled", "superseded"].includes(target.lifecycleStatus)) continue;
      const envelopes = targetEnvelopesByPacket.get(packet.packetId) ?? [];
      const hasAcceptedConfirmedTail = envelopes.some((envelope) => {
        const runs = runsByDelivery.get(envelope.deliveryId) ?? [];
        const tail = runs.at(-1);
        return tail?.transportStatus === "accepted" && tail.readback.status === "confirmed";
      });
      if (!hasAcceptedConfirmedTail) {
        addBlocker(blockers, "unterminated-target-delivery", "member");
      }
    }
  }
  return blockers;
}

// maintenance plan codec 同时关闭 disposition、blocker 与唯一物理 step 的交叉关系。
function validateArchiveShape(value) {
  if (!isPlainObject(value) || !new Set(["verified", "unavailable"]).has(value.status)) {
    fail("wakeflow-transport-retention-plan", "retention archive declaration is invalid");
  }
  if (value.status === "unavailable") {
    exactDataFields(value, ["status", "archiveId"], [], "unavailable archive declaration");
    assertWakeflowId(value.archiveId, "archive", "$plan/payload/archive/archiveId");
    return;
  }
  exactDataFields(
    value,
    ["status", "archiveId", "manifestRef", "manifestDigest", "transportSummary"],
    [],
    "verified archive declaration",
  );
  assertWakeflowId(value.archiveId, "archive", "$plan/payload/archive/archiveId");
  assertPortableRef(value.manifestRef, "archive manifest ref");
  assertDigest(value.manifestDigest, "archive manifest digest");
  exactDataFields(
    value.transportSummary,
    ["memberRef", "memberDigest", "sourceStatus", "inventoryDigest"],
    [],
    "archive transport summary declaration",
  );
  assertPortableRef(value.transportSummary.memberRef, "transport summary member ref");
  assertDigest(value.transportSummary.memberDigest, "transport summary member digest");
  assertDigest(value.transportSummary.inventoryDigest, "transport summary inventory digest");
  if (!new Set(["missing", "empty", "current"]).has(value.transportSummary.sourceStatus)) {
    fail("wakeflow-transport-retention-plan", "transport summary sourceStatus is invalid");
  }
}

function expectedRemoveStep(payload) {
  const sourceRef = `${DEMANDS_ROOT_REF}/${payload.demandId}`;
  const stagingRef = `${DEMANDS_ROOT_REF}/.${payload.demandId}.${payload.archive.archiveId}.wakeflow-prune-stage`;
  const digest = payload.archive.transportSummary.inventoryDigest;
  return {
    stepId: STEP_ID,
    ordinal: 0,
    stepKind: "remove",
    source: { ref: sourceRef, type: "directory", mode: "0700", digest },
    staging: { ref: stagingRef, type: "directory", mode: "0700", digest },
    final: { ref: sourceRef, type: "absent" },
  };
}

function validateRetentionPlan(value) {
  const plan = frozenClone(value);
  exactDataFields(plan, ["schemaId", "payload"], [], "transport retention plan");
  if (plan.schemaId !== PLAN_SCHEMA_ID) {
    fail("wakeflow-transport-retention-plan", "transport retention plan schemaId is invalid");
  }
  const payload = plan.payload;
  exactDataFields(payload, [
    "schemaVersion",
    "artifactKind",
    "programId",
    "demandId",
    "archive",
    "disposition",
    "blockers",
    "steps",
  ], [], "transport retention plan payload");
  if (payload.schemaVersion !== 1 || payload.artifactKind !== PLAN_KIND) {
    fail("wakeflow-transport-retention-plan", "transport retention plan kind/version is invalid");
  }
  assertWakeflowId(payload.programId, "program", "$plan/payload/programId");
  assertWakeflowId(payload.demandId, "demand", "$plan/payload/demandId");
  validateArchiveShape(payload.archive);
  if (!DISPOSITIONS.has(payload.disposition) || !Array.isArray(payload.blockers) || !Array.isArray(payload.steps)) {
    fail("wakeflow-transport-retention-plan", "transport retention disposition collections are invalid");
  }
  const blockerKeys = [];
  for (const [index, blocker] of payload.blockers.entries()) {
    exactDataFields(blocker, ["code", "scope"], [], `transport retention blocker ${index}`);
    if (!TOKEN_RE.test(blocker.code) || !BLOCKER_SCOPES.has(blocker.scope)) {
      fail("wakeflow-transport-retention-plan", "transport retention blocker is invalid");
    }
    blockerKeys.push(`${blocker.scope}:${blocker.code}`);
  }
  const sortedBlockerKeys = [...new Set(blockerKeys)].sort();
  if (
    sortedBlockerKeys.length !== blockerKeys.length
    || sortedBlockerKeys.some((key, index) => key !== blockerKeys[index])
  ) {
    fail("wakeflow-transport-retention-plan", "transport retention blockers must be sorted and unique");
  }
  if (payload.archive.status === "unavailable" && payload.disposition !== "blocked") {
    fail("wakeflow-transport-retention-plan", "unavailable archive authority must block retention");
  }
  if (payload.disposition === "blocked") {
    if (payload.blockers.length === 0 || payload.steps.length !== 0) {
      fail("wakeflow-transport-retention-plan", "blocked retention plan has an invalid physical contract");
    }
  } else if (payload.disposition === "source-absent") {
    if (payload.archive.status !== "verified" || payload.blockers.length !== 0 || payload.steps.length !== 0) {
      fail("wakeflow-transport-retention-plan", "source-absent retention plan has an invalid contract");
    }
  } else {
    if (
      payload.archive.status !== "verified"
      || payload.archive.transportSummary.sourceStatus === "missing"
      || payload.blockers.length !== 0
      || payload.steps.length !== 1
      || canonicalJson(payload.steps[0]) !== canonicalJson(expectedRemoveStep(payload))
    ) {
      fail("wakeflow-transport-retention-plan", "eligible retention plan has an invalid remove step");
    }
  }
  return plan;
}

function buildPlan({ input, archive, disposition, blockers = [], step = null }) {
  const plan = validateRetentionPlan({
    schemaId: PLAN_SCHEMA_ID,
    payload: {
      schemaVersion: 1,
      artifactKind: PLAN_KIND,
      programId: input.expectedProgramId,
      demandId: input.demandId,
      archive,
      disposition,
      blockers,
      steps: step === null ? [] : [step],
    },
  });
  return deepFreeze({ plan, planDigest: canonicalJsonDigest(plan) });
}

// canonical config 只用于确认 program authority；存储路径继续由配置快照和各领域 owner 解释。
function assertConfigAuthority(input) {
  const snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: input.workspaceRoot });
  if (snapshot.model.program.programId !== input.expectedProgramId) {
    fail(
      "wakeflow-transport-retention-authority",
      "canonical config belongs to another program authority",
    );
  }
  return snapshot;
}

function inspectArchive(input) {
  return inspectDemandBusinessArchive({
    workspaceRoot: input.workspaceRoot,
    expectedProgramId: input.expectedProgramId,
    demandId: input.demandId,
    archiveId: input.archiveId,
  });
}

// transport-store participant 是唯一物理 release owner；本模块只把归档中的 exact inventory 交给它复核。
function createReleaseParticipant(input, inspection) {
  const summary = inspection.transport.summary;
  if (!new Set(["empty", "current"]).has(summary.sourceStatus)) return null;
  return createTransportDemandReleaseParticipant({
    workspaceRoot: input.workspaceRoot,
    programId: input.expectedProgramId,
    demandId: input.demandId,
    archiveId: input.archiveId,
    sourceStatus: summary.sourceStatus,
    inventoryDigest: summary.inventoryDigest,
    entries: projectTransportEntries(summary),
  });
}

// 计划阶段只读：归档、实时清单、settlement 或 lease 任一无法证明时均产出 blocked，而不是猜测可删除。
function derivePublicPlan(input) {
  assertConfigAuthority(input);
  let inspection;
  try {
    inspection = inspectArchive(input);
  } catch {
    const blockers = new Map();
    addBlocker(blockers, "archive-unavailable", "archive");
    return buildPlan({
      input,
      archive: archiveUnavailable(input.archiveId),
      disposition: "blocked",
      blockers: sortedBlockers(blockers),
    });
  }
  const archive = compactArchiveInspection(inspection);
  let inventory;
  try {
    inventory = inspectTransportDemandAuthority({
      workspaceRoot: input.workspaceRoot,
      programId: input.expectedProgramId,
      demandId: input.demandId,
    });
  } catch {
    const blockers = new Map();
    addBlocker(blockers, "transport-inventory-unavailable", "transport");
    return buildPlan({
      input,
      archive,
      disposition: "blocked",
      blockers: sortedBlockers(blockers),
    });
  }
  const blockers = settlementBlockers(inspection);
  let participant = null;
  let releaseState = null;
  if (inspection.transport.summary.sourceStatus !== "missing") {
    try {
      participant = createReleaseParticipant(input, inspection);
      releaseState = participant.inspectState();
    } catch {
      addBlocker(blockers, "transport-release-residue", "transport");
    }
  }
  if (
    inventory.status === "missing"
    && inspection.transport.summary.sourceStatus === "missing"
  ) {
    return buildPlan({ input, archive, disposition: "source-absent" });
  }
  if (inventory.status === "missing" && releaseState?.state === "absent") {
    return buildPlan({ input, archive, disposition: "source-absent" });
  }
  if (releaseState && releaseState.state !== "source") {
    addBlocker(blockers, "transport-release-residue", "transport");
  }
  if (!transportInventoryMatchesArchive(inventory, inspection.transport.summary)) {
    addBlocker(blockers, "transport-inventory-mismatch", "transport");
  }
  let leaseInventory;
  try {
    leaseInventory = inspectWindowCoordinationLeaseInventory({
      workspaceRoot: input.workspaceRoot,
    });
    if (matchingDemandLeases(leaseInventory, input.demandId).length > 0) {
      addBlocker(blockers, "active-demand-lease", "lease");
    }
  } catch {
    addBlocker(blockers, "lease-inventory-unavailable", "lease");
  }
  const blockerList = sortedBlockers(blockers);
  if (blockerList.length > 0 || participant === null) {
    if (participant === null) addBlocker(blockers, "transport-inventory-mismatch", "transport");
    return buildPlan({
      input,
      archive,
      disposition: "blocked",
      blockers: sortedBlockers(blockers),
    });
  }
  return buildPlan({
    input,
    archive,
    disposition: "eligible",
    step: participant.step,
  });
}

// apply/recovery 必须回绑用户确认的 planDigest、program、demand 与 archive，拒绝复用其他 authority 的计划。
function assertPlanIdentity(input, plan, planDigest) {
  const confirmed = validateRetentionPlan(plan);
  const digest = canonicalJsonDigest(confirmed);
  if (digest !== planDigest) {
    fail("wakeflow-transport-retention-plan", "planDigest differs from the exact retention plan");
  }
  if (
    confirmed.payload.programId !== input.expectedProgramId
    || confirmed.payload.demandId !== input.demandId
    || confirmed.payload.archive.archiveId !== input.archiveId
  ) {
    fail("wakeflow-transport-retention-stale", "retention plan belongs to another authority input");
  }
  return confirmed;
}

function assertSamePlan(actual, confirmed, planDigest) {
  if (
    actual.planDigest !== planDigest
    || canonicalJson(actual.plan) !== canonicalJson(confirmed)
  ) {
    fail("wakeflow-transport-retention-stale", "confirmed retention plan is stale");
  }
}

// mutation gate 内重新读取全部删除 authority，关闭 preview 与 effect 之间的 TOCTOU 窗口。
function inspectVerifiedMutationAuthority(input, confirmed, participant, { recovery }) {
  assertConfigAuthority(input);
  const inspection = inspectArchive(input);
  const compact = compactArchiveInspection(inspection);
  if (canonicalJson(compact) !== canonicalJson(confirmed.payload.archive)) {
    fail("wakeflow-transport-retention-stale", "archive authority changed after retention confirmation");
  }
  const blockers = settlementBlockers(inspection);
  const leaseInventory = inspectWindowCoordinationLeaseInventory({
    workspaceRoot: input.workspaceRoot,
  });
  if (matchingDemandLeases(leaseInventory, input.demandId).length > 0) {
    addBlocker(blockers, "active-demand-lease", "lease");
  }
  if (blockers.size > 0) {
    fail("wakeflow-transport-retention-blocked", "retention safety authority is no longer closed", {
      blockers: sortedBlockers(blockers),
    });
  }
  const state = participant.inspectState();
  const admittedStates = recovery
    ? new Set(["source", "staged", "cleanup-pending", "absent"])
    : new Set(["source"]);
  if (!admittedStates.has(state.state)) {
    fail("wakeflow-transport-retention-stale", "transport release physical state is not admitted");
  }
  return Object.freeze({ inspection, compact, state });
}

// 该 participant 只把本领域 plan/closure 适配给统一 mutation manager；rename/cleanup 仍由 transport-store handler 执行。
function createMutationParticipant(input, confirmed, { recovery }) {
  const inspection = inspectArchive(input);
  const compact = compactArchiveInspection(inspection);
  if (canonicalJson(compact) !== canonicalJson(confirmed.payload.archive)) {
    fail("wakeflow-transport-retention-stale", "archive authority differs from the confirmed plan");
  }
  const participant = createReleaseParticipant(input, inspection);
  if (
    participant === null
    || canonicalJson(participant.step) !== canonicalJson(confirmed.payload.steps[0])
  ) {
    fail("wakeflow-transport-retention-stale", "transport release participant differs from the confirmed step");
  }
  const planDigest = canonicalJsonDigest(confirmed);
  return Object.freeze({
    validatePlan({ plan }) {
      const candidate = validateRetentionPlan(plan);
      if (canonicalJson(candidate) !== canonicalJson(confirmed)) {
        fail("wakeflow-transport-retention-plan", "mutation manager received another retention plan");
      }
      return { valid: true };
    },
    deriveCurrentPlan() {
      inspectVerifiedMutationAuthority(input, confirmed, participant, { recovery });
      return confirmed;
    },
    deriveTerminalClosure({ context, plan, planDigest: receivedDigest }) {
      if (
        context === null
        || receivedDigest !== planDigest
        || canonicalJson(plan) !== canonicalJson(confirmed)
      ) {
        fail("wakeflow-transport-retention-plan", "terminal closure received another retention plan");
      }
      const authority = inspectVerifiedMutationAuthority(input, confirmed, participant, {
        recovery: true,
      });
      if (!new Set(["staged", "cleanup-pending", "absent"]).has(authority.state.state)) {
        fail(
          "wakeflow-transport-retention-terminal",
          "terminal transport retention closure still has a canonical source",
        );
      }
      return {
        planDigest,
        closureDigests: [
          {
            name: "transport-archive-authority",
            digest: canonicalJsonDigest({
              archive: authority.compact,
              archivedState: authority.inspection.archivedState,
            }),
          },
          {
            name: "transport-canonical-source-absent",
            digest: canonicalJsonDigest({
              programId: input.expectedProgramId,
              demandId: input.demandId,
              inventoryDigest: confirmed.payload.archive.transportSummary.inventoryDigest,
              source: "absent",
            }),
          },
          {
            name: "transport-demand-lease-closure",
            digest: canonicalJsonDigest({ demandId: input.demandId, leases: [] }),
          },
        ],
      };
    },
    stepHandlers: Object.freeze({ [STEP_ID]: participant.handler }),
  });
}

/**
 * 读取归档、实时 transport 与 lease authority，返回零写、可摘要确认的整需求释放计划。
 */
export function planTransportDemandPrune(input = {}) {
  try {
    return derivePublicPlan(normalizeAuthorityInput(
      input,
      "transport retention plan input",
    ));
  } catch (cause) {
    wrap(cause, "plan");
  }
}

/**
 * 重验用户确认的计划，并在统一 maintenance gate 内执行唯一 transport release step。
 */
export async function applyTransportDemandPrunePlan(input = {}) {
  let normalized;
  try {
    normalized = normalizeApplyInput(input);
    const confirmed = assertPlanIdentity(normalized, normalized.plan, normalized.planDigest);
    if (confirmed.payload.disposition === "blocked") {
      fail("wakeflow-transport-retention-blocked", "a blocked retention plan cannot be applied", {
        blockers: confirmed.payload.blockers,
      });
    }
    if (confirmed.payload.disposition === "source-absent") {
      assertSamePlan(derivePublicPlan(normalized), confirmed, normalized.planDigest);
      return deepFreeze({ status: "source-absent", planDigest: normalized.planDigest });
    }
    const participant = createMutationParticipant(normalized, confirmed, { recovery: false });
    const result = await runWakeflowMaintenanceMutation({
      workspaceRoot: normalized.workspaceRoot,
      action: "reconcile",
      operationKind: "transport-demand-prune",
      domainOwner: "transport-retention",
      ...(normalized.acquireTimeoutMs === undefined
        ? {}
        : { acquireTimeoutMs: normalized.acquireTimeoutMs }),
      confirmedPlan: confirmed,
      planDigest: normalized.planDigest,
      validatePlan: participant.validatePlan,
      deriveCurrentPlan: participant.deriveCurrentPlan,
      deriveTerminalClosure: participant.deriveTerminalClosure,
      stepHandlers: participant.stepHandlers,
    });
    return deepFreeze({
      status: result.status,
      operationId: result.operationId,
      planDigest: result.planDigest,
      archiveId: normalized.archiveId,
      demandId: normalized.demandId,
    });
  } catch (cause) {
    wrap(cause, "apply");
  }
}

/**
 * 仅恢复已经开始的 eligible release；未知或非前缀 residue 继续 fail closed，留待人工处理。
 */
export async function recoverTransportDemandPrune(input = {}) {
  let normalized;
  try {
    normalized = normalizeRecoveryInput(input);
    const confirmed = assertPlanIdentity(normalized, normalized.plan, normalized.planDigest);
    if (confirmed.payload.disposition !== "eligible") {
      fail(
        "wakeflow-transport-retention-plan",
        "only an eligible physical retention plan can own recovery",
      );
    }
    const participant = createMutationParticipant(normalized, confirmed, { recovery: true });
    const result = await recoverWakeflowWorkspaceMutation({
      workspaceRoot: normalized.workspaceRoot,
      operationId: normalized.operationId,
      confirmedPlan: confirmed,
      planDigest: normalized.planDigest,
      validatePlan: participant.validatePlan,
      deriveCurrentPlan: participant.deriveCurrentPlan,
      deriveTerminalClosure: participant.deriveTerminalClosure,
      stepHandlers: participant.stepHandlers,
    });
    return deepFreeze({
      status: result.status,
      operationId: result.operationId,
      recoveryGeneration: result.recoveryGeneration,
      planDigest: result.planDigest,
      archiveId: normalized.archiveId,
      demandId: normalized.demandId,
    });
  } catch (cause) {
    wrap(cause, "recovery");
  }
}
