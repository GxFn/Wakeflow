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
  hasDurableAtomicFileStagePrefix,
} from "../../foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  recoverDurableAtomicFileStagesForTargets,
  DurableAtomicFileStageRecoveryError,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  createDirectoryAtomically,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
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
  StableFileReadError,
} from "../../foundation/filesystem/stable-file-read.js";
import {
  readStrictTextFile,
  StrictTextFileError,
} from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  WAKEFLOW_RUNTIME_ROOT_REF,
} from "../maintenance/wakeflow-maintenance-resource-catalog.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
} from "../workspace-host-resource-profile.js";
import {
  WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_REF,
  wakeflowHostIdentityRootRef,
  wakeflowHostProjectionsRootRef,
  wakeflowHostRuntimeRootRef,
} from "../workspace-host-runtime-paths.js";
import {
  compileWakeflowFreshWindowRuntimeAuthority,
  WakeflowFreshWindowRuntimeAuthorityError,
  type WakeflowFreshWindowRuntimeAuthority,
} from "./wakeflow-window-runtime-fresh-authority.js";
import {
  WakeflowWindowRuntimeDesiredTopologyError,
} from "./wakeflow-window-runtime-desired-topology.js";
import {
  wakeflowWindowBindingRootRef,
  wakeflowWindowRuntimeProjectionRootRef,
} from "./wakeflow-window-runtime-paths.js";
import {
  parseWakeflowWindowRuntimeUnregisteredProjectionDocument,
  WakeflowWindowRuntimeUnregisteredProjectionRecordError,
  type WakeflowWindowRuntimeUnregisteredProjectionEntry,
} from "./wakeflow-window-runtime-unregistered-projection.js";

/**
 * Wakeflow Workspace / Window Runtime：Fresh host-local 布局与未注册投影发布。
 *
 * 普通执行要求整个当前宿主 runtime 根严格不存在。affected-step 恢复只接受当前用户
 * `0700` 的精确目录前缀、空 Binding namespace、已发布的 exact projection 文件及其
 * Foundation stage；未知资源、非空 Binding 或字节漂移均保留现场并失败。
 */

export interface WakeflowFreshWindowRuntimePublicationOptions {
  readonly recoveringFreshPublication: boolean;
  readonly signal?: AbortSignal;
}

export interface WakeflowFreshWindowRuntimePublicationResult {
  readonly disposition: "created" | "current";
  readonly authorityDigest: Sha256Digest;
  readonly projectionSetDigest: Sha256Digest;
  readonly createdDirectoryCount: number;
  readonly createdProjectionCount: number;
  readonly observationDigest: Sha256Digest;
}

export type WakeflowFreshWindowRuntimePublicationErrorReason =
  | "input"
  | "authority"
  | "strict-absent"
  | "prefix-conflict"
  | "root-scope"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Fresh Window Runtime publication input is invalid.",
  authority: "Fresh Window Runtime publication authority is invalid.",
  "strict-absent": "Fresh Window Runtime host root already exists.",
  "prefix-conflict": "Fresh Window Runtime recovery prefix is not exact.",
  "root-scope": "Fresh Window Runtime publication lost workspace scope.",
  aborted: "Fresh Window Runtime publication was aborted.",
  "operation-failure": "Fresh Window Runtime publication failed.",
} as const satisfies Readonly<Record<
  WakeflowFreshWindowRuntimePublicationErrorReason,
  string
>>;

/** Fresh Window Runtime 发布失败的稳定、脱敏错误。 */
export class WakeflowFreshWindowRuntimePublicationError extends Error {
  override readonly name = "WakeflowFreshWindowRuntimePublicationError";
  readonly code = "wakeflow-fresh-window-runtime-publication" as const;
  readonly reason: WakeflowFreshWindowRuntimePublicationErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowFreshWindowRuntimePublicationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const MAXIMUM_PROJECTION_BYTES = parseByteCount(512 * 1024);

interface ParsedOptions {
  readonly recoveringFreshPublication: boolean;
  readonly signal: AbortSignal | undefined;
}

interface DirectoryEffect {
  readonly resourcePath: PortableResourcePath;
  readonly disposition: "created" | "current";
  readonly node: Readonly<FileNodeSnapshot>;
}

function fail(
  reason: WakeflowFreshWindowRuntimePublicationErrorReason,
  path: string,
): never {
  throw new WakeflowFreshWindowRuntimePublicationError(reason, path);
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
    !Object.hasOwn(record, "recoveringFreshPublication")
    || Object.keys(record).some((key) => (
      key !== "recoveringFreshPublication" && key !== "signal"
    ))
    || typeof record.recoveringFreshPublication !== "boolean"
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
    recoveringFreshPublication: record.recoveringFreshPublication,
    signal: record.signal as AbortSignal | undefined,
  });
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

