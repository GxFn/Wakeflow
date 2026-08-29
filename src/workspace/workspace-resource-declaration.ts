import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../contracts/identity/wakeflow-durable-id.js";
import {
  parseWakeflowResourceProcessingContract,
  WakeflowResourceProcessingContractError,
  type WakeflowResourceProcessingContract,
} from "../foundation/resource/resource-processing-contract.js";

/**
 * Wakeflow Workspace：资源声明的纯数据合同。
 *
 * 本模块把 Foundation 的机械处理合同与资源分类、唯一职责所有者、逻辑根目录位置、
 * 版本控制与隐私策略，以及文件系统节点策略组合成冻结声明。位置只引用 Workspace
 * 或 Config 已命名的逻辑根目录；本模块不解析绝对路径、不读取文件系统，也不取得
 * 任何变更权限。
 *
 * 持久化表示和领域编解码器属于上层职责所有者资源目录；宿主适用性属于后续 Host
 * 宿主资源配置。它们不会以可选字符串的形式提前混入这一底层声明。
 */

export const WAKEFLOW_WORKSPACE_RESOURCE_DECLARATION_KIND =
  "WakeflowWorkspaceResourceDeclaration" as const;

export const WAKEFLOW_WORKSPACE_RESOURCE_FAMILIES = Object.freeze([
  "workspace",
  "active",
  "local-core",
  "maintenance",
  "transport",
  "coordination",
  "audit",
  "demand",
  "host-runtime",
  "ledger",
  "support",
  "repository",
] as const);

export type WakeflowWorkspaceResourceFamily =
  (typeof WAKEFLOW_WORKSPACE_RESOURCE_FAMILIES)[number];

export const WAKEFLOW_WORKSPACE_RESOURCE_SCOPES = Object.freeze([
  "host-neutral",
  "current-host",
] as const);

export type WakeflowWorkspaceResourceScope =
  (typeof WAKEFLOW_WORKSPACE_RESOURCE_SCOPES)[number];

export const WAKEFLOW_WORKSPACE_RESOURCE_TRACKING_DISPOSITIONS = Object.freeze([
  "tracked",
  "ignored",
  "owner-defined",
] as const);

export type WakeflowWorkspaceResourceTrackingDisposition =
  (typeof WAKEFLOW_WORKSPACE_RESOURCE_TRACKING_DISPOSITIONS)[number];

export const WAKEFLOW_WORKSPACE_RESOURCE_PRIVACY_CLASSES = Object.freeze([
  "shareable",
  "runtime-private",
] as const);

export type WakeflowWorkspaceResourcePrivacy =
  (typeof WAKEFLOW_WORKSPACE_RESOURCE_PRIVACY_CLASSES)[number];

declare const WORKSPACE_RESOURCE_DECLARATION_ID_BRAND: unique symbol;
declare const WORKSPACE_RESOURCE_OWNER_ID_BRAND: unique symbol;

/** 资源矩阵内全局唯一、面向职责的资源声明 ID。 */
export type WakeflowWorkspaceResourceDeclarationId = string & {
  readonly [WORKSPACE_RESOURCE_DECLARATION_ID_BRAND]:
    "WakeflowWorkspaceResourceDeclarationId";
};

/** 不承载行为的稳定职责所有者 ID。 */
export type WakeflowWorkspaceResourceOwnerId = string & {
  readonly [WORKSPACE_RESOURCE_OWNER_ID_BRAND]:
    "WakeflowWorkspaceResourceOwnerId";
};

export type WakeflowWorkspaceResourceLogicalRoot =
  | { readonly kind: "workspace" }
  | { readonly kind: "ledger" }
  | {
      readonly kind: "support-surface";
      readonly surfaceId: WakeflowDurableId<"surface">;
    }
  | {
      readonly kind: "repository";
      readonly repositoryId: WakeflowDurableId<"repository">;
    };

interface WorkspaceRootPlacement<
  Root extends WakeflowWorkspaceResourceLogicalRoot,
  RelativePath extends PortableResourcePath | null,
> {
  readonly root: Root;
  readonly relativePath: RelativePath;
}

