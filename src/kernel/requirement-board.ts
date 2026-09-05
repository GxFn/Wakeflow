import {
  WAKEFLOW_REQUIREMENT_CLAIM_STATE_SCHEMA,
  type WakeflowRequirementClaimState,
} from "../contracts/generated/governance/board/requirement-claim-state.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../contracts/generated/foundation/utc-instant.generated.js";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, type Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../foundation/data/deterministic-json-document.js";
import { parseJsonValue } from "../foundation/data/json-value.js";
import {
  readDeterministicJsonFile,
  type DeterministicJsonFileResult,
} from "../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
} from "../foundation/filesystem/durable-atomic-file-write.js";
import {
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../foundation/filesystem/durable-directory-materialization.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import {
  RootedExclusiveFileLockError,
  withRootedExclusiveFileLock,
} from "../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
import {
  readStrictTextFile,
  StrictTextFileError,
  type StrictTextFileResult,
} from "../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { createRuntimeJsonSchemaValidator } from "../foundation/schema/runtime-json-schema.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { parseUtcInstant, type UtcInstant } from "../foundation/time/utc-instant.js";
import { fail, WakeflowError } from "./error.js";
import {
  REQUIREMENT_BOARD_INDEX_REF,
  REQUIREMENT_BOARD_ROOT_REF,
  requirementClaimStateRef,
} from "./layout.js";

/**
 * Wakeflow Kernel / Requirement Board：需求包的认领状态（ADR-0011 D1 D5）。
 *
 * 每个需求包一份状态文件 `.wakeflow-active/current/board/<requirementId>.json`，
 * 状态 `pending | parked | claimed | withdrawn | archived`，修订链 `revision` 加
 * `previousStateDigest`。变更只有一种方式：带期望节点与摘要的整文件替换，两个
 * Controller 同时认领时恰有一个成功。转移是纯函数；requirement 切片写 pending、
 * parked、withdrawn，Demand 侧写 claimed、archived 与取消后的 withdrawn。人读索引
 * `board/index.md` 由状态确定性重写，任何人不得手改。
 */

export const REQUIREMENT_CLAIM_STATUSES = Object.freeze([
  "pending",
  "parked",
  "claimed",
  "withdrawn",
  "archived",
] as const);

export type RequirementClaimStatus = (typeof REQUIREMENT_CLAIM_STATUSES)[number];
export type RequirementClaimState = Readonly<WakeflowRequirementClaimState>;

export interface RequirementClaimStateSource {
  readonly state: RequirementClaimState;
  readonly digest: Sha256Digest;
  readonly read: DeterministicJsonFileResult;
}

export interface RequirementClaimStateExpectation {
  readonly digest: Sha256Digest;
  readonly read: DeterministicJsonFileResult;
}

const STATE_MAXIMUM_BYTES = parseByteCount(64 * 1024, "$claimState.maximumBytes");
const INDEX_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$boardIndex.maximumBytes");
const BOARD_MAXIMUM_ENTRIES = 4096;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const STATE_FILE_PATTERN =
  /^(requirement_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;
const LOCKS_DIRECTORY_NAME = "locks";
const ATOMIC_STAGE_PREFIX = ".wakeflow-atomic-";
const LOCK_ACQUIRE_TIMEOUT_MILLISECONDS = 10_000;
const INDEX_REFRESH_ATTEMPTS = 4;
const BOARD_LOCKS_ROOT_REF = parsePortableResourcePath(
  `${REQUIREMENT_BOARD_ROOT_REF}/${LOCKS_DIRECTORY_NAME}`,
  "$layout",
);

function claimStateLockRef(requirementId: string): PortableResourcePath {
  return parsePortableResourcePath(`${BOARD_LOCKS_ROOT_REF}/${requirementId}.lock`, "$layout");
}

/** 每个需求包一把互斥锁：期望检查与替换在锁内连成一步，两个认领者恰有一个成功。 */
async function withClaimStateLock<Result>(
  root: RootedDirectory,
  requirementId: string,
  signal: AbortSignal | undefined,
  operation: () => Promise<Result>,
): Promise<Result> {
  try {
    await materializeDirectoryPath(root, BOARD_LOCKS_ROOT_REF, {
      mode: DIRECTORY_MODE,
      ...signalOptions(signal),
    });
    return await withRootedExclusiveFileLock(root, claimStateLockRef(requirementId), operation, {
      acquireTimeoutMilliseconds: LOCK_ACQUIRE_TIMEOUT_MILLISECONDS,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      fail("io-failure", `board-locks-${error.reason}`, "$board", { cause: error });
    }
    if (error instanceof RootedExclusiveFileLockError) {
      fail("concurrency-conflict", `claim-state-lock-${error.reason}`, "$claimState", {
        cause: error,
        retryable: true,
      });
    }
    throw error;
  }
}

const validateState = createRuntimeJsonSchemaValidator<WakeflowRequirementClaimState>(
  WAKEFLOW_REQUIREMENT_CLAIM_STATE_SCHEMA,
  [
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
  ],
);

function assertRelations(state: WakeflowRequirementClaimState): void {
  const path = "$claimState";
  if ((state.revision === 1) !== (state.previousStateDigest === null)) {
    fail("invalid-request", "claim-state-revision", `${path}.revision`);
  }
  if ((state.status === "parked") !== (state.parked !== null)) {
    fail("invalid-request", "claim-state-parked", `${path}.parked`);
  }
  if ((state.status === "claimed" || state.status === "archived") && state.claim === null) {
    fail("invalid-request", "claim-state-claim", `${path}.claim`);
  }
  if ((state.status === "pending" || state.status === "parked") && state.claim !== null) {
    fail("invalid-request", "claim-state-claim", `${path}.claim`);
  }
  if ((state.status === "withdrawn") !== (state.withdrawal !== null)) {
    fail("invalid-request", "claim-state-withdrawal", `${path}.withdrawal`);
  }
  if ((state.status === "archived") !== (state.archive !== null)) {
    fail("invalid-request", "claim-state-archive", `${path}.archive`);
  }
  if (
    state.archive !== null &&
    state.claim !== null &&
    state.archive.demandId !== state.claim.demandId
  ) {
    fail("invalid-request", "claim-state-archive", `${path}.archive.demandId`);
  }
  if (state.status === "parked" && state.revision !== 1 && state.previousStateDigest === null) {
    fail("invalid-request", "claim-state-parked", `${path}.revision`);
  }
}

/** 准入一份认领状态：Schema 加关系。 */
function parseRequirementClaimState(value: unknown): RequirementClaimState {
  const result = validateState(parseJsonValue(value, "$claimState"));
  if (!result.ok)
    fail("invalid-request", "claim-state-schema", `$claimState${result.path.slice(1)}`);
  assertRelations(result.value);
  return Object.freeze({ ...result.value });
}

export function computeRequirementClaimStateDigest(state: RequirementClaimState): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseJsonValue(state, "$claimState"));
}

function renderRequirementClaimState(state: RequirementClaimState): string {
  return renderDeterministicJsonDocument(parseJsonValue(state, "$claimState"), "$claimState");
}

export interface CreateRequirementClaimStateInput {
  readonly requirementId: string;
  readonly programId: string;
  readonly recordDigest: Sha256Digest;
  readonly title: string;
  readonly demandType: WakeflowRequirementClaimState["demandType"];
  readonly priority: WakeflowRequirementClaimState["priority"];
  readonly publishedAt: UtcInstant;
  readonly supersedes: string | null;
  /** 非空即 parked，否则 pending。 */
  readonly parkedTrigger: string | null;
}

/** 发布即上板：修订 1，pending 或 parked。 */
export function createRequirementClaimState(
  input: Readonly<CreateRequirementClaimStateInput>,
): RequirementClaimState {
  return parseRequirementClaimState({
    artifactKind: "wakeflow-requirement-claim-state",
    schemaVersion: 1,
    requirementId: input.requirementId,
    programId: input.programId,
    recordDigest: input.recordDigest,
    title: input.title,
    demandType: input.demandType,
    priority: input.priority,
    publishedAt: input.publishedAt,
    supersedes: input.supersedes,
    revision: 1,
    previousStateDigest: null,
    status: input.parkedTrigger === null ? "pending" : "parked",
    updatedAt: input.publishedAt,
    parked: input.parkedTrigger === null ? null : { trigger: input.parkedTrigger },
    claim: null,
    withdrawal: null,
    archive: null,
  });
}

function advance(
  current: RequirementClaimState,
  at: UtcInstant,
  patch: Partial<WakeflowRequirementClaimState>,
): RequirementClaimState {
  return parseRequirementClaimState({
    ...current,
    ...patch,
    revision: current.revision + 1,
    previousStateDigest: computeRequirementClaimStateDigest(current),
    updatedAt: parseUtcInstant(at, "$at"),
  });
}

function requireStatus(
  current: RequirementClaimState,
  allowed: readonly RequirementClaimStatus[],
  transition: string,
): void {
  if (!allowed.includes(current.status)) {
    fail("precondition-failed", `claim-${transition}-from-${current.status}`, "$claimState.status");
  }
}

/** parked → pending。 */
export function activateRequirementClaim(
  current: RequirementClaimState,
  at: UtcInstant,
): RequirementClaimState {
  requireStatus(current, ["parked"], "activate");
  return advance(current, at, { status: "pending", parked: null });
}

/** pending | parked | claimed → withdrawn；claimed 的撤回来自 Demand 取消。 */
export function withdrawRequirementClaim(
  current: RequirementClaimState,
  reason: string,
  at: UtcInstant,
): RequirementClaimState {
  requireStatus(current, ["pending", "parked", "claimed"], "withdraw");
  return advance(current, at, {
    status: "withdrawn",
    parked: null,
    withdrawal: { reason, withdrawnAt: parseUtcInstant(at, "$at") },
  });
}

/** pending → claimed：认领即创建 Demand，根先建后认领（ADR-0011 D7）。 */
export function claimRequirementPackage(
  current: RequirementClaimState,
  demandId: string,
  at: UtcInstant,
): RequirementClaimState {
  requireStatus(current, ["pending"], "claim");
  return advance(current, at, {
    status: "claimed",
    claim: { demandId, claimedAt: parseUtcInstant(at, "$at") },
  });
}

/** claimed → archived：完成即归档。 */
export function archiveRequirementClaim(
  current: RequirementClaimState,
  at: UtcInstant,
): RequirementClaimState {
  requireStatus(current, ["claimed"], "archive");
  if (current.claim === null)
    fail("precondition-failed", "claim-archive-without-claim", "$claimState.claim");
  return advance(current, at, {
    status: "archived",
    archive: { demandId: current.claim.demandId, archivedAt: parseUtcInstant(at, "$at") },
  });
}

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

async function readSource(
  root: RootedDirectory,
  ref: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<RequirementClaimStateSource | null> {
  try {
    const read = await readDeterministicJsonFile(root, ref, {
      maximumBytes: STATE_MAXIMUM_BYTES,
      ...signalOptions(signal),
    });
    const state = parseRequirementClaimState(
      parseDeterministicJsonDocument(read.text, "$claimState"),
    );
    return Object.freeze({ state, digest: computeRequirementClaimStateDigest(state), read });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError && error.reason === "not-found") return null;
    if (error instanceof StableFileReadError) {
      fail("io-failure", `claim-state-read-${error.reason}`, "$claimState", { cause: error });
    }
    throw error;
  }
}

/** 读取一个需求包的认领状态；不存在返回 `null`。 */
export async function readRequirementClaimState(
  root: RootedDirectory,
  requirementId: string,
  signal?: AbortSignal,
): Promise<RequirementClaimStateSource | null> {
  return readSource(root, requirementClaimStateRef(requirementId), signal);
}

export interface RequirementBoardListing {
  readonly states: readonly RequirementClaimState[];
  /** 无法读入或与文件名不符的条目数；看板损坏对 status 与 verify 可见。 */
  readonly skipped: number;
}

async function readBoardEntry(
  root: RootedDirectory,
  entry: Readonly<{ readonly name: string; readonly resourcePath: PortableResourcePath }>,
  signal: AbortSignal | undefined,
): Promise<RequirementClaimState | "skip" | "index"> {
  const match = STATE_FILE_PATTERN.exec(entry.name);
  if (match === null) {
    const expected =
      entry.name === "index.md" ||
      entry.name === LOCKS_DIRECTORY_NAME ||
      entry.name.startsWith(ATOMIC_STAGE_PREFIX);
    return expected ? "index" : "skip";
  }
  try {
    const source = await readSource(root, entry.resourcePath, signal);
    return source !== null && source.state.requirementId === match[1] ? source.state : "skip";
  } catch {
    return "skip";
  }
}

/** 有界列出看板上的全部状态，按文件名排序；目录不存在视为空看板。 */
export async function listRequirementClaimStates(
  root: RootedDirectory,
  signal?: AbortSignal,
): Promise<Readonly<RequirementBoardListing>> {
  let listing: Awaited<ReturnType<typeof readStableResourceDirectory>>;
  try {
    listing = await readStableResourceDirectory(root, REQUIREMENT_BOARD_ROOT_REF, {
      maximumEntries: BOARD_MAXIMUM_ENTRIES,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") {
      return Object.freeze({ states: Object.freeze([]), skipped: 0 });
    }
    if (error instanceof StableDirectoryReadError) {
      fail("io-failure", `board-listing-${error.reason}`, "$board", { cause: error });
    }
    throw error;
  }
  const states: RequirementClaimState[] = [];
  let skipped = 0;
  const entries = [...listing.entries].sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const outcome = await readBoardEntry(root, entry, signal);
    if (outcome === "skip") skipped += 1;
    else if (outcome !== "index") states.push(outcome);
  }
  return Object.freeze({ states: Object.freeze(states), skipped });
}

/** 确保看板目录存在（0700）。 */
export async function materializeRequirementBoardRoot(
  root: RootedDirectory,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await materializeDirectoryPath(root, REQUIREMENT_BOARD_ROOT_REF, {
      mode: DIRECTORY_MODE,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      fail("io-failure", `board-directory-${error.reason}`, "$board", { cause: error });
    }
    throw error;
  }
}

/** 独占创建修订 1 的状态；同内容已存在为 `current`，异内容为并发冲突。 */
export async function createRequirementClaimStateFile(
  root: RootedDirectory,
  state: RequirementClaimState,
  signal?: AbortSignal,
): Promise<"created" | "current"> {
  if (state.revision !== 1) fail("invalid-request", "claim-state-revision", "$claimState.revision");
  await materializeRequirementBoardRoot(root, signal);
  const ref = requirementClaimStateRef(state.requirementId);
  return withClaimStateLock(root, state.requirementId, signal, async () => {
    const existing = await readSource(root, ref, signal);
    if (existing !== null) {
      // 同一记录已上板即为 current；发布时间由先到者决定，重放不改它。
      if (existing.state.recordDigest !== state.recordDigest) {
        fail("concurrency-conflict", "claim-state-exists", "$claimState", { retryable: false });
      }
      return "current";
    }
    try {
      await createFileAtomically(
        root,
        ref,
        encodeUtf8(renderRequirementClaimState(state), "$claimState"),
        { mode: FILE_MODE, ...signalOptions(signal) },
      );
    } catch (error: unknown) {
      if (error instanceof DurableAtomicFileWriteError) {
        fail("io-failure", `claim-state-write-${error.reason}`, "$claimState", { cause: error });
      }
      throw error;
    }
    return "created";
  });
}

/** 带期望的整文件替换：期望不再成立即并发冲突，调用方重读后重决定。 */
export async function replaceRequirementClaimStateFile(
  root: RootedDirectory,
  expected: RequirementClaimStateExpectation,
  next: RequirementClaimState,
  signal?: AbortSignal,
): Promise<void> {
  if (next.previousStateDigest !== expected.digest) {
    fail("precondition-failed", "claim-state-chain", "$claimState.previousStateDigest");
  }
  const ref = requirementClaimStateRef(next.requirementId);
  await withClaimStateLock(root, next.requirementId, signal, async () => {
    // 锁内重读：期望摘要仍是当前摘要才替换，先到的写者让后到者看到漂移。
    const current = await readSource(root, ref, signal);
    if (current === null || current.digest !== expected.digest) {
      fail("concurrency-conflict", "claim-state-changed", "$claimState", { retryable: true });
    }
    try {
      await replaceFileAtomically(
        root,
        ref,
        encodeUtf8(renderRequirementClaimState(next), "$claimState"),
        {
          mode: FILE_MODE,
          expected: {
            resourcePath: current.read.resourcePath,
            node: current.read.node,
            byteCount: current.read.byteCount,
            digest: current.read.digest,
          },
          ...signalOptions(signal),
        },
      );
    } catch (error: unknown) {
      if (error instanceof DurableAtomicFileWriteError) {
        if (error.reason === "expectation-changed" || error.reason === "stage-changed") {
          fail("concurrency-conflict", "claim-state-changed", "$claimState", {
            cause: error,
            retryable: true,
          });
        }
        fail("io-failure", `claim-state-write-${error.reason}`, "$claimState", { cause: error });
      }
      throw error;
    }
  });
}

const PRIORITY_ORDER: Readonly<Record<RequirementClaimState["priority"], number>> = Object.freeze({
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
});

/** 看板顺序：优先级、发布时间、标识（ADR-0011 D5）。 */
export function compareRequirementClaimStates(
  left: RequirementClaimState,
  right: RequirementClaimState,
): number {
  const priority = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
  if (priority !== 0) return priority;
  const leftAt = Date.parse(left.publishedAt);
  const rightAt = Date.parse(right.publishedAt);
  if (leftAt !== rightAt) return leftAt < rightAt ? -1 : 1;
  if (left.publishedAt !== right.publishedAt) return left.publishedAt < right.publishedAt ? -1 : 1;
  return left.requirementId < right.requirementId
    ? -1
    : left.requirementId > right.requirementId
      ? 1
      : 0;
}

function escapeCell(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/`/gu, "&#96;")
    .replace(/\[/gu, "&#91;")
    .replace(/\]/gu, "&#93;")
    .replace(/\\/gu, "\\\\")
    .replace(/\|/gu, "\\|");
}

const REQUIREMENT_BOARD_INDEX_MARKER = "<!-- wakeflow:board-projection:v1 -->";

/** 人读索引：只列 pending、parked、claimed；已撤回与已归档留在状态文件里。 */
export function renderRequirementBoardIndex(states: readonly RequirementClaimState[]): string {
  const rows = [...states]
    .filter((state) => state.status !== "withdrawn" && state.status !== "archived")
    .sort(compareRequirementClaimStates)
    .map(
      (state) =>
        `| ${state.priority} | ${state.status} | \`${state.requirementId}\` | ${escapeCell(state.title)} | ${state.demandType} | ${state.publishedAt} | ${state.claim === null ? "—" : `\`${state.claim.demandId}\``} |`,
    );
  const lines = [
    "# Requirement Board",
    "",
    REQUIREMENT_BOARD_INDEX_MARKER,
    "",
    "This file is a deterministic projection of the claim states under `board/`; do not edit it by hand.",
    "",
    "| Priority | Status | Requirement | Title | Type | Published | Demand |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ];
  return `${lines.join("\n")}\n`;
}

/** 让磁盘上的索引等于当前状态的投影；已相等则不写。 */
export async function publishRequirementBoardIndex(
  root: RootedDirectory,
  states: readonly RequirementClaimState[],
  signal?: AbortSignal,
): Promise<Sha256Digest> {
  await materializeRequirementBoardRoot(root, signal);
  const document = renderRequirementBoardIndex(states);
  const bytes = encodeUtf8(document, "$boardIndex");
  let current: Readonly<StrictTextFileResult> | null = null;
  try {
    current = await readStrictTextFile(root, REQUIREMENT_BOARD_INDEX_REF, {
      maximumBytes: INDEX_MAXIMUM_BYTES,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError && error.reason === "not-found") {
      current = null;
    } else if (error instanceof StableFileReadError || error instanceof StrictTextFileError) {
      fail("io-failure", `board-index-read-${error.reason}`, "$boardIndex", { cause: error });
    } else {
      throw error;
    }
  }
  try {
    if (current === null) {
      await createFileAtomically(root, REQUIREMENT_BOARD_INDEX_REF, bytes, {
        mode: FILE_MODE,
        ...signalOptions(signal),
      });
    } else if (current.text !== document) {
      await replaceFileAtomically(root, REQUIREMENT_BOARD_INDEX_REF, bytes, {
        mode: FILE_MODE,
        expected: {
          resourcePath: current.resourcePath,
          node: current.node,
          byteCount: current.byteCount,
          digest: current.digest,
        },
        ...signalOptions(signal),
      });
    }
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      fail("io-failure", `board-index-write-${error.reason}`, "$boardIndex", { cause: error });
    }
    throw error;
  }
  return computeSha256Digest(bytes);
}

function isIndexRace(error: unknown): boolean {
  return (
    error instanceof WakeflowError &&
    (error.reason === "board-index-write-expectation-changed" ||
      error.reason === "board-index-write-stage-changed" ||
      error.reason === "board-index-write-target-exists")
  );
}

/**
 * 重新列出状态并重写索引；变更状态的调用方在提交后调用一次。索引是投影：
 * 与并发写者相撞就重列重写，几次后仍撞即报可重试的失败，权威状态已提交不受影响。
 */
export async function refreshRequirementBoardIndex(
  root: RootedDirectory,
  signal?: AbortSignal,
): Promise<Sha256Digest> {
  for (let attempt = 1; ; attempt += 1) {
    const listing = await listRequirementClaimStates(root, signal);
    try {
      return await publishRequirementBoardIndex(root, listing.states, signal);
    } catch (error: unknown) {
      if (!isIndexRace(error) || attempt >= INDEX_REFRESH_ATTEMPTS) {
        if (isIndexRace(error) && error instanceof WakeflowError) {
          fail("io-failure", "board-index-contended", "$boardIndex", {
            cause: error,
            retryable: true,
          });
        }
        throw error;
      }
    }
  }
}
