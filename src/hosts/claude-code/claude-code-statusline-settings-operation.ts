import { types } from "node:util";

import {
  parseWakeflowConfig,
  parseWakeflowConfigPlacement,
  WakeflowConfigError,
  type WakeflowConfigModel,
  type WakeflowConfigPlacement,
} from "../../configuration/wakeflow-config.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "../../configuration/wakeflow-config-root-placement.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import {
  type JsonValue,
  JsonValueError,
  parseJsonValue,
} from "../../foundation/data/json-value.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
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
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, encodeUtf8 } from "../../foundation/text/utf8.js";
import type { WakeflowHostMaintenanceOperationInput } from "../../workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import type { WakeflowStaticMaterializationAction } from "../../workspace/maintenance/wakeflow-static-materialization-preview-contract.js";
import { claudeCodeMaintenanceMaterializesMissingSupportRoot } from "./claude-code-portable-settings-composition.js";
import { CLAUDE_CODE_SETTINGS_DIRECTORY_REF } from "./claude-code-portable-settings-publication.js";
import {
  CLAUDE_CODE_STATUSLINE_MARKER,
  claudeCodeStatuslineCommand,
} from "./claude-code-statusline-asset.js";
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
 *
 * 复审 M2（1.1.1 批 1）：Design、Test 窗口在自己的支撑面目录里启动，Claude Code 只读那个 cwd 的
 * `.claude/settings.local.json`，所以每个 wakeflow-managed 支撑面也各写一份同一条目（命令里仍是
 * 工作区根）。支撑面操作的负载多一个 `surface`（surfaceId 与配置里的放置），执行时对照配置核对并
 * 以该面的根为写入根；支撑面根的 `.gitignore` 托管块本来就忽略这个文件。
 */

export const CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND = "statusline-settings" as const;
export const CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID = "claude-code-statusline-settings" as const;
/** 排在资产安装之后：先装资产，再让 settings 指向它。 */
export const CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID =
  "claude-statusline-settings:install" as const;
export const CLAUDE_CODE_STATUSLINE_SETTINGS_KEY = "statusLine" as const;
/** 0.9.x 发布的状态行资产文件名：带它的命令仍是 Wakeflow 的，升级时替换而不是当成用户的。 */
const LEGACY_STATUSLINE_FILE = "wakeflow-statusline.mjs";
export const CLAUDE_CODE_LOCAL_SETTINGS_REF: PortableResourcePath = parsePortableResourcePath(
  claudeCodeWorkspaceHostResourceProfile.surfaces.settingsIntegration?.localPath ??
    ".claude/settings.local.json",
  "$settings",
);
/** 计划失败时宿主贡献报出的 blocker。 */
export const CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER = "claude-settings-local-unreadable" as const;
const TARGET_KEY = "settings:claude-code:local-statusline" as const;
const SURFACE_SUFFIX = "support-surface" as const;

/** wakeflow-managed 支撑面的本地设置操作标识（复审 M2）；程序根仍用无后缀的标识。 */
export function claudeCodeStatuslineSettingsSurfaceOperationId(
  surfaceId: WakeflowDurableId<"surface">,
): string {
  return `${CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID}:${SURFACE_SUFFIX}:${surfaceId}`;
}

/** 支撑面读不出本地设置时宿主贡献报出的 blocker（与程序根的区分开，边界内不得重复）。 */
export function claudeCodeStatuslineSettingsSurfaceBlocker(
  surfaceId: WakeflowDurableId<"surface">,
): string {
  return `${CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER}:${SURFACE_SUFFIX}:${surfaceId}`;
}
const SETTINGS_MAXIMUM_BYTES = parseByteCount(1024 * 1024, "$settings.maximumBytes");
const SETTINGS_MODE = 0o600;
const DIRECTORY_MODE = 0o755;

/** 一个 wakeflow-managed 支撑面：标识与配置里的放置，执行时对照当前配置核对。 */
export interface ClaudeCodeStatuslineSettingsSurface {
  readonly surfaceId: WakeflowDurableId<"surface">;
  readonly configuredPlacement: WakeflowConfigPlacement;
}