export type WakeflowWorkspaceResourcePlacement =
  | WorkspaceRootPlacement<
      { readonly kind: "workspace" },
      PortableResourcePath
    >
  | WorkspaceRootPlacement<
      { readonly kind: "ledger" },
      PortableResourcePath | null
    >
  | WorkspaceRootPlacement<
      {
        readonly kind: "support-surface";
        readonly surfaceId: WakeflowDurableId<"surface">;
      },
      PortableResourcePath | null
    >
  | WorkspaceRootPlacement<
      {
        readonly kind: "repository";
        readonly repositoryId: WakeflowDurableId<"repository">;
      },
      PortableResourcePath | null
    >;

export interface WakeflowWorkspaceResourceTracking {
  readonly disposition: WakeflowWorkspaceResourceTrackingDisposition;
  readonly privacy: WakeflowWorkspaceResourcePrivacy;
}

export type WakeflowWorkspaceResourceFileMode =
  | "0600"
  | "0644"
  | "0700"
  | "0755"
  | "owner-defined";

export type WakeflowWorkspaceResourceDirectoryMode =
  | "0700"
  | "0755"
  | "owner-defined";

export interface WakeflowWorkspaceFileNodePolicy {
  readonly kind: "file";
  readonly mode: WakeflowWorkspaceResourceFileMode;
  readonly linkPolicy: "single-link" | "owner-defined";
  readonly executablePolicy: "forbidden" | "profile-declared";
}

export interface WakeflowWorkspaceDirectoryNodePolicy {
  readonly kind: "directory";
  readonly mode: WakeflowWorkspaceResourceDirectoryMode;
  readonly symlinkPolicy: "reject";
  readonly existingModePolicy: "observe-without-change";
}

export interface WakeflowWorkspaceTreeNodePolicy {
  readonly kind: "tree";
  readonly rootMode: WakeflowWorkspaceResourceDirectoryMode;
  readonly symlinkPolicy: "reject";
  readonly executablePolicy: "forbidden" | "manifest-declared";
}

export type WakeflowWorkspaceResourceNodePolicy =
  | WakeflowWorkspaceFileNodePolicy
  | WakeflowWorkspaceDirectoryNodePolicy
  | WakeflowWorkspaceTreeNodePolicy;

export interface WakeflowWorkspaceResourceDeclaration {
  readonly kind: typeof WAKEFLOW_WORKSPACE_RESOURCE_DECLARATION_KIND;
  readonly declarationId: WakeflowWorkspaceResourceDeclarationId;
  readonly family: WakeflowWorkspaceResourceFamily;
  readonly ownerId: WakeflowWorkspaceResourceOwnerId;
  readonly scope: WakeflowWorkspaceResourceScope;
  readonly placement: Readonly<WakeflowWorkspaceResourcePlacement>;
  readonly tracking: Readonly<WakeflowWorkspaceResourceTracking>;
  readonly nodePolicy: Readonly<WakeflowWorkspaceResourceNodePolicy>;
  readonly processing: Readonly<WakeflowResourceProcessingContract>;
}

export type WakeflowWorkspaceResourceDeclarationErrorReason =
  | "input"
  | "shape"
  | "identity"
  | "family"
  | "owner"
  | "scope"
  | "placement"
  | "tracking"
  | "node-policy"
  | "processing"
  | "compatibility";

const ERROR_MESSAGES = {
  input: "Wakeflow workspace resource declaration is not passive data.",
  shape: "Wakeflow workspace resource declaration has an invalid shape.",
  identity: "Wakeflow workspace resource declaration identity is invalid.",
  family: "Wakeflow workspace resource family is invalid.",
  owner: "Wakeflow workspace resource owner is invalid.",
  scope: "Wakeflow workspace resource scope is invalid.",
  placement: "Wakeflow workspace resource placement is invalid.",
  tracking: "Wakeflow workspace resource tracking is invalid.",
  "node-policy": "Wakeflow workspace resource node policy is invalid.",
  processing: "Wakeflow workspace resource processing contract is invalid.",
  compatibility: "Wakeflow workspace resource declaration facts conflict.",
} as const satisfies Readonly<Record<
  WakeflowWorkspaceResourceDeclarationErrorReason,
  string
