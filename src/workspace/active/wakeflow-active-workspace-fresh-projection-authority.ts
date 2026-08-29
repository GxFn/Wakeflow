import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseByteCount,
  type ByteCount,
} from "../../foundation/numeric/byte-count.js";
import {
  MarkdownJsonStringLiteralError,
  renderMarkdownJsonStringLiteral,
} from "../../foundation/text/markdown-json-string-literal.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST,
} from "../../governance/todo/todo-collection-initialization-authority.js";
import {
  TODO_BOARD_PROJECTION_REF,
} from "../../governance/todo/todo-paths.js";
import {
  WAKEFLOW_ACTIVE_ROOT_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
} from "./wakeflow-active-paths.js";

/**
 * Wakeflow Workspace / Active：Fresh Workspace 的两份可丢弃人类投影权威。
 *
 * 本authority只接受desired Config与“Demand集合严格为空”的fresh事实，生成Workspace
 * Index和idle Status。它不读取TODO正文、不生成per-Demand文档、不链接尚不存在的
 * Ledger投影，也不把Markdown升级为Config、TODO或Demand状态权威。
 */

export const WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_SCHEMA_VERSION = 1 as const;
export const WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_FILE_MODE = 0o600 as const;
export const WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_MAXIMUM_BYTES =
  parseByteCount(256 * 1024, "$activeWorkspaceProjection.maximumBytes");

