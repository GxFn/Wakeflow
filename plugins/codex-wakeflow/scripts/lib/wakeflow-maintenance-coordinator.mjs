import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { WAKEFLOW_MAINTENANCE_PLAN_ACTIONS } from "./wakeflow-maintenance-plan.mjs";

/**
 * 公共 workspace maintenance 协调器。
 *
 * 职责导航：
 * 1. 关闭 fresh-initialize、reconfigure、reconcile 与 preview、apply、recover 的组合面。
 * 2. 把公共请求复制为有容量上限的冻结 canonical data，摘要只证明同一份计划字节。
 * 3. 精确装配每个 action 的validator和回调，不解释任何领域计划或宿主行为。
 * 4. 返回统一工具envelope；真实规划、mutation、recovery和workspace authority仍归action runtime。
 */

// 一、公共词汇、容量与错误合同。
export const WAKEFLOW_MAINTENANCE_CONTRACT_VERSION = 1;
export const WAKEFLOW_MAINTENANCE_TOOL_NAME = "wakeflow_maintain_workspace";
export const WAKEFLOW_MAINTENANCE_ACTIONS = WAKEFLOW_MAINTENANCE_PLAN_ACTIONS;
export const WAKEFLOW_MAINTENANCE_MODES = Object.freeze([
  "preview",
  "apply",
  "recover",
]);

const ACTION_SET = new Set(WAKEFLOW_MAINTENANCE_ACTIONS);
const MODE_SET = new Set(WAKEFLOW_MAINTENANCE_MODES);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OPERATION_ID_PATTERN = /^workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_PREVIEW_REQUEST_BYTES = 1024 * 1024;
const MAX_CONFIRMED_PLAN_BYTES = 8 * 1024 * 1024;
const MAX_ACTION_RESULT_BYTES = 8 * 1024 * 1024;

const REQUEST_FIELDS = Object.freeze({
  preview: Object.freeze(["root", "action", "mode", "request"]),
  apply: Object.freeze(["root", "action", "mode", "confirmedPlan", "planDigest"]),
  recover: Object.freeze([
    "root",
    "action",
    "mode",
    "operationId",
    "confirmedPlan",
    "planDigest",
  ]),
});

const ACTION_HANDLER_FIELDS = Object.freeze([
  "validatePreviewRequest",
  "validateConfirmedPlan",
  "preview",
  "apply",
  "recover",
]);

