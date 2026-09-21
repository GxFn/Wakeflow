import { types } from "node:util";

import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
  WakeflowConfigError,
  type WakeflowConfigModel,
} from "../../configuration/wakeflow-config.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "../../configuration/wakeflow-config-root-placement.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  materializeAbsoluteDirectoryPlacement,
  AbsoluteDirectoryMaterializationError,
} from "../../foundation/filesystem/absolute-directory-materialization.js";
import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  createWakeflowManagedSupportResourceCatalog,
} from "./wakeflow-managed-support-resource-catalog.js";

/**
 * Wakeflow Workspace / Support：单个受管 Support 根目录的机械物化 owner。
 *
 * 本模块把 Config 根位置报告、动态 Support Resource Catalog 与 Foundation 绝对目录
 * 物化组合起来。它确保调用方明确选择的 wakeflow-managed surface 根以 `0755` 存在，
 * 并在根下确保目录里声明的角色 scaffold 目录（Design 的 `drafts/`，Test 的
 * `harnesses/` 与 `fixtures/`）；已有目录不改权限、不触碰内容。不创建 memory、不删除
 * 旧路径，也不判断 fresh/reconfigure 的高层 footprint 政策。
 *
 * 只读检查 `inspectWakeflowManagedSupportRoot` 给预览用同一份声明报告根与 scaffold
 * 的缺失或冲突；调用方仍须通过 maintenance confirmed plan 决定是否允许创建或接受
 * 已存在根。本 owner 的职责只是绑定摘要并执行一个可重试的机械目录效果。
 */

export const WAKEFLOW_MANAGED_SUPPORT_ROOT_MODE = 0o755;

export interface WakeflowManagedSupportRootMaterializationRequest {
  readonly config: unknown;
  readonly expectedConfigDigest: Sha256Digest;
  readonly profile: unknown;
  readonly expectedCatalogDigest: Sha256Digest;
  readonly surfaceId: unknown;
  readonly signal?: AbortSignal;
}

export interface WakeflowManagedSupportScaffoldEffect {
  readonly relativePath: PortableResourcePath;
  readonly disposition: "created" | "existing";
}

export interface WakeflowManagedSupportRootMaterializationReceipt {
  readonly kind: "WakeflowManagedSupportRootMaterializationReceipt";
  readonly disposition: "created" | "existing";
  readonly configDigest: Sha256Digest;
  readonly catalogDigest: Sha256Digest;
  readonly surfaceId: WakeflowDurableId<"surface">;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly scaffold: readonly Readonly<WakeflowManagedSupportScaffoldEffect>[];
}

export interface WakeflowManagedSupportScaffoldObservation {
  readonly relativePath: PortableResourcePath;
  readonly status: "current" | "absent" | "conflict";
}

export interface WakeflowManagedSupportRootInspection {
  readonly kind: "WakeflowManagedSupportRootInspection";
  /** `absent` 根不存在；`current` 根与全部 scaffold 就绪；`incomplete` 缺 scaffold；`conflict` 节点政策不符。 */
  readonly status: "absent" | "current" | "incomplete" | "conflict";
  readonly placementState: "present" | "missing";
  readonly surfaceId: WakeflowDurableId<"surface">;
  readonly scaffold: readonly Readonly<WakeflowManagedSupportScaffoldObservation>[];
  readonly observationDigest: Sha256Digest;
}

export type WakeflowManagedSupportRootMaterializationErrorReason =
  | "input"
  | "config"
  | "profile"
  | "catalog"
  | "surface"
  | "placement"
  | "root-policy"
  | "aborted"
  | "effect";

const ERROR_MESSAGES = {
  input: "Wakeflow managed support root materialization input is invalid.",
  config: "Wakeflow managed support root config is invalid.",
  profile: "Wakeflow managed support root host profile is invalid.",
  catalog: "Wakeflow managed support root catalog expectation is invalid.",
  surface: "Wakeflow managed support root surface is unavailable.",
  placement: "Wakeflow managed support root placement is unsafe.",
  "root-policy": "Wakeflow managed support root violates its node policy.",
  aborted: "Wakeflow managed support root materialization was aborted.",
  effect: "Wakeflow managed support root could not be materialized safely.",
} as const satisfies Readonly<Record<
  WakeflowManagedSupportRootMaterializationErrorReason,
  string
