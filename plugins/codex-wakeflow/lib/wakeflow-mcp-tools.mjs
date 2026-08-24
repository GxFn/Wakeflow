/**
 * Wakeflow 公共 MCP 工具的共享组合层。
 *
 * 能力导航：
 * - 公共合同与脱敏错误：WakeflowPublicMcpError、exactKeys、portableResult。
 * - 普通领域路由：domainHandlers、domainHandler，把闭合公共请求交给 public-v3 owner。
 * - 工作区维护路由：maintenanceCoordinator、runMaintenance，保持 fresh/reconfigure/reconcile 的独立权限面。
 * - 托管证据路由：evidenceRuntimeContext、normalizeEvidenceRequest、runEvidence，按需求派生 Controller 上下文。
 * - 工具声明与注册：writeAnnotations、routedTool、PUBLIC_TOOL_ORDER、tools、handlers。
 *
 * 本文件只拥有公共工具合同、组合路由和输出脱敏，不拥有领域状态转换、宿主 effect 或验收决定。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "../scripts/lib/wakeflow-canonical-json.mjs";
import {
  loadWakeflowConfigV3Snapshot,
} from "../scripts/lib/wakeflow-config-v3-snapshot.mjs";
import {
  applyManagedEvidenceImport,
  planManagedEvidenceImport,
  recoverManagedEvidenceImport,
} from "../scripts/lib/wakeflow-evidence-importer.mjs";
import { hostProfile } from "../scripts/lib/wakeflow-host-profile.mjs";
import {
  assertWakeflowId,
} from "../scripts/lib/wakeflow-identifiers.mjs";
import {
  loadWakeflowMaintenanceActionHandlers,
} from "../scripts/lib/wakeflow-maintenance-action-runtime.mjs";
import {
  createWakeflowMaintenanceCoordinator,
} from "../scripts/lib/wakeflow-maintenance-coordinator.mjs";
import {
  createWakeflowPublicV3DomainHandlers,
  refreshWakeflowActiveProjectionAfterPublicMutation,
} from "../scripts/lib/wakeflow-public-v3-runtime.mjs";
import { loadWakeflowAssetBundle } from "../scripts/lib/wakeflow-template-renderer.mjs";

const MAINTENANCE_TOOL = "wakeflow_maintain_workspace";
const EVIDENCE_TOOL = "wakeflow_record_evidence";
const MODES = new Set(["preview", "apply", "recover"]);
const wakeflowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let maintenanceCoordinatorPromise = null;
let domainHandlersPromise = null;
let evidenceProjectionBundle = null;

// 公共合同、错误与可移植输出

class WakeflowPublicMcpError extends Error {
  constructor(code, message, { details = {} } = {}) {
    super(message);
    this.name = "WakeflowPublicMcpError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

// 所有公开失败都先收敛为稳定 code/message，内部原因只保留稳定 causeCode。
function fail(code, message, details = {}) {
  throw new WakeflowPublicMcpError(code, message, { details });
}

// 只接纳普通对象，避免数组、class instance 或异常原型混入公共合同。
function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 校验闭合字段集合及可枚举 data property，防止 accessor 在验证阶段执行隐式逻辑。
function exactKeys(value, allowed, required, label) {
  if (!plainObject(value)) fail("wakeflow-public-mcp-contract", `${label} must be one plain object`);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string" || !allowed.includes(key))) {
    fail("wakeflow-public-mcp-contract", `${label} has an unknown field`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("wakeflow-public-mcp-contract", `${label} is missing ${key}`);
    }
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-public-mcp-contract", `${label}.${String(key)} must be an enumerable data property`);
    }
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function normalizedRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail("wakeflow-public-mcp-root", "root must be one normalized absolute workspace path");
  return value;
}

function mode(value) {
  if (!MODES.has(value)) fail("wakeflow-public-mcp-mode", "mode must be preview, apply, or recover");
  return value;
}

// 将 owner 结果复制为 canonical plain data，并拒绝把工作区绝对路径带回公共响应。
function portableResult({
  tool,
  selectedMode,
  result,
  root,
  action = undefined,
  activeProjection = null,
}) {
  let snapshot;
  try {
    snapshot = JSON.parse(canonicalJson({
      schemaVersion: 1,
      tool,
      ...(action === undefined ? {} : { action }),
      mode: selectedMode,
      result,
      ...(activeProjection === null ? {} : { activeProjection }),
    }));
  } catch {
    fail("wakeflow-public-mcp-result", `${tool} returned non-canonical data`);
  }
  if (canonicalJson(snapshot).includes(root)) {
    fail("wakeflow-public-mcp-private-output", `${tool} returned private workspace location data`);
  }
  return deepFreeze(snapshot);
}

// 普通领域工具路由

/**
 * 惰性构造共享 public-v3 handler 集合。
 * 缓存的是安装产物的静态组合，不缓存 workspace、config 或 demand authority。
 */