>>;

/** Workspace 资源声明准入失败的稳定、脱敏错误。 */
export class WakeflowWorkspaceResourceDeclarationError extends Error {
  override readonly name = "WakeflowWorkspaceResourceDeclarationError";
  readonly code = "wakeflow-workspace-resource-declaration" as const;
  readonly reason: WakeflowWorkspaceResourceDeclarationErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWorkspaceResourceDeclarationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const FAMILY_SET = new Set<string>(WAKEFLOW_WORKSPACE_RESOURCE_FAMILIES);
const SCOPE_SET = new Set<string>(WAKEFLOW_WORKSPACE_RESOURCE_SCOPES);
const TRACKING_SET = new Set<string>(
  WAKEFLOW_WORKSPACE_RESOURCE_TRACKING_DISPOSITIONS,
);
const PRIVACY_SET = new Set<string>(
  WAKEFLOW_WORKSPACE_RESOURCE_PRIVACY_CLASSES,
);
const FILE_MODE_SET = new Set<string>([
  "0600",
  "0644",
  "0700",
  "0755",
  "owner-defined",
]);
const DIRECTORY_MODE_SET = new Set<string>([
  "0700",
  "0755",
  "owner-defined",
]);
const DECLARATION_ID_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/u;
const OWNER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const DECLARATION_FIELDS = new Set([
  "kind",
  "declarationId",
  "family",
  "ownerId",
  "scope",
  "placement",
  "tracking",
  "nodePolicy",
  "processing",
]);
const PLACEMENT_FIELDS = new Set(["root", "relativePath"]);
const SIMPLE_ROOT_FIELDS = new Set(["kind"]);
const SUPPORT_ROOT_FIELDS = new Set(["kind", "surfaceId"]);
const REPOSITORY_ROOT_FIELDS = new Set(["kind", "repositoryId"]);
const TRACKING_FIELDS = new Set(["disposition", "privacy"]);
const FILE_NODE_POLICY_FIELDS = new Set([
  "kind",
  "mode",
  "linkPolicy",
  "executablePolicy",
]);
const DIRECTORY_NODE_POLICY_FIELDS = new Set([
  "kind",
  "mode",
  "symlinkPolicy",
  "existingModePolicy",
]);
const TREE_NODE_POLICY_FIELDS = new Set([
  "kind",
  "rootMode",
  "symlinkPolicy",
  "executablePolicy",
]);

function fail(
  reason: WakeflowWorkspaceResourceDeclarationErrorReason,
  path: string,
): never {
  throw new WakeflowWorkspaceResourceDeclarationError(reason, path);
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

function stableIdentifier(
  value: unknown,
  pattern: RegExp,
  reason: "identity" | "owner",
  path: string,
): string {
  if (
    typeof value !== "string"
    || !value.isWellFormed()
    || value.normalize("NFC") !== value
    || !pattern.test(value)
  ) {
    fail(reason, path);
  }
  return value;
}

function declarationId(
  value: unknown,
): WakeflowWorkspaceResourceDeclarationId {
  return stableIdentifier(
    value,
    DECLARATION_ID_PATTERN,
    "identity",
    "$/declarationId",
  ) as WakeflowWorkspaceResourceDeclarationId;
}

function ownerId(value: unknown): WakeflowWorkspaceResourceOwnerId {
  return stableIdentifier(
    value,
    OWNER_ID_PATTERN,
    "owner",
    "$/ownerId",
  ) as WakeflowWorkspaceResourceOwnerId;
}

function family(value: unknown): WakeflowWorkspaceResourceFamily {
  if (typeof value !== "string" || !FAMILY_SET.has(value)) {
    fail("family", "$/family");
  }
  return value as WakeflowWorkspaceResourceFamily;
}

function scope(value: unknown): WakeflowWorkspaceResourceScope {
  if (typeof value !== "string" || !SCOPE_SET.has(value)) {
    fail("scope", "$/scope");
  }
  return value as WakeflowWorkspaceResourceScope;
}

function parseLogicalRoot(
  value: unknown,
): Readonly<WakeflowWorkspaceResourceLogicalRoot> {
  const record = plainRecord(value, "$/placement/root");
  if (record.kind === "workspace") {
    assertExactFields(record, SIMPLE_ROOT_FIELDS, "$/placement/root");
    return Object.freeze({ kind: "workspace" });
  }
  if (record.kind === "ledger") {
    assertExactFields(record, SIMPLE_ROOT_FIELDS, "$/placement/root");
    return Object.freeze({ kind: "ledger" });
  }
  if (record.kind === "support-surface") {
    assertExactFields(record, SUPPORT_ROOT_FIELDS, "$/placement/root");
    try {
      return Object.freeze({
        kind: "support-surface",
        surfaceId: parseWakeflowDurableIdOfKind(
          record.surfaceId,
          "surface",
          "$/placement/root/surfaceId",
        ),
      });
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) {
        fail("placement", "$/placement/root/surfaceId");
      }
      throw error;
    }
  }
  if (record.kind === "repository") {
    assertExactFields(record, REPOSITORY_ROOT_FIELDS, "$/placement/root");
    try {
      return Object.freeze({
        kind: "repository",
        repositoryId: parseWakeflowDurableIdOfKind(
          record.repositoryId,
          "repository",
          "$/placement/root/repositoryId",
        ),
      });
    } catch (error: unknown) {
      if (error instanceof WakeflowDurableIdError) {
        fail("placement", "$/placement/root/repositoryId");
      }
      throw error;
    }
  }
  fail("placement", "$/placement/root/kind");
}

function parseRelativePath(
  value: unknown,
  root: Readonly<WakeflowWorkspaceResourceLogicalRoot>,
): PortableResourcePath | null {
  if (value === null) {
    if (root.kind === "workspace") {
      fail("placement", "$/placement/relativePath");
    }
    return null;
  }
  try {
    return parsePortableResourcePath(value, "$/placement/relativePath");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("placement", "$/placement/relativePath");
    }
    throw error;
  }
}