function assertPrivateNode(
  node: Readonly<FileNodeSnapshot>,
  kind: "directory" | "file",
  path: string,
): void {
  if (
    node.kind !== kind
    || node.permissionBits !== (kind === "directory" ? 0o700 : 0o600)
    || (kind === "file" && node.linkCount !== 1n)
    || (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    fail("prefix-conflict", path);
  }
}

async function assertRuntimeParent(root: RootedDirectory): Promise<void> {
  try {
    const parent = await root.inspectExistingResource(WAKEFLOW_RUNTIME_ROOT_REF);
    assertPrivateNode(parent.node, "directory", "$runtimeRoot");
  } catch (error: unknown) {
    if (error instanceof WakeflowFreshWindowRuntimePublicationError) throw error;
    if (error instanceof RootedDirectoryError) fail("root-scope", "$runtimeRoot");
    throw error;
  }
}

async function ensureDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  recovering: boolean,
  signal: AbortSignal | undefined,
): Promise<Readonly<DirectoryEffect>> {
  try {
    const existing = await root.inspectExistingResource(resourcePath);
    assertPrivateNode(existing.node, "directory", `$layout/${resourcePath}`);
    if (!recovering) fail("strict-absent", `$layout/${resourcePath}`);
    return Object.freeze({
      resourcePath,
      disposition: "current" as const,
      node: existing.node,
    });
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      try {
        const created = await createDirectoryAtomically(root, resourcePath, {
          mode: 0o700,
          ...(signal === undefined ? {} : { signal }),
        });
        assertPrivateNode(
          created.node,
          "directory",
          `$layout/${resourcePath}`,
        );
        return Object.freeze({
          resourcePath,
          disposition: "created" as const,
          node: created.node,
        });
      } catch (createError: unknown) {
        if (createError instanceof DurableDirectoryMaterializationError) {
          if (createError.reason === "aborted") fail("aborted", "$signal");
          fail("operation-failure", `$layout/${resourcePath}`);
        }
        throw createError;
      }
    }
    if (error instanceof WakeflowFreshWindowRuntimePublicationError) throw error;
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

async function readPrivateDirectory(
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
    assertPrivateNode(read.directoryNode, "directory", `$inventory/${resourcePath}`);
    return read;
  } catch (error: unknown) {
    if (error instanceof WakeflowFreshWindowRuntimePublicationError) throw error;
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("prefix-conflict", `$inventory/${resourcePath}`);
    }
    throw error;
  }
}

async function assertBindingsEmpty(
  root: RootedDirectory,
  bindingRoot: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<Readonly<FileNodeSnapshot>> {
  const read = await readPrivateDirectory(root, bindingRoot, 1, signal);
  if (read.entries.length !== 0) fail("prefix-conflict", "$bindingInventory");
  return read.directoryNode;
}

async function assertExactDirectoryChildren(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expectedNames: readonly string[],
  signal: AbortSignal | undefined,
): Promise<void> {
  const read = await readPrivateDirectory(
    root,
    resourcePath,
    expectedNames.length + 1,
    signal,
  );
  const expected = new Set(expectedNames);
  if (
    read.entries.length !== expected.size
    || read.entries.some((entry) => !expected.has(entry.name))
  ) {
    fail("prefix-conflict", `$layout/${resourcePath}`);
  }
}

function expectedFileName(
  entry: Readonly<WakeflowWindowRuntimeUnregisteredProjectionEntry>,
): string {
  return splitPortableResourcePath(entry.resourceRef).at(-1) ?? "";
}

async function recoverProjectionStages(
  root: RootedDirectory,
  authority: Readonly<WakeflowFreshWindowRuntimeAuthority>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const receipt = await recoverDurableAtomicFileStagesForTargets(
      root,
      authority.projectionSet.entries.map((entry) => entry.resourceRef),
      signal === undefined ? undefined : { signal },
    );
    if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0) {
      fail("prefix-conflict", "$projectionStages");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowFreshWindowRuntimePublicationError) throw error;
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("prefix-conflict", "$projectionStages");
    }
    throw error;
  }
}

