import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import {
  createDirectoryAtomically,
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
  splitPortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { isPrivateDirectory } from "../../foundation/filesystem/private-node-policy.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import {
  wakeflowHostIdentityRootRef,
  wakeflowHostProjectionsRootRef,
  wakeflowHostRuntimeRootRef,
} from "../workspace-host-runtime-paths.js";
import {
  compileWakeflowHostCapabilityLayoutAuthority,
  type WakeflowHostCapabilityLayoutAuthority,
  WakeflowHostCapabilityLayoutAuthorityError,
} from "./wakeflow-host-capability-layout-authority.js";

/**
 * Wakeflow Workspace / Host Runtime：Profile capability 空父目录的 Fresh 物化。
 *
 * Window Runtime 已建立当前宿主 root/identity/projections 后，本 owner 只创建 Profile
 * 适用的 evidence/operations 子树。普通执行要求全部目标 absent；恢复接受 exact 0700
 * 空前缀并补齐缺失目录。任何文件、未知目录或权限漂移都保留现场并失败。
 */

export interface WakeflowHostCapabilityLayoutMaterializationOptions {
  readonly recoveringFreshLayout: boolean;
  readonly signal?: AbortSignal;
}

export interface WakeflowHostCapabilityLayoutMaterializationResult {
  readonly disposition: "created" | "current";
  readonly authorityDigest: Sha256Digest;
  readonly createdDirectoryCount: number;
  readonly observationDigest: Sha256Digest;
}

export type WakeflowHostCapabilityLayoutMaterializationErrorReason =
  | "input"
  | "authority"
  | "prerequisite"
  | "strict-absent"
  | "prefix-conflict"
  | "root-scope"
  | "operation-failure";

/** Host capability layout 物化失败的稳定、脱敏错误。 */
export class WakeflowHostCapabilityLayoutMaterializationError extends ModuleError<WakeflowHostCapabilityLayoutMaterializationErrorReason> {
  static override readonly code = "wakeflow-host-capability-layout-materialization";
}

const fail: Fail<WakeflowHostCapabilityLayoutMaterializationErrorReason> = failWith(
  WakeflowHostCapabilityLayoutMaterializationError,
);

interface DirectoryEffect {
  readonly resourcePath: PortableResourcePath;
  readonly disposition: "created" | "current";
  readonly node: Readonly<FileNodeSnapshot>;
}

type ExpectedChildren = ReadonlyMap<PortableResourcePath, ReadonlySet<string>>;

function assertPrivateDirectory(node: Readonly<FileNodeSnapshot>, path: string): void {
  if (!isPrivateDirectory(node)) fail("prefix-conflict", path);
}

function resourceParent(resourcePath: PortableResourcePath): PortableResourcePath {
  const segments = splitPortableResourcePath(resourcePath);
  if (segments.length < 2) fail("authority", "$declarations");
  return parsePortableResourcePath(segments.slice(0, -1).join("/"));
}

function resourceName(resourcePath: PortableResourcePath): string {
  return splitPortableResourcePath(resourcePath).at(-1) ?? "";
}

function expectedChildren(
  authority: Readonly<WakeflowHostCapabilityLayoutAuthority>,
  hostRoot: PortableResourcePath,
): ExpectedChildren {
  const mutable = new Map<PortableResourcePath, Set<string>>();
  mutable.set(hostRoot, new Set(["identity", "projections"]));
  for (const declaration of authority.declarations) {
    const resourcePath = declaration.placement.relativePath;
    if (resourcePath === null) fail("authority", "$declarations");
    const parent = resourceParent(resourcePath);
    const name = resourceName(resourcePath);
    if (name.length === 0) fail("authority", "$declarations");
    const children = mutable.get(parent) ?? new Set<string>();
    children.add(name);
    mutable.set(parent, children);
    if (!mutable.has(resourcePath)) mutable.set(resourcePath, new Set());
  }
  return new Map([...mutable].map(([parent, children]) => [parent, new Set(children)] as const));
}

async function optionalDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    const resource = await root.inspectResourceOrNull(resourcePath);
    if (resource === null) return null;
    assertPrivateDirectory(resource.node, `$layout/${resourcePath}`);
    return resource.node;
  } catch (error: unknown) {
    if (error instanceof WakeflowHostCapabilityLayoutMaterializationError) {
      throw error;
    }
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root", error);
    throw error;
  }
}

async function readDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  maximumEntries: number,
  signal: AbortSignal | undefined,
) {
  try {
    const read = await readStableResourceDirectory(root, resourcePath, {
      maximumEntries,
      ...(signal === undefined ? {} : { signal }),
    });
    assertPrivateDirectory(read.directoryNode, `$layout/${resourcePath}`);
    return read;
  } catch (error: unknown) {
    if (error instanceof WakeflowHostCapabilityLayoutMaterializationError) {
      throw error;
    }
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "root-scope") fail("root-scope", "$root", error);
      fail("prefix-conflict", `$layout/${resourcePath}`, error);
    }
    throw error;
  }
}

