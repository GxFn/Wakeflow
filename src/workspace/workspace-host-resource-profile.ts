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
  "podEvidence",
  "keepLive",
  "windowLocator",
  "settingsIntegration",
  "statuslineAsset",
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

export interface WakeflowWorkspaceHostResourceSurfaces {
  readonly windowIdentity: boolean;
  readonly podEvidence: boolean;
  readonly keepLive: boolean;
  readonly windowLocator: boolean;
  readonly settingsIntegration:
    Readonly<WakeflowWorkspaceHostSettingsIntegration> | null;
  readonly statuslineAsset:
    Readonly<WakeflowWorkspaceHostStatuslineAsset> | null;
  readonly activityMonitor: boolean;
  readonly temporaryPrompts: boolean;
}

export interface WakeflowWorkspaceHostResourceProfile {
  readonly kind: typeof WAKEFLOW_WORKSPACE_HOST_RESOURCE_PROFILE_KIND;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly runtimeDirectoryName: WakeflowWorkspaceHostResourceComponent;
  readonly instructionFileName: WakeflowWorkspaceHostResourceComponent;
  readonly surfaces: Readonly<WakeflowWorkspaceHostResourceSurfaces>;
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
]);
const SURFACE_FIELDS = new Set<string>(
  WAKEFLOW_WORKSPACE_HOST_RESOURCE_SURFACE_NAMES,
);
const SETTINGS_INTEGRATION_FIELDS = new Set(["portablePath", "localPath"]);
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
    podEvidence: surfaceBoolean(record.podEvidence, "podEvidence"),
    keepLive: surfaceBoolean(record.keepLive, "keepLive"),
    windowLocator: surfaceBoolean(record.windowLocator, "windowLocator"),
    settingsIntegration,
    statuslineAsset,
    activityMonitor: surfaceBoolean(record.activityMonitor, "activityMonitor"),
    temporaryPrompts: surfaceBoolean(record.temporaryPrompts, "temporaryPrompts"),
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
  return Object.freeze({
    kind: WAKEFLOW_WORKSPACE_HOST_RESOURCE_PROFILE_KIND,
    hostId,
    runtimeDirectoryName,
    instructionFileName: parseComponent(
      record.instructionFileName,
      "$/instructionFileName",
    ),
    surfaces: parseSurfaces(record.surfaces),
  });
}
