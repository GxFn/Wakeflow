import { renderDeterministicJsonDocument } from "../foundation/data/deterministic-json-document.js";
import {
  parseJsonValue,
  type JsonValue,
} from "../foundation/data/json-value.js";
import {
  parseWakeflowConfigV3,
  type WakeflowConfigProgram,
  type WakeflowConfigRepository,
  type WakeflowConfigSupportSurface,
  type WakeflowConfigV3Model,
  type WakeflowConfigWindow,
} from "./wakeflow-config-v3.js";

/**
 * Wakeflow Configuration：公开 v3 配置的唯一确定性格式化 JSON 表示。
 *
 * 本模块只重建领域字段顺序并渲染文本。Schema、类型化引用和跨实体关系继续由
 * `wakeflow-config-v3` 负责，物理读取和源资源事实由 Config 权威快照组合。字段顺序
 * 在此显式维护，不从 JSON Schema 的 `properties` 或输入文本推断。
 */

function optionalField(
  key: string,
  value: unknown,
): Readonly<Record<string, unknown>> {
  return value === undefined ? {} : { [key]: value };
}

function programRepresentation(program: WakeflowConfigProgram) {
  return {
    programId: program.programId,
    displayName: program.displayName,
    ...optionalField("description", program.description),
  };
}

function presentationRepresentation(
  presentation: WakeflowConfigV3Model["presentation"],
) {
  return { language: presentation.language };
}

function repositoryRepresentation(repository: WakeflowConfigRepository) {
  return {
    repositoryId: repository.repositoryId,
    path: repository.path,
    displayName: repository.displayName,
    ...optionalField("description", repository.description),
    instructionManagement: repository.instructionManagement,
    ...optionalField(
      "validation",
      repository.validation === undefined
        ? undefined
        : {
            residueExceptions: repository.validation.residueExceptions.map(
              (residue) => ({ path: residue.path, reason: residue.reason }),
            ),
          },
    ),
  };
}

function supportSurfaceRepresentation(surface: WakeflowConfigSupportSurface) {
  return {
    surfaceId: surface.surfaceId,
    capability: surface.capability,
    path: surface.path,
    displayName: surface.displayName,
    ...optionalField("description", surface.description),
    ownership: surface.ownership,
    ...(surface.ownership === "external-owned"
      ? { instructionManagement: surface.instructionManagement }
      : {}),
  };
}

function windowRepresentation(window: WakeflowConfigWindow) {
  const root = window.role === "controller"
    ? { kind: "program" as const }
    : window.role === "product"
      ? {
          kind: "repository" as const,
          repositoryId: window.root.repositoryId,
        }
      : {
          kind: "support-surface" as const,
          surfaceId: window.root.surfaceId,
        };
  return {
    windowId: window.windowId,
    role: window.role,
    displayName: window.displayName,
    ...optionalField("description", window.description),
    root,
  };
}

interface RoleMapRepresentationInput {
  readonly controller?: unknown;
  readonly design?: unknown;
  readonly test?: unknown;
  readonly product?: unknown;
  readonly default?: unknown;
}

function roleMapRepresentation(value: RoleMapRepresentationInput) {
  return {
    ...optionalField("controller", value.controller),
    ...optionalField("design", value.design),
    ...optionalField("test", value.test),
    ...optionalField("product", value.product),
    ...optionalField("default", value.default),
  };
}

interface LaunchRepresentationInput {
  readonly modelByRole?: RoleMapRepresentationInput;
  readonly reasoningEffortByRole?: RoleMapRepresentationInput;
  readonly permissionMode?: unknown;
}

function launchRepresentation(value: LaunchRepresentationInput) {
  return {
    ...optionalField(
      "modelByRole",
      value.modelByRole === undefined
        ? undefined
        : roleMapRepresentation(value.modelByRole),
    ),
    ...optionalField(
      "reasoningEffortByRole",
      value.reasoningEffortByRole === undefined
        ? undefined
        : roleMapRepresentation(value.reasoningEffortByRole),
    ),
    ...optionalField("permissionMode", value.permissionMode),
  };
}

function governanceRepresentation(governance: WakeflowConfigV3Model["governance"]) {
  return {
    ...optionalField(
      "audit",
      governance.audit === undefined
        ? undefined
        : { preservedReviewAfterDays: governance.audit.preservedReviewAfterDays },
    ),
    ...optionalField(
      "validation",
      governance.validation === undefined
        ? undefined
        : {
            runtimeResidue: {
              label: governance.validation.runtimeResidue.label,
              matchers: governance.validation.runtimeResidue.matchers.map(
                (matcher) => ({ kind: matcher.kind, value: matcher.value }),
              ),
            },
          },
    ),
  };
}

function hostsRepresentation(hosts: WakeflowConfigV3Model["hosts"]) {
  return {
    ...optionalField(
      "codex",
      hosts.codex === undefined
        ? undefined
        : {
            ...optionalField(
              "launch",
              hosts.codex.launch === undefined
                ? undefined
                : launchRepresentation(hosts.codex.launch),
            ),
          },
    ),
    ...optionalField(
      "claude-code",
      hosts["claude-code"] === undefined
        ? undefined
        : {
            ...optionalField(
              "launch",
              hosts["claude-code"].launch === undefined
                ? undefined
                : launchRepresentation(hosts["claude-code"].launch),
            ),
            ...optionalField(
              "tmux",
              hosts["claude-code"].tmux === undefined
                ? undefined
                : {
                    ...optionalField(
                      "sessionName",
                      hosts["claude-code"].tmux.sessionName,
                    ),
                    ...optionalField(
                      "socketName",
                      hosts["claude-code"].tmux.socketName,
                    ),
                  },
            ),
          },
    ),
  };
}

function configRepresentation(model: WakeflowConfigV3Model) {
  return {
    $schema: model.$schema,
    kind: model.kind,
    schemaVersion: model.schemaVersion,
    program: programRepresentation(model.program),
    presentation: presentationRepresentation(model.presentation),
    topology: {
      repositories: model.topology.repositories.map(repositoryRepresentation),
      supportSurfaces: model.topology.supportSurfaces.map(
        supportSurfaceRepresentation,
      ),
      windows: model.topology.windows.map(windowRepresentation),
    },
    storage: { ledgerRoot: model.storage.ledgerRoot },
    governance: governanceRepresentation(model.governance),
    hosts: hostsRepresentation(model.hosts),
  };
}

/**
 * 创建与持久 Config 文档字段顺序一致的递归冻结 JSON 值。
 *
 * 该值供需要嵌入 Config 快照的私有恢复意图复用；它不携带文件路径、节点身份或
 * 写入授权，也不会保留调用方对象引用。
 */
export function createWakeflowConfigV3DocumentValue(
  value: unknown,
): JsonValue {
  return parseJsonValue(
    configRepresentation(parseWakeflowConfigV3(value)),
    "$config",
  );
}

/** 从严格 v3 领域模型生成唯一 deterministic pretty JSON 表示。 */
export function renderWakeflowConfigV3(value: unknown): string {
  return renderDeterministicJsonDocument(
    createWakeflowConfigV3DocumentValue(value),
    "$config",
  );
}