>>;

/** 受管 Support 根物化失败的稳定、脱敏错误。 */
export class WakeflowManagedSupportRootMaterializationError extends Error {
  override readonly name = "WakeflowManagedSupportRootMaterializationError";
  readonly code = "wakeflow-managed-support-root-materialization" as const;
  readonly reason: WakeflowManagedSupportRootMaterializationErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowManagedSupportRootMaterializationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedRequest {
  readonly config: WakeflowConfigModel;
  readonly configDigest: Sha256Digest;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly catalogDigest: Sha256Digest;
  readonly surfaceId: WakeflowDurableId<"surface">;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: WakeflowManagedSupportRootMaterializationErrorReason,
  path: string,
): never {
  throw new WakeflowManagedSupportRootMaterializationError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", path);
    throw error;
  }
}

function parseRequest(value: unknown): Readonly<ParsedRequest> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$request");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$request");
    throw error;
  }
  const required = [
    "config",
    "expectedCatalogDigest",
    "expectedConfigDigest",
    "profile",
    "surfaceId",
  ];
  const expected = record.signal === undefined
    ? required
    : [...required, "signal"].sort();
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
    || (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    fail("input", "$request");
  }
  let config: WakeflowConfigModel;
  try {
    config = parseWakeflowConfig(record.config);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigError) fail("config", error.path);
    throw error;
  }
  const configDigest = parseDigest(
    record.expectedConfigDigest,
    "$request.expectedConfigDigest",
  );
  if (computeWakeflowConfigDigest(config) !== configDigest) {
    fail("config", "$request.expectedConfigDigest");
  }
  let profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  try {
    profile = parseWakeflowWorkspaceHostResourceProfile(record.profile);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("profile", error.path);
    }
    throw error;
  }
  let surfaceId: WakeflowDurableId<"surface">;
  try {
    surfaceId = parseWakeflowDurableIdOfKind(
      record.surfaceId,
      "surface",
      "$request.surfaceId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("input", "$request.surfaceId");
    }
    throw error;
  }
  const catalog = createWakeflowManagedSupportResourceCatalog(config, profile);
  const catalogDigest = parseDigest(
    record.expectedCatalogDigest,
    "$request.expectedCatalogDigest",
  );
  if (catalog.catalogDigest !== catalogDigest) {
    fail("catalog", "$request.expectedCatalogDigest");
  }
  const rootDeclaration = catalog.declarations.find((entry) => (
    entry.declarationId === `support.${surfaceId}.root`
  ));
  if (rootDeclaration === undefined) fail("surface", "$request.surfaceId");
  try {
    admitWakeflowResourceOperation(
      rootDeclaration.processing,
      "materialize-directory",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("catalog", "$request.expectedCatalogDigest");
    }
    throw error;
  }
  return Object.freeze({
    config,
    configDigest,
    profile,
    catalogDigest,
    surfaceId,
    signal: record.signal as AbortSignal | undefined,
  });
}

function currentUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("root-policy", "$root");
  }
  return BigInt(process.geteuid());
}

function assertWorkspaceRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

/** 目录里属于该 surface 根下的 scaffold 目录声明，按相对路径排序。 */
function scaffoldPaths(
  request: Readonly<ParsedRequest>,
): readonly PortableResourcePath[] {
  const catalog = createWakeflowManagedSupportResourceCatalog(
    request.config,
    request.profile,
  );
  return Object.freeze(
    catalog.declarations
      .filter(
        (entry) =>
          entry.placement.root.kind === "support-surface"
          && entry.placement.root.surfaceId === request.surfaceId
          && entry.placement.relativePath !== null
          && entry.processing.kind === "directory-container",
      )
      .map((entry) => entry.placement.relativePath as PortableResourcePath)
      .sort(),
  );
}

