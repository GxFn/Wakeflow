import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
} from "../../foundation/data/deterministic-json-document.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  replaceFileAtomically,
  DurableAtomicFileWriteError,
  type DurableAtomicFileExpectation,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  recoverDurableAtomicFileStagesForTargets,
  DurableAtomicFileStageRecoveryError,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { WakeflowWindowHostBinding } from "./wakeflow-window-host-binding.js";
import type {
  WakeflowWindowHostBindingRegistrationAuthority,
} from "./wakeflow-window-host-binding-registration-authority.js";
import {
  compileWakeflowWindowRuntimeRegisteredProjectionEntry,
  parseWakeflowWindowRuntimeRegisteredProjectionDocument,
  WakeflowWindowRuntimeRegisteredProjectionError,
  type WakeflowWindowRuntimeRegisteredProjectionEntry,
} from "./wakeflow-window-runtime-registered-projection.js";

/**
 * Wakeflow Workspace / Window Runtime：registered projection 的独立派生发布边界。
 *
 * Binding authority 必须先已存在。本模块只接受 missing、当前 unregistered 文档或与
 * 当前 Binding 完全一致的 registered 文档；其他内容不被覆盖。失败不会回滚 Binding，
 * 调用方必须把它报告为 projection recovery required。
 */

export type WakeflowWindowRuntimeRegisteredProjectionPublicationErrorReason =
  | "conflict"
  | "recovery-required"
  | "aborted";

const ERROR_MESSAGES = {
  conflict: "Window Runtime projection is not an admitted source.",
  "recovery-required": "Window Runtime registered projection requires recovery.",
  aborted: "Window Runtime registered projection publication was aborted.",
} as const satisfies Readonly<Record<
  WakeflowWindowRuntimeRegisteredProjectionPublicationErrorReason,
  string
>>;

/** Registered projection 持久化失败的稳定、脱敏错误。 */
export class WakeflowWindowRuntimeRegisteredProjectionPublicationError
  extends Error {
  override readonly name =
    "WakeflowWindowRuntimeRegisteredProjectionPublicationError";
  readonly code =
    "wakeflow-window-runtime-registered-projection-publication" as const;
  readonly reason: WakeflowWindowRuntimeRegisteredProjectionPublicationErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWindowRuntimeRegisteredProjectionPublicationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const MAXIMUM_PROJECTION_BYTES = parseByteCount(512 * 1024);

function fail(
  reason: WakeflowWindowRuntimeRegisteredProjectionPublicationErrorReason,
  path: string,
): never {
  throw new WakeflowWindowRuntimeRegisteredProjectionPublicationError(
    reason,
    path,
  );
}

function privateFile(node: Readonly<FileNodeSnapshot>): void {
  const currentUserId = typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
  if (
    node.kind !== "file"
    || node.permissionBits !== 0o600
    || node.linkCount !== 1n
    || (currentUserId !== null && node.userId !== currentUserId)
  ) {
    fail("conflict", "$projection");
  }
}

function expectation(read: Readonly<{
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: DurableAtomicFileExpectation["byteCount"];
  readonly digest: Sha256Digest;
}>): Readonly<DurableAtomicFileExpectation> {
  return Object.freeze({
    resourcePath: read.resourcePath,
    node: read.node,
    byteCount: read.byteCount,
    digest: read.digest,
  });
}

async function recoverTargetStage(
  root: RootedDirectory,
  target: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const recovery = await recoverDurableAtomicFileStagesForTargets(
      root,
      [target],
      signal === undefined ? undefined : { signal },
    );
    if (recovery.activeStageCount !== 0 || recovery.unknownStageCount !== 0) {
      fail("recovery-required", "$projectionStage");
    }
  } catch (error: unknown) {
    if (
      error instanceof WakeflowWindowRuntimeRegisteredProjectionPublicationError
    ) {
      throw error;
    }
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$projectionStage");
    }
    throw error;
  }
}

async function readSourceOrNull(
  root: RootedDirectory,
  resourceRef: PortableResourcePath,
  signal: AbortSignal | undefined,
) {
  try {
    const read = await readDeterministicJsonFile(root, resourceRef, {
      maximumBytes: MAXIMUM_PROJECTION_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
    privateFile(read.node);
    return read;
  } catch (error: unknown) {
    if (
      error instanceof StableFileReadError
      && error.reason === "not-found"
    ) {
      return null;
    }
    if (error instanceof StableFileReadError && error.reason === "aborted") {
      fail("aborted", "$signal");
    }
    if (
      error instanceof StableFileReadError
      || error instanceof StrictTextFileError
      || error instanceof DeterministicJsonDocumentError
    ) {
      fail("conflict", "$projection");
    }
    throw error;
  }
}

/** 从当前 Binding authority 幂等创建或替换对应 registered projection。 */
export async function publishWakeflowWindowRuntimeRegisteredProjection(
  root: RootedDirectory,
  authority: Readonly<WakeflowWindowHostBindingRegistrationAuthority>,
  binding: Readonly<WakeflowWindowHostBinding>,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowWindowRuntimeRegisteredProjectionEntry>> {
  let target: Readonly<WakeflowWindowRuntimeRegisteredProjectionEntry>;
  try {
    target = compileWakeflowWindowRuntimeRegisteredProjectionEntry(
      authority.resourceProfile,
      authority.unregisteredProjection.projection,
      binding,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowRuntimeRegisteredProjectionError) {
      fail("recovery-required", "$projection");
    }
    throw error;
  }
  await recoverTargetStage(root, target.resourceRef, signal);
  const source = await readSourceOrNull(root, target.resourceRef, signal);
  if (source?.text === target.document) {
    try {
      parseWakeflowWindowRuntimeRegisteredProjectionDocument(
        source.text,
        authority.resourceProfile,
        authority.unregisteredProjection.projection,
        binding,
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowWindowRuntimeRegisteredProjectionError) {
        fail("conflict", "$projection");
      }
      throw error;
    }
    return target;
  }
  if (
    source !== null
    && source.text !== authority.unregisteredProjection.document
  ) {
    fail("conflict", "$projection");
  }
  const bytes = encodeUtf8(target.document, "$projection");
  try {
    if (source === null) {
      await createFileAtomically(root, target.resourceRef, bytes, {
        mode: 0o600,
        ...(signal === undefined ? {} : { signal }),
      });
    } else {
      await replaceFileAtomically(root, target.resourceRef, bytes, {
        mode: 0o600,
        expected: expectation(source),
        ...(signal === undefined ? {} : { signal }),
      });
    }
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$projection");
    }
    throw error;
  }
  return target;
}
