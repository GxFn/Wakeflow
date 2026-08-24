import path from "node:path";

import { rebuildWakeflowActiveProjection } from "./wakeflow-active-projector.mjs";
import {
  commitDemandBusinessArchive,
  inspectDemandBusinessArchive,
  planDemandBusinessArchive,
  recoverDemandBusinessArchive,
} from "./wakeflow-business-archive-service.mjs";
import { canonicalJson } from "./wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import {
  applyTargetDeliveryPlan,
  claimTargetDelivery,
  planTargetDelivery,
  rearmTargetDelivery,
  recordTargetDeliveryOutcome,
} from "./wakeflow-delivery-orchestration.mjs";
import {
  createTaskPackageArtifact,
  createTestCardArtifact,
} from "./wakeflow-demand-artifact-service.mjs";
import {
  applyDemandLifecycleTransitionPlan,
  planDemandLifecycleTransition,
  recoverDemandLifecycleTransition,
} from "./wakeflow-demand-lifecycle-orchestration.mjs";
import {
  planInitialDemandPublication,
  publishInitialDemandPublication,
  recoverInitialDemandPublication,
} from "./wakeflow-demand-publication-service.mjs";
import { recoverDemandStateTransition } from "./wakeflow-demand-state-service.mjs";
import { loadWakeflowHostSettingsAssetsAdapter } from "./wakeflow-host-settings-assets-owner.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  inspectWakeflowObservabilityV3,
  projectWakeflowConfigView,
  projectWakeflowStatus,
  projectWakeflowStorageView,
  verifyWakeflowWorkspaceV3,
} from "./wakeflow-observability-v3.mjs";
import {
  applyPodLaunchInitializationPlan,
  applyPodProductLaunchAppendPlan,
  decommissionClosedPodWindowBinding,
  inspectPodClose,
  inspectPodTestAccess,
  inspectPodWindowMaterialization,
  observePodCloseIntent,
  observePodTestAccessPlan,
  planPodLaunchInitialization,
  planPodProductLaunchAppend,
  planPodWindowMaterialization,
  recordPodCloseIntent,
  recordPodCloseReceipt,
  recordPodCreationReceipt,
  recordPodDesignHandoffArtifact,
  recordPodDesignRequestArtifact,
  recordPodMaterializationEvent,
  recordPodTestAccessPlan,
  recordPodTestAccessReceipt,
} from "./wakeflow-pod-service.mjs";
import {
  applyLocalPreservationPlan,
  inspectLocalPreservationInventory,
  planLocalPreservation,
  planLocalPreservationRelease,
  recoverLocalPreservationMutation,
} from "./wakeflow-preservation.mjs";
import {
  applyControllerReturnDeliveryPlan,
  createDispatchGroupReviewCandidate,
  decideDispatchGroupReviewCandidate,
  inspectControllerReturnPreSend,
  inspectDemandResultReviewTrace,
  inspectDispatchGroupReview,
  planControllerReturnDelivery,
  recordControllerReturnOutcome,
  recordTargetResultFromTransport,
} from "./wakeflow-result-review-orchestration.mjs";
import { loadWakeflowAssetBundle } from "./wakeflow-template-renderer.mjs";
import {
  appendTodoRow,
  claimTodoRow,
  inspectTodoBoard,
  inspectTodoClaim,
  recoverTodoRowClaim,
  TODO_BOARD_REF,
} from "./wakeflow-todo-service.mjs";
import {
  applyTransportDemandPrunePlan,
  planTransportDemandPrune,
  recoverTransportDemandPrune,
} from "./wakeflow-transport-retention.mjs";
import {
  decommissionWindowBinding,
  inspectWindowBindingInventory,
  registerWindowBinding,
  replaceWindowBinding,
} from "./wakeflow-window-binding-service.mjs";
import { releaseWindowCoordinationLease } from "./wakeflow-window-lease-service.mjs";

/**
 * 公共 v3 runtime 是 MCP/CLI 与各领域 owner 之间的唯一普通业务组合边界。
 * 它只关闭公开信封、派生单次调用上下文、选择精确 owner 并生成脱敏结果；业务状态、
 * 写入资格、事务、恢复与真实宿主 effect 继续由被调用的领域 owner 持有。
 *
 * 阅读导航：下面七类能力共同完成一次公开调用，不构成第二套业务 authority。
 *
 * 1. 工具与 operation 合同：ROUTED_OPERATIONS / assertRoutedOperation 在读取 workspace
 *    authority 前关闭词汇，routeOperation 再核对当前分支确实实现了该 operation。
 * 2. 公开信封：normalizeEnvelope / requestObject 校验 root、typed demandId、operation 与
 *    request，并拒绝调用方注入 runtime 派生字段。
 * 3. Portable 路径边界：pathTokenEntries / hydrateRequest 将当前配置中的 token 转成真实
 *    路径，publicResult 将 owner 输出重新投影为 portable token 并阻断私有绝对路径。
 * 4. 单次 authority context：baseContext 每次重读 strict config snapshot，派生 program、
 *    ledger 与可选 demand state root；它不跨公开调用缓存 workspace authority。
 * 5. 静态 artifact 资源：artifactResources 只缓存安装包内的 bundle 与宿主 settings adapter；
 *    失败后清空 promise，绝不把 workspace/config 状态放入该缓存。
 * 6. Owner 路由：executeTool 按工具职责把窄输入交给现有 domain service；Pod 四个工具仍
 *    各自拥有独立 operation 集合，不能通过共享路由跨工具调用。
 * 7. Active 提交后刷新：只有精确列入 ACTIVE_SOURCE_MUTATIONS 的 operation 在 owner 成功
 *    返回后调用同一个 projector；刷新失败只形成降级回执，不回滚已提交的领域 authority。
 * 8. Factory 入口：createWakeflowPublicV3DomainHandlers 绑定当前 artifact 与 host profile，
 *    返回无可变公开状态的 handler 集合。
 */
