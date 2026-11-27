import {
  buildWakeflowConfigIndexes,
  parseWakeflowConfig,
  WAKEFLOW_ACTIVE_ROOT,
  WAKEFLOW_LOCAL_ROOT,
  WakeflowConfigError,
  type WakeflowConfigModel,
  type WakeflowConfigRepository,
  type WakeflowExternalSupportSurface,
  type WakeflowPresentationLanguage,
  type WakeflowProductWindow,
} from "../../configuration/wakeflow-config.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import {
  MarkdownJsonStringLiteralError,
  renderMarkdownJsonStringLiteral,
} from "../../foundation/text/markdown-json-string-literal.js";
import { encodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceComponent,
  type WakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
} from "../workspace-host-resource-profile.js";
import {
  WAKEFLOW_MANAGED_TEXT_MARKER_PREFIX,
  type WakeflowManagedTextEnvelopeTarget,
} from "./wakeflow-managed-text-envelope.js";

/**
 * Wakeflow Workspace / Managed Integration：外部拥有根目录里 Wakeflow 托管块的正文权威。
 *
 * 外部根有两类：`instructionManagement: managed-block` 的产品仓库，以及
 * `ownership: external-owned` 且 `instructionManagement: managed-block` 的 Design/Test
 * 支撑面。两类根都不由 Wakeflow 创建、不放 scaffold；Wakeflow 只在其宿主指令文件里
 * 拥有一个受管区域。`owner-managed` 的仓库与支撑面不产生任何 target。
 *
 * 正文只引用 primary pod 的持久窗口：其他 pod 的窗口随 pod 生命周期出现和消失，把它们
 * 写进托管块会让用户仓库里的受管文件随每次 pod 创建而变脏。摘要基础不含 Config 摘要，
 * 只含程序、目标、宿主、文件名、语言、窗口 ID 与正文摘要，因此 pod 记录的变化不会
 * 触发重组。本模块不读取文件、不解释区域外文本，也不执行重组、CAS 或原子发布。
 */

export const WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_AUTHORITY_KIND =
  "WakeflowExternalInstructionBodyAuthority" as const;
export const WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_AUTHORITY_SCHEMA_VERSION = 1 as const;
const WAKEFLOW_REPOSITORY_INSTRUCTION_COMPONENT = "repository-instruction" as const;
const WAKEFLOW_SUPPORT_INSTRUCTION_COMPONENT = "support-instruction" as const;
const WAKEFLOW_EXTERNAL_INSTRUCTION_OWNER = "host-instruction-integration" as const;

export type WakeflowExternalInstructionTarget =
  | {
      readonly kind: "repository";
      readonly repositoryId: WakeflowDurableId<"repository">;
    }
  | {
      readonly kind: "support-surface";
      readonly surfaceId: WakeflowDurableId<"surface">;
    };

export interface WakeflowExternalInstructionBodyAuthority {
  readonly kind: typeof WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_AUTHORITY_KIND;
  readonly schemaVersion: typeof WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_AUTHORITY_SCHEMA_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly target: Readonly<WakeflowExternalInstructionTarget>;
  readonly targetKey: string;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly instructionFileName: WakeflowWorkspaceHostResourceComponent;
  readonly language: WakeflowPresentationLanguage;
  readonly windowIds: readonly WakeflowDurableId<"window">[];
  readonly body: string;
  readonly bodyDigest: Sha256Digest;
  readonly authorityDigest: Sha256Digest;
  readonly envelopeTarget: Readonly<WakeflowManagedTextEnvelopeTarget>;
}

export type WakeflowExternalInstructionBodyAuthorityErrorReason =
  | "input"
  | "config"
  | "profile"
  | "target"
  | "text";

/** 外部指令正文权威准入失败的稳定、脱敏错误。 */
export class WakeflowExternalInstructionBodyAuthorityError extends ModuleError<WakeflowExternalInstructionBodyAuthorityErrorReason> {
  static override readonly code = "wakeflow-external-instruction-body-authority";
}