async function domainHandlers() {
  if (domainHandlersPromise === null) {
    domainHandlersPromise = Promise.resolve().then(() => createWakeflowPublicV3DomainHandlers({
      wakeflowRoot,
      hostProfile,
    }));
  }
  try {
    return await domainHandlersPromise;
  } catch (error) {
    domainHandlersPromise = null;
    fail("wakeflow-public-mcp-runtime-unavailable", "the installed v3 domain runtime is unavailable", {
      causeCode: typeof error?.code === "string" ? error.code : null,
    });
  }
  return null;
}

/**
 * 为单个公共工具创建薄路由。
 * 领域 owner 继续负责 operation、authority 和 mutation；这里仅统一脱敏公开错误。
 */
function domainHandler(tool) {
  return async (args) => {
    try {
      const available = await domainHandlers();
      return await available[tool](args);
    } catch (error) {
      if (error instanceof WakeflowPublicMcpError) throw error;
      fail("wakeflow-public-mcp-domain", `${tool} failed closed inside its v3 owner`, {
        causeCode: typeof error?.code === "string" ? error.code : null,
      });
    }
  };
}

// 工作区维护路由

/**
 * 惰性装配 maintenance coordinator 与宿主 action handlers。
 * 该对象只持有静态实现引用，每次 workspace authority 仍由具体维护调用重新读取和栅栏化。
 */
async function maintenanceCoordinator() {
  if (maintenanceCoordinatorPromise === null) {
    maintenanceCoordinatorPromise = loadWakeflowMaintenanceActionHandlers({
      wakeflowRoot,
      hostProfile,
    }).then((actionHandlers) => createWakeflowMaintenanceCoordinator({ actionHandlers }));
  }
  try {
    return await maintenanceCoordinatorPromise;
  } catch (error) {
    maintenanceCoordinatorPromise = null;
    fail(
      "wakeflow-public-mcp-runtime-unavailable",
      "the installed Wakeflow artifact cannot load its maintenance runtime",
      { causeCode: typeof error?.code === "string" ? error.code : null },
    );
  }
  return null;
}

/**
 * 执行 fresh-initialize、reconfigure 或 reconcile 的已闭合请求。
 * preview 返回可复核计划摘要；任何结果都不得泄露调用方传入的工作区绝对路径。
 */
async function runMaintenance(args) {
  const root = normalizedRoot(args?.root);
  const coordinator = await maintenanceCoordinator();
  let result;
  try {
    result = await coordinator.execute(args);
  } catch (error) {
    fail(
      "wakeflow-public-mcp-maintenance",
      "public maintenance failed closed",
      { causeCode: typeof error?.code === "string" ? error.code : null },
    );
  }
  if (canonicalJson(result).includes(root)) {
    fail("wakeflow-public-mcp-private-output", "public maintenance returned private workspace location data");
  }
  if (result.mode === "preview" && result.result?.confirmedActionPlan) {
    return deepFreeze({
      ...result,
      result: {
        ...result.result,
        confirmedActionPlanDigest: canonicalJsonDigest(result.result.confirmedActionPlan),
      },
    });
  }
  return result;
}

// 托管证据路由

/**
 * 从 strict v3 config 为一次 evidence 调用派生需求路径、Controller 身份和 programId。
 * 返回值不是可跨调用复用的“当前工作区”上下文，也不能替代 importer 内部的提交前重验。
 */