const SCHEMA_VERSION = 1;
const ACTIVE_CURRENT_REF = ".wakeflow-active/current";
const ROUTED_OPERATIONS = Object.freeze({
  wakeflow_add_task: Object.freeze(["create"]),
  wakeflow_archive: Object.freeze(["preview", "apply", "inspect", "recover"]),
  wakeflow_cancel_demand: Object.freeze(["preview", "apply", "recover"]),
  wakeflow_claim_next: Object.freeze(["inspect", "claim", "recover"]),
  wakeflow_complete_demand: Object.freeze(["preview", "apply", "recover"]),
  wakeflow_continue_demand: Object.freeze(["create"]),
  wakeflow_create_demand: Object.freeze(["preview", "apply", "recover"]),
  wakeflow_decide_review: Object.freeze(["decide"]),
  wakeflow_deliver: Object.freeze(["append"]),
  wakeflow_intake_test_card: Object.freeze(["create"]),
  wakeflow_next_work: Object.freeze(["inspect"]),
  wakeflow_pod_bind: Object.freeze(["creation-receipt", "binding-decommission"]),
  wakeflow_pod_open: Object.freeze([
    "inspect-materialization",
    "plan-materialization",
    "launch-preview",
    "launch-apply",
    "product-preview",
    "product-apply",
  ]),
  wakeflow_pod_plan: Object.freeze([
    "design-request",
    "test-access-plan",
    "test-access-inspect",
    "close-intent",
    "close-inspect",
  ]),
  wakeflow_pod_record: Object.freeze([
    "record-materialization",
    "design-handoff",
    "test-access-observe",
    "test-access-receipt",
    "close-observe",
    "close-receipt",
  ]),
  wakeflow_prepare_delivery: Object.freeze([
    "target-preview",
    "target-apply",
    "target-claim",
    "target-rearm",
    "controller-preview",
    "controller-apply",
    "controller-pre-send",
  ]),
  wakeflow_prune_runtime: Object.freeze(["preview", "apply", "recover"]),
  wakeflow_record_delivery: Object.freeze(["target-outcome", "controller-outcome"]),
  wakeflow_record_target_result: Object.freeze(["import"]),
  wakeflow_recover_state_transition: Object.freeze(["generic", "lifecycle"]),
  wakeflow_reduce_results: Object.freeze(["create"]),
  wakeflow_register_window: Object.freeze(["register"]),
  wakeflow_release_window_lock: Object.freeze(["release"]),
  wakeflow_replace_windows: Object.freeze(["inspect", "replace", "decommission"]),
  wakeflow_review_pack: Object.freeze(["group", "trace"]),
  wakeflow_status: Object.freeze(["inspect"]),
  wakeflow_storage_preserve: Object.freeze([
    "inspect",
    "preview",
    "preview-release",
    "apply",
    "recover",
  ]),
  wakeflow_verify: Object.freeze(["inspect"]),
  wakeflow_view: Object.freeze(["config", "storage", "verification", "result-trace"]),
});
const ROUTED_TOOLS = Object.freeze(Object.keys(ROUTED_OPERATIONS));

/**
 * 会改变 Active projector 来源的精确公开 operation 集合。
 *
 * 判断标准不是“该工具是否写文件”，而是是否可能改变 strict config、current demand identity、
 * demand core/state/events、state-selected artifact/evidence/result 或投影所选模板语言。TODO、
 * window identity/runtime、shared transport、lease、local preservation 与 Pod 的纯观察/物理事件
 * 均不属于该来源，不能为了统一形式而触发无意义的 workspace Markdown 写入。
 */
const ACTIVE_SOURCE_MUTATIONS = Object.freeze({
  wakeflow_add_task: Object.freeze(["create"]),
  wakeflow_archive: Object.freeze(["apply", "recover"]),
  wakeflow_cancel_demand: Object.freeze(["apply", "recover"]),
  wakeflow_complete_demand: Object.freeze(["apply", "recover"]),
  wakeflow_continue_demand: Object.freeze(["create"]),
  wakeflow_create_demand: Object.freeze(["apply", "recover"]),
  wakeflow_decide_review: Object.freeze(["decide"]),
  wakeflow_intake_test_card: Object.freeze(["create"]),
  wakeflow_pod_bind: Object.freeze(["creation-receipt"]),
  wakeflow_pod_open: Object.freeze(["launch-apply", "product-apply"]),
  wakeflow_pod_plan: Object.freeze(["design-request", "test-access-plan", "close-intent"]),
  wakeflow_pod_record: Object.freeze(["design-handoff", "test-access-receipt", "close-receipt"]),
  wakeflow_prepare_delivery: Object.freeze(["target-apply", "target-claim", "target-rearm"]),
  wakeflow_record_delivery: Object.freeze(["target-outcome"]),
  wakeflow_record_target_result: Object.freeze(["import"]),
  wakeflow_recover_state_transition: Object.freeze(["generic", "lifecycle"]),
  wakeflow_reduce_results: Object.freeze(["create"]),
});
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const ABSOLUTE_WINDOWS_RE = /^[A-Za-z]:[\\/]/u;