export interface ClaudeCodeStatuslineSettingsOperationPayload {
  readonly path: typeof CLAUDE_CODE_LOCAL_SETTINGS_REF;
  readonly key: typeof CLAUDE_CODE_STATUSLINE_SETTINGS_KEY;
  /** 缺省即工作区根；给出即该支撑面根下的同一文件（复审 M2）。 */
  readonly surface?: Readonly<ClaudeCodeStatuslineSettingsSurface>;
}

export interface ExecuteClaudeCodeStatuslineSettingsOperationRequest {
  /** 当前配置：支撑面负载只在它仍是 wakeflow-managed 且放置未变时执行。 */
  readonly config: WakeflowConfigModel;
  readonly operation: unknown;
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
  readonly recoveringAffectedOperation: boolean;
  readonly signal?: AbortSignal;
}

export interface ClaudeCodeStatuslineSettingsOperationResult {
  readonly operationId: string;
  readonly disposition: "current" | "created" | "updated";
  readonly targetDigest: Sha256Digest;
}

export interface PlanClaudeCodeStatuslineSettingsSurfaceOperationsOptions {
  readonly action: WakeflowStaticMaterializationAction;
  readonly config: WakeflowConfigModel;
  readonly signal?: AbortSignal;
}

export interface ClaudeCodeStatuslineSettingsSurfacePlan {
  readonly operations: readonly Readonly<WakeflowHostMaintenanceOperationInput>[];
  /** 读不出的面各一条 `claude-settings-local-unreadable:support-surface:<surfaceId>`。 */
  readonly blockerCodes: readonly string[];
}

export type ClaudeCodeStatuslineSettingsOperationErrorReason =
  | "input"
  | "operation"
  | "settings-unreadable"
  | "source-stale"
  | "write"
  | "placement"
  | "root-open"
  | "close-failure"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Claude statusline settings operation input is invalid.",
  operation: "Claude statusline settings operation payload is invalid.",
  "settings-unreadable": "Claude local settings could not be read as a JSON object.",
  "source-stale": "Claude local settings changed since the plan was made.",
  write: "Claude local settings could not be written safely.",
  placement: "Claude support surface root could not be resolved.",
  "root-open": "Claude support surface root could not be opened.",
  "close-failure": "Claude support surface root could not be closed.",
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
    typeof root !== "object" ||
    root === null ||
    types.isProxy(root) ||
    !(root instanceof RootedDirectory)
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
function renderTarget(document: Readonly<Record<string, JsonValue>>, entry: JsonValue): Uint8Array {
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
    existing !== undefined &&
    computeCanonicalJsonSha256Digest(existing) === computeCanonicalJsonSha256Digest(entry) &&
    current.source.node.permissionBits === SETTINGS_MODE
  );
}

/**
 * Wakeflow 自己的状态行条目（复审 T31/M1，旧版的 `custom/unmanaged` 判定）：命令里带现行标记 `--wakeflow-statusline-v1`
 * 或 0.9.x 的 `wakeflow-statusline.mjs` 才是 Wakeflow 的；其他 `statusLine` 是用户自己的，维护不覆盖，观察侧报 `custom`。
 */
export function claudeCodeStatuslineEntryIsWakeflows(entry: JsonValue): boolean {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
  const command = (entry as Readonly<Record<string, JsonValue>>).command;
  if (typeof command !== "string") return false;
  return (
    command.includes(CLAUDE_CODE_STATUSLINE_MARKER) || command.includes(LEGACY_STATUSLINE_FILE)
  );
}

/**
 * 零写计划：键已是期望值且 0600 即 null，用户自己的 `statusLine` 也是 null（不碰用户的配置），否则一条操作；
 * 文件读不出即抛 `settings-unreadable`。
 */
export async function planClaudeCodeStatuslineSettingsOperation(
  root: RootedDirectory,
  options: { readonly signal?: AbortSignal } = {},
): Promise<WakeflowHostMaintenanceOperationInput | null> {
  assertRoot(root);
  const current = await currentSettings(root, options.signal);
  return planFromCurrent(current, claudeCodeStatuslineSettingsEntry(root.absolutePath), null);
}

