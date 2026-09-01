import { types } from "node:util";

import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  readDeterministicJsonFile,
  type DeterministicJsonFileResult,
} from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import {
  createWindowWorkClaimResourceDeclaration,
  WINDOW_WORK_CLAIMS_ROOT_REF,
  windowWorkClaimRef,
} from "./window-work-claim-resource-catalog.js";
import {
  parseWindowWorkClaim,
  parseWindowWorkClaimDocument,
  renderWindowWorkClaim,
  WindowWorkClaimError,
  type WindowWorkClaim,
} from "./window-work-claim.js";

/**
 * Wakeflow Governance / Delivery：WindowWorkClaim 的根作用域物理 Store。
 *
 * Claim 创建使用逐窗口路径的 durable exclusive create，不需要全局进程锁；同字节重放
 * 幂等，不同 Claim 明确为 occupied。释放只删除同一严格文档和同一文件节点，并允许另一个
 * 已授权 Claim 在删除后立即取得相同路径名。本 Store 不判断何时允许 Claim 或释放。
 */

export const WINDOW_WORK_CLAIM_DIRECTORY_MODE = 0o700;
export const WINDOW_WORK_CLAIM_FILE_MODE = 0o600;
const MAXIMUM_CLAIM_BYTES = parseByteCount(256 * 1024);

/** 同一进程内按目标路径串行短生命周期 mutation；不保存业务权威。 */
class WindowWorkClaimMutationQueue {
  readonly #tails = new Map<string, Promise<void>>();

  async run<Result>(
    key: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const predecessor = this.#tails.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.catch(() => undefined).then(() => gate);
    this.#tails.set(key, tail);
    await predecessor.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

const MUTATION_QUEUE = new WindowWorkClaimMutationQueue();

export interface InspectWindowWorkClaimResult {
  readonly status: "absent" | "claimed";
  readonly claim?: Readonly<WindowWorkClaim>;
  readonly source?: Readonly<DeterministicJsonFileResult>;
}

export interface CreateWindowWorkClaimResult {
  readonly disposition: "created" | "current";
  readonly claim: Readonly<WindowWorkClaim>;
  readonly source: Readonly<DeterministicJsonFileResult>;
}

export interface ReleaseWindowWorkClaimResult {
  readonly disposition: "released";
  readonly claim: Readonly<WindowWorkClaim>;
  readonly replacementObserved: boolean;
}

export interface WindowWorkClaimStoreOptions {
  readonly signal?: AbortSignal;
}

export type WindowWorkClaimStoreAuthority = "unchanged" | "current" | "unknown";

export type WindowWorkClaimStoreErrorReason =
  | "input"
  | "layout"
  | "claim"
  | "occupied"
  | "expectation-mismatch"
  | "not-found"
  | "capacity"
  | "recovery-required"
  | "aborted"
  | "write"
  | "release";

const ERROR_MESSAGES = {
  input: "Window Work Claim Store input is invalid.",
  layout: "Window Work Claim Store private layout is unavailable or unsafe.",
  claim: "Window Work Claim Store contains an invalid Claim.",
  occupied: "Window already has a different current Work Claim.",
  "expectation-mismatch":
    "Current Window Work Claim differs from the expected Claim.",
  "not-found":
    "Window Work Claim does not exist and its release cannot be proven.",
  capacity: "Window Work Claim exceeds its capacity.",
  "recovery-required": "Window Work Claim Store requires explicit recovery.",
  aborted: "Window Work Claim Store operation was aborted.",
  write: "Window Work Claim publication failed.",
  release: "Window Work Claim release failed or became uncertain.",
} as const satisfies Readonly<Record<WindowWorkClaimStoreErrorReason, string>>;

/** Claim Store 失败时保留稳定分类与当前 Claim 权威状态。 */
export class WindowWorkClaimStoreError extends Error {
  override readonly name = "WindowWorkClaimStoreError";
  readonly code = "wakeflow-window-work-claim-store" as const;
  readonly reason: WindowWorkClaimStoreErrorReason;
  readonly path: string;
  readonly claimAuthority: WindowWorkClaimStoreAuthority;

  constructor(
    reason: WindowWorkClaimStoreErrorReason,
    path: string,
    claimAuthority: WindowWorkClaimStoreAuthority = "unchanged",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
    this.claimAuthority = claimAuthority;
  }
}

function fail(
  reason: WindowWorkClaimStoreErrorReason,
  path: string,
  claimAuthority: WindowWorkClaimStoreAuthority = "unchanged",
): never {
  throw new WindowWorkClaimStoreError(reason, path, claimAuthority);
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function assertNode(
  node: Readonly<FileNodeSnapshot>,
  kind: "directory" | "file",
  path: string,
): void {
  if (
    node.kind !== kind ||
    node.permissionBits !==
      (kind === "directory"
        ? WINDOW_WORK_CLAIM_DIRECTORY_MODE
        : WINDOW_WORK_CLAIM_FILE_MODE) ||
    (kind === "file" && node.linkCount !== 1n) ||
    (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    fail("layout", path);
  }
}

function parseOptions(value: unknown): AbortSignal | undefined {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value ?? {}, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal") ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input", "$options");
  }
  if ((record.signal as AbortSignal | undefined)?.aborted === true) {
    fail("aborted", "$signal");
  }
  return record.signal as AbortSignal | undefined;
}

function parseClaim(value: unknown): Readonly<WindowWorkClaim> {
  try {
    return parseWindowWorkClaim(value);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) fail("claim", error.path);
    throw error;
  }
}

function sameClaim(
  left: Readonly<WindowWorkClaim>,
  right: Readonly<WindowWorkClaim>,
): boolean {
  return (
    left.claimDigest === right.claimDigest &&
    renderWindowWorkClaim(left) === renderWindowWorkClaim(right)
  );
}

async function assertClaimRoot(root: RootedDirectory): Promise<void> {
  try {
    const observation = await root.inspectExistingResource(
      WINDOW_WORK_CLAIMS_ROOT_REF,
      "$claimRoot",
    );
    assertNode(observation.node, "directory", "$claimRoot");
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimStoreError) throw error;
    if (error instanceof RootedDirectoryError) fail("layout", "$claimRoot");
    throw error;
  }
}