// ==================== 一、公开合同与 operation 词汇（能力 1、2） ====================

export class WakeflowPublicV3RuntimeError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowPublicV3RuntimeError";
    this.code = code;
    this.details = deepFreeze({ code, ...details });
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowPublicV3RuntimeError(code, message, { details, cause });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactDataObject(value, allowed, required, label) {
  if (!plainObject(value)) fail("wakeflow-public-v3-contract", `${label} must be one plain object`);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) {
    fail("wakeflow-public-v3-contract", `${label} has an unknown field`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail("wakeflow-public-v3-contract", `${label} is missing ${key}`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-public-v3-contract", `${label}.${String(key)} must be one enumerable data property`);
    }
  }
  return value;
}

function normalizedRoot(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || CONTROL_RE.test(value)
  ) fail("wakeflow-public-v3-root", `${label} must be one normalized absolute path`);
  return value;
}

function demandId(value) {
  try {
    return assertWakeflowId(value, "demand", "$/demandId");
  } catch (cause) {
    fail("wakeflow-public-v3-demand", "demandId must be one typed Wakeflow demand ID", {}, cause);
  }
}

/**
 * 复制公开 request 前先移除所有 runtime 派生字段的注入可能。
 * 这些字段即使恰好也是某个 owner 的合法键，也只能由当前 envelope/config/tool 派生，
 * 不能让嵌套 request 覆盖 workspace、demand 或 lifecycle authority。
 */
function requestObject(value) {
  if (!plainObject(value)) fail("wakeflow-public-v3-contract", "request must be one plain object");
  const request = exactDataObject(
    value,
    Reflect.ownKeys(value).filter((key) => typeof key === "string"),
    [],
    "request",
  );
  for (const key of [
    "workspaceRoot",
    "stateRoot",
    "expectedProgramId",
    "ledgerRoot",
    "config",
    "bundle",
    "hostProfile",
    "hostSettingsAssetsAdapter",
    "boardPath",
    "root",
    "demandId",
    "action",
  ]) {
    if (Object.hasOwn(request, key)) {
      fail("wakeflow-public-v3-derived-field", `request.${key} is derived by the public runtime`);
    }
  }
  try {
    return deepFreeze(structuredClone(request));
  } catch (cause) {
    fail("wakeflow-public-v3-contract", "request must contain cloneable JSON-compatible data", {}, cause);
  }
}

/**
 * 校验一个公开工具信封，但不读取任何 workspace 文件。
 * 返回值只保留规范化绝对 root、closed operation、clone 后 request 与可选 typed demandId。
 */
function normalizeEnvelope(value) {
  const input = exactDataObject(
    value,
    ["root", "demandId", "operation", "request"],
    ["root", "operation", "request"],
    "public tool request",
  );
  if (typeof input.operation !== "string" || !input.operation || input.operation !== input.operation.trim()) {
    fail("wakeflow-public-v3-operation", "operation must be one non-empty token");
  }
  return Object.freeze({
    root: normalizedRoot(input.root, "root"),
    operation: input.operation,
    request: requestObject(input.request),
    ...(input.demandId === undefined ? {} : { demandId: demandId(input.demandId) }),
  });
}

/**
 * 在 config snapshot、state root 或其他 workspace authority 被读取前关闭 operation。
 * MCP schema 只是声明面；CLI 与 direct handler 仍必须由 runtime 自己执行同一边界。
 */
function assertRoutedOperation(tool, operation) {
  if (
    !Object.hasOwn(ROUTED_OPERATIONS, tool)
    || !ROUTED_OPERATIONS[tool].includes(operation)
  ) {
    fail("wakeflow-public-v3-operation", `${tool} does not support operation ${operation}`);
  }
  return operation;
}

// ==================== 二、portable 路径与公开结果（能力 3） ====================

/**
 * 从本次 strict config snapshot 建立 absolute path 与 portable token 的双向词汇。
 * 较长根优先，避免 workspace 根先吞掉其内部 repository/support surface 的精确身份。
 */
function pathTokenEntries(snapshot, root) {
  const entries = [
    [root, "wakeflow://workspace"],
    [snapshot.ledgerRoot, "wakeflow://ledger"],
  ];
  for (const repository of snapshot.model.topology.repositories) {
    entries.push([
      path.resolve(root, ...repository.path.split("/")),
      `wakeflow://repository/${repository.repositoryId}`,
    ]);
  }
  for (const surface of snapshot.model.topology.supportSurfaces) {
    entries.push([
      path.resolve(root, ...surface.path.split("/")),
      `wakeflow://support-surface/${surface.surfaceId}`,
    ]);
  }
  return Object.freeze(entries
    .map(([absolute, token]) => Object.freeze({ absolute: path.resolve(absolute), token }))
    .sort((left, right) => right.absolute.length - left.absolute.length));
}