function evidenceRuntimeContext(root, demandId) {
  const workspaceRoot = normalizedRoot(root);
  let typedDemandId;
  try {
    typedDemandId = assertWakeflowId(demandId, "demand", "$/demandId");
  } catch {
    fail("wakeflow-public-mcp-demand", "demandId must be one typed Wakeflow demand ID");
  }
  let snapshot;
  try {
    snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot });
  } catch (error) {
    fail("wakeflow-public-mcp-config", "root does not contain one strict current v3 config", {
      causeCode: typeof error?.code === "string" ? error.code : null,
    });
  }
  return Object.freeze({
    root: workspaceRoot,
    stateRoot: path.join(workspaceRoot, ".wakeflow-active", "current", typedDemandId),
    configPath: path.join(workspaceRoot, "wakeflow.config.json"),
    controllerWindowId: snapshot.indexes.controllerWindow.windowId,
    expectedProgramId: snapshot.model.program.programId,
    interfaceLanguage: snapshot.model.program.interfaceLanguage,
  });
}

// evidence 不复用普通 handler 的 workspace context；这里只共享安装包静态 bundle，不缓存配置或需求状态。
function loadEvidenceProjectionBundle() {
  if (evidenceProjectionBundle !== null) return evidenceProjectionBundle;
  try {
    evidenceProjectionBundle = loadWakeflowAssetBundle({ wakeflowRoot });
    return evidenceProjectionBundle;
  } catch {
    evidenceProjectionBundle = null;
    return null;
  }
}

// apply/recover 已成功关闭 evidence authority 后才刷新；preview 严格保持零写入。
function refreshEvidenceActiveProjection(selectedMode, runtime) {
  if (selectedMode === "preview") return null;
  const language = ["en", "zh"].includes(runtime.interfaceLanguage)
    ? runtime.interfaceLanguage
    : null;
  return refreshWakeflowActiveProjectionAfterPublicMutation({
    workspaceRoot: runtime.root,
    bundle: language === null ? null : loadEvidenceProjectionBundle(),
    language,
  });
}

// 根据 preview/apply/recover 分支校验 evidence 请求的精确字段集合。
function normalizeEvidenceRequest(args) {
  if (!plainObject(args)) fail("wakeflow-public-mcp-contract", "evidence request must be one plain object");
  const selectedMode = mode(args.mode);
  if (selectedMode === "preview") {
    exactKeys(
      args,
      [
        "root",
        "demandId",
        "mode",
        "kind",
        "source",
        "relations",
        "sensitivity",
        "controllerReviewedOpaque",
      ],
      ["root", "demandId", "mode", "kind", "source"],
      "evidence preview request",
    );
  } else if (selectedMode === "apply") {
    exactKeys(
      args,
      ["root", "demandId", "mode", "plan", "planDigest"],
      ["root", "demandId", "mode", "plan", "planDigest"],
      "evidence apply request",
    );
  } else {
    exactKeys(
      args,
      ["root", "demandId", "mode"],
      ["root", "demandId", "mode"],
      "evidence recovery request",
    );
  }
  return selectedMode;
}

/**
 * 把一次托管证据请求交给 importer 的 plan/apply/recover owner。
 * evidence 只记录可审查输入，不在此处判断事实真伪或需求是否通过。
 */
async function runEvidence(args) {
  const selectedMode = normalizeEvidenceRequest(args);
  const runtime = evidenceRuntimeContext(args.root, args.demandId);
  let result;
  try {
    if (selectedMode === "preview") {
      result = planManagedEvidenceImport({
        stateRoot: runtime.stateRoot,
        configPath: runtime.configPath,
        controllerWindowId: runtime.controllerWindowId,
        kind: args.kind,
        source: args.source,
        relations: args.relations ?? [],
        sensitivity: args.sensitivity ?? "internal",
        controllerReviewedOpaque: args.controllerReviewedOpaque ?? false,
      });
    } else if (selectedMode === "apply") {
      result = applyManagedEvidenceImport({
        plan: args.plan,
        planDigest: args.planDigest,
        runtimeContext: {
          stateRoot: runtime.stateRoot,
          configPath: runtime.configPath,
          expectedProgramId: runtime.expectedProgramId,
        },
      });
    } else {
      result = recoverManagedEvidenceImport({
        stateRoot: runtime.stateRoot,
        configPath: runtime.configPath,
        expectedProgramId: runtime.expectedProgramId,
      });
    }
  } catch (error) {
    fail(
      "wakeflow-public-mcp-evidence",
      "public evidence import failed closed",
      { causeCode: typeof error?.code === "string" ? error.code : null },
    );
  }
  return portableResult({
    tool: EVIDENCE_TOOL,
    selectedMode,
    result,
    root: runtime.root,
    activeProjection: refreshEvidenceActiveProjection(selectedMode, runtime),
  });
}

