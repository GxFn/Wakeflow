import {
  buildWakeflowConfigV3Indexes,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  WAKEFLOW_ACTIVE_ROOT,
  WAKEFLOW_LOCAL_ROOT,
  WAKEFLOW_PRESENTATION_LANGUAGES,
  type WakeflowConfigV3Model,
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
import { encodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import {
  MarkdownJsonStringLiteralError,
  renderMarkdownJsonStringLiteral,
} from "../../foundation/text/markdown-json-string-literal.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceComponent,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  WAKEFLOW_MANAGED_TEXT_MARKER_PREFIX,
  type WakeflowManagedTextEnvelopeTarget,
} from "./wakeflow-managed-text-envelope.js";

/**
 * Wakeflow Workspace / Managed Integration：Program Instruction 的正文权威。
 *
 * 本模块从严格 Config 与单个 Host Resource Profile 生成宿主指令文件中的 Wakeflow
 * managed-block 正文。Config 是程序身份和呈现语言的唯一持久来源；Host Profile 只
 * 提供宿主协议身份与目标文件名。本模块不读取现有文件、不解释 outside 文本，也不
 * 执行重组、CAS 或原子发布。
 *
 * 用户提供的展示文本始终编码为 Markdown 内的 JSON 字符串字面量，不能注入标题、
 * 列表或 managed-content marker。正文只引用当前 TS 实现已经拥有的稳定协议根，
 * 不提前声称旧 JS 中的 active index、status 或 ledger record map 已经存在。
 */

export const WAKEFLOW_PROGRAM_INSTRUCTION_BODY_AUTHORITY_KIND =
  "WakeflowProgramInstructionBodyAuthority" as const;
export const WAKEFLOW_PROGRAM_INSTRUCTION_BODY_AUTHORITY_SCHEMA_VERSION =
  1 as const;
export const WAKEFLOW_PROGRAM_INSTRUCTION_COMPONENT =
  "program-instruction" as const;
export const WAKEFLOW_PROGRAM_INSTRUCTION_OWNER =
  "host-instruction-integration" as const;

export interface WakeflowProgramInstructionBodyAuthority {
  readonly kind: typeof WAKEFLOW_PROGRAM_INSTRUCTION_BODY_AUTHORITY_KIND;
  readonly schemaVersion:
    typeof WAKEFLOW_PROGRAM_INSTRUCTION_BODY_AUTHORITY_SCHEMA_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly instructionFileName: WakeflowWorkspaceHostResourceComponent;
  readonly language: WakeflowPresentationLanguage;
  readonly body: string;
  readonly bodyDigest: Sha256Digest;
  readonly authorityDigest: Sha256Digest;
  readonly envelopeTarget: Readonly<WakeflowManagedTextEnvelopeTarget>;
}

export type WakeflowProgramInstructionBodyAuthorityErrorReason =
  | "input"
  | "config"
  | "profile"
  | "text"
  | "authority";

const ERROR_MESSAGES = {
  input: "Wakeflow Program Instruction authority input is invalid.",
  config: "Wakeflow Program Instruction config source is invalid.",
  profile: "Wakeflow Program Instruction host profile is invalid.",
  text: "Wakeflow Program Instruction text cannot be represented safely.",
  authority: "Wakeflow Program Instruction authority record is invalid.",
} as const satisfies Readonly<Record<
  WakeflowProgramInstructionBodyAuthorityErrorReason,
  string
>>;

/** Program Instruction 正文权威准入失败的稳定、脱敏错误。 */
export class WakeflowProgramInstructionBodyAuthorityError extends Error {
  override readonly name =
    "WakeflowProgramInstructionBodyAuthorityError";
  readonly code = "wakeflow-program-instruction-body-authority" as const;
  readonly reason: WakeflowProgramInstructionBodyAuthorityErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowProgramInstructionBodyAuthorityErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const PRESENTATION_LANGUAGE_SET = new Set<string>(
  WAKEFLOW_PRESENTATION_LANGUAGES,
);
const HOST_ID_SET = new Set<string>(WAKEFLOW_WORKSPACE_HOST_IDS);
const CONFIG_FILE_REF = "wakeflow.config.json" as const;

function fail(
  reason: WakeflowProgramInstructionBodyAuthorityErrorReason,
  path: string,
): never {
  throw new WakeflowProgramInstructionBodyAuthorityError(reason, path);
}

function parseConfig(value: unknown): WakeflowConfigV3Model {
  try {
    return parseWakeflowConfigV3(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) {
      fail("config", error.path);
    }
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

function markdownDataLiteral(value: string, path: string): string {
  try {
    return renderMarkdownJsonStringLiteral(value, path);
  } catch (error: unknown) {
    if (error instanceof MarkdownJsonStringLiteralError) {
      fail("text", error.path);
    }
    throw error;
  }
}

function englishBody(
  config: WakeflowConfigV3Model,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  controllerWindowId: WakeflowDurableId<"window">,
): string {
  const description = config.program.description === undefined
    ? []
    : [
        `- Program description: ${markdownDataLiteral(
          config.program.description,
          "$/program/description",
        )}`,
      ];
  return `${[
    "## Wakeflow Program Instructions",
    "",
    `> Wakeflow owns only this managed section in ${markdownDataLiteral(profile.instructionFileName, "$/profile/instructionFileName")}; text outside it remains user-owned.`,
    "",
    "### Stable identity",
    "",
    `- Program ID: ${markdownDataLiteral(config.program.programId, "$/program/programId")}`,
    `- Display name: ${markdownDataLiteral(config.program.displayName, "$/program/displayName")}`,
    ...description,
    `- Controller window ID: ${markdownDataLiteral(controllerWindowId, "$/controllerWindowId")}`,
    `- Host protocol: ${markdownDataLiteral(profile.hostId, "$/profile/hostId")}`,
    "",
    "### Authority and work selection",
    "",
    `- Read ${markdownDataLiteral(CONFIG_FILE_REF, "$/paths/config")} first; it is the durable program configuration.`,
    "- Continue only the exact assignment selected by Wakeflow. Do not infer or claim work from filenames, empty directories, or prose projections.",
    "- Treat generated Markdown as navigation or projection, never as a replacement for typed authority.",
    "- Use Wakeflow capabilities for state, delivery, evidence, identity, and retention changes. Do not hand-edit Wakeflow-owned resources.",
    "",
    "### Runtime and unavailable-plugin boundary",
    "",
    `- ${markdownDataLiteral(`${WAKEFLOW_ACTIVE_ROOT}/`, "$/paths/activeRoot")} contains active authority and projections; ${markdownDataLiteral(`${WAKEFLOW_LOCAL_ROOT}/`, "$/paths/localRoot")} contains machine-local coordination, transport, and host evidence. Do not edit, move, commit, or delete either root by hand.`,
    "- If the Wakeflow plugin is unavailable, use managed files only for read-only orientation and report the blocker. Do not reconstruct backend mutations manually.",
    "",
    "### Responsibility and safety",
    "",
    "- The Controller owns cross-repository sequencing and final acceptance; each product window executes only its exact current assignment.",
    "- Do not reset, revert, delete user work, rewrite history, expose secrets, or mutate unrelated repositories.",
    "- Commit, push, tag, publish, release, cache refresh, destructive cleanup, and scope expansion each require explicit authorization.",
  ].join("\n")}\n`;
}

function simplifiedChineseBody(
  config: WakeflowConfigV3Model,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  controllerWindowId: WakeflowDurableId<"window">,
): string {
  const description = config.program.description === undefined
    ? []
    : [
        `- 程序说明：${markdownDataLiteral(
          config.program.description,
          "$/program/description",
        )}`,
      ];
  return `${[
    "## Wakeflow 程序指令",
    "",
    `> Wakeflow 只拥有 ${markdownDataLiteral(profile.instructionFileName, "$/profile/instructionFileName")} 中的这一受管区域；区域外文本仍归用户所有。`,
    "",
    "### 稳定身份",
    "",
    `- 程序 ID：${markdownDataLiteral(config.program.programId, "$/program/programId")}`,
    `- 显示名称：${markdownDataLiteral(config.program.displayName, "$/program/displayName")}`,
    ...description,
    `- Controller 窗口 ID：${markdownDataLiteral(controllerWindowId, "$/controllerWindowId")}`,
    `- 宿主协议：${markdownDataLiteral(profile.hostId, "$/profile/hostId")}`,
    "",
    "### 权威与工作选择",
    "",
    `- 首先读取 ${markdownDataLiteral(CONFIG_FILE_REF, "$/paths/config")}；它是程序的持久配置。`,
    "- 只继续 Wakeflow 已选定的精确任务分配；不得根据文件名、空目录或文字投影推断或自行认领工作。",
    "- 生成的 Markdown 只用于导航或投影，不能替代类型化权威记录。",
    "- 状态、交付、证据、身份和保留期变更必须使用 Wakeflow 能力；不得手工编辑 Wakeflow 所有的资源。",
    "",
    "### 运行时与插件不可用边界",
    "",
    `- ${markdownDataLiteral(`${WAKEFLOW_ACTIVE_ROOT}/`, "$/paths/activeRoot")} 保存活动权威与投影；${markdownDataLiteral(`${WAKEFLOW_LOCAL_ROOT}/`, "$/paths/localRoot")} 保存本机协调、传输和宿主证据。不得手工编辑、搬移、提交或删除这两个根目录。`,
    "- Wakeflow 插件不可用时，只能把受管文件用于只读定位并报告阻塞；不得手工重建后端变更。",
    "",
    "### 职责与安全",
    "",
    "- Controller 负责跨仓库编排与最终验收；每个产品窗口只执行当前精确分配。",
    "- 不得重置、回退或删除用户工作，不得改写历史、泄露秘密或修改无关仓库。",
    "- 提交、推送、打标签、发布、发版、刷新缓存、破坏性清理和扩大范围都需要分别获得明确授权。",
  ].join("\n")}\n`;
}

function renderBody(
  config: WakeflowConfigV3Model,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  controllerWindowId: WakeflowDurableId<"window">,
): string {
  const body = config.presentation.language === "en"
    ? englishBody(config, profile, controllerWindowId)
    : simplifiedChineseBody(config, profile, controllerWindowId);
  if (
    !body.isWellFormed()
    || body.normalize("NFC") !== body
    || body.startsWith("\ufeff")
    || body.includes("\r")
    || !body.endsWith("\n")
    || body.endsWith("\n\n")
    || body.includes(WAKEFLOW_MANAGED_TEXT_MARKER_PREFIX)
  ) {
    fail("text", "$body");
  }
  return body;
}

function authorityDigestBasis(
  programId: WakeflowDurableId<"program">,
  controllerWindowId: WakeflowDurableId<"window">,
  hostId: WakeflowWorkspaceHostId,
  instructionFileName: WakeflowWorkspaceHostResourceComponent,
  language: WakeflowPresentationLanguage,
  bodyDigest: Sha256Digest,
) {
  return {
    kind: "WakeflowProgramInstructionBodyAuthorityDigestBasis" as const,
    schemaVersion:
      WAKEFLOW_PROGRAM_INSTRUCTION_BODY_AUTHORITY_SCHEMA_VERSION,
    programId,
    controllerWindowId,
    hostId,
    instructionFileName,
    language,
    bodyDigest,
  };
}

/** 从当前 Config 与目标 Host Profile 生成唯一 Program Instruction 正文权威。 */
export function createWakeflowProgramInstructionBodyAuthority(
  configValue: unknown,
  profileValue: unknown,
): Readonly<WakeflowProgramInstructionBodyAuthority> {
  const config = parseConfig(configValue);
  const profile = parseProfile(profileValue);
  const controllerWindowId = buildWakeflowConfigV3Indexes(config)
    .controllerWindow.windowId;
  const body = renderBody(config, profile, controllerWindowId);
  let bodyDigest: Sha256Digest;
  try {
    bodyDigest = computeSha256Digest(encodeUtf8(body, "$body"), "$body");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("text", error.path);
    throw error;
  }
  const authorityDigest = computeCanonicalJsonSha256Digest(
    authorityDigestBasis(
      config.program.programId,
      controllerWindowId,
      profile.hostId,
      profile.instructionFileName,
      config.presentation.language,
      bodyDigest,
    ),
  );
  return Object.freeze({
    kind: WAKEFLOW_PROGRAM_INSTRUCTION_BODY_AUTHORITY_KIND,
    schemaVersion:
      WAKEFLOW_PROGRAM_INSTRUCTION_BODY_AUTHORITY_SCHEMA_VERSION,
    programId: config.program.programId,
    controllerWindowId,
    hostId: profile.hostId,
    instructionFileName: profile.instructionFileName,
    language: config.presentation.language,
    body,
    bodyDigest,
    authorityDigest,
    envelopeTarget: Object.freeze({
      component: WAKEFLOW_PROGRAM_INSTRUCTION_COMPONENT,
      owner: WAKEFLOW_PROGRAM_INSTRUCTION_OWNER,
      body,
    }),
  });
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
}

function parseAuthorityId<K extends "program" | "window">(
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

function parseInstructionFileName(
  value: unknown,
): WakeflowWorkspaceHostResourceComponent {
  try {
    const resourcePath = parsePortableResourcePath(
      value,
      "$authority.instructionFileName",
    );
    if (splitPortableResourcePath(resourcePath).length !== 1) {
      fail("authority", "$authority.instructionFileName");
    }
    return resourcePath as WakeflowWorkspaceHostResourceComponent;
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("authority", "$authority.instructionFileName");
    }
    throw error;
  }
}

/** 重验正文、身份、目标和摘要，返回解除别名的冻结 authority。 */
export function parseWakeflowProgramInstructionBodyAuthority(
  value: unknown,
): Readonly<WakeflowProgramInstructionBodyAuthority> {
  const record = plainRecord(value, "$authority");
  const keys = Object.keys(record).sort();
  const expectedKeys = [
    "authorityDigest",
    "body",
    "bodyDigest",
    "controllerWindowId",
    "envelopeTarget",
    "hostId",
    "instructionFileName",
    "kind",
    "language",
    "programId",
    "schemaVersion",
  ];
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
    || record.kind !== WAKEFLOW_PROGRAM_INSTRUCTION_BODY_AUTHORITY_KIND
    || record.schemaVersion
      !== WAKEFLOW_PROGRAM_INSTRUCTION_BODY_AUTHORITY_SCHEMA_VERSION
    || typeof record.hostId !== "string"
    || !HOST_ID_SET.has(record.hostId)
    || typeof record.language !== "string"
    || !PRESENTATION_LANGUAGE_SET.has(record.language)
    || typeof record.body !== "string"
  ) {
    fail("authority", "$authority");
  }
  const programId = parseAuthorityId(
    record.programId,
    "program",
    "$authority.programId",
  );
  const controllerWindowId = parseAuthorityId(
    record.controllerWindowId,
    "window",
    "$authority.controllerWindowId",
  );
  const hostId = record.hostId as WakeflowWorkspaceHostId;
  const language = record.language as WakeflowPresentationLanguage;
  const instructionFileName = parseInstructionFileName(
    record.instructionFileName,
  );
  if (
    !record.body.isWellFormed()
    || record.body.normalize("NFC") !== record.body
    || record.body.startsWith("\ufeff")
    || record.body.includes("\r")
    || !record.body.endsWith("\n")
    || record.body.endsWith("\n\n")
    || record.body.includes(WAKEFLOW_MANAGED_TEXT_MARKER_PREFIX)
  ) {
    fail("authority", "$authority.body");
  }
  let bodyDigest: Sha256Digest;
  let authorityDigest: Sha256Digest;
  try {
    bodyDigest = parseSha256Digest(
      record.bodyDigest,
      "$authority.bodyDigest",
    );
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
    || computeCanonicalJsonSha256Digest(authorityDigestBasis(
      programId,
      controllerWindowId,
      hostId,
      instructionFileName,
      language,
      bodyDigest,
    )) !== authorityDigest
  ) {
    fail("authority", "$authority");
  }
  const target = plainRecord(
    record.envelopeTarget,
    "$authority.envelopeTarget",
  );
  if (
    Object.keys(target).sort().join("\u0000")
      !== "body\u0000component\u0000owner"
    || target.component !== WAKEFLOW_PROGRAM_INSTRUCTION_COMPONENT
    || target.owner !== WAKEFLOW_PROGRAM_INSTRUCTION_OWNER
    || target.body !== record.body
  ) {
    fail("authority", "$authority.envelopeTarget");
  }
  return Object.freeze({
    kind: WAKEFLOW_PROGRAM_INSTRUCTION_BODY_AUTHORITY_KIND,
    schemaVersion:
      WAKEFLOW_PROGRAM_INSTRUCTION_BODY_AUTHORITY_SCHEMA_VERSION,
    programId,
    controllerWindowId,
    hostId,
    instructionFileName,
    language,
    body: record.body,
    bodyDigest,
    authorityDigest,
    envelopeTarget: Object.freeze({
      component: WAKEFLOW_PROGRAM_INSTRUCTION_COMPONENT,
      owner: WAKEFLOW_PROGRAM_INSTRUCTION_OWNER,
      body: record.body,
    }),
  });
}