// 只转换 JSON-like value 中的字符串值；字段名和领域结构继续由 owner schema 持有。
function transformStrings(value, stringTransform) {
  if (typeof value === "string") return stringTransform(value);
  if (Array.isArray(value)) return value.map((entry) => transformStrings(entry, stringTransform));
  if (plainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      transformStrings(entry, stringTransform),
    ]));
  }
  return value;
}

// 将 owner 输出中的已配置绝对根替换为 portable token，并拒绝其余绝对路径泄漏。
function portableString(value, tokens) {
  for (const { absolute, token } of tokens) {
    if (value === absolute) return token;
    if (value.startsWith(`${absolute}${path.sep}`)) {
      const relative = path.relative(absolute, value).split(path.sep).join("/");
      return `${token}/${relative}`;
    }
    if (value.includes(absolute)) {
      fail("wakeflow-public-v3-private-output", "owner output embedded a private configured path");
    }
  }
  if ((path.isAbsolute(value) || ABSOLUTE_WINDOWS_RE.test(value)) && !/^https?:\/\//u.test(value)) {
    fail("wakeflow-public-v3-private-output", "owner output contains an unowned absolute path");
  }
  return value;
}

// 只接受当前 config authority 已声明的 portable token，并保持后缀在对应根内。
function hydratedString(value, tokens) {
  for (const { absolute, token } of tokens) {
    if (value === token) return absolute;
    if (value.startsWith(`${token}/`)) {
      const relative = value.slice(token.length + 1);
      if (!relative || relative.includes("\\") || path.posix.normalize(relative) !== relative || relative.startsWith("../")) {
        fail("wakeflow-public-v3-path-token", "portable path token has an invalid relative suffix");
      }
      return path.resolve(absolute, ...relative.split("/"));
    }
  }
  if (value.startsWith("wakeflow://")) {
    fail("wakeflow-public-v3-path-token", "portable path token is not part of current config authority");
  }
  return value;
}

/**
 * 把一个 owner 结果包装成 canonical、deep-frozen 的公开响应。
 * 这里验证 portable 路径和瞬时 host identity 不回显，但不重新解释 owner 的业务状态。
 */
function publicResult(tool, operation, value, context, secret = null, activeProjection = null) {
  const portable = transformStrings(value, (entry) => portableString(entry, context.tokens));
  const portableProjection = activeProjection === null
    ? null
    : transformStrings(activeProjection, (entry) => portableString(entry, context.tokens));
  const result = deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    tool,
    operation,
    result: portable,
    ...(portableProjection === null ? {} : { activeProjection: portableProjection }),
  });
  let encoded;
  try {
    encoded = canonicalJson(result);
  } catch (cause) {
    fail("wakeflow-public-v3-result", "owner returned non-canonical output", {}, cause);
  }
  if (secret !== null && encoded.includes(secret)) {
    fail("wakeflow-public-v3-private-output", "owner output echoed a transient host identity");
  }
  return result;
}

// ==================== 三、单次 workspace authority context（能力 4） ====================

/**
 * 每次公开调用重新读取 strict config snapshot 并派生 owner 所需的最小共享上下文。
 * stateRoot 只是由 envelope demandId 确定的位置，不代表该 demand 已存在或可被变更；
 * 最终 authority、lock 内重读和 transition admission 仍由领域 owner 完成。
 */
function baseContext(root, typedDemandId = null) {
  let snapshot;
  try {
    snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: root });
  } catch (cause) {
    fail("wakeflow-public-v3-config", "root has no strict public v3 config authority", {
      causeCode: typeof cause?.code === "string" ? cause.code : null,
    }, cause);
  }
  return Object.freeze({
    root,
    snapshot,
    expectedProgramId: snapshot.model.program.programId,
    config: snapshot.model,
    ledgerRoot: snapshot.ledgerRoot,
    stateRoot: typedDemandId === null
      ? null
      : path.join(root, ACTIVE_CURRENT_REF, typedDemandId),
    demandId: typedDemandId,
    tokens: pathTokenEntries(snapshot, root),
  });
}

function requireDemand(envelope) {
  if (envelope.demandId === undefined) {
    fail("wakeflow-public-v3-demand", `${envelope.operation} requires demandId`);
  }
  return baseContext(envelope.root, envelope.demandId);
}

function withoutDemand(envelope) {
  if (envelope.demandId !== undefined) {
    fail("wakeflow-public-v3-demand", `${envelope.operation} does not accept demandId`);
  }
  return baseContext(envelope.root);
}

// 将公开 request 中的 portable token 水合为本次 context 已验证的真实路径。
function hydrateRequest(envelope, context) {
  return transformStrings(envelope.request, (entry) => hydratedString(entry, context.tokens));
}

// 以下输入构造器始终让 runtime 派生字段覆盖 request，领域字段再由各 owner 精确校验。
function demandAuthorityInput(context, request) {
  return {
    ...request,
    workspaceRoot: context.root,
    stateRoot: context.stateRoot,
    expectedProgramId: context.expectedProgramId,
  };
}

function artifactInput(context, request) {
  return {
    ...request,
    stateRoot: context.stateRoot,
    expectedProgramId: context.expectedProgramId,
    ledgerRoot: context.ledgerRoot,
    config: context.config,
  };
}