async function inspectPartialTree(
  root: RootedDirectory,
  expected: ExpectedChildren,
  signal: AbortSignal | undefined,
  requireComplete: boolean,
): Promise<void> {
  for (const [parent, childNames] of expected) {
    if ((await optionalDirectory(root, parent)) === null) {
      if (requireComplete) fail("prefix-conflict", `$layout/${parent}`);
      continue;
    }
    const directory = await readDirectory(root, parent, childNames.size + 1, signal);
    if (
      directory.entries.some(
        (entry) => !childNames.has(entry.name) || !isPrivateDirectory(entry.node),
      ) ||
      (requireComplete && directory.entries.length !== childNames.size)
    ) {
      fail("prefix-conflict", `$layout/${parent}`);
    }
  }
}

async function assertTargetsAbsent(
  root: RootedDirectory,
  authority: Readonly<WakeflowHostCapabilityLayoutAuthority>,
): Promise<void> {
  for (const declaration of authority.declarations) {
    const resourcePath = declaration.placement.relativePath;
    if (resourcePath === null) fail("authority", "$declarations");
    if ((await optionalDirectory(root, resourcePath)) !== null) {
      fail("strict-absent", `$layout/${resourcePath}`);
    }
  }
}

async function ensureDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  recovering: boolean,
  signal: AbortSignal | undefined,
): Promise<Readonly<DirectoryEffect>> {
  const existing = await optionalDirectory(root, resourcePath);
  if (existing !== null) {
    if (!recovering) fail("strict-absent", `$layout/${resourcePath}`);
    return Object.freeze({
      resourcePath,
      disposition: "current" as const,
      node: existing,
    });
  }
  try {
    const created = await createDirectoryAtomically(root, resourcePath, {
      mode: 0o700,
      ...(signal === undefined ? {} : { signal }),
    });
    assertPrivateDirectory(created.node, `$layout/${resourcePath}`);
    return Object.freeze({
      resourcePath,
      disposition: "created" as const,
      node: created.node,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowHostCapabilityLayoutMaterializationError) {
      throw error;
    }
    if (error instanceof DurableDirectoryMaterializationError) {
      fail("operation-failure", `$layout/${resourcePath}`, error);
    }
    throw error;
  }
}

export interface WakeflowHostCapabilityLayoutInspection {
  readonly kind: "WakeflowHostCapabilityLayoutInspection";
  /**
   * `prerequisite-missing`：宿主 root/identity/projections 尚不存在（窗口运行时未发布）；
   * `incomplete`：缺少 capability 目录，可以 ensure 补齐；`conflict`：某个声明位置不是
   * 当前用户的 0700 目录，只报告。运行中的工作区里这些目录装着租约、回执与定位器，
   * 所以检查与 ensure 都只看声明的目录本身，不枚举内容。
   */
  readonly status: "current" | "incomplete" | "prerequisite-missing" | "conflict";
  readonly authorityDigest: Sha256Digest;
  readonly missingDirectoryCount: number;
  readonly observationDigest: Sha256Digest;
}

function compileAuthority(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): Readonly<WakeflowHostCapabilityLayoutAuthority> {
  try {
    return compileWakeflowHostCapabilityLayoutAuthority(profile);
  } catch (error: unknown) {
    if (error instanceof WakeflowHostCapabilityLayoutAuthorityError) {
      fail("authority", error.path, error);
    }
    throw error;
  }
}

function layoutResult(
  authority: Readonly<WakeflowHostCapabilityLayoutAuthority>,
  effects: readonly Readonly<DirectoryEffect>[],
): Readonly<WakeflowHostCapabilityLayoutMaterializationResult> {
  const createdDirectoryCount = effects.filter((entry) => entry.disposition === "created").length;
  const observationBasis = {
    kind: "WakeflowHostCapabilityLayoutObservation",
    authorityDigest: authority.authorityDigest,
    directories: effects.map((entry) => ({
      resourcePath: entry.resourcePath,
      deviceId: entry.node.deviceId.toString(),
      inodeId: entry.node.inodeId.toString(),
    })),
  };
  return Object.freeze({
    disposition: createdDirectoryCount === 0 ? "current" : "created",
    authorityDigest: authority.authorityDigest,
    createdDirectoryCount,
    observationDigest: computeCanonicalJsonSha256Digest(observationBasis as unknown as JsonValue),
  });
}

async function prerequisitesPresent(
  root: RootedDirectory,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): Promise<boolean> {
  return (
    (await optionalDirectory(root, wakeflowHostRuntimeRootRef(profile))) !== null &&
    (await optionalDirectory(root, wakeflowHostIdentityRootRef(profile))) !== null &&
    (await optionalDirectory(root, wakeflowHostProjectionsRootRef(profile))) !== null
  );
}

function declarationPath(
  declaration: Readonly<WakeflowHostCapabilityLayoutAuthority>["declarations"][number],
): PortableResourcePath {
  const resourcePath = declaration.placement.relativePath;
  if (resourcePath === null) fail("authority", "$declarations");
  return resourcePath;
}

/** 零写入检查当前 Host Profile 的 capability 目录是否齐全且各自是当前用户的 0700 目录。 */
export async function inspectWakeflowHostCapabilityLayout(
  root: RootedDirectory,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  { signal }: Readonly<{ readonly signal?: AbortSignal }> = {},
): Promise<Readonly<WakeflowHostCapabilityLayoutInspection>> {
  throwIfAborted(signal);
  const authority = compileAuthority(profile);
  let status: WakeflowHostCapabilityLayoutInspection["status"] = "current";
  let missingDirectoryCount = 0;
  try {
    if (!(await prerequisitesPresent(root, profile))) {
      status = "prerequisite-missing";
    } else {
      for (const declaration of authority.declarations) {
        if ((await optionalDirectory(root, declarationPath(declaration))) === null) {
          missingDirectoryCount += 1;
        }
      }
      if (missingDirectoryCount > 0) status = "incomplete";
    }
  } catch (error: unknown) {
    if (
      error instanceof WakeflowHostCapabilityLayoutMaterializationError &&
      error.reason === "prefix-conflict"
    ) {
      status = "conflict";
    } else {
      throw error;
    }
  }
  const basis = {
    kind: "WakeflowHostCapabilityLayoutInspection" as const,
    status,
    authorityDigest: authority.authorityDigest,
    missingDirectoryCount,
  };
  return Object.freeze({
    ...basis,
    observationDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

/**
 * 在已发布窗口运行时的工作区里补齐缺失的 capability 目录（reconcile/reconfigure 修复）。
 * 已有目录只核对节点政策、不枚举内容；缺失的中间段与目标以 0700 创建。
 */
export async function ensureWakeflowHostCapabilityLayout(
  root: RootedDirectory,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  { signal }: Readonly<{ readonly signal?: AbortSignal }> = {},
): Promise<Readonly<WakeflowHostCapabilityLayoutMaterializationResult>> {
  throwIfAborted(signal);
  const authority = compileAuthority(profile);
  if (!(await prerequisitesPresent(root, profile))) {
    fail("prerequisite", "$hostLayout");
  }
  const effects: Readonly<DirectoryEffect>[] = [];
  for (const declaration of authority.declarations) {
    const resourcePath = declarationPath(declaration);
    const existing = await optionalDirectory(root, resourcePath);
    if (existing !== null) {
      effects.push(
        Object.freeze({ resourcePath, disposition: "current" as const, node: existing }),
      );
      continue;
    }
    let materialized: Awaited<ReturnType<typeof materializeDirectoryPath>>;
    try {
      materialized = await materializeDirectoryPath(root, resourcePath, {
        mode: 0o700,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error: unknown) {
      if (error instanceof DurableDirectoryMaterializationError) {
        fail("operation-failure", `$layout/${resourcePath}`, error);
      }
      throw error;
    }
    for (const segment of materialized.segments) {
      assertPrivateDirectory(segment.node, `$layout/${segment.resourcePath}`);
    }
    effects.push(
      Object.freeze({
        resourcePath,
        disposition: "created" as const,
        node: materialized.node,
      }),
    );
  }
  return layoutResult(authority, effects);
}

/** 按当前 Host Profile 物化空 capability 父目录，或恢复同一 exact 前缀。 */
export async function materializeWakeflowHostCapabilityLayout(
  root: RootedDirectory,
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  { recoveringFreshLayout, signal }: WakeflowHostCapabilityLayoutMaterializationOptions,
): Promise<Readonly<WakeflowHostCapabilityLayoutMaterializationResult>> {
  throwIfAborted(signal);
  const authority = compileAuthority(profile);
  const hostRoot = wakeflowHostRuntimeRootRef(profile);
  if ((await optionalDirectory(root, hostRoot)) === null) {
    fail("prerequisite", "$hostRoot");
  }
  if (
    (await optionalDirectory(root, wakeflowHostIdentityRootRef(profile))) === null ||
    (await optionalDirectory(root, wakeflowHostProjectionsRootRef(profile))) === null
  ) {
    fail("prerequisite", "$hostLayout");
  }
  const expected = expectedChildren(authority, hostRoot);
  await inspectPartialTree(root, expected, signal, false);
  if (!recoveringFreshLayout) {
    await assertTargetsAbsent(root, authority);
  }
  const effects: Readonly<DirectoryEffect>[] = [];
  for (const declaration of authority.declarations) {
    const resourcePath = declaration.placement.relativePath;
    if (resourcePath === null) fail("authority", "$declarations");
    effects.push(await ensureDirectory(root, resourcePath, recoveringFreshLayout, signal));
  }
  await inspectPartialTree(root, expected, signal, true);
  return layoutResult(authority, effects);
}