async function assertProjectionNamespaceNames(
  root: RootedDirectory,
  authority: Readonly<WakeflowFreshWindowRuntimeAuthority>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const expected = new Set(authority.projectionSet.entries.map(expectedFileName));
  const inventory = await readPrivateDirectory(
    root,
    authority.projectionSet.projectionRootRef,
    (expected.size * 2) + 1,
    signal,
  );
  if (inventory.entries.some((entry) => (
    !expected.has(entry.name)
    && !hasDurableAtomicFileStagePrefix(entry.name)
  ))) {
    fail("prefix-conflict", "$projectionInventory");
  }
}

async function inspectProjectionInventory(
  root: RootedDirectory,
  authority: Readonly<WakeflowFreshWindowRuntimeAuthority>,
  signal: AbortSignal | undefined,
) {
  const expected = new Map(authority.projectionSet.entries.map((entry) => (
    [expectedFileName(entry), entry] as const
  )));
  if (expected.has("")) fail("authority", "$projectionSet");
  const read = await readPrivateDirectory(
    root,
    authority.projectionSet.projectionRootRef,
    expected.size + 1,
    signal,
  );
  const current = new Map<string, Sha256Digest>();
  for (const directoryEntry of read.entries) {
    const entry = expected.get(directoryEntry.name);
    if (entry === undefined) fail("prefix-conflict", "$projectionInventory");
    assertPrivateNode(
      directoryEntry.node,
      "file",
      `$projectionInventory/${directoryEntry.name}`,
    );
    let source;
    try {
      source = await readStrictTextFile(root, entry.resourceRef, {
        maximumBytes: MAXIMUM_PROJECTION_BYTES,
        expectedNode: directoryEntry.node,
        ...(signal === undefined ? {} : { signal }),
      });
      parseWakeflowWindowRuntimeUnregisteredProjectionDocument(source.text);
    } catch (error: unknown) {
      if (error instanceof WakeflowWindowRuntimeUnregisteredProjectionRecordError) {
        fail("prefix-conflict", `$projectionInventory/${directoryEntry.name}`);
      }
      if (error instanceof StrictTextFileError) {
        fail("prefix-conflict", `$projectionInventory/${directoryEntry.name}`);
      }
      if (error instanceof StableFileReadError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        if (error.reason === "root-scope") fail("root-scope", "$root");
        fail("prefix-conflict", `$projectionInventory/${directoryEntry.name}`);
      }
      throw error;
    }
    if (source.text !== entry.document || source.digest !== entry.documentDigest) {
      fail("prefix-conflict", `$projectionInventory/${directoryEntry.name}`);
    }
    current.set(directoryEntry.name, source.digest);
  }
  return Object.freeze({ read, current });
}