function parsePlacement(
  value: unknown,
): Readonly<WakeflowWorkspaceResourcePlacement> {
  const record = plainRecord(value, "$/placement");
  assertExactFields(record, PLACEMENT_FIELDS, "$/placement");
  const root = parseLogicalRoot(record.root);
  const relativePath = parseRelativePath(record.relativePath, root);
  return Object.freeze({ root, relativePath }) as Readonly<
    WakeflowWorkspaceResourcePlacement
  >;
}

function parseTracking(
  value: unknown,
): Readonly<WakeflowWorkspaceResourceTracking> {
  const record = plainRecord(value, "$/tracking");
  assertExactFields(record, TRACKING_FIELDS, "$/tracking");
  if (typeof record.disposition !== "string" || !TRACKING_SET.has(record.disposition)) {
    fail("tracking", "$/tracking/disposition");
  }
  if (typeof record.privacy !== "string" || !PRIVACY_SET.has(record.privacy)) {
    fail("tracking", "$/tracking/privacy");
  }
  return Object.freeze({
    disposition: record.disposition as WakeflowWorkspaceResourceTrackingDisposition,
    privacy: record.privacy as WakeflowWorkspaceResourcePrivacy,
  });
}

function parseNodePolicy(
  value: unknown,
): Readonly<WakeflowWorkspaceResourceNodePolicy> {
  const record = plainRecord(value, "$/nodePolicy");
  if (record.kind === "file") {
    assertExactFields(record, FILE_NODE_POLICY_FIELDS, "$/nodePolicy");
    if (typeof record.mode !== "string" || !FILE_MODE_SET.has(record.mode)) {
      fail("node-policy", "$/nodePolicy/mode");
    }
    if (record.linkPolicy !== "single-link" && record.linkPolicy !== "owner-defined") {
      fail("node-policy", "$/nodePolicy/linkPolicy");
    }
    if (record.executablePolicy !== "forbidden" && record.executablePolicy !== "profile-declared") {
      fail("node-policy", "$/nodePolicy/executablePolicy");
    }
    return Object.freeze({
      kind: "file",
      mode: record.mode as WakeflowWorkspaceResourceFileMode,
      linkPolicy: record.linkPolicy,
      executablePolicy: record.executablePolicy,
    });
  }
  if (record.kind === "directory") {
    assertExactFields(record, DIRECTORY_NODE_POLICY_FIELDS, "$/nodePolicy");
    if (typeof record.mode !== "string" || !DIRECTORY_MODE_SET.has(record.mode)) {
      fail("node-policy", "$/nodePolicy/mode");
    }
    if (record.symlinkPolicy !== "reject") {
      fail("node-policy", "$/nodePolicy/symlinkPolicy");
    }
    if (record.existingModePolicy !== "observe-without-change") {
      fail("node-policy", "$/nodePolicy/existingModePolicy");
    }
    return Object.freeze({
      kind: "directory",
      mode: record.mode as WakeflowWorkspaceResourceDirectoryMode,
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    });
  }
  if (record.kind === "tree") {
    assertExactFields(record, TREE_NODE_POLICY_FIELDS, "$/nodePolicy");
    if (typeof record.rootMode !== "string" || !DIRECTORY_MODE_SET.has(record.rootMode)) {
      fail("node-policy", "$/nodePolicy/rootMode");
    }
    if (record.symlinkPolicy !== "reject") {
      fail("node-policy", "$/nodePolicy/symlinkPolicy");
    }
    if (record.executablePolicy !== "forbidden" && record.executablePolicy !== "manifest-declared") {
      fail("node-policy", "$/nodePolicy/executablePolicy");
    }
    return Object.freeze({
      kind: "tree",
      rootMode: record.rootMode as WakeflowWorkspaceResourceDirectoryMode,
      symlinkPolicy: "reject",
      executablePolicy: record.executablePolicy,
    });
  }
  fail("node-policy", "$/nodePolicy/kind");
}

