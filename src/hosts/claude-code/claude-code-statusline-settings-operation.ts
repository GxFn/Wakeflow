import { types } from "node:util";

import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import { type JsonValue, JsonValueError, parseJsonValue } from "../../foundation/data/json-value.js";
import {
  PassiveOwnDataError,
  parsePlainRecord,
} from "../../foundation/data/passive-own-data.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, encodeUtf8 } from "../../foundation/text/utf8.js";
import type { WakeflowHostMaintenanceOperationInput } from "../../workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import { CLAUDE_CODE_SETTINGS_DIRECTORY_REF } from "./claude-code-portable-settings-publication.js";
import { claudeCodeStatuslineCommand } from "./claude-code-statusline-asset.js";
import { claudeCodeWorkspaceHostResourceProfile } from "./wakeflow-workspace-host-resource-profile.js";

/**
 * Wakeflow Host / Claude Code：状态栏命令写进本地设置的维护操作（gate-log §13.94 D6）。
 *
 * 目标是 `.claude/settings.local.json` 的 `statusLine` 一个键：命令里带 base64url 的工作区绝对根，
 * 所以只能进忽略的私有本地文件，不能进可提交的 `settings.json`。计划只读：键已是期望值且文件
 * 0600 即无操作；缺失、漂移或模式不对即一条 `statusline-settings` 操作，目标摘要是"现有文档
 * 只改这一键"重新渲染后的字节。文件读不出或不是 JSON 对象时不猜：计划报 `settings-unreadable`，
 * 宿主贡献把它变成 blocker。执行是单文件 CAS：缺失创建，存在替换，保留其他键与顺序，0600。
 * 负载不含根：命令在执行时从根重新派生，目标摘要绑定最终字节。
 */

export const CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND = "statusline-settings" as const;
export const CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID = "claude-code-statusline-settings" as const;
/** 排在资产安装之后：先装资产，再让 settings 指向它。 */
export const CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID =
  "claude-statusline-settings:install" as const;
export const CLAUDE_CODE_STATUSLINE_SETTINGS_KEY = "statusLine" as const;
export const CLAUDE_CODE_LOCAL_SETTINGS_REF: PortableResourcePath = parsePortableResourcePath(
  claudeCodeWorkspaceHostResourceProfile.surfaces.settingsIntegration?.localPath
    ?? ".claude/settings.local.json",
  "$settings",
);
/** 计划失败时宿主贡献报出的 blocker。 */
export const CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER = "claude-settings-local-unreadable" as const;
const TARGET_KEY = "settings:claude-code:local-statusline" as const;
const SETTINGS_MAXIMUM_BYTES = parseByteCount(1024 * 1024, "$settings.maximumBytes");
const SETTINGS_MODE = 0o600;
const DIRECTORY_MODE = 0o755;

export interface ClaudeCodeStatuslineSettingsOperationPayload {
  readonly path: typeof CLAUDE_CODE_LOCAL_SETTINGS_REF;
  readonly key: typeof CLAUDE_CODE_STATUSLINE_SETTINGS_KEY;
}

export interface ExecuteClaudeCodeStatuslineSettingsOperationRequest {
  readonly operation: unknown;
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
  readonly recoveringAffectedOperation: boolean;
  readonly signal?: AbortSignal;
}

export interface ClaudeCodeStatuslineSettingsOperationResult {
  readonly operationId: typeof CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID;
  readonly disposition: "current" | "created" | "updated";
  readonly targetDigest: Sha256Digest;
}

export type ClaudeCodeStatuslineSettingsOperationErrorReason =
  | "input"
  | "operation"
  | "settings-unreadable"
  | "source-stale"
  | "write"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Claude statusline settings operation input is invalid.",
  operation: "Claude statusline settings operation payload is invalid.",
  "settings-unreadable": "Claude local settings could not be read as a JSON object.",
  "source-stale": "Claude local settings changed since the plan was made.",
  write: "Claude local settings could not be written safely.",
  aborted: "Claude statusline settings operation was aborted.",
} as const satisfies Readonly<Record<ClaudeCodeStatuslineSettingsOperationErrorReason, string>>;