async function placementFor(
  workspaceRoot: RootedDirectory,
  request: Readonly<ParsedRequest>,
) {
  let report;
  try {
    report = await validateWakeflowConfigRootPlacements(
      workspaceRoot,
      request.config,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      fail("placement", error.path);
    }
    throw error;
  }
  const placement = report.roots.find(
    (entry) => entry.key === `support.${request.surfaceId}.root`,
  );
  if (placement === undefined) fail("surface", "$request.surfaceId");
  return placement;
}

function scaffoldDirectoryCurrent(
  node: Readonly<FileNodeSnapshot>,
  expectedUserId: bigint,
): boolean {
  return node.kind === "directory"
    && node.permissionBits === WAKEFLOW_MANAGED_SUPPORT_ROOT_MODE
    && node.userId === expectedUserId;
}

async function openSupportRoot(
  workspaceRoot: RootedDirectory,
  absolutePath: string,
): Promise<RootedDirectory> {
  try {
    return await RootedDirectory.open(absolutePath, "$supportRoot", {
      durability: workspaceRoot.durability,
    });
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("placement", "$root");
    throw error;
  }
}

async function withSupportRoot<T>(
  workspaceRoot: RootedDirectory,
  absolutePath: string,
  action: (supportRoot: RootedDirectory) => Promise<T>,
): Promise<T> {
  const supportRoot = await openSupportRoot(workspaceRoot, absolutePath);
  let result: T | undefined;
  let primaryError: unknown;
  try {
    result = await action(supportRoot);
  } catch (error: unknown) {
    primaryError = error;
  }
  let closeError: unknown;
  try {
    await supportRoot.close();
  } catch (error: unknown) {
    closeError = error;
  }
  if (primaryError !== undefined) throw primaryError;
  if (closeError !== undefined || result === undefined) fail("effect", "$root");
  return result;
}

async function observeScaffold(
  supportRoot: RootedDirectory,
  relativePath: PortableResourcePath,
  expectedUserId: bigint,
): Promise<Readonly<WakeflowManagedSupportScaffoldObservation>> {
  try {
    const resource = await supportRoot.inspectExistingResource(
      relativePath,
      `$supportRoot/${relativePath}`,
    );
    return Object.freeze({
      relativePath,
      status: scaffoldDirectoryCurrent(resource.node, expectedUserId)
        ? ("current" as const)
        : ("conflict" as const),
    });
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      return Object.freeze({ relativePath, status: "absent" as const });
    }
    if (error instanceof RootedDirectoryError) {
      return Object.freeze({ relativePath, status: "conflict" as const });
    }
    throw error;
  }
}