function rebaseProcessingPath(path: string): string {
  return path === "$" ? "$/processing" : `$/processing${path.slice(1)}`;
}

function parseProcessing(
  value: unknown,
): Readonly<WakeflowResourceProcessingContract> {
  try {
    return parseWakeflowResourceProcessingContract(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("processing", rebaseProcessingPath(error.path));
    }
    throw error;
  }
}

function assertFamilyPlacement(
  familyValue: WakeflowWorkspaceResourceFamily,
  placement: Readonly<WakeflowWorkspaceResourcePlacement>,
): void {
  const requiredRootKind = familyValue === "ledger"
    ? "ledger"
    : familyValue === "support"
      ? "support-surface"
      : familyValue === "repository"
        ? "repository"
        : "workspace";
  if (placement.root.kind !== requiredRootKind) {
    fail("compatibility", "$/placement/root/kind");
  }
}

function assertProcessingNodeCompatibility(
  processing: Readonly<WakeflowResourceProcessingContract>,
  nodePolicy: Readonly<WakeflowWorkspaceResourceNodePolicy>,
): void {
  if (processing.kind === "directory-container") {
    if (nodePolicy.kind !== "directory") {
      fail("compatibility", "$/nodePolicy/kind");
    }
    return;
  }
  if (processing.role === "manifested-tree") {
    if (nodePolicy.kind !== "tree") {
      fail("compatibility", "$/nodePolicy/kind");
    }
    return;
  }
  if (
    processing.role !== "external-reference"
    && processing.role !== "transaction-artifact"
    && nodePolicy.kind !== "file"
  ) {
    fail("compatibility", "$/nodePolicy/kind");
  }
}

function nodeMode(
  nodePolicy: Readonly<WakeflowWorkspaceResourceNodePolicy>,
): WakeflowWorkspaceResourceFileMode | WakeflowWorkspaceResourceDirectoryMode {
  return nodePolicy.kind === "tree" ? nodePolicy.rootMode : nodePolicy.mode;
}