function archiveInput(context, request) {
  return {
    ...request,
    workspaceRoot: context.root,
    expectedProgramId: context.expectedProgramId,
    demandId: context.demandId,
  };
}

function todoInput(context, request) {
  return {
    ...request,
    root: context.root,
    boardPath: path.join(context.root, ...TODO_BOARD_REF.split("/")),
  };
}

function preservationInput(context, request) {
  return { ...request, workspaceRoot: context.root, expectedProgramId: context.expectedProgramId };
}

function retentionInput(context, request) {
  return {
    ...request,
    workspaceRoot: context.root,
    expectedProgramId: context.expectedProgramId,
    demandId: context.demandId,
  };
}

/**
 * 在全局 operation 预检之后，再确认当前工具分支确实提供 own route function。
 * own-property 检查阻断 toString/constructor 等 Object.prototype 名称被误当成 operation。
 */
function routeOperation(tool, operation, routes) {
  if (!Object.hasOwn(routes, operation) || typeof routes[operation] !== "function") {
    fail("wakeflow-public-v3-operation", `${tool} does not support operation ${operation}`);
  }
  return routes[operation];
}

/**
 * 为四个 Pod 公共工具分别构造自己的 operation 路由。
 * 底层 service 可以同文件实现多个 Pod 阶段，但公开工具不能因此互相借用 operation。
 */
function podOperationRoutes(tool, input) {
  if (tool === "wakeflow_pod_open") {
    return {
      "inspect-materialization": () => inspectPodWindowMaterialization(input),
      "plan-materialization": () => planPodWindowMaterialization(input),
      "launch-preview": () => planPodLaunchInitialization(input),
      "launch-apply": () => applyPodLaunchInitializationPlan(input),
      "product-preview": () => planPodProductLaunchAppend(input),
      "product-apply": () => applyPodProductLaunchAppendPlan(input),
    };
  }
  if (tool === "wakeflow_pod_record") {
    return {
      "record-materialization": () => recordPodMaterializationEvent(input),
      "design-handoff": () => recordPodDesignHandoffArtifact(input),
      "test-access-observe": () => observePodTestAccessPlan(input),
      "test-access-receipt": () => recordPodTestAccessReceipt(input),
      "close-observe": () => observePodCloseIntent(input),
      "close-receipt": () => recordPodCloseReceipt(input),
    };
  }
  if (tool === "wakeflow_pod_bind") {
    return {
      "creation-receipt": () => recordPodCreationReceipt(input),
      "binding-decommission": () => decommissionClosedPodWindowBinding(input),
    };
  }
  if (tool === "wakeflow_pod_plan") {
    return {
      "design-request": () => recordPodDesignRequestArtifact(input),
      "test-access-plan": () => recordPodTestAccessPlan(input),
      "test-access-inspect": () => inspectPodTestAccess(input),
      "close-intent": () => recordPodCloseIntent(input),
      "close-inspect": () => inspectPodClose(input),
    };
  }
  fail("wakeflow-public-v3-tool", `${tool} has no Pod owner route`);
}

// ==================== 四、安装包静态资源与 observation（能力 5） ====================

/**
 * 懒加载当前安装 artifact 的静态 bundle 与 host settings adapter。
 * 这里只缓存与 workspace 无关的只读资源；失败 promise 会被清除，允许后续调用重新加载。
 */
async function artifactResources(runtime) {
  if (runtime.resourcesPromise === null) {
    runtime.resourcesPromise = (async () => Object.freeze({
      bundle: loadWakeflowAssetBundle({ wakeflowRoot: runtime.wakeflowRoot }),
      hostSettingsAssetsAdapter: await loadWakeflowHostSettingsAssetsAdapter({
        wakeflowRoot: runtime.wakeflowRoot,
        hostProfile: runtime.hostProfile,
      }),
    }))();
  }
  try {
    return await runtime.resourcesPromise;
  } catch (cause) {
    runtime.resourcesPromise = null;
    fail("wakeflow-public-v3-artifact", "installed runtime assets are unavailable", {}, cause);
  }
}

// 使用同一组静态资源签发一次只读 observation；投影职责仍归 observability owner。
async function observation(runtime, context, language) {
  const resources = await artifactResources(runtime);
  return inspectWakeflowObservabilityV3({
    workspaceRoot: context.root,
    hostProfile: runtime.hostProfile,
    bundle: resources.bundle,
    language,
    hostSettingsAssetsAdapter: resources.hostSettingsAssetsAdapter,
  });
}

// ==================== 五、Active authority 提交后的投影回执（能力 7） ====================

function changesActiveProjectionSource(tool, operation) {
  return Object.hasOwn(ACTIVE_SOURCE_MUTATIONS, tool)
    && ACTIVE_SOURCE_MUTATIONS[tool].includes(operation);
}

/**
 * 把 projector 的完整诊断压缩成 public composition 所需的稳定回执。
 * 回执保留 freshness/source/storage 三个独立轴；不会把 storage residue 误报成 state 提交失败，
 * 也不返回 workspace 绝对路径、模板正文或 projector 内部异常。
 */
