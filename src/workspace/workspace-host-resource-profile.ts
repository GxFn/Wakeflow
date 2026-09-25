import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  splitPortableResourcePath,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";

/**
 * Wakeflow Workspace：会改变资源矩阵形状的宿主静态画像。
 *
 * 这是一个字段集合严格受限的专用数据合同，不是完整的宿主门面。它只登记宿主资源
 * 编译器真正需要的协议身份、运行目录、指令文件名和资源表面；不保存实现状态、就绪
 * 状态、适配器、句柄、启动偏好、实时探测或副作用。
 *
 * Codex 与 Claude Code 分别在 `src/hosts/*` 提供本合同的值。共享代码只能使用这里
 * 规范化后的数据，不得通过 `hostId` 分支重新推导宿主差异。
 */

export const WAKEFLOW_WORKSPACE_HOST_RESOURCE_PROFILE_KIND =
  "WakeflowWorkspaceHostResourceProfile" as const;

export const WAKEFLOW_WORKSPACE_HOST_IDS = Object.freeze([
  "codex",
  "claude-code",
] as const);

export type WakeflowWorkspaceHostId =
  (typeof WAKEFLOW_WORKSPACE_HOST_IDS)[number];

export const WAKEFLOW_WORKSPACE_HOST_RESOURCE_SURFACE_NAMES = Object.freeze([
  "windowIdentity",
  "podReceipts",
  "worktree",
  "keepLive",
  "windowLocator",
  "settingsIntegration",
  "statuslineAsset",
  "tmuxAsset",
  "activityMonitor",
  "temporaryPrompts",
] as const);

export type WakeflowWorkspaceHostResourceSurfaceName =
  (typeof WAKEFLOW_WORKSPACE_HOST_RESOURCE_SURFACE_NAMES)[number];

declare const HOST_RESOURCE_COMPONENT_BRAND: unique symbol;

/** 已验证为单个可移植路径分段的宿主资源名称。 */
export type WakeflowWorkspaceHostResourceComponent = PortableResourcePath & {
  readonly [HOST_RESOURCE_COMPONENT_BRAND]:
    "WakeflowWorkspaceHostResourceComponent";
};

export interface WakeflowWorkspaceHostSettingsIntegration {
  readonly portablePath: PortableResourcePath;
  readonly localPath: PortableResourcePath;
}

export interface WakeflowWorkspaceHostStatuslineAsset {
  readonly fileName: WakeflowWorkspaceHostResourceComponent;
}

/** 宿主运行时 `operations/assets/` 下的 tmux 会话/窗口助手资产。 */
export interface WakeflowWorkspaceHostTmuxAsset {
  readonly fileName: WakeflowWorkspaceHostResourceComponent;
}

export const WAKEFLOW_WORKSPACE_HOST_WORKTREE_LAUNCHES = Object.freeze([
  "claude-worktree-flag",
  "codex-worktree-thread",
] as const);
export type WakeflowWorkspaceHostWorktreeLaunch =
  (typeof WAKEFLOW_WORKSPACE_HOST_WORKTREE_LAUNCHES)[number];

export const WAKEFLOW_WORKSPACE_HOST_ATTACHED_DIRECTORY_MODES = Object.freeze([
  "add-dir-flag",
  "prompt-path",
] as const);
export type WakeflowWorkspaceHostAttachedDirectoryMode =
  (typeof WAKEFLOW_WORKSPACE_HOST_ATTACHED_DIRECTORY_MODES)[number];

/**
 * worktree pod 的宿主意图模板（ADR-0010 D4 后果）：产品窗口如何得到自己的 worktree，
 * Test 窗口如何读到它。只是静态值；命令行与参数由端点切片按模板渲染。
 */
export interface WakeflowWorkspaceHostWorktreeTemplate {
  readonly launch: WakeflowWorkspaceHostWorktreeLaunch;
  readonly attachedDirectories: WakeflowWorkspaceHostAttachedDirectoryMode;
}