function expectedManagedMode(
  tracking: Readonly<WakeflowWorkspaceResourceTracking>,
  nodePolicy: Readonly<WakeflowWorkspaceResourceNodePolicy>,
): Exclude<
  WakeflowWorkspaceResourceFileMode | WakeflowWorkspaceResourceDirectoryMode,
  "owner-defined"
> {
  const privateResource = tracking.disposition === "ignored";
  if (nodePolicy.kind !== "file") return privateResource ? "0700" : "0755";
  if (nodePolicy.executablePolicy === "profile-declared") {
    return privateResource ? "0700" : "0755";
  }
  return privateResource ? "0600" : "0644";
}

function assertTrackingNodeCompatibility(
  tracking: Readonly<WakeflowWorkspaceResourceTracking>,
  nodePolicy: Readonly<WakeflowWorkspaceResourceNodePolicy>,
): void {
  if (
    tracking.disposition === "tracked"
    && tracking.privacy === "runtime-private"
  ) {
    fail("compatibility", "$/tracking/privacy");
  }
  const mode = nodeMode(nodePolicy);
  if (tracking.disposition === "owner-defined") {
    if (mode !== "owner-defined") {
      fail("compatibility", nodePolicy.kind === "tree"
        ? "$/nodePolicy/rootMode"
        : "$/nodePolicy/mode");
    }
    return;
  }
  if (mode !== expectedManagedMode(tracking, nodePolicy)) {
    fail("compatibility", nodePolicy.kind === "tree"
      ? "$/nodePolicy/rootMode"
      : "$/nodePolicy/mode");
  }
  if (nodePolicy.kind === "file" && nodePolicy.linkPolicy !== "single-link") {
    fail("compatibility", "$/nodePolicy/linkPolicy");
  }
}

function assertDeclarationCompatibility(
  familyValue: WakeflowWorkspaceResourceFamily,
  placement: Readonly<WakeflowWorkspaceResourcePlacement>,
  tracking: Readonly<WakeflowWorkspaceResourceTracking>,
  nodePolicy: Readonly<WakeflowWorkspaceResourceNodePolicy>,
  processing: Readonly<WakeflowResourceProcessingContract>,
): void {
  assertFamilyPlacement(familyValue, placement);
  if (placement.relativePath === null && nodePolicy.kind !== "directory") {
    fail("compatibility", "$/placement/relativePath");
  }
  assertProcessingNodeCompatibility(processing, nodePolicy);
  assertTrackingNodeCompatibility(tracking, nodePolicy);
  if (
    processing.kind === "resource"
    && processing.role === "external-reference"
    && tracking.disposition !== "owner-defined"
  ) {
    fail("compatibility", "$/tracking/disposition");
  }
  if (
    processing.kind === "directory-container"
    && tracking.disposition === "owner-defined"
  ) {
    fail("compatibility", "$/tracking/disposition");
  }
}

/** 把任意输入准入为解除别名、递归冻结的 Workspace 资源声明。 */
export function parseWakeflowWorkspaceResourceDeclaration(
  value: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  const record = plainRecord(value, "$");
  assertExactFields(record, DECLARATION_FIELDS, "$");
  if (record.kind !== WAKEFLOW_WORKSPACE_RESOURCE_DECLARATION_KIND) {
    fail("shape", "$/kind");
  }
  const declarationIdValue = declarationId(record.declarationId);
  const familyValue = family(record.family);
  const ownerIdValue = ownerId(record.ownerId);
  const scopeValue = scope(record.scope);
  const placement = parsePlacement(record.placement);
  const tracking = parseTracking(record.tracking);
  const nodePolicy = parseNodePolicy(record.nodePolicy);
  const processing = parseProcessing(record.processing);
  assertDeclarationCompatibility(
    familyValue,
    placement,
    tracking,
    nodePolicy,
    processing,
  );
  return Object.freeze({
    kind: WAKEFLOW_WORKSPACE_RESOURCE_DECLARATION_KIND,
    declarationId: declarationIdValue,
    family: familyValue,
    ownerId: ownerIdValue,
    scope: scopeValue,
    placement,
    tracking,
    nodePolicy,
    processing,
  });
}