async function readClaim(
  root: RootedDirectory,
  windowId: WakeflowDurableId<"window">,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly claim: Readonly<WindowWorkClaim>;
    readonly source: Readonly<DeterministicJsonFileResult>;
  }>
> {
  try {
    const source = await readDeterministicJsonFile(
      root,
      windowWorkClaimRef(windowId),
      {
        maximumBytes: MAXIMUM_CLAIM_BYTES,
        expectedNode,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    assertNode(source.node, "file", "$claim");
    const claim = parseWindowWorkClaimDocument(source.text);
    if (claim.route.windowId !== windowId) fail("claim", "$/route/windowId");
    return Object.freeze({ claim, source });
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimStoreError) throw error;
    if (error instanceof StableFileReadError && error.reason === "aborted") {
      fail("aborted", "$signal");
    }
    if (
      error instanceof StableFileReadError ||
      error instanceof StrictTextFileError ||
      error instanceof DeterministicJsonDocumentError ||
      error instanceof WindowWorkClaimError
    ) {
      fail("claim", "$claim");
    }
    throw error;
  }
}

/** 以零写入方式检查一个稳定窗口当前是否已有 WorkClaim。 */
export async function inspectWindowWorkClaim(
  root: RootedDirectory,
  windowId: WakeflowDurableId<"window">,
  options: WindowWorkClaimStoreOptions = {},
): Promise<Readonly<InspectWindowWorkClaimResult>> {
  assertRoot(root);
  const signal = parseOptions(options);
  await assertClaimRoot(root);
  let observation;
  try {
    observation = await root.inspectExistingResource(
      windowWorkClaimRef(windowId),
      "$claim",
    );
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError &&
      error.reason === "resource-not-found"
    ) {
      return Object.freeze({ status: "absent" as const });
    }
    if (error instanceof RootedDirectoryError) fail("layout", "$claim");
    throw error;
  }
  assertNode(observation.node, "file", "$claim");
  const loaded = await readClaim(root, windowId, observation.node, signal);
  return Object.freeze({
    status: "claimed" as const,
    claim: loaded.claim,
    source: loaded.source,
  });
}

function admitClaimOperation(
  claim: Readonly<WindowWorkClaim>,
  operation: "exclusive-create" | "exact-retire",
): void {
  try {
    const declaration = createWindowWorkClaimResourceDeclaration(
      claim.route.windowId,
    );
    if (
      declaration.placement.relativePath !==
      windowWorkClaimRef(claim.route.windowId)
    ) {
      fail("claim", "$resourceDeclaration");
    }
    admitWakeflowResourceOperation(declaration.processing, operation);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimStoreError) throw error;
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("claim", "$resourceDeclaration");
    }
    throw error;
  }
}

