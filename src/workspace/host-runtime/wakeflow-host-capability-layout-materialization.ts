import { types } from "node:util";

import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  createDirectoryAtomically,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  parsePortableResourcePath,
  splitPortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import {
  wakeflowHostIdentityRootRef,
  wakeflowHostProjectionsRootRef,
  wakeflowHostRuntimeRootRef,
} from "../workspace-host-runtime-paths.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
} from "../workspace-host-resource-profile.js";
import {
  compileWakeflowHostCapabilityLayoutAuthority,
  WakeflowHostCapabilityLayoutAuthorityError,
  type WakeflowHostCapabilityLayoutAuthority,
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
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Host capability layout materialization input is invalid.",
  authority: "Host capability layout authority is invalid.",
  prerequisite: "Host capability layout prerequisite is unavailable.",
  "strict-absent": "Fresh host capability layout target already exists.",
  "prefix-conflict": "Host capability layout prefix is not exact.",
  "root-scope": "Host capability layout lost workspace scope.",
  aborted: "Host capability layout materialization was aborted.",
  "operation-failure": "Host capability layout materialization failed.",
} as const satisfies Readonly<Record<
  WakeflowHostCapabilityLayoutMaterializationErrorReason,
  string
>>;

/** Host capability layout 物化失败的稳定、脱敏错误。 */
export class WakeflowHostCapabilityLayoutMaterializationError extends Error {
  override readonly name = "WakeflowHostCapabilityLayoutMaterializationError";
  readonly code = "wakeflow-host-capability-layout-materialization" as const;
  readonly reason: WakeflowHostCapabilityLayoutMaterializationErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowHostCapabilityLayoutMaterializationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly recoveringFreshLayout: boolean;
  readonly signal: AbortSignal | undefined;
}

interface DirectoryEffect {
  readonly resourcePath: PortableResourcePath;
  readonly disposition: "created" | "current";
  readonly node: Readonly<FileNodeSnapshot>;
}

type ExpectedChildren = ReadonlyMap<PortableResourcePath, ReadonlySet<string>>;

function fail(
  reason: WakeflowHostCapabilityLayoutMaterializationErrorReason,
  path: string,
): never {
  throw new WakeflowHostCapabilityLayoutMaterializationError(reason, path);
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    !Object.hasOwn(record, "recoveringFreshLayout")
    || Object.keys(record).some((key) => (
      key !== "recoveringFreshLayout" && key !== "signal"
    ))
    || typeof record.recoveringFreshLayout !== "boolean"
    || (
      record.signal !== undefined
      && (
        typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)
      )
    )
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    recoveringFreshLayout: record.recoveringFreshLayout,
    signal: record.signal as AbortSignal | undefined,
  });
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

function assertPrivateDirectory(
  node: Readonly<FileNodeSnapshot>,
  path: string,
): void {
  if (
    node.kind !== "directory"
    || node.permissionBits !== 0o700
    || (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    fail("prefix-conflict", path);
  }
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
  return new Map([...mutable].map(([parent, children]) => (
    [parent, new Set(children)] as const
  )));
}

async function optionalDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    const resource = await root.inspectExistingResource(resourcePath);
    assertPrivateDirectory(resource.node, `$layout/${resourcePath}`);
    return resource.node;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) return null;
    if (error instanceof WakeflowHostCapabilityLayoutMaterializationError) {
      throw error;
    }
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
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
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("prefix-conflict", `$layout/${resourcePath}`);
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
    if (await optionalDirectory(root, parent) === null) {
      if (requireComplete) fail("prefix-conflict", `$layout/${parent}`);
      continue;
    }
    const directory = await readDirectory(
      root,
      parent,
      childNames.size + 1,
      signal,
    );
    if (
      directory.entries.some((entry) => (
        !childNames.has(entry.name)
        || entry.node.kind !== "directory"
        || entry.node.permissionBits !== 0o700
        || (currentUserId() !== null && entry.node.userId !== currentUserId())
      ))
      || (requireComplete && directory.entries.length !== childNames.size)
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
    if (await optionalDirectory(root, resourcePath) !== null) {
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
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("operation-failure", `$layout/${resourcePath}`);
    }
    throw error;
  }
}

/** 按当前 Host Profile 物化空 capability 父目录，或恢复同一 exact 前缀。 */
export async function materializeWakeflowHostCapabilityLayout(
  rootValue: RootedDirectory,
  profileValue: unknown,
  optionsValue: WakeflowHostCapabilityLayoutMaterializationOptions,
): Promise<Readonly<WakeflowHostCapabilityLayoutMaterializationResult>> {
  if (
    typeof rootValue !== "object"
    || rootValue === null
    || types.isProxy(rootValue)
    || !(rootValue instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const options = parseOptions(optionsValue);
  if (options.signal?.aborted === true) fail("aborted", "$signal");
  let profile;
  let authority: Readonly<WakeflowHostCapabilityLayoutAuthority>;
  try {
    profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
    authority = compileWakeflowHostCapabilityLayoutAuthority(profile);
  } catch (error: unknown) {
    if (
      error instanceof WakeflowWorkspaceHostResourceProfileError
      || error instanceof WakeflowHostCapabilityLayoutAuthorityError
    ) {
      fail("authority", error.path);
    }
    throw error;
  }
  const hostRoot = wakeflowHostRuntimeRootRef(profile);
  if (await optionalDirectory(rootValue, hostRoot) === null) {
    fail("prerequisite", "$hostRoot");
  }
  if (
    await optionalDirectory(rootValue, wakeflowHostIdentityRootRef(profile))
      === null
    || await optionalDirectory(
      rootValue,
      wakeflowHostProjectionsRootRef(profile),
    ) === null
  ) {
    fail("prerequisite", "$hostLayout");
  }
  const expected = expectedChildren(authority, hostRoot);
  await inspectPartialTree(rootValue, expected, options.signal, false);
  if (!options.recoveringFreshLayout) {
    await assertTargetsAbsent(rootValue, authority);
  }
  const effects: Readonly<DirectoryEffect>[] = [];
  for (const declaration of authority.declarations) {
    const resourcePath = declaration.placement.relativePath;
    if (resourcePath === null) fail("authority", "$declarations");
    effects.push(await ensureDirectory(
      rootValue,
      resourcePath,
      options.recoveringFreshLayout,
      options.signal,
    ));
  }
  await inspectPartialTree(rootValue, expected, options.signal, true);
  const createdDirectoryCount = effects.filter((entry) => (
    entry.disposition === "created"
  )).length;
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
    observationDigest: computeCanonicalJsonSha256Digest(
      observationBasis as unknown as JsonValue,
    ),
  });
}