export interface WakeflowWorkspaceHostResourceSurfaces {
  readonly windowIdentity: boolean;
  /** pod 回执目录 `hosts/<host>/pods/`：worktree 回执与关闭观察（ADR-0010 D6）。 */
  readonly podReceipts: boolean;
  readonly worktree: Readonly<WakeflowWorkspaceHostWorktreeTemplate>;
  readonly keepLive: boolean;
  readonly windowLocator: boolean;
  readonly settingsIntegration:
    Readonly<WakeflowWorkspaceHostSettingsIntegration> | null;
  readonly statuslineAsset:
    Readonly<WakeflowWorkspaceHostStatuslineAsset> | null;
  readonly tmuxAsset: Readonly<WakeflowWorkspaceHostTmuxAsset> | null;
  readonly activityMonitor: boolean;
  readonly temporaryPrompts: boolean;
}

/**
 * 宿主启动模板：端点切片按它渲染 Agent 的启动参数，不再按 hostId 分支。
 * `tmux-session` 携带宿主自己的缺省值（配置未声明时使用）；`host-thread` 由宿主工具建线程。
 */
export type WakeflowWorkspaceHostLaunchTemplate =
  | {
    readonly kind: "tmux-session";
    readonly controllerEffort: string;
    readonly defaultEffort: string;
    readonly permissionMode: string;
    readonly sessionName: string;
  }
  | { readonly kind: "host-thread" };

export interface WakeflowWorkspaceHostResourceProfile {
  readonly kind: typeof WAKEFLOW_WORKSPACE_HOST_RESOURCE_PROFILE_KIND;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly runtimeDirectoryName: WakeflowWorkspaceHostResourceComponent;
  readonly instructionFileName: WakeflowWorkspaceHostResourceComponent;
  readonly surfaces: Readonly<WakeflowWorkspaceHostResourceSurfaces>;
  readonly launch: Readonly<WakeflowWorkspaceHostLaunchTemplate>;
}

export type WakeflowWorkspaceHostResourceProfileErrorReason =
  | "input"
  | "shape"
  | "host"
  | "component"
  | "path"
  | "surface"
  | "contradiction";

const ERROR_MESSAGES = {
  input: "Wakeflow workspace host resource profile is not passive data.",
  shape: "Wakeflow workspace host resource profile has an invalid shape.",
  host: "Wakeflow workspace host identity is invalid.",
  component: "Wakeflow workspace host resource component is invalid.",
  path: "Wakeflow workspace host resource path is invalid.",
  surface: "Wakeflow workspace host resource surface is invalid.",
  contradiction: "Wakeflow workspace host resource facts conflict.",
} as const satisfies Readonly<Record<
  WakeflowWorkspaceHostResourceProfileErrorReason,
  string
>>;

/** Host Resource Profile 准入失败的稳定、脱敏错误。 */
export class WakeflowWorkspaceHostResourceProfileError extends Error {
  override readonly name = "WakeflowWorkspaceHostResourceProfileError";
  readonly code = "wakeflow-workspace-host-resource-profile" as const;
  readonly reason: WakeflowWorkspaceHostResourceProfileErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWorkspaceHostResourceProfileErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const HOST_ID_SET = new Set<string>(WAKEFLOW_WORKSPACE_HOST_IDS);
const PROFILE_FIELDS = new Set([
  "kind",
  "hostId",
  "runtimeDirectoryName",
  "instructionFileName",
  "surfaces",
  "launch",
]);
const TMUX_LAUNCH_FIELDS = new Set([
  "kind",
  "controllerEffort",
  "defaultEffort",
  "permissionMode",
  "sessionName",
]);
const THREAD_LAUNCH_FIELDS = new Set(["kind"]);
const LAUNCH_VALUE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SURFACE_FIELDS = new Set<string>(
  WAKEFLOW_WORKSPACE_HOST_RESOURCE_SURFACE_NAMES,
);
const SETTINGS_INTEGRATION_FIELDS = new Set(["portablePath", "localPath"]);
const WORKTREE_FIELDS = new Set(["launch", "attachedDirectories"]);
const WORKTREE_LAUNCH_SET = new Set<string>(WAKEFLOW_WORKSPACE_HOST_WORKTREE_LAUNCHES);
const ATTACHED_DIRECTORY_MODE_SET = new Set<string>(
  WAKEFLOW_WORKSPACE_HOST_ATTACHED_DIRECTORY_MODES,
);
const STATUSLINE_ASSET_FIELDS = new Set(["fileName"]);

function fail(
  reason: WakeflowWorkspaceHostResourceProfileErrorReason,
  path: string,
): never {
  throw new WakeflowWorkspaceHostResourceProfileError(reason, path);
}

function propertyPath(base: string, key: string): string {
  const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
  return `${base}/${escaped}`;
}

function assertExactFields(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  const unknown = Object.keys(record).sort().find((key) => !allowed.has(key));
  if (unknown !== undefined) fail("shape", propertyPath(path, unknown));
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
}

function parseHostId(value: unknown): WakeflowWorkspaceHostId {
  if (typeof value !== "string" || !HOST_ID_SET.has(value)) {
    fail("host", "$/hostId");
  }
  return value as WakeflowWorkspaceHostId;
}

function parseComponent(
  value: unknown,
  path: string,
): WakeflowWorkspaceHostResourceComponent {
  try {
    const resourcePath = parsePortableResourcePath(value, path);
    if (splitPortableResourcePath(resourcePath, path).length !== 1) {
      fail("component", path);
    }
    return resourcePath as WakeflowWorkspaceHostResourceComponent;
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("component", path);
    throw error;
  }
}

function parseResourcePath(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("path", path);
    throw error;
  }
}