/** 以 exclusive-create 创建 Claim；相同字节重放幂等，不同当前 Claim 返回 occupied。 */
export async function createWindowWorkClaimInStore(
  root: RootedDirectory,
  claimValue: unknown,
  options: WindowWorkClaimStoreOptions = {},
): Promise<Readonly<CreateWindowWorkClaimResult>> {
  assertRoot(root);
  const claim = parseClaim(claimValue);
  const signal = parseOptions(options);
  admitClaimOperation(claim, "exclusive-create");
  const ref = windowWorkClaimRef(claim.route.windowId);
  const mutationKey = `${root.absolutePath}\0${ref}`;
  return MUTATION_QUEUE.run(mutationKey, async () => {
    await assertClaimRoot(root);
    const bytes = encodeUtf8(renderWindowWorkClaim(claim), "$claim");
    if (BigInt(bytes.byteLength) > MAXIMUM_CLAIM_BYTES) {
      fail("capacity", "$claim");
    }
    let disposition: "created" | "current" = "created";
    try {
      await createFileAtomically(root, ref, bytes, {
        mode: WINDOW_WORK_CLAIM_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error: unknown) {
      if (
        error instanceof DurableAtomicFileWriteError &&
        error.reason === "target-exists"
      ) {
        disposition = "current";
      } else if (error instanceof DurableAtomicFileWriteError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        if (error.reason === "stage-recovery-required") {
          fail("recovery-required", "$claim");
        }
        if (
          error.reason === "commit-uncertain" ||
          error.reason === "durability-failure" ||
          error.reason === "stage-cleanup-failure" ||
          error.reason === "close-failure"
        ) {
          fail("write", "$claim", "unknown");
        }
        fail("write", "$claim");
      } else {
        throw error;
      }
    }
    let inspected: Readonly<InspectWindowWorkClaimResult>;
    try {
      inspected = await inspectWindowWorkClaim(
        root,
        claim.route.windowId,
        signal === undefined ? {} : { signal },
      );
    } catch (error: unknown) {
      if (
        disposition === "current" &&
        error instanceof WindowWorkClaimStoreError &&
        (error.reason === "layout" || error.reason === "claim")
      ) {
        fail("recovery-required", "$claim", "unknown");
      }
      throw error;
    }
    if (inspected.status !== "claimed" || inspected.claim === undefined) {
      fail(
        "write",
        "$claim",
        disposition === "created" ? "unknown" : "unchanged",
      );
    }
    if (!sameClaim(inspected.claim, claim)) {
      fail("occupied", "$claim", "current");
    }
    if (inspected.source === undefined) fail("write", "$claim", "current");
    return Object.freeze({
      disposition,
      claim: inspected.claim,
      source: inspected.source,
    });
  });
}

/** 以 exact-retire 释放同一 Claim；缺失或不同 Claim 都不能伪装为幂等成功。 */
export async function releaseWindowWorkClaimInStore(
  root: RootedDirectory,
  expectedValue: unknown,
  options: WindowWorkClaimStoreOptions = {},
): Promise<Readonly<ReleaseWindowWorkClaimResult>> {
  assertRoot(root);
  const expected = parseClaim(expectedValue);
  const signal = parseOptions(options);
  admitClaimOperation(expected, "exact-retire");
  const ref = windowWorkClaimRef(expected.route.windowId);
  const mutationKey = `${root.absolutePath}\0${ref}`;
  return MUTATION_QUEUE.run(mutationKey, async () => {
    const inspected = await inspectWindowWorkClaim(
      root,
      expected.route.windowId,
      signal === undefined ? {} : { signal },
    );
    if (inspected.status === "absent") {
      fail("not-found", "$claim", "unknown");
    }
    if (
      inspected.claim === undefined ||
      inspected.source === undefined ||
      !sameClaim(inspected.claim, expected)
    ) {
      fail("expectation-mismatch", "$claim", "current");
    }
    try {
      const receipt = await unlinkRegularFileExactly(root, ref, {
        expectedNode: inspected.source.node,
        settlement: "replacement-allowed",
        ...(signal === undefined ? {} : { signal }),
      });
      return Object.freeze({
        disposition: "released" as const,
        claim: inspected.claim,
        replacementObserved: receipt.replacementObserved,
      });
    } catch (error: unknown) {
      if (error instanceof ExactRegularFileUnlinkError) {
        if (error.reason === "aborted") {
          fail("aborted", "$signal", "current");
        }
        if (
          error.reason === "commit-uncertain" ||
          error.reason === "durability-failure" ||
          error.reason === "close-failure" ||
          error.reason === "unlink-failure"
        ) {
          fail("release", "$claim", "unknown");
        }
        if (
          error.reason === "source-not-found" ||
          error.reason === "source-changed"
        ) {
          fail("release", "$claim", "unknown");
        }
        fail("release", "$claim", "current");
      }
      throw error;
    }
  });
}