async function createMissingProjections(
  root: RootedDirectory,
  authority: Readonly<WakeflowFreshWindowRuntimeAuthority>,
  current: ReadonlyMap<string, Sha256Digest>,
  signal: AbortSignal | undefined,
): Promise<number> {
  let created = 0;
  for (const entry of authority.projectionSet.entries) {
    if (current.has(expectedFileName(entry))) continue;
    try {
      await createFileAtomically(
        root,
        entry.resourceRef,
        encodeUtf8(entry.document, "$projection"),
        {
          mode: 0o600,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      created += 1;
    } catch (error: unknown) {
      if (error instanceof DurableAtomicFileWriteError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        fail("operation-failure", "$projectionWrite");
      }
      throw error;
    }
  }
  return created;
}

/** 独占发布 Fresh host-local Window Runtime，或恢复同一 exact 未注册集合。 */
export async function publishFreshWakeflowWindowRuntime(
  rootValue: RootedDirectory,
  configValue: unknown,
  profileValue: unknown,
  optionsValue: WakeflowFreshWindowRuntimePublicationOptions,
): Promise<Readonly<WakeflowFreshWindowRuntimePublicationResult>> {
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
  let authority: Readonly<WakeflowFreshWindowRuntimeAuthority>;
  try {
    authority = compileWakeflowFreshWindowRuntimeAuthority(
      configValue,
      profileValue,
    );
  } catch (error: unknown) {
    if (
      error instanceof WakeflowFreshWindowRuntimeAuthorityError
      || error instanceof WakeflowWindowRuntimeDesiredTopologyError
      || error instanceof WakeflowWorkspaceHostResourceProfileError
      || error instanceof WakeflowWindowRuntimeUnregisteredProjectionRecordError
    ) {
      fail("authority", error.path);
    }
    throw error;
  }
  const profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
  await assertRuntimeParent(rootValue);
  const directoryPaths = [
    WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_REF,
    wakeflowHostRuntimeRootRef(profile),
    wakeflowHostIdentityRootRef(profile),
    wakeflowHostProjectionsRootRef(profile),
    wakeflowWindowBindingRootRef(profile),
    wakeflowWindowRuntimeProjectionRootRef(profile),
  ];
  const directoryEffects: Readonly<DirectoryEffect>[] = [];
  for (const resourcePath of directoryPaths) {
    directoryEffects.push(await ensureDirectory(
      rootValue,
      resourcePath,
      options.recoveringFreshPublication,
      options.signal,
    ));
  }
  const declaredLayoutPaths = authority.layoutDeclarations.map((entry) => (
    entry.placement.relativePath
  ));
  if (
    declaredLayoutPaths.length !== directoryPaths.length
    || declaredLayoutPaths.some((resourcePath, index) => (
      resourcePath !== directoryPaths[index]
    ))
  ) {
    fail("authority", "$layoutDeclarations");
  }
  await assertExactDirectoryChildren(
    rootValue,
    WAKEFLOW_HOST_RUNTIME_PROFILES_ROOT_REF,
    [profile.runtimeDirectoryName],
    options.signal,
  );
  await assertExactDirectoryChildren(
    rootValue,
    wakeflowHostRuntimeRootRef(profile),
    ["identity", "projections"],
    options.signal,
  );
  await assertExactDirectoryChildren(
    rootValue,
    wakeflowHostIdentityRootRef(profile),
    ["window-bindings"],
    options.signal,
  );
  await assertExactDirectoryChildren(
    rootValue,
    wakeflowHostProjectionsRootRef(profile),
    ["window-runtime"],
    options.signal,
  );
  const bindingNode = await assertBindingsEmpty(
    rootValue,
    wakeflowWindowBindingRootRef(profile),
    options.signal,
  );
  await assertProjectionNamespaceNames(rootValue, authority, options.signal);
  await recoverProjectionStages(rootValue, authority, options.signal);
  const before = await inspectProjectionInventory(
    rootValue,
    authority,
    options.signal,
  );
  const createdProjectionCount = await createMissingProjections(
    rootValue,
    authority,
    before.current,
    options.signal,
  );
  const after = await inspectProjectionInventory(
    rootValue,
    authority,
    options.signal,
  );
  if (
    after.current.size !== authority.projectionSet.entries.length
  ) {
    fail("operation-failure", "$projectionReadback");
  }
  await assertBindingsEmpty(
    rootValue,
    wakeflowWindowBindingRootRef(profile),
    options.signal,
  );
  const createdDirectoryCount = directoryEffects.filter((entry) => (
    entry.disposition === "created"
  )).length;
  const observationBasis = {
    kind: "WakeflowFreshWindowRuntimePublicationObservation",
    authorityDigest: authority.authorityDigest,
    bindingRoot: {
      deviceId: bindingNode.deviceId.toString(),
      inodeId: bindingNode.inodeId.toString(),
    },
    directories: directoryEffects.map((entry) => ({
      resourcePath: entry.resourcePath,
      deviceId: entry.node.deviceId.toString(),
      inodeId: entry.node.inodeId.toString(),
    })),
    projections: authority.projectionSet.entries.map((entry) => ({
      windowId: entry.windowId,
      documentDigest: after.current.get(expectedFileName(entry)) ?? null,
    })),
  };
  return Object.freeze({
    disposition:
      createdDirectoryCount === 0 && createdProjectionCount === 0
        ? "current"
        : "created",
    authorityDigest: authority.authorityDigest,
    projectionSetDigest: authority.projectionSet.projectionSetDigest,
    createdDirectoryCount,
    createdProjectionCount,
    observationDigest: computeCanonicalJsonSha256Digest(
      observationBasis as unknown as JsonValue,
    ),
  });
}
