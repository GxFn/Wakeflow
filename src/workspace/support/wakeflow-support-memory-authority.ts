import {
  buildWakeflowConfigV3Indexes,
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  WAKEFLOW_PRESENTATION_LANGUAGES,
  type WakeflowConfigV3Model,
  type WakeflowManagedSupportSurface,
  type WakeflowPresentationLanguage,
} from "../../configuration/wakeflow-config-v3.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  splitPortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../foundation/identity/wakeflow-durable-id.js";
import {
  MarkdownJsonStringLiteralError,
  renderMarkdownJsonStringLiteral,
} from "../../foundation/text/markdown-json-string-literal.js";
import { encodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceComponent,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";

/**
 * Wakeflow Workspace / Support：Wakeflow-managed Design/Test whole-file memory 权威。
 *
 * 本模块从严格 Config、一个受管 Support surface 和当前 Host Profile 生成宿主项目指令
 * 文件的全部字节语义。正文只保存稳定身份、权威边界、角色硬限制、Skill 路由和通用
 * 安全约束；多步骤方法继续由安装的 `wakeflow-design` / `wakeflow-test` Skills 拥有。
 *
 * 本模块不复制 active/ledger 路径、不记录当前任务或宿主句柄、不创建 scaffold，也不
 * 读取、写入或恢复文件。external-owned surface 不属于本 whole-file authority。
 */

export const WAKEFLOW_SUPPORT_MEMORY_AUTHORITY_KIND =
  "WakeflowSupportMemoryAuthority" as const;
export const WAKEFLOW_SUPPORT_MEMORY_AUTHORITY_SCHEMA_VERSION = 1 as const;

export type WakeflowSupportRole = "design" | "test";

export interface WakeflowSupportMemoryAuthority {
  readonly kind: typeof WAKEFLOW_SUPPORT_MEMORY_AUTHORITY_KIND;
  readonly schemaVersion: typeof WAKEFLOW_SUPPORT_MEMORY_AUTHORITY_SCHEMA_VERSION;
  readonly configDigest: Sha256Digest;
  readonly programId: WakeflowDurableId<"program">;
  readonly surfaceId: WakeflowDurableId<"surface">;
  readonly windowId: WakeflowDurableId<"window">;
  readonly role: WakeflowSupportRole;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly instructionFileName: WakeflowWorkspaceHostResourceComponent;
  readonly declarationId: string;
  readonly language: WakeflowPresentationLanguage;
  readonly body: string;
  readonly bodyDigest: Sha256Digest;
  readonly authorityDigest: Sha256Digest;
}

export type WakeflowSupportMemoryAuthorityErrorReason =
  | "input"
  | "config"
  | "profile"
  | "surface"
  | "text"
  | "authority";

const ERROR_MESSAGES = {
  input: "Wakeflow support memory authority input is invalid.",
  config: "Wakeflow support memory config source is invalid.",
  profile: "Wakeflow support memory host profile is invalid.",
  surface: "Wakeflow support memory requires a managed Design/Test surface.",
  text: "Wakeflow support memory text cannot be represented safely.",
  authority: "Wakeflow support memory authority record is invalid.",
} as const satisfies Readonly<Record<
  WakeflowSupportMemoryAuthorityErrorReason,
  string
>>;

/** Support whole-file memory 权威准入失败的稳定、脱敏错误。 */
export class WakeflowSupportMemoryAuthorityError extends Error {
  override readonly name = "WakeflowSupportMemoryAuthorityError";
  readonly code = "wakeflow-support-memory-authority" as const;
  readonly reason: WakeflowSupportMemoryAuthorityErrorReason;
  readonly path: string;

  constructor(reason: WakeflowSupportMemoryAuthorityErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const HOST_ID_SET = new Set<string>(WAKEFLOW_WORKSPACE_HOST_IDS);
const LANGUAGE_SET = new Set<string>(WAKEFLOW_PRESENTATION_LANGUAGES);
const ROLE_SET = new Set<string>(["design", "test"]);
const MANAGED_MARKER_PREFIX = "<!-- wakeflow:managed-content:";

function fail(
  reason: WakeflowSupportMemoryAuthorityErrorReason,
  path: string,
): never {
  throw new WakeflowSupportMemoryAuthorityError(reason, path);
}

function parseConfig(value: unknown): WakeflowConfigV3Model {
  try {
    return parseWakeflowConfigV3(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", error.path);
    throw error;
  }
}

function parseProfile(
  value: unknown,
): Readonly<WakeflowWorkspaceHostResourceProfile> {
  try {
    return parseWakeflowWorkspaceHostResourceProfile(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("profile", error.path);
    }
    throw error;
  }
}

function dataLiteral(value: string, path: string): string {
  try {
    return renderMarkdownJsonStringLiteral(value, path);
  } catch (error: unknown) {
    if (error instanceof MarkdownJsonStringLiteralError) {
      fail("text", error.path);
    }
    throw error;
  }
}

function declarationId(
  surfaceId: WakeflowDurableId<"surface">,
  hostId: WakeflowWorkspaceHostId,
): string {
  return `support.${surfaceId}.instruction.${hostId}`;
}

function optionalDescription(
  surface: WakeflowManagedSupportSurface,
  language: WakeflowPresentationLanguage,
): readonly string[] {
  if (surface.description === undefined) return [];
  return language === "en"
    ? [`- Surface description: ${dataLiteral(surface.description, "$/surface/description")}`]
    : [`- Surface 说明：${dataLiteral(surface.description, "$/surface/description")}`];
}

function englishBody(
  config: WakeflowConfigV3Model,
  surface: WakeflowManagedSupportSurface,
  windowId: WakeflowDurableId<"window">,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): string {
  const design = surface.capability === "design";
  const roleName = design ? "Design" : "Test";
  return `${[
    `# Wakeflow ${roleName} Support`,
    "",
    `> Wakeflow owns this entire ${dataLiteral(profile.instructionFileName, "$/profile/instructionFileName")} file for the configured ${roleName} support surface.`,
    "",
    "## Stable identity",
    "",
    `- Program ID: ${dataLiteral(config.program.programId, "$/program/programId")}`,
    `- Program name: ${dataLiteral(config.program.displayName, "$/program/displayName")}`,
    `- Surface ID: ${dataLiteral(surface.surfaceId, "$/surface/surfaceId")}`,
    `- Surface name: ${dataLiteral(surface.displayName, "$/surface/displayName")}`,
    ...optionalDescription(surface, "en"),
    `- Window ID: ${dataLiteral(windowId, "$/window/windowId")}`,
    `- Host protocol: ${dataLiteral(profile.hostId, "$/profile/hostId")}`,
    "",
    "## Authority boundary",
    "",
    design
      ? "- Act only on an exact Wakeflow Design assignment or a direct user request that remains inside the Design role."
      : "- Act only on an exact Controller-approved Test assignment or a Controller-scoped Test-only reproduction or environment diagnostic.",
    "- Typed Wakeflow records and the current exact assignment are authority. Conversation, filenames, directory presence, drafts, notes, projections, and Agent claims are not workflow state.",
    "- Use Wakeflow capabilities for workflow mutations. If the plugin is unavailable, perform read-only orientation and report the blocker instead of editing authority files manually.",
    "",
    `## ${roleName} role`,
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
    "## Safety boundary",
    "",
    "- Do not reset, revert, delete user work, rewrite history, expose secrets, or mutate unrelated repositories.",
    "- Commit, push, tag, publish, release, cache refresh, destructive cleanup, live-data mutation, and scope expansion each require explicit authorization in addition to role authority.",
    "- Stop and report the contradiction when identity, authority, ownership, environment, or the assigned contract is missing, stale, or inconsistent.",
  ].join("\n")}\n`;
}

function simplifiedChineseBody(
  config: WakeflowConfigV3Model,
  surface: WakeflowManagedSupportSurface,
  windowId: WakeflowDurableId<"window">,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): string {
  const design = surface.capability === "design";
  const roleName = design ? "Design" : "Test";
  return `${[
    `# Wakeflow ${roleName} 支持窗口`,
    "",
    `> Wakeflow 完整拥有当前配置 ${roleName} 支持面中的 ${dataLiteral(profile.instructionFileName, "$/profile/instructionFileName")} 文件。`,
    "",
    "## 稳定身份",
    "",
    `- 程序 ID：${dataLiteral(config.program.programId, "$/program/programId")}`,
    `- 程序名称：${dataLiteral(config.program.displayName, "$/program/displayName")}`,
    `- Surface ID：${dataLiteral(surface.surfaceId, "$/surface/surfaceId")}`,
    `- Surface 名称：${dataLiteral(surface.displayName, "$/surface/displayName")}`,
    ...optionalDescription(surface, "zh-Hans"),
    `- 窗口 ID：${dataLiteral(windowId, "$/window/windowId")}`,
    `- 宿主协议：${dataLiteral(profile.hostId, "$/profile/hostId")}`,
    "",
    "## 权威边界",
    "",
    design
      ? "- 只处理 Wakeflow 精确分配的 Design 工作，或仍处于 Design 职责范围内的用户直接请求。"
      : "- 只处理 Controller 已批准的 Test 分配，或 Controller 限定范围的 Test-only 复现与环境诊断。",
    "- 类型化 Wakeflow 记录和当前精确分配才是权威。对话、文件名、目录存在性、草稿、笔记、投影和 Agent 声明都不是工作流状态。",
    "- 工作流变更必须使用 Wakeflow 能力。插件不可用时只能只读定位并报告阻塞，不得手工编辑权威文件。",
    "",
    `## ${roleName} 职责`,
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
    "## 安全边界",
    "",
    "- 不得重置、回退或删除用户工作，不得改写历史、泄露秘密或修改无关仓库。",
    "- 提交、推送、打标签、发布、发版、刷新缓存、破坏性清理、修改真实数据和扩大范围，都需要在角色权限之外另行获得明确授权。",
    "- 身份、权威、所有权、环境或分配合同缺失、陈旧或矛盾时，停止并报告矛盾。",
  ].join("\n")}\n`;
}

function assertBody(
  body: string,
  reason: "text" | "authority",
): void {
  if (
    !body.isWellFormed()
    || body.normalize("NFC") !== body
    || body.startsWith("\ufeff")
    || body.includes("\r")
    || !body.endsWith("\n")
    || body.endsWith("\n\n")
    || body.includes(MANAGED_MARKER_PREFIX)
  ) {
    fail(reason, reason === "text" ? "$body" : "$authority.body");
  }
}

function digestBasis(
  configDigest: Sha256Digest,
  programId: WakeflowDurableId<"program">,
  surfaceId: WakeflowDurableId<"surface">,
  windowId: WakeflowDurableId<"window">,
  role: WakeflowSupportRole,
  hostId: WakeflowWorkspaceHostId,
  instructionFileName: WakeflowWorkspaceHostResourceComponent,
  language: WakeflowPresentationLanguage,
  bodyDigest: Sha256Digest,
) {
  return {
    kind: "WakeflowSupportMemoryAuthorityDigestBasis" as const,
    schemaVersion: WAKEFLOW_SUPPORT_MEMORY_AUTHORITY_SCHEMA_VERSION,
    configDigest,
    programId,
    surfaceId,
    windowId,
    role,
    hostId,
    instructionFileName,
    declarationId: declarationId(surfaceId, hostId),
    language,
    bodyDigest,
  };
}

function parseSurfaceId(value: unknown): WakeflowDurableId<"surface"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "surface", "$surfaceId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", "$surfaceId");
    throw error;
  }
}

/** 为一个严格 wakeflow-managed Design/Test surface 生成 whole-file memory 权威。 */
export function createWakeflowSupportMemoryAuthority(
  configValue: unknown,
  profileValue: unknown,
  surfaceIdValue: unknown,
): Readonly<WakeflowSupportMemoryAuthority> {
  const config = parseConfig(configValue);
  const profile = parseProfile(profileValue);
  const surfaceId = parseSurfaceId(surfaceIdValue);
  const indexes = buildWakeflowConfigV3Indexes(config);
  const surface = indexes.surfaceById[surfaceId];
  if (surface === undefined || surface.ownership !== "wakeflow-managed") {
    fail("surface", "$surfaceId");
  }
  const window = surface.capability === "design"
    ? indexes.designWindow
    : indexes.testWindow;
  if (window.root.surfaceId !== surface.surfaceId) {
    fail("surface", "$surfaceId");
  }
  const language = config.presentation.language;
  const body = language === "en"
    ? englishBody(config, surface, window.windowId, profile)
    : simplifiedChineseBody(config, surface, window.windowId, profile);
  assertBody(body, "text");
  let bodyDigest: Sha256Digest;
  try {
    bodyDigest = computeSha256Digest(encodeUtf8(body, "$body"), "$body");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("text", error.path);
    throw error;
  }
  const configDigest = computeWakeflowConfigV3Digest(config);
  const role = surface.capability;
  const authorityDigest = computeCanonicalJsonSha256Digest(digestBasis(
    configDigest,
    config.program.programId,
    surface.surfaceId,
    window.windowId,
    role,
    profile.hostId,
    profile.instructionFileName,
    language,
    bodyDigest,
  ));
  return Object.freeze({
    kind: WAKEFLOW_SUPPORT_MEMORY_AUTHORITY_KIND,
    schemaVersion: WAKEFLOW_SUPPORT_MEMORY_AUTHORITY_SCHEMA_VERSION,
    configDigest,
    programId: config.program.programId,
    surfaceId: surface.surfaceId,
    windowId: window.windowId,
    role,
    hostId: profile.hostId,
    instructionFileName: profile.instructionFileName,
    declarationId: declarationId(surface.surfaceId, profile.hostId),
    language,
    body,
    bodyDigest,
    authorityDigest,
  });
}

function authorityRecord(value: unknown): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, "$authority");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("authority", "$authority");
    throw error;
  }
}

function authorityId<K extends "program" | "surface" | "window">(
  value: unknown,
  kind: K,
  path: string,
): WakeflowDurableId<K> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("authority", path);
    throw error;
  }
}

function instructionFileName(
  value: unknown,
): WakeflowWorkspaceHostResourceComponent {
  try {
    const path = parsePortableResourcePath(
      value,
      "$authority.instructionFileName",
    );
    if (splitPortableResourcePath(path).length !== 1) {
      fail("authority", "$authority.instructionFileName");
    }
    return path as WakeflowWorkspaceHostResourceComponent;
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("authority", "$authority.instructionFileName");
    }
    throw error;
  }
}

/** 重验 whole-file body、身份与摘要，返回解除别名的冻结 authority。 */
export function parseWakeflowSupportMemoryAuthority(
  value: unknown,
): Readonly<WakeflowSupportMemoryAuthority> {
  const record = authorityRecord(value);
  const expectedKeys = [
    "authorityDigest",
    "body",
    "bodyDigest",
    "configDigest",
    "declarationId",
    "hostId",
    "instructionFileName",
    "kind",
    "language",
    "programId",
    "role",
    "schemaVersion",
    "surfaceId",
    "windowId",
  ];
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
    || record.kind !== WAKEFLOW_SUPPORT_MEMORY_AUTHORITY_KIND
    || record.schemaVersion !== WAKEFLOW_SUPPORT_MEMORY_AUTHORITY_SCHEMA_VERSION
    || typeof record.hostId !== "string"
    || !HOST_ID_SET.has(record.hostId)
    || typeof record.role !== "string"
    || !ROLE_SET.has(record.role)
    || typeof record.language !== "string"
    || !LANGUAGE_SET.has(record.language)
    || typeof record.body !== "string"
  ) {
    fail("authority", "$authority");
  }
  const programId = authorityId(record.programId, "program", "$authority.programId");
  const surfaceId = authorityId(record.surfaceId, "surface", "$authority.surfaceId");
  const windowId = authorityId(record.windowId, "window", "$authority.windowId");
  const hostId = record.hostId as WakeflowWorkspaceHostId;
  const role = record.role as WakeflowSupportRole;
  const language = record.language as WakeflowPresentationLanguage;
  const fileName = instructionFileName(record.instructionFileName);
  const expectedDeclarationId = declarationId(surfaceId, hostId);
  if (record.declarationId !== expectedDeclarationId) {
    fail("authority", "$authority.declarationId");
  }
  assertBody(record.body, "authority");
  let configDigest: Sha256Digest;
  let bodyDigest: Sha256Digest;
  let authorityDigest: Sha256Digest;
  try {
    configDigest = parseSha256Digest(record.configDigest, "$authority.configDigest");
    bodyDigest = parseSha256Digest(record.bodyDigest, "$authority.bodyDigest");
    authorityDigest = parseSha256Digest(
      record.authorityDigest,
      "$authority.authorityDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("authority", error.path);
    throw error;
  }
  if (
    computeSha256Digest(encodeUtf8(record.body), "$authority.body")
      !== bodyDigest
    || computeCanonicalJsonSha256Digest(digestBasis(
      configDigest,
      programId,
      surfaceId,
      windowId,
      role,
      hostId,
      fileName,
      language,
      bodyDigest,
    )) !== authorityDigest
  ) {
    fail("authority", "$authority");
  }
  return Object.freeze({
    kind: WAKEFLOW_SUPPORT_MEMORY_AUTHORITY_KIND,
    schemaVersion: WAKEFLOW_SUPPORT_MEMORY_AUTHORITY_SCHEMA_VERSION,
    configDigest,
    programId,
    surfaceId,
    windowId,
    role,
    hostId,
    instructionFileName: fileName,
    declarationId: expectedDeclarationId,
    language,
    body: record.body,
    bodyDigest,
    authorityDigest,
  });
}