/** 状态栏设置操作失败的稳定、脱敏错误。 */
export class ClaudeCodeStatuslineSettingsOperationError extends Error {
  override readonly name = "ClaudeCodeStatuslineSettingsOperationError";
  readonly code = "wakeflow-claude-code-statusline-settings-operation" as const;
  readonly reason: ClaudeCodeStatuslineSettingsOperationErrorReason;
  readonly path: string;

  constructor(reason: ClaudeCodeStatuslineSettingsOperationErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: ClaudeCodeStatuslineSettingsOperationErrorReason, path: string): never {
  throw new ClaudeCodeStatuslineSettingsOperationError(reason, path);
}

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function assertRoot(root: unknown): asserts root is RootedDirectory {
  if (
    typeof root !== "object"
    || root === null
    || types.isProxy(root)
    || !(root instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

/** Claude Code 期望的 `statusLine` 值：命令行带资产路径、标记与 base64url 的工作区根。 */
export function claudeCodeStatuslineSettingsEntry(workspaceRoot: string): JsonValue {
  return parseJsonValue(
    { type: "command", command: claudeCodeStatuslineCommand(workspaceRoot) },
    "$statusLine",
  );
}

interface CurrentSettings {
  readonly source: Readonly<StableFileSource>;
  readonly document: Readonly<Record<string, JsonValue>>;
}

function parseSettingsDocument(bytes: Uint8Array): Readonly<Record<string, JsonValue>> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeUtf8(bytes, "$settings"));
  } catch {
    fail("settings-unreadable", "$settings");
  }
  try {
    const record = parsePlainRecord(decoded, "$settings");
    const document: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(record)) {
      document[key] = parseJsonValue(value, `$settings/${key}`);
    }
    return Object.freeze(document);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError || error instanceof JsonValueError) {
      fail("settings-unreadable", "$settings");
    }
    throw error;
  }
}

/** 当前本地设置：缺失为 null；读不出或不是 JSON 对象即 `settings-unreadable`。 */
async function currentSettings(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<CurrentSettings | null> {
  let read: Awaited<ReturnType<typeof readStableFile>>;
  try {
    read = await readStableFile(root, CLAUDE_CODE_LOCAL_SETTINGS_REF, {
      maximumBytes: SETTINGS_MAXIMUM_BYTES,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "not-found") return null;
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("settings-unreadable", "$settings");
    }
    throw error;
  }
  return Object.freeze({
    source: Object.freeze({
      resourcePath: read.resourcePath,
      node: read.node,
      byteCount: read.byteCount,
      digest: read.digest,
    }),
    document: parseSettingsDocument(read.bytes),
  });
}

/** 只改 `statusLine` 一键：已有键原位替换，否则追加在末尾；其他键与顺序原样保留。 */
function renderTarget(
  document: Readonly<Record<string, JsonValue>>,
  entry: JsonValue,
): Uint8Array {
  const next: Record<string, JsonValue> = {};
  let replaced = false;
  for (const [key, value] of Object.entries(document)) {
    if (key === CLAUDE_CODE_STATUSLINE_SETTINGS_KEY) {
      next[key] = entry;
      replaced = true;
    } else {
      next[key] = value;
    }
  }
  if (!replaced) next[CLAUDE_CODE_STATUSLINE_SETTINGS_KEY] = entry;
  return encodeUtf8(`${JSON.stringify(next, null, 2)}\n`, "$settings");
}

function entryCurrent(current: CurrentSettings | null, entry: JsonValue): boolean {
  if (current === null) return false;
  const existing = current.document[CLAUDE_CODE_STATUSLINE_SETTINGS_KEY];
  return (
    existing !== undefined
    && computeCanonicalJsonSha256Digest(existing) === computeCanonicalJsonSha256Digest(entry)
    && current.source.node.permissionBits === SETTINGS_MODE
  );
}

/** 零写计划：键已是期望值且 0600 即 null，否则一条操作；文件读不出即抛 `settings-unreadable`。 */
export async function planClaudeCodeStatuslineSettingsOperation(
  root: RootedDirectory,
  options: { readonly signal?: AbortSignal } = {},
): Promise<WakeflowHostMaintenanceOperationInput | null> {
  assertRoot(root);
  const current = await currentSettings(root, options.signal);
  const entry = claudeCodeStatuslineSettingsEntry(root.absolutePath);
  if (entryCurrent(current, entry)) return null;
  const target = renderTarget(current?.document ?? {}, entry);
  return Object.freeze({
    operationId: CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID,
    operationKind: CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND,
    ownerId: CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID,
    targetKey: TARGET_KEY,
    sourceDigest: current?.source.digest ?? null,
    targetDigest: computeSha256Digest(target),
    payload: {
      path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
      key: CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
    },
  });
}

function parsePayload(value: unknown): Readonly<ClaudeCodeStatuslineSettingsOperationPayload> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$operation");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("operation", error.path);
    throw error;
  }
  if (
    Object.keys(record).sort().join(" ") !== "key path"
    || record.path !== CLAUDE_CODE_LOCAL_SETTINGS_REF
    || record.key !== CLAUDE_CODE_STATUSLINE_SETTINGS_KEY
  ) {
    fail("operation", "$operation");
  }
  return Object.freeze({
    path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
    key: CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
  });
}