export function refreshWakeflowActiveProjectionAfterPublicMutation(value = {}) {
  let input;
  try {
    input = exactDataObject(
      value,
      ["workspaceRoot", "bundle", "language"],
      ["workspaceRoot", "bundle", "language"],
      "active projection refresh input",
    );
  } catch {
    return deepFreeze({
      kind: "WakeflowActiveProjectionRefreshReceipt",
      schemaVersion: 1,
      status: "degraded",
      attempted: false,
      projectionStatus: "unknown",
      sourceHealth: "unknown",
      storageHealth: "unknown",
      writeStatus: "failed",
      written: [],
      issueCodes: ["active-projection-refresh-contract"],
    });
  }
  if (input.language === null) {
    return deepFreeze({
      kind: "WakeflowActiveProjectionRefreshReceipt",
      schemaVersion: 1,
      status: "deferred",
      attempted: false,
      projectionStatus: "unknown",
      sourceHealth: "unknown",
      storageHealth: "unknown",
      writeStatus: "not-attempted",
      written: [],
      issueCodes: ["active-projection-language-unresolved"],
    });
  }
  if (input.language !== "en" && input.language !== "zh") {
    return deepFreeze({
      kind: "WakeflowActiveProjectionRefreshReceipt",
      schemaVersion: 1,
      status: "degraded",
      attempted: false,
      projectionStatus: "unknown",
      sourceHealth: "unknown",
      storageHealth: "unknown",
      writeStatus: "failed",
      written: [],
      issueCodes: ["active-projection-refresh-contract"],
    });
  }
  try {
    const rebuilt = rebuildWakeflowActiveProjection({
      workspaceRoot: input.workspaceRoot,
      bundle: input.bundle,
      language: input.language,
    });
    const issueCodes = [...new Set(rebuilt.issues.map((entry) => entry.code))].sort();
    // 顶层status只是三个诊断轴的保守摘要；任何storage residue都应显式降级，
    // 但仍由独立storageHealth字段说明它不是owner提交或投影字节失败。
    const current = rebuilt.axes.sourceHealth === "complete"
      && rebuilt.axes.storageHealth === "healthy"
      && rebuilt.axes.projectionStatus === "current";
    return deepFreeze({
      kind: "WakeflowActiveProjectionRefreshReceipt",
      schemaVersion: 1,
      status: current ? "current" : "degraded",
      attempted: true,
      projectionStatus: rebuilt.axes.projectionStatus,
      sourceHealth: rebuilt.axes.sourceHealth,
      storageHealth: rebuilt.axes.storageHealth,
      writeStatus: rebuilt.writeStatus,
      written: rebuilt.written,
      issueCodes,
    });
  } catch {
    return deepFreeze({
      kind: "WakeflowActiveProjectionRefreshReceipt",
      schemaVersion: 1,
      status: "degraded",
      attempted: true,
      projectionStatus: "unknown",
      sourceHealth: "unknown",
      storageHealth: "unknown",
      writeStatus: "failed",
      written: [],
      issueCodes: ["active-projection-refresh-failed"],
    });
  }
}

// 显式配置可直接解析；auto 只能复用本次 publication 已由调用方解析并被 owner 接纳的语言。
function projectionLanguage(tool, context, request) {
  const configured = context.config.program.interfaceLanguage;
  if (configured === "en" || configured === "zh") return configured;
  if (tool === "wakeflow_create_demand" && ["en", "zh"].includes(request.language)) {
    return request.language;
  }
  return null;
}

/**
 * owner 已成功返回后再尝试刷新，确保 projector 永远不是领域提交的前置 authority。
 * archive 在自身 projector→identity→state 锁全部释放后才会走到这里，因此可安全重新取得
 * projector lock；replay/no-op 也执行一次确定性检查，并由 projector 自己收敛为 current。
 */
async function refreshActiveProjectionAfterOwner(runtime, tool, operation, context, request) {
  if (!changesActiveProjectionSource(tool, operation)) return null;
  const language = projectionLanguage(tool, context, request);
  if (language === null) {
    return refreshWakeflowActiveProjectionAfterPublicMutation({
      workspaceRoot: context.root,
      bundle: null,
      language: null,
    });
  }
  let bundle = null;
  try {
    bundle = (await artifactResources(runtime)).bundle;
  } catch {
    // 静态资源失败属于投影降级；下面的稳定回执不能覆盖已经成功返回的领域结果。
  }
  return refreshWakeflowActiveProjectionAfterPublicMutation({
    workspaceRoot: context.root,
    bundle,
    language,
  });
}

// ==================== 六、公开工具到领域 owner 的路由（能力 6） ====================

/**
 * 执行一个已经绑定 tool identity 的普通公开调用。
 * 顺序固定为：纯信封校验与 operation 预检、单次 context、request hydration、唯一 owner、
 * 按精确矩阵执行可降级的Active刷新、portable 结果；任何分支都不得在operation未关闭时
 * 读取authority或调用写owner，projector也不得先于owner提交。
 */