// 工具声明、schema 与 annotation

/**
 * 构造 MCP 客户端提示信息。
 * destructiveHint 按工具可能执行的最强 operation 声明；它只是提示，不授予写入权限。
 */
function writeAnnotations(title, idempotentHint, { readOnly = false, destructive = false } = {}) {
  return Object.freeze({
    title,
    readOnlyHint: readOnly,
    destructiveHint: destructive,
    idempotentHint,
    openWorldHint: false,
  });
}

const repositoryIdSchema = Object.freeze({
  type: "string",
  pattern: "^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});
const digestSchema = Object.freeze({
  type: "string",
  pattern: "^sha256:[0-9a-f]{64}$",
});
const authorizedRepositoryIdsSchema = Object.freeze({
  type: "array",
  uniqueItems: true,
  items: repositoryIdSchema,
});

const freshSelectionSchema = Object.freeze({
  type: "object",
  required: ["program", "topology", "storage", "governance", "hosts"],
  properties: {
    program: {
      type: "object",
      required: ["displayName", "interfaceLanguage"],
      properties: {
        displayName: { type: "string" },
        description: { type: "string" },
        interfaceLanguage: { type: "string", enum: ["auto", "en", "zh"] },
      },
      additionalProperties: false,
    },
    topology: {
      type: "object",
      required: ["repositories", "supportSurfaces", "windows"],
      properties: {
        repositories: { type: "array", minItems: 1, items: { type: "object" } },
        supportSurfaces: { type: "array", minItems: 2, items: { type: "object" } },
        windows: { type: "array", minItems: 4, items: { type: "object" } },
      },
      additionalProperties: false,
    },
    storage: {
      type: "object",
      required: ["ledgerRoot"],
      properties: { ledgerRoot: { type: "string" } },
      additionalProperties: false,
    },
    governance: { type: "object" },
    hosts: { type: "object" },
  },
  additionalProperties: false,
});

function closedObject(required, properties) {
  return Object.freeze({
    type: "object",
    required,
    properties,
    additionalProperties: false,
  });
}

const maintenanceBranches = Object.freeze([
  closedObject(["root", "action", "mode", "request"], {
    root: { type: "string" },
    action: { const: "fresh-initialize" },
    mode: { const: "preview" },
    request: closedObject(["selection", "language"], {
      selection: freshSelectionSchema,
      language: { type: "string", enum: ["en", "zh"] },
    }),
  }),
  closedObject(["root", "action", "mode", "request"], {
    root: { type: "string" },
    action: { const: "reconfigure" },
    mode: { const: "preview" },
    request: closedObject(["desiredModel", "language", "authorizedRepositoryIds"], {
      desiredModel: { type: "object" },
      language: { type: "string", enum: ["en", "zh"] },
      authorizedRepositoryIds: authorizedRepositoryIdsSchema,
    }),
  }),
  closedObject(["root", "action", "mode", "request"], {
    root: { type: "string" },
    action: { const: "reconcile" },
    mode: { const: "preview" },
    request: closedObject(["language", "authorizedRepositoryIds"], {
      language: { type: "string", enum: ["en", "zh"] },
      authorizedRepositoryIds: authorizedRepositoryIdsSchema,
    }),
  }),
  closedObject(["root", "action", "mode", "confirmedPlan", "planDigest"], {
    root: { type: "string" },
    action: { type: "string", enum: ["fresh-initialize", "reconfigure", "reconcile"] },
    mode: { const: "apply" },
    confirmedPlan: { type: "object" },
    planDigest: digestSchema,
  }),
  closedObject(["root", "action", "mode", "operationId", "confirmedPlan", "planDigest"], {
    root: { type: "string" },
    action: { type: "string", enum: ["fresh-initialize", "reconfigure", "reconcile"] },
    mode: { const: "recover" },
    operationId: {
      type: "string",
      pattern: "^workspace-mutation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    },
    confirmedPlan: { type: "object" },
    planDigest: digestSchema,
  }),
]);

const evidenceSourceSchema = Object.freeze({
  oneOf: [{
    type: "object",
    required: ["kind", "root", "path", "expectedType", "expectedDigest"],
    properties: {
      kind: { const: "managed-path" },
      root: {
        oneOf: [
          closedObject(["kind", "repositoryId"], {
            kind: { const: "repository" },
            repositoryId: repositoryIdSchema,
          }),
          closedObject(["kind", "surfaceId"], {
            kind: { const: "support-surface" },
            surfaceId: {
              type: "string",
              pattern: "^surface_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            },
          }),
        ],
      },
      path: { type: "string" },
      expectedType: { type: "string", enum: ["file", "tree"] },
      expectedDigest: digestSchema,
    },
    additionalProperties: false,
  }, {
    type: "object",
    required: ["kind", "url", "verification"],
    properties: {
      kind: { const: "https" },
      url: { type: "string", pattern: "^https://" },
      verification: closedObject(["kind", "digest"], {
        kind: { const: "caller-supplied-digest" },
        digest: digestSchema,
      }),
    },
    additionalProperties: false,
  }, {
    type: "object",
    required: ["kind", "repositoryId", "commitOid", "verification"],
    properties: {
      kind: { const: "git-commit" },
      repositoryId: repositoryIdSchema,
      commitOid: { type: "string", pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" },
      verification: closedObject(["kind", "digest"], {
        kind: { const: "caller-supplied-digest" },
        digest: digestSchema,
      }),
    },
    additionalProperties: false,
  }],
});

const relationSchema = Object.freeze({
  oneOf: [{
    type: "object",
    required: ["kind", "artifactKind", "artifactId", "ref", "digest"],
    properties: {
      kind: { const: "artifact" },
      artifactKind: {
        type: "string",
        enum: ["wakeflow-task-package", "wakeflow-target-result", "wakeflow-review-candidate", "wakeflow-test-card"],
      },
      artifactId: { type: "string" },
      ref: { type: "string" },
      digest: digestSchema,
    },
    additionalProperties: false,
  }, {
    type: "object",
    required: ["kind", "eventId", "digest"],
    properties: {
      kind: { const: "controller-event" },
      eventId: { type: "string" },
      digest: digestSchema,
    },
    additionalProperties: false,
  }],
});

const evidenceBranches = Object.freeze([
  closedObject(["root", "demandId", "mode", "kind", "source"], {
    root: { type: "string" },
    demandId: {
      type: "string",
      pattern: "^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    },
    mode: { const: "preview" },
    kind: { type: "string", minLength: 1, maxLength: 128 },
    source: evidenceSourceSchema,
    relations: { type: "array", maxItems: 256, uniqueItems: true, items: relationSchema },
    sensitivity: { type: "string", enum: ["public", "internal"] },
    controllerReviewedOpaque: { type: "boolean" },
  }),
  closedObject(["root", "demandId", "mode", "plan", "planDigest"], {
    root: { type: "string" },
    demandId: {
      type: "string",
      pattern: "^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    },
    mode: { const: "apply" },
    plan: { type: "object" },
    planDigest: digestSchema,
  }),
  closedObject(["root", "demandId", "mode"], {
    root: { type: "string" },
    demandId: {
      type: "string",
      pattern: "^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    },
    mode: { const: "recover" },
  }),
]);

const maintenanceTool = {
  name: MAINTENANCE_TOOL,
  description: "Preview, apply, or explicitly recover the public v3 Wakeflow workspace maintenance plan. The admitted actions are fresh-initialize, reconfigure, and reconcile. Apply consumes the complete reviewed confirmedPlan and digest, then re-derives it under the workspace mutation fence; the digest is not an authorization token.",
  annotations: writeAnnotations("Maintain Wakeflow Workspace", true, { destructive: true }),
  inputSchema: {
    type: "object",
    oneOf: maintenanceBranches,
    properties: {
      root: { type: "string" },
      action: { type: "string" },
      mode: { type: "string" },
      request: { type: "object" },
      confirmedPlan: { type: "object" },
      planDigest: digestSchema,
      operationId: { type: "string" },
    },
    additionalProperties: false,
  },
};

const evidenceTool = {
  name: EVIDENCE_TOOL,
  description: "Controller-owned capability to preview, apply, or recover one immutable managed evidence import for an exact typed demand. The handler derives the configured Controller identity and canonical state root; tool visibility is not authentication, and caller-supplied role or confirmation fields are never accepted. Evidence records review input, not truth or acceptance.",
  annotations: writeAnnotations("Record Wakeflow Managed Evidence", true),
  inputSchema: {
    type: "object",
    oneOf: evidenceBranches,
    properties: {
      root: { type: "string" },
      demandId: { type: "string" },
      mode: { type: "string" },
      kind: { type: "string" },
      source: evidenceSourceSchema,
      relations: { type: "array" },
      sensitivity: { type: "string" },
      controllerReviewedOpaque: { type: "boolean" },
      plan: { type: "object" },
      planDigest: digestSchema,
    },
    additionalProperties: false,
  },
};

const demandIdSchema = Object.freeze({
  type: "string",
  pattern: "^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});

/**
 * 生成普通 public-v3 工具的闭合 envelope 声明。
 * schema 只声明公共字段；operation-specific request 仍由真实领域 owner 二次精确校验。
 */
function routedTool({ name, title, description, operations, readOnly = false, destructive = false }) {
  return Object.freeze({
    name,
    description: `${description} Inputs use one closed public envelope: root, optional typed demandId, operation, and the exact owner request. Workspace/state/config/ledger paths are derived and cannot be caller-overridden.`,
    annotations: writeAnnotations(title, true, { readOnly, destructive }),
    inputSchema: {
      type: "object",
      required: ["root", "operation", "request"],
      properties: {
        root: { type: "string", description: "Normalized absolute Wakeflow workspace root; never returned." },
        demandId: demandIdSchema,
        operation: { type: "string", enum: operations },
        request: {
          type: "object",
          description: "Operation-specific closed request validated again by the owning v3 domain service.",
        },
      },
      additionalProperties: false,
    },
  });
}

const routedToolDefinitions = [
  routedTool({
    name: "wakeflow_status",
    title: "Inspect Wakeflow Status",
    description: "Issue one read-only v3 observation and return its status projection.",
    operations: ["inspect"],
    readOnly: true,
  }),
  routedTool({
    name: "wakeflow_replace_windows",
    title: "Replace Wakeflow Window Binding",
    description: "Inspect, replace, or decommission one typed host-local window binding; it never performs the host create/close effect.",
    operations: ["inspect", "replace", "decommission"],
    destructive: true,
  }),
  routedTool({
    name: "wakeflow_register_window",
    title: "Register Wakeflow Window Binding",
    description: "Register one host-created window against its stable windowId while keeping the raw handle private.",
    operations: ["register"],
  }),
  routedTool({
    name: "wakeflow_create_demand",
    title: "Create Wakeflow Demand",
    description: "Preview, publish, or recover one exact initial demand authority stack.",
    operations: ["preview", "apply", "recover"],
  }),
  routedTool({
    name: "wakeflow_add_task",
    title: "Add Wakeflow Task Package",
    description: "Create one complete immutable TaskPackage and its exact state transition.",
    operations: ["create"],
  }),
  routedTool({
    name: "wakeflow_prepare_delivery",
    title: "Prepare Wakeflow Delivery",
    description: "Plan/apply/claim/rearm target delivery or plan/apply/preflight a Controller return without executing a host send.",
    operations: [
      "target-preview",
      "target-apply",
      "target-claim",
      "target-rearm",
      "controller-preview",
      "controller-apply",
      "controller-pre-send",
    ],
  }),
  routedTool({
    name: "wakeflow_record_delivery",
    title: "Record Wakeflow Delivery Outcome",
    description: "Record an already-observed target or Controller-return host outcome; this call is not the host-effect fence.",
    operations: ["target-outcome", "controller-outcome"],
  }),
  routedTool({
    name: "wakeflow_record_target_result",
    title: "Record Wakeflow Target Result",
    description: "Import one transport-bound TargetResult through the strict current-envelope authority.",
    operations: ["import"],
  }),
  routedTool({
    name: "wakeflow_review_pack",
    title: "Inspect Wakeflow Review",
    description: "Inspect one strict dispatch-group review snapshot or the demand result/review trace.",
    operations: ["group", "trace"],
    readOnly: true,
  }),
  routedTool({
    name: "wakeflow_reduce_results",
    title: "Create Wakeflow Review Candidate",
    description: "Create one exact ReviewCandidate from a strict dispatch-group result snapshot.",
    operations: ["create"],
  }),
  routedTool({
    name: "wakeflow_decide_review",
    title: "Decide Wakeflow Review",
    description: "Commit one exact accept, rework, redesign, or blocked decision for the pending candidate.",
    operations: ["decide"],
  }),
  routedTool({
    name: "wakeflow_complete_demand",
    title: "Complete Wakeflow Demand",
    description: "Preview, apply, or recover the dedicated completion lifecycle owner.",
    operations: ["preview", "apply", "recover"],
  }),
  routedTool({
    name: "wakeflow_continue_demand",
    title: "Continue Wakeflow Demand",
    description: "Create an exact continuation TaskPackage after the retained demand.completed tail authorizes it.",
    operations: ["create"],
  }),
  routedTool({
    name: "wakeflow_recover_state_transition",
    title: "Recover Wakeflow State Transition",
    description: "Recover only an explicitly selected generic or lifecycle state-transition owner.",
    operations: ["generic", "lifecycle"],
  }),
  routedTool({
    name: "wakeflow_release_window_lock",
    title: "Release Wakeflow Window Lease",
    description: "Release one exact typed lease/binding/delivery tuple by compare-and-delete.",
    operations: ["release"],
    destructive: true,
  }),
  routedTool({
    name: "wakeflow_view",
    title: "View Wakeflow Authority",
    description: "Return config, storage, verification, or strict result-trace read models; live status remains owned by wakeflow_status.",
    operations: ["config", "storage", "verification", "result-trace"],
    readOnly: true,
  }),
  routedTool({
    name: "wakeflow_storage_preserve",
    title: "Preserve Wakeflow Local Evidence",
    description: "Inspect, plan, apply, release, or recover a typed local preservation mutation.",
    operations: ["inspect", "preview", "preview-release", "apply", "recover"],
    destructive: true,
  }),
  routedTool({
    name: "wakeflow_archive",
    title: "Archive Wakeflow Demand",
    description: "Preview, commit, inspect, or recover one portable whole-demand BusinessArchive.",
    operations: ["preview", "apply", "inspect", "recover"],
    destructive: true,
  }),
  routedTool({
    name: "wakeflow_intake_test_card",
    title: "Create Wakeflow Test Card",
    description: "Create one exact authority-bound TestCard before a Test TaskPackage.",
    operations: ["create"],
  }),
  routedTool({
    name: "wakeflow_deliver",
    title: "Append Wakeflow TODO",
    description: "Append one exact pending or parked row to the canonical global TODO authority.",
    operations: ["append"],
  }),
  routedTool({
    name: "wakeflow_next_work",
    title: "Inspect Wakeflow TODO",
    description: "Read the canonical TODO authority under its writer lock without creating a missing board.",
    operations: ["inspect"],
    readOnly: true,
  }),
  routedTool({
    name: "wakeflow_claim_next",
    title: "Claim Wakeflow TODO",
    description: "Inspect, claim, or recover one exact TODO row CAS; it does not choose a row, initialize a demand, or replace root-first create-demand publication.",
    operations: ["inspect", "claim", "recover"],
  }),
  routedTool({
    name: "wakeflow_cancel_demand",
    title: "Cancel Wakeflow Demand",
    description: "Preview, apply, or recover the dedicated cancellation owner while preserving results and honest history.",
    operations: ["preview", "apply", "recover"],
  }),
  routedTool({
    name: "wakeflow_pod_open",
    title: "Open Wakeflow Pod",
    description: "Inspect/plan materialization or preview/apply Pod control/product membership without performing a host effect.",
    operations: [
      "inspect-materialization",
      "plan-materialization",
      "launch-preview",
      "launch-apply",
      "product-preview",
      "product-apply",
    ],
  }),
  routedTool({
    name: "wakeflow_pod_record",
    title: "Record Wakeflow Pod Evidence",
    description: "Record or observe one typed Pod materialization, design, Test-access, or close fact.",
    operations: [
      "record-materialization",
      "design-handoff",
      "test-access-observe",
      "test-access-receipt",
      "close-observe",
      "close-receipt",
    ],
  }),
  routedTool({
    name: "wakeflow_pod_bind",
    title: "Bind Wakeflow Pod Window",
    description: "Record one Pod creation receipt or decommission one exactly closed Pod binding.",
    operations: ["creation-receipt", "binding-decommission"],
    destructive: true,
  }),
  routedTool({
    name: "wakeflow_pod_plan",
    title: "Plan Wakeflow Pod Action",
    description: "Record a Design request, issue/inspect Test access, or issue/inspect a close intent without combining the host effect.",
    operations: ["design-request", "test-access-plan", "test-access-inspect", "close-intent", "close-inspect"],
  }),
  routedTool({
    name: "wakeflow_prune_runtime",
    title: "Prune Wakeflow Transport",
    description: "Preview, apply, or recover whole-demand transport retention after archive and lease closure.",
    operations: ["preview", "apply", "recover"],
    destructive: true,
  }),
  routedTool({
    name: "wakeflow_verify",
    title: "Verify Wakeflow Workspace",
    description: "Issue one read-only v3 observation and return its verification projection.",
    operations: ["inspect"],
    readOnly: true,
  }),
];

const PUBLIC_TOOL_ORDER = Object.freeze([
  "wakeflow_status",
  MAINTENANCE_TOOL,
  "wakeflow_replace_windows",
  "wakeflow_register_window",
  "wakeflow_create_demand",
  "wakeflow_add_task",
  "wakeflow_prepare_delivery",
  "wakeflow_record_delivery",
  "wakeflow_record_target_result",
  "wakeflow_review_pack",
  "wakeflow_reduce_results",
  "wakeflow_decide_review",
  "wakeflow_complete_demand",
  "wakeflow_continue_demand",
  EVIDENCE_TOOL,
  "wakeflow_recover_state_transition",
  "wakeflow_release_window_lock",
  "wakeflow_view",
  "wakeflow_storage_preserve",
  "wakeflow_archive",
  "wakeflow_intake_test_card",
  "wakeflow_deliver",
  "wakeflow_next_work",
  "wakeflow_claim_next",
  "wakeflow_cancel_demand",
  "wakeflow_pod_open",
  "wakeflow_pod_record",
  "wakeflow_pod_bind",
  "wakeflow_pod_plan",
  "wakeflow_prune_runtime",
  "wakeflow_verify",
]);

const toolByName = new Map([
  [MAINTENANCE_TOOL, maintenanceTool],
  [EVIDENCE_TOOL, evidenceTool],
  ...routedToolDefinitions.map((tool) => [tool.name, tool]),
]);

// tools 与 handlers 必须按同一固定顺序导出，供 MCP、CLI、validator 和双宿主产物共同核对。
export const tools = deepFreeze(PUBLIC_TOOL_ORDER.map((name) => toolByName.get(name)));

const handlerByName = Object.freeze({
  [MAINTENANCE_TOOL]: runMaintenance,
  [EVIDENCE_TOOL]: runEvidence,
  ...Object.fromEntries(routedToolDefinitions.map((tool) => [tool.name, domainHandler(tool.name)])),
});

export const handlers = Object.freeze(Object.fromEntries(
  PUBLIC_TOOL_ORDER.map((name) => [name, handlerByName[name]]),
));