export interface WakeflowActiveWorkspaceProjectionFileAuthority {
  readonly resourcePath: PortableResourcePath;
  readonly content: string;
  readonly bytes: Uint8Array;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

export interface WakeflowActiveWorkspaceFreshProjectionAuthority {
  readonly kind: "WakeflowActiveWorkspaceFreshProjectionAuthority";
  readonly schemaVersion:
    typeof WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_SCHEMA_VERSION;
  readonly configDigest: Sha256Digest;
  readonly todoInitializationAuthorityDigest:
    typeof TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST;
  readonly demandSet: "empty";
  readonly orientation: "idle";
  readonly language: WakeflowConfigV3Model["presentation"]["language"];
  readonly sourceDigest: Sha256Digest;
  readonly files: readonly [
    Readonly<WakeflowActiveWorkspaceProjectionFileAuthority>,
    Readonly<WakeflowActiveWorkspaceProjectionFileAuthority>,
  ];
  readonly authorityDigest: Sha256Digest;
}

export type WakeflowActiveWorkspaceFreshProjectionAuthorityErrorReason =
  | "config"
  | "text"
  | "capacity";

const ERROR_MESSAGES = {
  config: "Fresh Active workspace projection Config is invalid.",
  text: "Fresh Active workspace projection text cannot be rendered safely.",
  capacity: "Fresh Active workspace projection exceeds its byte budget.",
} as const satisfies Readonly<Record<
  WakeflowActiveWorkspaceFreshProjectionAuthorityErrorReason,
  string
>>;

/** Fresh Active workspace projection authority 失败的稳定、脱敏错误。 */
export class WakeflowActiveWorkspaceFreshProjectionAuthorityError
  extends Error {
  override readonly name =
    "WakeflowActiveWorkspaceFreshProjectionAuthorityError";
  readonly code = "wakeflow-active-workspace-fresh-projection-authority" as const;
  readonly reason: WakeflowActiveWorkspaceFreshProjectionAuthorityErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowActiveWorkspaceFreshProjectionAuthorityErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const TEXT = Object.freeze({
  en: Object.freeze({
    indexTitle: "Wakeflow Active Workspace",
    statusTitle: "Workspace Current Status",
    projectionNotice:
      "Generated projection only. Config, TODO, and Demand event streams remain authoritative.",
    program: "Program",
    programId: "Program ID",
    status: "Current status",
    todo: "Global TODO",
    demands: "Active demands",
    noDemands: "No active Demand roots.",
    orientation: "Orientation",
    source: "Projection source",
    demandCount: "Active Demand count",
    nextAction: "Next action",
    inspectTodo: "Inspect the canonical TODO authority before creating work.",
    back: "Active workspace index",
  }),
  "zh-Hans": Object.freeze({
    indexTitle: "Wakeflow 活动工作区",
    statusTitle: "工作区当前状态",
    projectionNotice:
      "仅为生成式投影。Config、TODO 与 Demand 事件流仍是权威。",
    program: "程序",
    programId: "程序 ID",
    status: "当前状态",
    todo: "全局 TODO",
    demands: "活动 Demand",
    noDemands: "当前没有活动 Demand 根。",
    orientation: "运行方向",
    source: "投影来源",
    demandCount: "活动 Demand 数量",
    nextAction: "下一动作",
    inspectTodo: "创建工作前检查规范 TODO 权威。",
    back: "活动工作区索引",
  }),
});

function fail(
  reason: WakeflowActiveWorkspaceFreshProjectionAuthorityErrorReason,
  path: string,
): never {
  throw new WakeflowActiveWorkspaceFreshProjectionAuthorityError(reason, path);
}

function parseConfig(value: unknown): WakeflowConfigV3Model {
  try {
    return parseWakeflowConfigV3(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", error.path);
    throw error;
  }
}

function literal(value: string, path: string): string {
  try {
    return renderMarkdownJsonStringLiteral(value, path);
  } catch (error: unknown) {
    if (error instanceof MarkdownJsonStringLiteralError) {
      fail("text", error.path);
    }
    throw error;
  }
}

function relativeFromActive(resourcePath: PortableResourcePath): string {
  const prefix = `${WAKEFLOW_ACTIVE_ROOT_REF}/`;
  if (!resourcePath.startsWith(prefix)) fail("text", "$resourcePath");
  return resourcePath.slice(prefix.length);
}

function marker(sourceDigest: Sha256Digest): string {
  return `<!-- wakeflow:active-workspace-projection:v${WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_SCHEMA_VERSION}:${sourceDigest} -->`;
}

function renderIndex(
  model: WakeflowConfigV3Model,
  sourceDigest: Sha256Digest,
): string {
  const text = TEXT[model.presentation.language];
  return [
    `# ${text.indexTitle}`,
    "",
    marker(sourceDigest),
    "",
    `> ${text.projectionNotice}`,
    "",
    `- ${text.program}: ${literal(model.program.displayName, "$/program/displayName")}`,
    `- ${text.programId}: ${literal(model.program.programId, "$/program/programId")}`,
    `- [${text.status}](${relativeFromActive(WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF)})`,
    `- [${text.todo}](${relativeFromActive(TODO_BOARD_PROJECTION_REF)})`,
    "",
    `## ${text.demands}`,
    "",
    text.noDemands,
    "",
  ].join("\n");
}

function renderStatus(
  model: WakeflowConfigV3Model,
  sourceDigest: Sha256Digest,
): string {
  const text = TEXT[model.presentation.language];
  return [
    `# ${text.statusTitle}`,
    "",
    marker(sourceDigest),
    "",
    `> ${text.projectionNotice}`,
    "",
    `- ${text.orientation}: ${literal("idle", "$/orientation")}`,
    `- ${text.programId}: ${literal(model.program.programId, "$/program/programId")}`,
    `- ${text.source}: ${literal(sourceDigest, "$/sourceDigest")}`,
    `- ${text.demandCount}: 0`,
    `- ${text.nextAction}: ${text.inspectTodo}`,
    "",
    `[${text.back}](../index.md)`,
    "",
  ].join("\n");
}

function fileAuthority(
  resourcePath: PortableResourcePath,
  content: string,
): Readonly<WakeflowActiveWorkspaceProjectionFileAuthority> {
  const bytes = encodeUtf8(content, `$projection/${resourcePath}`);
  if (bytes.byteLength > WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_MAXIMUM_BYTES) {
    fail("capacity", `$projection/${resourcePath}`);
  }
  return Object.freeze({
    resourcePath,
    content,
    bytes,
    byteCount: parseByteCount(
      bytes.byteLength,
      `$projection/${resourcePath}.byteCount`,
    ),
    digest: computeSha256Digest(bytes, `$projection/${resourcePath}`),
  });
}

/** 从desired Config建立Demand集合为空的Fresh workspace投影权威。 */
export function createWakeflowActiveWorkspaceFreshProjectionAuthority(
  configValue: unknown,
): Readonly<WakeflowActiveWorkspaceFreshProjectionAuthority> {
  const model = parseConfig(configValue);
  const configDigest = computeWakeflowConfigV3Digest(model);
  const source = Object.freeze({
    kind: "WakeflowActiveWorkspaceFreshProjectionSource" as const,
    schemaVersion: WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_SCHEMA_VERSION,
    configDigest,
    todoInitializationAuthorityDigest:
      TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST,
    demandSet: "empty" as const,
    orientation: "idle" as const,
    language: model.presentation.language,
  });
  const sourceDigest = computeCanonicalJsonSha256Digest(
    source as unknown as JsonValue,
  );
  const files = Object.freeze([
    fileAuthority(
      WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
      renderIndex(model, sourceDigest),
    ),
    fileAuthority(
      WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
      renderStatus(model, sourceDigest),
    ),
  ]) as WakeflowActiveWorkspaceFreshProjectionAuthority["files"];
  const basis = Object.freeze({
    kind: "WakeflowActiveWorkspaceFreshProjectionAuthority" as const,
    schemaVersion: WAKEFLOW_ACTIVE_WORKSPACE_PROJECTION_SCHEMA_VERSION,
    configDigest,
    todoInitializationAuthorityDigest:
      TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST,
    demandSet: "empty" as const,
    orientation: "idle" as const,
    language: model.presentation.language,
    sourceDigest,
    files: files.map((entry) => ({
      resourcePath: entry.resourcePath,
      byteCount: entry.byteCount,
      digest: entry.digest,
    })),
  });
  return Object.freeze({
    kind: basis.kind,
    schemaVersion: basis.schemaVersion,
    configDigest,
    todoInitializationAuthorityDigest: basis.todoInitializationAuthorityDigest,
    demandSet: basis.demandSet,
    orientation: basis.orientation,
    language: basis.language,
    sourceDigest,
    files,
    authorityDigest: computeCanonicalJsonSha256Digest(
      basis as unknown as JsonValue,
    ),
  });
}