const fail: Fail<WakeflowExternalInstructionBodyAuthorityErrorReason> = failWith(
  WakeflowExternalInstructionBodyAuthorityError,
);

function parseConfig(value: unknown): WakeflowConfigModel {
  try {
    return parseWakeflowConfig(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigError) fail("config", error.path, error);
    throw error;
  }
}

function parseProfile(value: unknown): Readonly<WakeflowWorkspaceHostResourceProfile> {
  try {
    return parseWakeflowWorkspaceHostResourceProfile(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("profile", error.path, error);
    }
    throw error;
  }
}

function parseTargetId<K extends "repository" | "surface">(
  value: unknown,
  kind: K,
  path: string,
): WakeflowDurableId<K> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", path, error);
    throw error;
  }
}

/** 快照并校验一个外部指令 target 的形状与类型化标识。 */
export function parseWakeflowExternalInstructionTarget(
  value: unknown,
  path = "$target",
): Readonly<WakeflowExternalInstructionTarget> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path, error);
    throw error;
  }
  const keys = Object.keys(record).sort().join("\u0000");
  if (record.kind === "repository" && keys === "kind\u0000repositoryId") {
    return Object.freeze({
      kind: "repository",
      repositoryId: parseTargetId(record.repositoryId, "repository", `${path}.repositoryId`),
    });
  }
  if (record.kind === "support-surface" && keys === "kind\u0000surfaceId") {
    return Object.freeze({
      kind: "support-surface",
      surfaceId: parseTargetId(record.surfaceId, "surface", `${path}.surfaceId`),
    });
  }
  fail("input", path);
}

/** 一个 target 的稳定文本键；也是物化步骤的 targetKey。 */
export function wakeflowExternalInstructionTargetKey(
  target: Readonly<WakeflowExternalInstructionTarget>,
): string {
  return target.kind === "repository"
    ? `repository:${target.repositoryId}`
    : `support-surface:${target.surfaceId}`;
}

/** 一个 target 在 Config root placement 报告里的根键。 */
export function wakeflowExternalInstructionPlacementKey(
  target: Readonly<WakeflowExternalInstructionTarget>,
): string {
  return target.kind === "repository"
    ? `repository.${target.repositoryId}.root`
    : `support.${target.surfaceId}.root`;
}

/**
 * 列出 desired Config 里需要 Wakeflow 托管块的外部根：managed-block 仓库在前，
 * external-owned 且 managed-block 的支撑面在后，各自保持 Config 的呈现顺序。
 */
export function listWakeflowExternalInstructionTargets(
  configValue: unknown,
): readonly Readonly<WakeflowExternalInstructionTarget>[] {
  const config = parseConfig(configValue);
  const targets: Readonly<WakeflowExternalInstructionTarget>[] = [];
  for (const repository of config.topology.repositories) {
    if (repository.instructionManagement !== "managed-block") continue;
    targets.push(
      Object.freeze({
        kind: "repository",
        repositoryId: repository.repositoryId,
      }),
    );
  }
  for (const surface of config.topology.supportSurfaces) {
    if (
      surface.ownership !== "external-owned" ||
      surface.instructionManagement !== "managed-block"
    ) {
      continue;
    }
    targets.push(
      Object.freeze({
        kind: "support-surface",
        surfaceId: surface.surfaceId,
      }),
    );
  }
  return Object.freeze(targets);
}

type ResolvedTarget =
  | {
      readonly kind: "repository";
      readonly repository: WakeflowConfigRepository;
      readonly windows: readonly WakeflowProductWindow[];
    }
  | {
      readonly kind: "support-surface";
      readonly surface: WakeflowExternalSupportSurface;
      readonly windowId: WakeflowDurableId<"window">;
    };