async function executeTool(runtime, tool, rawArgs) {
  if (!ROUTED_TOOLS.includes(tool)) fail("wakeflow-public-v3-tool", `unknown public v3 tool ${tool}`);
  const envelope = normalizeEnvelope(rawArgs);
  assertRoutedOperation(tool, envelope.operation);
  let context;
  let request;
  let result;
  let secret = null;

  if (tool === "wakeflow_status" || tool === "wakeflow_verify") {
    context = withoutDemand(envelope);
    request = hydrateRequest(envelope, context);
    exactDataObject(request, ["language"], ["language"], `${tool} request`);
    routeOperation(tool, envelope.operation, { inspect: () => null });
    const issued = await observation(runtime, context, request.language);
    result = tool === "wakeflow_status"
      ? projectWakeflowStatus({ observation: issued })
      : verifyWakeflowWorkspaceV3({ observation: issued });
  } else if (tool === "wakeflow_view") {
    if (envelope.operation === "result-trace") {
      context = requireDemand(envelope);
      request = hydrateRequest(envelope, context);
      exactDataObject(request, ["mode"], [], "result trace request");
      result = inspectDemandResultReviewTrace(demandAuthorityInput(context, request));
    } else {
      // operation 已在读取 workspace authority 前完成全局预检；这里仅选择对应投影。
      let issued = null;
      const project = routeOperation(tool, envelope.operation, {
        config: () => projectWakeflowConfigView({ observation: issued }),
        storage: () => projectWakeflowStorageView({ observation: issued }),
        verification: () => verifyWakeflowWorkspaceV3({ observation: issued }),
      });
      context = withoutDemand(envelope);
      request = hydrateRequest(envelope, context);
      exactDataObject(request, ["language"], ["language"], "view request");
      issued = await observation(runtime, context, request.language);
      result = project();
    }
  } else if (tool === "wakeflow_replace_windows") {
    context = withoutDemand(envelope);
    request = hydrateRequest(envelope, context);
    result = await routeOperation(tool, envelope.operation, {
      inspect: () => {
        exactDataObject(request, [], [], "window binding inspection request");
        return inspectWindowBindingInventory({ workspaceRoot: context.root });
      },
      replace: () => replaceWindowBinding({ ...request, workspaceRoot: context.root }),
      decommission: () => decommissionWindowBinding({ ...request, workspaceRoot: context.root }),
    })();
    secret = request.handle?.value ?? null;
  } else if (tool === "wakeflow_register_window") {
    context = withoutDemand(envelope);
    request = hydrateRequest(envelope, context);
    routeOperation(tool, envelope.operation, { register: () => null });
    result = await registerWindowBinding({ ...request, workspaceRoot: context.root });
    secret = request.handle?.value ?? null;
  } else if (tool === "wakeflow_release_window_lock") {
    context = withoutDemand(envelope);
    request = hydrateRequest(envelope, context);
    routeOperation(tool, envelope.operation, { release: () => null });
    result = await releaseWindowCoordinationLease({ ...request, workspaceRoot: context.root });
  } else if (tool === "wakeflow_create_demand") {
    context = envelope.operation === "recover" ? requireDemand(envelope) : withoutDemand(envelope);
    request = hydrateRequest(envelope, context);
    if (envelope.operation === "recover") {
      exactDataObject(request, [], [], "demand publication recovery request");
      result = recoverInitialDemandPublication({
        workspaceRoot: context.root,
        expectedProgramId: context.expectedProgramId,
        ledgerRoot: context.ledgerRoot,
        demandId: context.demandId,
      });
    } else {
      const resources = await artifactResources(runtime);
      const publication = {
        ...request,
        workspaceRoot: context.root,
        expectedProgramId: context.expectedProgramId,
        ledgerRoot: context.ledgerRoot,
        bundle: resources.bundle,
      };
      result = routeOperation(tool, envelope.operation, {
        preview: () => planInitialDemandPublication(publication),
        apply: () => publishInitialDemandPublication(publication),
      })();
    }
  } else if (tool === "wakeflow_add_task" || tool === "wakeflow_continue_demand") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    routeOperation(tool, envelope.operation, { create: () => null });
    result = createTaskPackageArtifact(artifactInput(context, request));
  } else if (tool === "wakeflow_intake_test_card") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    routeOperation(tool, envelope.operation, { create: () => null });
    result = createTestCardArtifact(artifactInput(context, request));
  } else if (tool === "wakeflow_prepare_delivery") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    const input = demandAuthorityInput(context, request);
    result = await routeOperation(tool, envelope.operation, {
      "target-preview": () => planTargetDelivery(input),
      "target-apply": () => applyTargetDeliveryPlan(input),
      "target-claim": () => claimTargetDelivery(input),
      "target-rearm": () => rearmTargetDelivery(input),
      "controller-preview": () => planControllerReturnDelivery(input),
      "controller-apply": () => applyControllerReturnDeliveryPlan(input),
      "controller-pre-send": () => inspectControllerReturnPreSend(input),
    })();
  } else if (tool === "wakeflow_record_delivery") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    const input = demandAuthorityInput(context, request);
    result = await routeOperation(tool, envelope.operation, {
      "target-outcome": () => recordTargetDeliveryOutcome(input),
      "controller-outcome": () => recordControllerReturnOutcome(input),
    })();
  } else if (tool === "wakeflow_record_target_result") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    routeOperation(tool, envelope.operation, { import: () => null });
    result = await recordTargetResultFromTransport(demandAuthorityInput(context, request));
  } else if (tool === "wakeflow_review_pack") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    const input = demandAuthorityInput(context, request);
    result = routeOperation(tool, envelope.operation, {
      group: () => inspectDispatchGroupReview(input),
      trace: () => inspectDemandResultReviewTrace(input),
    })();
  } else if (tool === "wakeflow_reduce_results") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    routeOperation(tool, envelope.operation, { create: () => null });
    result = await createDispatchGroupReviewCandidate(demandAuthorityInput(context, request));
  } else if (tool === "wakeflow_decide_review") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    routeOperation(tool, envelope.operation, { decide: () => null });
    result = await decideDispatchGroupReviewCandidate(demandAuthorityInput(context, request));
  } else if (tool === "wakeflow_complete_demand" || tool === "wakeflow_cancel_demand") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    const action = tool === "wakeflow_complete_demand" ? "complete" : "cancel";
    result = await routeOperation(tool, envelope.operation, {
      preview: () => planDemandLifecycleTransition(demandAuthorityInput(context, { ...request, action })),
      apply: () => applyDemandLifecycleTransitionPlan(demandAuthorityInput(context, request)),
      recover: () => recoverDemandLifecycleTransition(demandAuthorityInput(context, request)),
    })();
  } else if (tool === "wakeflow_recover_state_transition") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    result = await routeOperation(tool, envelope.operation, {
      generic: () => recoverDemandStateTransition({
        ...request,
        stateRoot: context.stateRoot,
        expectedProgramId: context.expectedProgramId,
        ledgerRoot: context.ledgerRoot,
      }),
      lifecycle: () => recoverDemandLifecycleTransition(demandAuthorityInput(context, request)),
    })();
  } else if (tool === "wakeflow_archive") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    const input = archiveInput(context, request);
    result = routeOperation(tool, envelope.operation, {
      preview: () => planDemandBusinessArchive(input),
      apply: () => commitDemandBusinessArchive(input),
      inspect: () => inspectDemandBusinessArchive(input),
      recover: () => recoverDemandBusinessArchive(input),
    })();
  } else if (tool === "wakeflow_storage_preserve") {
    context = withoutDemand(envelope);
    request = hydrateRequest(envelope, context);
    const input = preservationInput(context, request);
    result = await routeOperation(tool, envelope.operation, {
      inspect: () => inspectLocalPreservationInventory(input),
      preview: () => planLocalPreservation(input),
      "preview-release": () => planLocalPreservationRelease(input),
      apply: () => applyLocalPreservationPlan(input),
      recover: () => recoverLocalPreservationMutation(input),
    })();
  } else if (tool === "wakeflow_deliver") {
    context = withoutDemand(envelope);
    request = hydrateRequest(envelope, context);
    routeOperation(tool, envelope.operation, { append: () => null });
    result = appendTodoRow(todoInput(context, request));
  } else if (tool === "wakeflow_next_work") {
    context = withoutDemand(envelope);
    request = hydrateRequest(envelope, context);
    exactDataObject(request, [], [], "next work request");
    routeOperation(tool, envelope.operation, { inspect: () => null });
    result = inspectTodoBoard(todoInput(context, request));
  } else if (tool === "wakeflow_claim_next") {
    context = withoutDemand(envelope);
    request = hydrateRequest(envelope, context);
    const input = todoInput(context, request);
    result = routeOperation(tool, envelope.operation, {
      inspect: () => inspectTodoClaim(input),
      claim: () => claimTodoRow(input),
      recover: () => recoverTodoRowClaim(input),
    })();
  } else if (["wakeflow_pod_open", "wakeflow_pod_record", "wakeflow_pod_bind", "wakeflow_pod_plan"].includes(tool)) {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    const input = demandAuthorityInput(context, request);
    result = await routeOperation(tool, envelope.operation, podOperationRoutes(tool, input))();
  } else if (tool === "wakeflow_prune_runtime") {
    context = requireDemand(envelope);
    request = hydrateRequest(envelope, context);
    const input = retentionInput(context, request);
    result = await routeOperation(tool, envelope.operation, {
      preview: () => planTransportDemandPrune(input),
      apply: () => applyTransportDemandPrunePlan(input),
      recover: () => recoverTransportDemandPrune(input),
    })();
  } else {
    fail("wakeflow-public-v3-tool", `${tool} has no v3 owner route`);
  }

  const activeProjection = await refreshActiveProjectionAfterOwner(
    runtime,
    tool,
    envelope.operation,
    context,
    request,
  );
  return publicResult(tool, envelope.operation, result, context, secret, activeProjection);
}

// ==================== 七、artifact/host 绑定的公开 factory（能力 8） ====================

/**
 * 为当前安装 artifact 和 host profile 创建全部普通 v3 domain handlers。
 * 返回对象只共享静态资源 promise；每次 handler 调用仍独立读取 workspace config/context。
 */
export function createWakeflowPublicV3DomainHandlers(value = {}) {
  const input = exactDataObject(
    value,
    ["wakeflowRoot", "hostProfile"],
    ["wakeflowRoot", "hostProfile"],
    "public v3 runtime input",
  );
  const runtime = {
    wakeflowRoot: normalizedRoot(input.wakeflowRoot, "wakeflowRoot"),
    hostProfile: input.hostProfile,
    resourcesPromise: null,
  };
  return Object.freeze(Object.fromEntries(ROUTED_TOOLS.map((tool) => [
    tool,
    (args) => executeTool(runtime, tool, args),
  ])));
}