function parseSettingsIntegration(
  value: unknown,
): Readonly<WakeflowWorkspaceHostSettingsIntegration> | null {
  if (value === null) return null;
  const record = plainRecord(value, "$/surfaces/settingsIntegration");
  assertExactFields(
    record,
    SETTINGS_INTEGRATION_FIELDS,
    "$/surfaces/settingsIntegration",
  );
  return Object.freeze({
    portablePath: parseResourcePath(
      record.portablePath,
      "$/surfaces/settingsIntegration/portablePath",
    ),
    localPath: parseResourcePath(
      record.localPath,
      "$/surfaces/settingsIntegration/localPath",
    ),
  });
}

function parseStatuslineAsset(
  value: unknown,
): Readonly<WakeflowWorkspaceHostStatuslineAsset> | null {
  if (value === null) return null;
  const record = plainRecord(value, "$/surfaces/statuslineAsset");
  assertExactFields(
    record,
    STATUSLINE_ASSET_FIELDS,
    "$/surfaces/statuslineAsset",
  );
  return Object.freeze({
    fileName: parseComponent(
      record.fileName,
      "$/surfaces/statuslineAsset/fileName",
    ),
  });
}

function parseTmuxAsset(
  value: unknown,
): Readonly<WakeflowWorkspaceHostTmuxAsset> | null {
  if (value === null) return null;
  const record = plainRecord(value, "$/surfaces/tmuxAsset");
  assertExactFields(record, STATUSLINE_ASSET_FIELDS, "$/surfaces/tmuxAsset");
  return Object.freeze({
    fileName: parseComponent(record.fileName, "$/surfaces/tmuxAsset/fileName"),
  });
}

function parseWorktreeTemplate(
  value: unknown,
): Readonly<WakeflowWorkspaceHostWorktreeTemplate> {
  const record = plainRecord(value, "$/surfaces/worktree");
  assertExactFields(record, WORKTREE_FIELDS, "$/surfaces/worktree");
  const { launch, attachedDirectories } = record;
  if (typeof launch !== "string" || !WORKTREE_LAUNCH_SET.has(launch)) {
    fail("surface", "$/surfaces/worktree/launch");
  }
  if (
    typeof attachedDirectories !== "string"
    || !ATTACHED_DIRECTORY_MODE_SET.has(attachedDirectories)
  ) {
    fail("surface", "$/surfaces/worktree/attachedDirectories");
  }
  return Object.freeze({
    launch: launch as WakeflowWorkspaceHostWorktreeLaunch,
    attachedDirectories: attachedDirectories as WakeflowWorkspaceHostAttachedDirectoryMode,
  });
}

function surfaceBoolean(
  value: unknown,
  name: WakeflowWorkspaceHostResourceSurfaceName,
): boolean {
  if (typeof value !== "boolean") fail("surface", `$/surfaces/${name}`);
  return value;
}