function resolveTarget(
  config: WakeflowConfigModel,
  target: Readonly<WakeflowExternalInstructionTarget>,
): ResolvedTarget {
  const indexes = buildWakeflowConfigIndexes(config);
  if (target.kind === "repository") {
    const repository = indexes.repositoryById[target.repositoryId];
    if (repository === undefined || repository.instructionManagement !== "managed-block") {
      fail("target", "$target.repositoryId");
    }
    const windows = [...(indexes.primaryPod.windowsByRepositoryId[target.repositoryId] ?? [])].sort(
      (left, right) =>
        left.windowId < right.windowId ? -1 : left.windowId > right.windowId ? 1 : 0,
    );
    if (windows.length === 0) fail("target", "$target.repositoryId");
    return { kind: "repository", repository, windows };
  }
  const surface = indexes.surfaceById[target.surfaceId];
  if (
    surface === undefined ||
    surface.ownership !== "external-owned" ||
    surface.instructionManagement !== "managed-block"
  ) {
    fail("target", "$target.surfaceId");
  }
  const window = surface.capability === "design" ? indexes.designWindow : indexes.testWindow;
  if (window.root.surfaceId !== surface.surfaceId) {
    fail("target", "$target.surfaceId");
  }
  return { kind: "support-surface", surface, windowId: window.windowId };
}

function markdownDataLiteral(value: string, path: string): string {
  try {
    return renderMarkdownJsonStringLiteral(value, path);
  } catch (error: unknown) {
    if (error instanceof MarkdownJsonStringLiteralError) {
      fail("text", error.path, error);
    }
    throw error;
  }
}

function windowLines(windows: readonly WakeflowProductWindow[]): readonly string[] {
  return windows.map((window, index) => {
    const at = `$/windows/${index}`;
    const description =
      window.description === undefined
        ? ""
        : ` (${markdownDataLiteral(window.description, `${at}/description`)})`;
    return `- ${markdownDataLiteral(window.windowId, `${at}/windowId`)}: ${markdownDataLiteral(window.displayName, `${at}/displayName`)}${description}`;
  });
}

function identityLines(
  config: WakeflowConfigModel,
  language: WakeflowPresentationLanguage,
): readonly string[] {
  const programId = markdownDataLiteral(config.program.programId, "$/program/programId");
  const programName = markdownDataLiteral(config.program.displayName, "$/program/displayName");
  return language === "en"
    ? [`- Program ID: ${programId}`, `- Program name: ${programName}`]
    : [`- 程序 ID：${programId}`, `- 程序名称：${programName}`];
}

function hostLine(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  language: WakeflowPresentationLanguage,
): string {
  const hostId = markdownDataLiteral(profile.hostId, "$/profile/hostId");
  return language === "en" ? `- Host protocol: ${hostId}` : `- 宿主协议：${hostId}`;
}

function runtimeRootsLiteral(): { readonly active: string; readonly local: string } {
  return {
    active: markdownDataLiteral(`${WAKEFLOW_ACTIVE_ROOT}/`, "$/paths/activeRoot"),
    local: markdownDataLiteral(`${WAKEFLOW_LOCAL_ROOT}/`, "$/paths/localRoot"),
  };
}