function operationIdFor(surface: Readonly<ClaudeCodeStatuslineSettingsSurface> | null): string {
  return surface === null
    ? CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID
    : claudeCodeStatuslineSettingsSurfaceOperationId(surface.surfaceId);
}

function payloadFor(
  surface: Readonly<ClaudeCodeStatuslineSettingsSurface> | null,
): Readonly<ClaudeCodeStatuslineSettingsOperationPayload> {
  const base = {
    path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
    key: CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
  };
  return Object.freeze(
    surface === null
      ? base
      : {
          ...base,
          surface: Object.freeze({
            surfaceId: surface.surfaceId,
            configuredPlacement: surface.configuredPlacement,
          }),
        },
  );
}

/** 同一条零写规则对程序根与每个支撑面各算一次；条目永远由工作区根派生。 */
function planFromCurrent(
  current: CurrentSettings | null,
  entry: JsonValue,
  surface: Readonly<ClaudeCodeStatuslineSettingsSurface> | null,
): WakeflowHostMaintenanceOperationInput | null {
  if (entryCurrent(current, entry)) return null;
  const existing = current?.document[CLAUDE_CODE_STATUSLINE_SETTINGS_KEY];
  if (existing !== undefined && !claudeCodeStatuslineEntryIsWakeflows(existing)) return null;
  const target = renderTarget(current?.document ?? {}, entry);
  return Object.freeze({
    operationId: operationIdFor(surface),
    operationKind: CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_KIND,
    ownerId: CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID,
    targetKey:
      surface === null ? TARGET_KEY : `${TARGET_KEY}:${SURFACE_SUFFIX}:${surface.surfaceId}`,
    sourceDigest: current?.source.digest ?? null,
    targetDigest: computeSha256Digest(target),
    payload: payloadFor(surface),
  });
}

function parseModel(value: unknown): WakeflowConfigModel {
  try {
    return parseWakeflowConfig(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigError) fail("input", "$config");
    throw error;
  }
}

/** 配置里 wakeflow-managed 的支撑面，按 surfaceId 排序（与 portable settings 的根权威同序）。 */
function managedSurfaces(
  model: WakeflowConfigModel,
): readonly Readonly<ClaudeCodeStatuslineSettingsSurface>[] {
  return Object.freeze(
    [...model.topology.supportSurfaces]
      .filter((surface) => surface.ownership === "wakeflow-managed")
      .sort((left, right) =>
        left.surfaceId < right.surfaceId ? -1 : left.surfaceId > right.surfaceId ? 1 : 0,
      )
      .map((surface) =>
        Object.freeze({ surfaceId: surface.surfaceId, configuredPlacement: surface.path }),
      ),
  );
}

interface SurfacePlacement {
  readonly state: "present" | "missing";
  readonly absolutePath: string;
}

/** 支撑面根的实际位置：缺失即 missing（fresh-initialize 与 reconcile 会先建它），别的准入失败即 `placement`。 */
async function surfacePlacement(
  workspaceRoot: RootedDirectory,
  model: WakeflowConfigModel,
  surface: Readonly<ClaudeCodeStatuslineSettingsSurface>,
): Promise<Readonly<SurfacePlacement>> {
  let placements: Awaited<ReturnType<typeof validateWakeflowConfigRootPlacements>>;
  try {
    placements = await validateWakeflowConfigRootPlacements(workspaceRoot, model);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) fail("placement", error.path);
    throw error;
  }
  const placement = placements.roots.find(
    (entry) => entry.key === `support.${surface.surfaceId}.root`,
  );
  if (placement === undefined) fail("placement", "$supportRoot");
  return Object.freeze({
    state: placement.state === "present" ? ("present" as const) : ("missing" as const),
    absolutePath: placement.absolutePath,
  });
}