export class WakeflowMaintenanceCoordinatorError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowMaintenanceCoordinatorError";
    this.code = code;
    this.details = deepFreeze({ code, ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}) {
  throw new WakeflowMaintenanceCoordinatorError(code, message, { details });
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 精确对象准入拒绝symbol、隐藏字段和accessor，避免“校验”本身执行调用方代码。
function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) {
    fail("wakeflow-maintenance-invalid-contract", `${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  const wanted = new Set(expected);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== "string" || !wanted.has(key))
  ) {
    fail("wakeflow-maintenance-invalid-contract", `${label} has an invalid field set`, {
      actual: actual.map(String).sort(),
      expected: [...expected].sort(),
    });
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-maintenance-invalid-contract",
        `${label}.${key} must be an enumerable data property`,
      );
    }
  }
  return value;
}

function dataProperty(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail(
      "wakeflow-maintenance-invalid-contract",
      `${label}.${key} must be an enumerable data property`,
    );
  }
  return descriptor.value;
}

// action/mode缺失时保留各自稳定错误码；一旦字段存在，则仍必须是可枚举data property。
function routingDataProperty(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail(
      "wakeflow-maintenance-invalid-contract",
      `${label}.${key} must be an enumerable data property`,
    );
  }
  return descriptor.value;
}

// canonical clone负责纯数据、容量和冻结；它不把planDigest提升为执行授权。
function canonicalClone(value, { label, maximumBytes }) {
  let encoded;
  try {
    encoded = canonicalJson(value);
  } catch (cause) {
    throw new WakeflowMaintenanceCoordinatorError(
      "wakeflow-maintenance-invalid-contract",
      `${label} must be canonical JSON data`,
      { cause },
    );
  }
  if (Buffer.byteLength(encoded, "utf8") > maximumBytes) {
    fail("wakeflow-maintenance-request-too-large", `${label} exceeds its bounded size`);
  }
  return deepFreeze(JSON.parse(encoded));
}

function assertAbsoluteRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\0")
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) {
    fail(
      "wakeflow-maintenance-invalid-root",
      "root must be an exact normalized absolute workspace path",
    );
  }
  return value;
}

function assertAction(value) {
  if (!ACTION_SET.has(value)) {
    fail("wakeflow-maintenance-invalid-action", "action is not admitted by the public maintenance contract", {
      action: typeof value === "string" ? value : null,
      allowedActions: WAKEFLOW_MAINTENANCE_ACTIONS,
    });
  }
  return value;
}

function assertMode(value) {
  if (!MODE_SET.has(value)) {
    fail("wakeflow-maintenance-invalid-mode", "mode is not a supported maintenance mode", {
      mode: typeof value === "string" ? value : null,
      allowedModes: WAKEFLOW_MAINTENANCE_MODES,
    });
  }
  return value;
}

function assertDigest(value) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    fail("wakeflow-maintenance-invalid-plan-digest", "planDigest must be a lowercase sha256 digest");
  }
  return value;
}

function assertOperationId(value) {
  if (typeof value !== "string" || !OPERATION_ID_PATTERN.test(value)) {
    fail(
      "wakeflow-maintenance-invalid-operation-id",
      "operationId must be a Wakeflow workspace mutation identifier",
    );
  }
  return value;
}

function assertExactValidationVerdict(value, label) {
  try {
    exactKeys(value, ["valid"], label);
  } catch (cause) {
    if (cause instanceof WakeflowMaintenanceCoordinatorError) {
      fail(
        "wakeflow-maintenance-invalid-action-validator",
        `${label} must return exact { valid: true }`,
      );
    }
    throw cause;
  }
  if (dataProperty(value, "valid", label) !== true) {
    fail(
      "wakeflow-maintenance-invalid-action-validator",
      `${label} must return exact { valid: true }`,
    );
  }
}

// 二、公共请求按mode关闭字段，并在action回调前完成全部结构校验。
function normalizeMaintenanceRequest(value) {
  if (!isPlainObject(value)) {
    fail("wakeflow-maintenance-invalid-contract", "maintenance request must be a plain object");
  }
  const action = assertAction(routingDataProperty(value, "action", "maintenance request"));
  const mode = assertMode(routingDataProperty(value, "mode", "maintenance request"));
  exactKeys(value, REQUEST_FIELDS[mode], `${action} ${mode} request`);
  const root = assertAbsoluteRoot(dataProperty(value, "root", `${action} ${mode} request`));

  if (mode === "preview") {
    const request = canonicalClone(value.request, {
      label: `${action} preview request`,
      maximumBytes: MAX_PREVIEW_REQUEST_BYTES,
    });
    if (!isPlainObject(request)) {
      fail(
        "wakeflow-maintenance-invalid-contract",
        `${action} preview request must be a plain object`,
      );
    }
    return deepFreeze({ root, action, mode, request });
  }

  const confirmedPlan = canonicalClone(value.confirmedPlan, {
    label: `${action} confirmed plan`,
    maximumBytes: MAX_CONFIRMED_PLAN_BYTES,
  });
  if (!isPlainObject(confirmedPlan)) {
    fail("wakeflow-maintenance-invalid-contract", `${action} confirmed plan must be a plain object`);
  }
  const planDigest = assertDigest(value.planDigest);
  if (canonicalJsonDigest(confirmedPlan) !== planDigest) {
    fail(
      "wakeflow-maintenance-plan-digest-mismatch",
      "planDigest differs from the exact confirmedPlan payload",
    );
  }
  if (mode === "apply") {
    return deepFreeze({ root, action, mode, confirmedPlan, planDigest });
  }
  return deepFreeze({
    root,
    action,
    mode,
    operationId: assertOperationId(value.operationId),
    confirmedPlan,
    planDigest,
  });
}

// 三、action registry是数据驱动的callable表，只接纳own enumerable data-property函数。
function validateActionHandlers(value) {
  exactKeys(value, WAKEFLOW_MAINTENANCE_ACTIONS, "maintenance action handlers");
  const normalized = {};
  for (const action of WAKEFLOW_MAINTENANCE_ACTIONS) {
    const handler = dataProperty(value, action, "maintenance action handlers");
    exactKeys(handler, ACTION_HANDLER_FIELDS, `${action} handler`);
    for (const field of ACTION_HANDLER_FIELDS) {
      if (typeof dataProperty(handler, field, `${action} handler`) !== "function") {
        fail(
          "wakeflow-maintenance-invalid-action-handler",
          `${action}.${field} must be a function`,
        );
      }
    }
    normalized[action] = Object.freeze(Object.fromEntries(
      ACTION_HANDLER_FIELDS.map((field) => [
        field,
        dataProperty(handler, field, `${action} handler`),
      ]),
    ));
  }
  return Object.freeze(normalized);
}

// 四、validator先于action回调执行，且只能返回精确纯数据判定值{valid:true}。
async function validateActionPayload(handler, request) {
  let verdict;
  try {
    if (request.mode === "preview") {
      verdict = await handler.validatePreviewRequest({ request: request.request });
    } else {
      verdict = await handler.validateConfirmedPlan({ plan: request.confirmedPlan });
    }
  } catch (cause) {
    throw new WakeflowMaintenanceCoordinatorError(
      "wakeflow-maintenance-action-contract-rejected",
      `${request.action} rejected its ${request.mode} payload`,
      { cause },
    );
  }
  assertExactValidationVerdict(
    verdict,
    request.mode === "preview"
      ? `${request.action}.validatePreviewRequest`
      : `${request.action}.validateConfirmedPlan`,
  );
}

async function runAction(handler, request) {
  try {
    if (request.mode === "preview") {
      return await handler.preview({ root: request.root, request: request.request });
    }
    if (request.mode === "apply") {
      return await handler.apply({
        root: request.root,
        confirmedPlan: request.confirmedPlan,
        planDigest: request.planDigest,
      });
    }
    return await handler.recover({
      root: request.root,
      operationId: request.operationId,
      confirmedPlan: request.confirmedPlan,
      planDigest: request.planDigest,
    });
  } catch (cause) {
    throw new WakeflowMaintenanceCoordinatorError(
      "wakeflow-maintenance-action-failed",
      `${request.action} ${request.mode} failed inside its action-specific coordinator`,
      { cause },
    );
  }
}

export function validateWakeflowMaintenanceRequest(value) {
  return normalizeMaintenanceRequest(value);
}

/**
 * 由三组已验证action handlers创建无状态协调器。
 *
 * 输入：精确、无accessor的action callable registry。
 * 输出：冻结的execute facade，每次调用独立规范化请求并返回统一canonical envelope。
 * 边界：不缓存workspace、confirmed plan或mutation authority，也不直接导入mutation owner。
 */
export function createWakeflowMaintenanceCoordinator(options = {}) {
  exactKeys(options, ["actionHandlers"], "maintenance coordinator options");
  const actionHandlers = validateActionHandlers(dataProperty(
    options,
    "actionHandlers",
    "maintenance coordinator options",
  ));

  return Object.freeze({
    async execute(value) {
      const request = normalizeMaintenanceRequest(value);
      const handler = actionHandlers[request.action];
      await validateActionPayload(handler, request);
      const result = canonicalClone(await runAction(handler, request), {
        label: `${request.action} ${request.mode} result`,
        maximumBytes: MAX_ACTION_RESULT_BYTES,
      });
      if (!isPlainObject(result)) {
        fail(
          "wakeflow-maintenance-invalid-action-result",
          `${request.action} ${request.mode} result must be a plain object`,
        );
      }
      return deepFreeze({
        schemaVersion: WAKEFLOW_MAINTENANCE_CONTRACT_VERSION,
        tool: WAKEFLOW_MAINTENANCE_TOOL_NAME,
        action: request.action,
        mode: request.mode,
        result,
      });
    },
  });
}