function parseSurfaces(
  value: unknown,
): Readonly<WakeflowWorkspaceHostResourceSurfaces> {
  const record = plainRecord(value, "$/surfaces");
  assertExactFields(record, SURFACE_FIELDS, "$/surfaces");
  const settingsIntegration = parseSettingsIntegration(
    record.settingsIntegration,
  );
  const statuslineAsset = parseStatuslineAsset(record.statuslineAsset);
  if (
    settingsIntegration !== null
    && settingsIntegration.portablePath === settingsIntegration.localPath
  ) {
    fail("contradiction", "$/surfaces/settingsIntegration/localPath");
  }
  if (statuslineAsset !== null && settingsIntegration === null) {
    fail("contradiction", "$/surfaces/statuslineAsset");
  }
  return Object.freeze({
    windowIdentity: surfaceBoolean(record.windowIdentity, "windowIdentity"),
    podReceipts: surfaceBoolean(record.podReceipts, "podReceipts"),
    worktree: parseWorktreeTemplate(record.worktree),
    keepLive: surfaceBoolean(record.keepLive, "keepLive"),
    windowLocator: surfaceBoolean(record.windowLocator, "windowLocator"),
    settingsIntegration,
    statuslineAsset,
    tmuxAsset: parseTmuxAsset(record.tmuxAsset),
    activityMonitor: surfaceBoolean(record.activityMonitor, "activityMonitor"),
    temporaryPrompts: surfaceBoolean(record.temporaryPrompts, "temporaryPrompts"),
  });
}

function launchValue(value: unknown, path: string): string {
  if (typeof value !== "string" || !LAUNCH_VALUE_PATTERN.test(value)) {
    fail("surface", path);
  }
  return value;
}

function parseLaunchTemplate(
  value: unknown,
): Readonly<WakeflowWorkspaceHostLaunchTemplate> {
  const record = plainRecord(value, "$/launch");
  if (record.kind === "host-thread") {
    assertExactFields(record, THREAD_LAUNCH_FIELDS, "$/launch");
    return Object.freeze({ kind: "host-thread" as const });
  }
  if (record.kind !== "tmux-session") fail("surface", "$/launch/kind");
  assertExactFields(record, TMUX_LAUNCH_FIELDS, "$/launch");
  return Object.freeze({
    kind: "tmux-session" as const,
    controllerEffort: launchValue(record.controllerEffort, "$/launch/controllerEffort"),
    defaultEffort: launchValue(record.defaultEffort, "$/launch/defaultEffort"),
    permissionMode: launchValue(record.permissionMode, "$/launch/permissionMode"),
    sessionName: launchValue(record.sessionName, "$/launch/sessionName"),
  });
}

/** 把任意输入准入为解除别名、递归冻结的宿主资源画像。 */
export function parseWakeflowWorkspaceHostResourceProfile(
  value: unknown,
): Readonly<WakeflowWorkspaceHostResourceProfile> {
  const record = plainRecord(value, "$");
  assertExactFields(record, PROFILE_FIELDS, "$");
  if (record.kind !== WAKEFLOW_WORKSPACE_HOST_RESOURCE_PROFILE_KIND) {
    fail("shape", "$/kind");
  }
  const hostId = parseHostId(record.hostId);
  const runtimeDirectoryName = parseComponent(
    record.runtimeDirectoryName,
    "$/runtimeDirectoryName",
  );
  if (runtimeDirectoryName !== hostId) {
    fail("contradiction", "$/runtimeDirectoryName");
  }
  const surfaces = parseSurfaces(record.surfaces);
  const launch = parseLaunchTemplate(record.launch);
  if (launch.kind === "tmux-session" && !surfaces.windowLocator) {
    fail("contradiction", "$/launch");
  }
  return Object.freeze({
    kind: WAKEFLOW_WORKSPACE_HOST_RESOURCE_PROFILE_KIND,
    hostId,
    runtimeDirectoryName,
    instructionFileName: parseComponent(
      record.instructionFileName,
      "$/instructionFileName",
    ),
    surfaces,
    launch,
  });
}