/** 打开支撑面根跑一段，无论成败都关掉；关不上报 `close-failure`。 */
async function withSurfaceRoot<T>(
  absolutePath: string,
  run: (surfaceRoot: RootedDirectory) => Promise<T>,
): Promise<T> {
  let surfaceRoot: RootedDirectory;
  try {
    surfaceRoot = await RootedDirectory.open(absolutePath, "$supportRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-open", "$supportRoot");
    throw error;
  }
  let result: { readonly value: T } | undefined;
  let primaryError: unknown;
  try {
    result = { value: await run(surfaceRoot) };
  } catch (error: unknown) {
    primaryError = error;
  }
  let closeError: unknown;
  try {
    await surfaceRoot.close();
  } catch (error: unknown) {
    closeError = error;
  }
  if (result === undefined) throw primaryError;
  if (closeError !== undefined) fail("close-failure", "$supportRoot");
  return result.value;
}

type SurfacePlanOutcome =
  | { readonly operation: WakeflowHostMaintenanceOperationInput | null }
  | { readonly blockerCode: string };

/** 一个支撑面：面根不在时 fresh-initialize 与 reconcile 当作缺文件（维护先重建根），reconfigure 不计划；读不出即带 surfaceId 的 blocker。 */
async function planSurface(
  workspaceRoot: RootedDirectory,
  model: WakeflowConfigModel,
  surface: Readonly<ClaudeCodeStatuslineSettingsSurface>,
  action: WakeflowStaticMaterializationAction,
  entry: JsonValue,
  signal: AbortSignal | undefined,
): Promise<SurfacePlanOutcome> {
  const placement = await surfacePlacement(workspaceRoot, model, surface);
  if (placement.state === "missing") {
    return {
      operation: claudeCodeMaintenanceMaterializesMissingSupportRoot(action)
        ? planFromCurrent(null, entry, surface)
        : null,
    };
  }
  try {
    const current = await withSurfaceRoot(placement.absolutePath, (surfaceRoot) =>
      currentSettings(surfaceRoot, signal),
    );
    return { operation: planFromCurrent(current, entry, surface) };
  } catch (error: unknown) {
    if (
      error instanceof ClaudeCodeStatuslineSettingsOperationError &&
      error.reason === "settings-unreadable"
    ) {
      return { blockerCode: claudeCodeStatuslineSettingsSurfaceBlocker(surface.surfaceId) };
    }
    throw error;
  }
}

/**
 * 每个 wakeflow-managed 支撑面一条零写计划（复审 M2）：面根在就按它的本地设置算；面根不在时
 * fresh-initialize 与 reconcile 当作缺文件（维护的共享步先重建根，宿主操作依赖它；open-items W5），
 * reconfigure 跳过（portable settings 的组合已报 `support-root-missing`）；文件读不出不抛，记一条带
 * surfaceId 的 blocker。
 */