async function ensureScaffold(
  supportRoot: RootedDirectory,
  relativePath: PortableResourcePath,
  expectedUserId: bigint,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowManagedSupportScaffoldEffect>> {
  let result;
  try {
    result = await materializeDirectoryPath(supportRoot, relativePath, {
      mode: WAKEFLOW_MANAGED_SUPPORT_ROOT_MODE,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("effect", `$supportRoot/${relativePath}`);
    }
    throw error;
  }
  if (!scaffoldDirectoryCurrent(result.node, expectedUserId)) {
    fail("root-policy", `$supportRoot/${relativePath}`);
  }
  return Object.freeze({
    relativePath,
    disposition: result.segments.some((entry) => entry.disposition === "created")
      ? ("created" as const)
      : ("existing" as const),
  });
}

/** 零写入检查一个 wakeflow-managed support 根与它的 scaffold 目录。 */
export async function inspectWakeflowManagedSupportRoot(
  workspaceRootValue: RootedDirectory,
  requestValue: WakeflowManagedSupportRootMaterializationRequest,
): Promise<Readonly<WakeflowManagedSupportRootInspection>> {
  assertWorkspaceRoot(workspaceRootValue);
  const request = parseRequest(requestValue);
  if (request.signal?.aborted === true) fail("aborted", "$signal");
  const placement = await placementFor(workspaceRootValue, request);
  const expectedUserId = currentUserId();
  const paths = scaffoldPaths(request);
  let rootStatus: "absent" | "current" | "conflict" = "absent";
  let scaffold: readonly Readonly<WakeflowManagedSupportScaffoldObservation>[] =
    Object.freeze(paths.map((relativePath) => Object.freeze({
      relativePath,
      status: "absent" as const,
    })));
  if (placement.state === "present") {
    const observed = await withSupportRoot(
      workspaceRootValue,
      placement.absolutePath,
      async (supportRoot) => {
        const rootNode = await supportRoot.assertCurrent("$supportRoot");
        const entries = [];
        for (const relativePath of paths) {
          entries.push(await observeScaffold(supportRoot, relativePath, expectedUserId));
        }
        return Object.freeze({
          rootCurrent: scaffoldDirectoryCurrent(rootNode, expectedUserId),
          scaffold: Object.freeze(entries),
        });
      },
    );
    rootStatus = observed.rootCurrent ? "current" : "conflict";
    scaffold = observed.scaffold;
  }
  const status: WakeflowManagedSupportRootInspection["status"] =
    rootStatus === "absent"
      ? "absent"
      : rootStatus === "conflict" || scaffold.some((entry) => entry.status === "conflict")
        ? "conflict"
        : scaffold.some((entry) => entry.status === "absent")
          ? "incomplete"
          : "current";
  const basis = {
    kind: "WakeflowManagedSupportRootInspection" as const,
    status,
    placementState: placement.state,
    surfaceId: request.surfaceId,
    scaffold: scaffold.map((entry) => ({ ...entry })),
  };
  return Object.freeze({
    ...basis,
    scaffold,
    observationDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

/** 物化一个已由 Config/Catalog 摘要绑定的 wakeflow-managed support 根及其 scaffold 目录。 */
export async function materializeWakeflowManagedSupportRoot(
  workspaceRootValue: RootedDirectory,
  requestValue: WakeflowManagedSupportRootMaterializationRequest,
): Promise<Readonly<WakeflowManagedSupportRootMaterializationReceipt>> {
  assertWorkspaceRoot(workspaceRootValue);
  const request = parseRequest(requestValue);
  if (request.signal?.aborted === true) fail("aborted", "$signal");
  const placement = await placementFor(workspaceRootValue, request);
  const key = `support.${request.surfaceId}.root`;
  let materialized;
  try {
    materialized = await materializeAbsoluteDirectoryPlacement(
      placement.absolutePath,
      {
        mode: WAKEFLOW_MANAGED_SUPPORT_ROOT_MODE,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof AbsoluteDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (
        error.reason === "symlink"
        || error.reason === "not-directory"
        || error.reason === "alias"
        || error.reason === "scope"
        || error.reason === "path-changed"
      ) {
        fail("placement", "$root");
      }
      fail("effect", "$root");
    }
    throw error;
  }
  const expectedUserId = currentUserId();
  if (!scaffoldDirectoryCurrent(materialized.node, expectedUserId)) {
    fail("root-policy", "$root");
  }
  const scaffold = await withSupportRoot(
    workspaceRootValue,
    materialized.absolutePath,
    async (supportRoot) => {
      const effects: Readonly<WakeflowManagedSupportScaffoldEffect>[] = [];
      for (const relativePath of scaffoldPaths(request)) {
        effects.push(
          await ensureScaffold(supportRoot, relativePath, expectedUserId, request.signal),
        );
      }
      return Object.freeze(effects);
    },
  );
  let after;
  try {
    after = await validateWakeflowConfigRootPlacements(
      workspaceRootValue,
      request.config,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      fail("placement", error.path);
    }
    throw error;
  }
  const finalPlacement = after.roots.find((entry) => entry.key === key);
  if (
    finalPlacement?.state !== "present"
    || finalPlacement.realPath !== materialized.absolutePath
  ) {
    fail("placement", "$root");
  }
  return Object.freeze({
    kind: "WakeflowManagedSupportRootMaterializationReceipt",
    disposition:
      materialized.segments.some((entry) => entry.disposition === "created")
      || scaffold.some((entry) => entry.disposition === "created")
        ? "created"
        : "existing",
    configDigest: request.configDigest,
    catalogDigest: request.catalogDigest,
    surfaceId: request.surfaceId,
    node: materialized.node,
    scaffold,
  });
}