function repositoryEnglishBody(
  config: WakeflowConfigModel,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  repository: WakeflowConfigRepository,
  windows: readonly WakeflowProductWindow[],
): string {
  const description =
    repository.description === undefined
      ? []
      : [
          `- Repository description: ${markdownDataLiteral(
            repository.description,
            "$/repository/description",
          )}`,
        ];
  const roots = runtimeRootsLiteral();
  return `${[
    "## Wakeflow Repository Instructions",
    "",
    `> Wakeflow owns only this managed section in ${markdownDataLiteral(profile.instructionFileName, "$/profile/instructionFileName")}; the repository owner owns all surrounding text.`,
    "",
    "### Stable identity",
    "",
    ...identityLines(config, "en"),
    `- Repository ID: ${markdownDataLiteral(repository.repositoryId, "$/repository/repositoryId")}`,
    `- Repository name: ${markdownDataLiteral(repository.displayName, "$/repository/displayName")}`,
    ...description,
    hostLine(profile, "en"),
    "",
    "### Durable responsibility windows",
    "",
    ...windowLines(windows),
    "",
    "### Exact assignment rule",
    "",
    "- The windows above are the primary pod's alternative durable responsibility entries for one repository, not parallel execution lanes. Windows of other pods for this repository work in their own worktrees under the same rules.",
    "- Act only when the registered window binding and the current task package agree on this program, this repository, and the exact target task. Without an exact task package, perform identity alignment only and wait.",
    "- Never consume another window's task merely because it shares this checkout. The task package owns the current scope, exclusions, forbidden actions, acceptance, and validation; window descriptions and this managed section cannot expand it.",
    "",
    "### Repository boundary",
    "",
    "- This repository owns its product source, local engineering rules, physical health, validation, and dirty-worktree decisions. Wakeflow does not grant parallel write authority merely because several windows reference it.",
    `- Wakeflow keeps its authority and runtime state in the program workspace, never in this repository. Do not create, edit, move, commit, or delete ${roots.active} or ${roots.local} anywhere.`,
    "- Use Wakeflow capabilities for state, delivery, evidence, identity, and retention changes. If the Wakeflow plugin is unavailable, use this section for read-only orientation only and report the blocker.",
    "",
    "### Safety boundary",
    "",
    "- Do not reset, revert, delete user work, rewrite history, expose secrets, or mutate unrelated repositories.",
    "- Commit, push, tag, publish, release, cache refresh, destructive cleanup, and scope expansion each require explicit authorization.",
    "- Stop and report the contradiction when identity, authority, ownership, paths, or the task package is missing, stale, or inconsistent.",
  ].join("\n")}\n`;
}

function repositorySimplifiedChineseBody(
  config: WakeflowConfigModel,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  repository: WakeflowConfigRepository,
  windows: readonly WakeflowProductWindow[],
): string {
  const description =
    repository.description === undefined
      ? []
      : [`- 仓库说明：${markdownDataLiteral(repository.description, "$/repository/description")}`];
  const roots = runtimeRootsLiteral();
  return `${[
    "## Wakeflow 仓库指令",
    "",
    `> Wakeflow 只拥有 ${markdownDataLiteral(profile.instructionFileName, "$/profile/instructionFileName")} 中的这一受管区域；区域外文本归仓库所有者。`,
    "",
    "### 稳定身份",
    "",
    ...identityLines(config, "zh-Hans"),
    `- 仓库 ID：${markdownDataLiteral(repository.repositoryId, "$/repository/repositoryId")}`,
    `- 仓库名称：${markdownDataLiteral(repository.displayName, "$/repository/displayName")}`,
    ...description,
    hostLine(profile, "zh-Hans"),
    "",
    "### 持久职责窗口",
    "",
    ...windowLines(windows),
    "",
    "### 精确分配规则",
    "",
    "- 上述窗口是 primary pod 中同一仓库的多个持久职责入口，不是并行执行通道；其他 pod 中该仓库的窗口在各自的 worktree 里遵循同样的规则。",
    "- 只有已登记的窗口绑定与当前任务包在本程序、本仓库和精确目标任务上一致时才行动；没有精确任务包时只做身份对齐并等待。",
    "- 不得仅因共享同一检出就消费其他窗口的任务。任务包拥有当前范围、排除项、禁止动作、验收与验证；窗口说明和本受管区域不能扩大它。",
    "",
    "### 仓库边界",
    "",
    "- 本仓库拥有自己的产品源码、本地工程规则、物理健康、验证与脏工作树决策；Wakeflow 不因多个窗口引用它而授予并行写权限。",
    `- Wakeflow 的权威与运行时状态只保存在程序工作区，绝不放在本仓库；不得在任何位置创建、编辑、搬移、提交或删除 ${roots.active} 或 ${roots.local}。`,
    "- 状态、交付、证据、身份和保留期变更必须使用 Wakeflow 能力；Wakeflow 插件不可用时，只能把本区域用于只读定位并报告阻塞。",
    "",
    "### 安全边界",
    "",
    "- 不得重置、回退或删除用户工作，不得改写历史、泄露秘密或修改无关仓库。",
    "- 提交、推送、打标签、发布、发版、刷新缓存、破坏性清理和扩大范围都需要分别获得明确授权。",
    "- 身份、权威、所有权、路径或任务包缺失、陈旧或矛盾时，停止并报告矛盾。",
  ].join("\n")}\n`;
}