function parseDigests(
  request: Readonly<ExecuteClaudeCodeStatuslineSettingsOperationRequest>,
): { readonly sourceDigest: Sha256Digest | null; readonly targetDigest: Sha256Digest } {
  try {
    return {
      sourceDigest:
        request.sourceDigest === null
          ? null
          : parseSha256Digest(request.sourceDigest, "$operation.sourceDigest"),
      targetDigest: parseSha256Digest(request.targetDigest, "$operation.targetDigest"),
    };
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("operation", error.path);
    throw error;
  }
}

async function ensureSettingsDirectory(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await materializeDirectoryPath(root, CLAUDE_CODE_SETTINGS_DIRECTORY_REF, {
      mode: DIRECTORY_MODE,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("write", "$settings.directory");
    }
    throw error;
  }
}

async function writeTarget(
  root: RootedDirectory,
  current: CurrentSettings | null,
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
): Promise<"created" | "updated"> {
  try {
    if (current === null) {
      await ensureSettingsDirectory(root, signal);
      await createFileAtomically(root, CLAUDE_CODE_LOCAL_SETTINGS_REF, bytes, {
        mode: SETTINGS_MODE,
        ...signalOptions(signal),
      });
      return "created";
    }
    await replaceFileAtomically(root, CLAUDE_CODE_LOCAL_SETTINGS_REF, bytes, {
      mode: SETTINGS_MODE,
      expected: current.source,
      ...signalOptions(signal),
    });
    return "updated";
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "expectation-changed" || error.reason === "target-exists") {
        fail("source-stale", "$settings");
      }
      fail("write", "$settings");
    }
    throw error;
  }
}

/**
 * 执行：文件已是目标字节且 0600 即 current；否则来源摘要必须等于计划时的（affected 恢复放开
 * 这一条），从当前文档重新渲染并要求得到计划的目标摘要，再 CAS 写入。
 */
export async function executeClaudeCodeStatuslineSettingsOperation(
  root: RootedDirectory,
  request: Readonly<ExecuteClaudeCodeStatuslineSettingsOperationRequest>,
): Promise<Readonly<ClaudeCodeStatuslineSettingsOperationResult>> {
  assertRoot(root);
  parsePayload(request.operation);
  const digests = parseDigests(request);
  const current = await currentSettings(root, request.signal);
  if (
    current !== null
    && current.source.digest === digests.targetDigest
    && current.source.node.permissionBits === SETTINGS_MODE
  ) {
    return Object.freeze({
      operationId: CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID,
      disposition: "current" as const,
      targetDigest: digests.targetDigest,
    });
  }
  if (
    !request.recoveringAffectedOperation
    && (current?.source.digest ?? null) !== digests.sourceDigest
  ) {
    fail("source-stale", "$settings");
  }
  const bytes = renderTarget(
    current?.document ?? {},
    claudeCodeStatuslineSettingsEntry(root.absolutePath),
  );
  if (computeSha256Digest(bytes) !== digests.targetDigest) fail("source-stale", "$settings");
  const disposition = await writeTarget(root, current, bytes, request.signal);
  return Object.freeze({
    operationId: CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID,
    disposition,
    targetDigest: digests.targetDigest,
  });
}