export async function planClaudeCodeStatuslineSettingsSurfaceOperations(
  workspaceRoot: RootedDirectory,
  options: PlanClaudeCodeStatuslineSettingsSurfaceOperationsOptions,
): Promise<Readonly<ClaudeCodeStatuslineSettingsSurfacePlan>> {
  assertRoot(workspaceRoot);
  const model = parseModel(options.config);
  if (options.signal?.aborted === true) fail("aborted", "$signal");
  const entry = claudeCodeStatuslineSettingsEntry(workspaceRoot.absolutePath);
  const operations: WakeflowHostMaintenanceOperationInput[] = [];
  const blockerCodes: string[] = [];
  for (const surface of managedSurfaces(model)) {
    const planned = await planSurface(
      workspaceRoot,
      model,
      surface,
      options.action,
      entry,
      options.signal,
    );
    if ("blockerCode" in planned) {
      blockerCodes.push(planned.blockerCode);
    } else if (planned.operation !== null) {
      operations.push(planned.operation);
    }
  }
  return Object.freeze({
    operations: Object.freeze(operations),
    blockerCodes: Object.freeze(blockerCodes),
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
  const keys = Object.keys(record).sort().join(" ");
  if (
    (keys !== "key path" && keys !== "key path surface") ||
    record.path !== CLAUDE_CODE_LOCAL_SETTINGS_REF ||
    record.key !== CLAUDE_CODE_STATUSLINE_SETTINGS_KEY
  ) {
    fail("operation", "$operation");
  }
  if (keys === "key path") return payloadFor(null);
  return payloadFor(parseSurface(record.surface));
}

function parseSurface(value: unknown): Readonly<ClaudeCodeStatuslineSettingsSurface> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$operation.surface");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("operation", "$operation.surface");
    throw error;
  }
  if (Object.keys(record).sort().join(" ") !== "configuredPlacement surfaceId") {
    fail("operation", "$operation.surface");
  }
  try {
    return Object.freeze({
      surfaceId: parseWakeflowDurableIdOfKind(
        record.surfaceId,
        "surface",
        "$operation.surface.surfaceId",
      ),
      configuredPlacement: parseWakeflowConfigPlacement(
        record.configuredPlacement,
        "$operation.surface.configuredPlacement",
      ),
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError || error instanceof WakeflowConfigError) {
      fail("operation", error.path);
    }
    throw error;
  }
}

/** 支撑面负载只在配置里仍有同一 wakeflow-managed 面、放置未变时执行。 */
function authorizedSurface(
  model: WakeflowConfigModel,
  surface: Readonly<ClaudeCodeStatuslineSettingsSurface>,
): Readonly<ClaudeCodeStatuslineSettingsSurface> {
  const configured = model.topology.supportSurfaces.find(
    (entry) => entry.surfaceId === surface.surfaceId,
  );
  if (
    configured === undefined ||
    configured.ownership !== "wakeflow-managed" ||
    configured.path !== surface.configuredPlacement
  ) {
    fail("operation", "$operation.surface");
  }
  return surface;
}

function parseDigests(request: Readonly<ExecuteClaudeCodeStatuslineSettingsOperationRequest>): {
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
} {
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
  workspaceRoot: RootedDirectory,
  request: Readonly<ExecuteClaudeCodeStatuslineSettingsOperationRequest>,
): Promise<Readonly<ClaudeCodeStatuslineSettingsOperationResult>> {
  assertRoot(workspaceRoot);
  const model = parseModel(request.config);
  const payload = parsePayload(request.operation);
  const digests = parseDigests(request);
  const entry = claudeCodeStatuslineSettingsEntry(workspaceRoot.absolutePath);
  if (payload.surface === undefined) {
    return executeAt(workspaceRoot, null, entry, digests, request);
  }
  const surface = authorizedSurface(model, payload.surface);
  const placement = await surfacePlacement(workspaceRoot, model, surface);
  if (placement.state !== "present") fail("placement", "$supportRoot");
  return withSurfaceRoot(placement.absolutePath, (surfaceRoot) =>
    executeAt(surfaceRoot, surface, entry, digests, request),
  );
}

async function executeAt(
  settingsRoot: RootedDirectory,
  surface: Readonly<ClaudeCodeStatuslineSettingsSurface> | null,
  entry: JsonValue,
  digests: ReturnType<typeof parseDigests>,
  request: Readonly<ExecuteClaudeCodeStatuslineSettingsOperationRequest>,
): Promise<Readonly<ClaudeCodeStatuslineSettingsOperationResult>> {
  const operationId = operationIdFor(surface);
  const current = await currentSettings(settingsRoot, request.signal);
  if (
    current !== null &&
    current.source.digest === digests.targetDigest &&
    current.source.node.permissionBits === SETTINGS_MODE
  ) {
    return Object.freeze({
      operationId,
      disposition: "current" as const,
      targetDigest: digests.targetDigest,
    });
  }
  if (
    !request.recoveringAffectedOperation &&
    (current?.source.digest ?? null) !== digests.sourceDigest
  ) {
    fail("source-stale", "$settings");
  }
  const bytes = renderTarget(current?.document ?? {}, entry);
  if (computeSha256Digest(bytes) !== digests.targetDigest) fail("source-stale", "$settings");
  const disposition = await writeTarget(settingsRoot, current, bytes, request.signal);
  return Object.freeze({ operationId, disposition, targetDigest: digests.targetDigest });
}