function surfaceEnglishBody(
  config: WakeflowConfigModel,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  surface: WakeflowExternalSupportSurface,
  windowId: WakeflowDurableId<"window">,
): string {
  const design = surface.capability === "design";
  const roleName = design ? "Design" : "Test";
  const description =
    surface.description === undefined
      ? []
      : [
          `- Surface description: ${markdownDataLiteral(
            surface.description,
            "$/surface/description",
          )}`,
        ];
  const roots = runtimeRootsLiteral();
  return `${[
    `## Wakeflow ${roleName} Support Instructions`,
    "",
    `> Wakeflow owns only this managed section in ${markdownDataLiteral(profile.instructionFileName, "$/profile/instructionFileName")}; the surface owner owns all surrounding text.`,
    "",
    "### Stable identity",
    "",
    ...identityLines(config, "en"),
    `- Surface ID: ${markdownDataLiteral(surface.surfaceId, "$/surface/surfaceId")}`,
    `- Surface name: ${markdownDataLiteral(surface.displayName, "$/surface/displayName")}`,
    ...description,
    `- Window ID: ${markdownDataLiteral(windowId, "$/window/windowId")}`,
    hostLine(profile, "en"),
    "",
    "### Authority boundary",
    "",
    design
      ? "- Act only on an exact Wakeflow Design assignment or a direct user request that remains inside the Design role."
      : "- Act only on an exact Controller-approved Test assignment or a Controller-scoped Test-only reproduction or environment diagnostic.",
    "- Typed Wakeflow records and the current exact assignment are authority. Conversation, filenames, directory presence, drafts, notes, projections, and Agent claims are not workflow state.",
    "- Use Wakeflow capabilities for workflow mutations. If the plugin is unavailable, perform read-only orientation and report the blocker instead of editing authority files manually.",
    "",
    `### ${roleName} role`,
    "",
    ...(design
      ? [
          "- Clarify goals, inspect available facts, compare bounded options, define scope and non-goals, and prepare reviewable requirement material.",
          "- Create or revise a persistent draft only when explicitly requested. A draft remains non-authoritative until it is explicitly confirmed and delivered through Wakeflow.",
          "- Do not implement product code, mutate product repositories, create Controller task packages, dispatch work, accept delivery, or make the final product decision.",
          "- Load the installed `wakeflow-design` Skill for method. The Skill cannot expand this role or grant additional write authority.",
        ]
      : [
          "- Execute only Controller-approved implementation validation or a Controller-scoped Test-only reproduction or environment diagnostic.",
          "- Product source is always read-only. Mutations are limited to the confirmed environment and explicitly Test-owned harness or fixture assets.",
          "- Return bounded, reproducible evidence and honest limitations; do not repair product code or decide product acceptance.",
          "- Load the installed `wakeflow-test` Skill for method. The Skill cannot expand the frozen target, environment, or write boundary.",
        ]),
    "",
    "### Surface boundary",
    "",
    `- This surface is owned outside Wakeflow: Wakeflow creates no scaffold here and keeps its authority and runtime state in the program workspace. Do not create, edit, move, commit, or delete ${roots.active} or ${roots.local} anywhere.`,
    "- The window above is the primary pod's durable entry for this surface. Windows of other pods for this surface follow the same rules; current authority comes only from the registered window binding and the exact assignment.",
    "",
    "### Safety boundary",
    "",
    "- Do not reset, revert, delete user work, rewrite history, expose secrets, or mutate unrelated repositories.",
    "- Commit, push, tag, publish, release, cache refresh, destructive cleanup, live-data mutation, and scope expansion each require explicit authorization in addition to role authority.",
    "- Stop and report the contradiction when identity, authority, ownership, environment, or the assigned contract is missing, stale, or inconsistent.",
  ].join("\n")}\n`;
}

function surfaceSimplifiedChineseBody(
  config: WakeflowConfigModel,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  surface: WakeflowExternalSupportSurface,
  windowId: WakeflowDurableId<"window">,
): string {
  const design = surface.capability === "design";
  const roleName = design ? "Design" : "Test";
  const description =
    surface.description === undefined
      ? []
      : [`- Surface 说明：${markdownDataLiteral(surface.description, "$/surface/description")}`];
  const roots = runtimeRootsLiteral();
  return `${[
    `## Wakeflow ${roleName} 支持指令`,
    "",
    `> Wakeflow 只拥有 ${markdownDataLiteral(profile.instructionFileName, "$/profile/instructionFileName")} 中的这一受管区域；区域外文本归支撑面所有者。`,
    "",
    "### 稳定身份",
    "",
    ...identityLines(config, "zh-Hans"),
    `- Surface ID：${markdownDataLiteral(surface.surfaceId, "$/surface/surfaceId")}`,
    `- Surface 名称：${markdownDataLiteral(surface.displayName, "$/surface/displayName")}`,
    ...description,
    `- 窗口 ID：${markdownDataLiteral(windowId, "$/window/windowId")}`,
    hostLine(profile, "zh-Hans"),
    "",
    "### 权威边界",
    "",
    design
      ? "- 只处理 Wakeflow 精确分配的 Design 工作，或仍处于 Design 职责范围内的用户直接请求。"
      : "- 只处理 Controller 已批准的 Test 分配，或 Controller 限定范围的 Test-only 复现与环境诊断。",
    "- 类型化 Wakeflow 记录和当前精确分配才是权威。对话、文件名、目录存在性、草稿、笔记、投影和 Agent 声明都不是工作流状态。",
    "- 工作流变更必须使用 Wakeflow 能力。插件不可用时只能只读定位并报告阻塞，不得手工编辑权威文件。",
    "",
    `### ${roleName} 职责`,
    "",
    ...(design
      ? [
          "- 澄清目标、检查已有事实、比较有边界的方案、明确范围与非目标，并准备可审阅的需求材料。",
          "- 只有明确要求时才能创建或修改持久草稿；草稿在明确确认并通过 Wakeflow 交付前始终不是权威。",
          "- 不得实现产品代码、修改产品仓库、创建 Controller 任务包、调度工作、验收交付或作出最终产品决策。",
          "- 方法步骤由已安装的 `wakeflow-design` Skill 提供；Skill 不能扩大本角色或授予额外写权限。",
        ]
      : [
          "- 只执行 Controller 已批准的实现验证，或 Controller 限定范围的 Test-only 复现与环境诊断。",
          "- 产品源码始终只读；变更只限于已确认环境和明确归 Test 所有的 harness 或 fixture 资源。",
          "- 返回有界、可复现的证据和真实限制；不得修复产品代码或决定产品验收。",
          "- 方法步骤由已安装的 `wakeflow-test` Skill 提供；Skill 不能扩大已冻结的目标、环境或写入边界。",
        ]),
    "",
    "### 支撑面边界",
    "",
    `- 本支撑面归 Wakeflow 之外的所有者：Wakeflow 不在这里创建 scaffold，并把权威与运行时状态只保存在程序工作区；不得在任何位置创建、编辑、搬移、提交或删除 ${roots.active} 或 ${roots.local}。`,
    "- 上述窗口是 primary pod 中本支撑面的持久入口；其他 pod 中本支撑面的窗口遵循同样的规则，当前权威只来自已登记的窗口绑定与精确分配。",
    "",
    "### 安全边界",
    "",
    "- 不得重置、回退或删除用户工作，不得改写历史、泄露秘密或修改无关仓库。",
    "- 提交、推送、打标签、发布、发版、刷新缓存、破坏性清理、修改真实数据和扩大范围，都需要在角色权限之外另行获得明确授权。",
    "- 身份、权威、所有权、环境或分配合同缺失、陈旧或矛盾时，停止并报告矛盾。",
  ].join("\n")}\n`;
}

function renderBody(
  config: WakeflowConfigModel,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  resolved: ResolvedTarget,
): string {
  const english = config.presentation.language === "en";
  const body =
    resolved.kind === "repository"
      ? english
        ? repositoryEnglishBody(config, profile, resolved.repository, resolved.windows)
        : repositorySimplifiedChineseBody(config, profile, resolved.repository, resolved.windows)
      : english
        ? surfaceEnglishBody(config, profile, resolved.surface, resolved.windowId)
        : surfaceSimplifiedChineseBody(config, profile, resolved.surface, resolved.windowId);
  if (
    !body.isWellFormed() ||
    body.normalize("NFC") !== body ||
    body.startsWith("﻿") ||
    body.includes("\r") ||
    !body.endsWith("\n") ||
    body.endsWith("\n\n") ||
    body.includes(WAKEFLOW_MANAGED_TEXT_MARKER_PREFIX)
  ) {
    fail("text", "$body");
  }
  return body;
}

/** 从 Config、当前 Host Profile 与一个外部 target 生成唯一的托管块正文权威。 */
export function createWakeflowExternalInstructionBodyAuthority(
  configValue: unknown,
  profileValue: unknown,
  targetValue: unknown,
): Readonly<WakeflowExternalInstructionBodyAuthority> {
  const config = parseConfig(configValue);
  const profile = parseProfile(profileValue);
  const target = parseWakeflowExternalInstructionTarget(targetValue);
  const resolved = resolveTarget(config, target);
  const windowIds = Object.freeze(
    resolved.kind === "repository"
      ? resolved.windows.map((window) => window.windowId)
      : [resolved.windowId],
  );
  const body = renderBody(config, profile, resolved);
  let bodyDigest: Sha256Digest;
  try {
    bodyDigest = computeSha256Digest(encodeUtf8(body, "$body"), "$body");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("text", error.path, error);
    throw error;
  }
  const targetKey = wakeflowExternalInstructionTargetKey(target);
  const component =
    target.kind === "repository"
      ? WAKEFLOW_REPOSITORY_INSTRUCTION_COMPONENT
      : WAKEFLOW_SUPPORT_INSTRUCTION_COMPONENT;
  const authorityDigest = computeCanonicalJsonSha256Digest({
    kind: "WakeflowExternalInstructionBodyAuthorityDigestBasis" as const,
    schemaVersion: WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_AUTHORITY_SCHEMA_VERSION,
    programId: config.program.programId,
    targetKey,
    hostId: profile.hostId,
    instructionFileName: profile.instructionFileName,
    language: config.presentation.language,
    windowIds: [...windowIds],
    bodyDigest,
  });
  return Object.freeze({
    kind: WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_AUTHORITY_KIND,
    schemaVersion: WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_AUTHORITY_SCHEMA_VERSION,
    programId: config.program.programId,
    target,
    targetKey,
    hostId: profile.hostId,
    instructionFileName: profile.instructionFileName,
    language: config.presentation.language,
    windowIds,
    body,
    bodyDigest,
    authorityDigest,
    envelopeTarget: Object.freeze({
      component,
      owner: WAKEFLOW_EXTERNAL_INSTRUCTION_OWNER,
      body,
    }),
  });
}
