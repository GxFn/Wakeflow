import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../contracts/generated/foundation/utc-instant.generated.js";
import {
  WAKEFLOW_REQUIREMENT_CLAIM_STATE_SCHEMA,
  type WakeflowRequirementClaimState,
} from "../contracts/generated/governance/board/requirement-claim-state.generated.js";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, type Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../foundation/data/deterministic-json-document.js";
import { parseJsonValue } from "../foundation/data/json-value.js";
import {
  type DeterministicJsonFileResult,
  readDeterministicJsonFile,
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
import { KernelFileLockError } from "../foundation/filesystem/kernel-file-lock.js";
import type { PortableResourcePath } from "../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
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
import { signalOptions } from "../foundation/node/abort-signal.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { createRuntimeJsonSchemaValidator } from "../foundation/schema/runtime-json-schema.js";
import { truncateToCodePoints } from "../foundation/text/bounded-text.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { parseUtcInstant, type UtcInstant } from "../foundation/time/utc-instant.js";
import { fail, WakeflowError } from "./error.js";
import {
  REQUIREMENT_BOARD_INDEX_REF,
  REQUIREMENT_BOARD_ROOT_REF,
  requirementClaimStateRef,
} from "./layout.js";
import { settleStagesOfDeadWriters, withWorkspaceLock } from "./workspace-locks.js";

/**
 * Wakeflow Kernel / Requirement Board：需求包的认领状态（ADR-0011 D1 D5）。
 *
 * 每个需求包一份状态文件 `.wakeflow-active/current/board/<requirementId>.json`，
 * 状态 `pending | parked | claimed | withdrawn | archived`，修订链 `revision` 加
 * `previousStateDigest`。变更只有一种方式：带期望节点与摘要的整文件替换，两个
 * Controller 同时认领时恰有一个成功。转移是纯函数；requirement 切片写 pending、
 * parked、withdrawn，Demand 侧写 claimed、archived 与取消后的 withdrawn。人读索引
 * `board/index.md` 由状态确定性重写，刷新在看板级锁 `locks/index.lock` 内列举并发布（W29），
 * 任何人不得手改。
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

/**
 * 一个 pending 的 supplement 包该并入哪个 Demand（Q7 裁决）：它声明的父需求已由某个 Demand 归档时是那个
 * Demand；父需求还在进行、未认领或看板上没有时为 null（等它完成）。不是 supplement 包（没有父需求）返回
 * undefined。
 */
export function supplementAttachTarget(
  states: readonly RequirementClaimState[],
  state: RequirementClaimState,
): string | null | undefined {
  if (state.supplements === undefined) return undefined;
  const parent = states.find((entry) => entry.requirementId === state.supplements);
  return parent?.status === "archived" && parent.archive !== null ? parent.archive.demandId : null;
}

/** 看板上 Controller 现在能动手的 pending 包：普通的包去认领，父需求已归档的 supplement 包去续接。 */
export interface PendingRequirementWork {
  readonly claimable: number;
  readonly attachable: number;
}

/** 父需求还没有完成的 supplement 包两边都不算：它暂时没有可做的一步。 */
export function pendingRequirementWork(
  states: readonly RequirementClaimState[],
): Readonly<PendingRequirementWork> {
  let claimable = 0;
  let attachable = 0;
  for (const state of states) {
    if (state.status !== "pending") continue;
    const target = supplementAttachTarget(states, state);
    if (target === undefined) claimable += 1;
    else if (target !== null) attachable += 1;
  }
  return Object.freeze({ claimable, attachable });
}

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
/** 1.4.5 之前看板目录里的锁目录的名字：列举时照旧跳过，直到一次维护把它清掉。 */
const LEGACY_LOCKS_DIRECTORY_NAME = "locks";
const ATOMIC_STAGE_PREFIX = ".wakeflow-atomic-";
const LOCK_ACQUIRE_TIMEOUT_MILLISECONDS = 10_000;
const INDEX_REFRESH_ATTEMPTS = 4;

/**
 * 看板的一把互斥锁（ADR-0033）：状态文件的写入与索引的刷新都持它，互不嵌套——状态写入在锁内读、比对、
 * 替换；刷新在锁内列举、渲染、发布；调用方在状态提交之后、锁外调用刷新。锁本身的失败由调用方按自己的
 * 边界映射，临界区的错误原样穿过。
 */
async function withBoardLock<Result>(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  operation: () => Promise<Result>,
  mapLockError: (error: KernelFileLockError) => never,
): Promise<Result> {
  let entered = false;
  try {
    return await withWorkspaceLock(
      root,
      "requirement-board",
      () => {
        entered = true;
        return operation();
      },
      { acquireTimeoutMilliseconds: LOCK_ACQUIRE_TIMEOUT_MILLISECONDS, ...signalOptions(signal) },
    );
  } catch (error: unknown) {
    // 只把获取时的失败说成锁的失败；临界区里别的锁抛出的同类错误不是这把锁的。
    if (!entered && error instanceof KernelFileLockError) mapLockError(error);
    throw error;
  }
}

/** 状态文件的写入：期望检查与替换在锁内连成一步，两个认领者恰有一个成功。 */
function withClaimStateLock<Result>(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  operation: () => Promise<Result>,
): Promise<Result> {
  return withBoardLock(root, signal, operation, (error) =>
    fail("concurrency-conflict", `claim-state-lock-${error.reason}`, "$claimState", {
      cause: error,
      retryable: error.reason === "timeout",
    }),
  );
}

/**
 * 索引的刷新（W29，R-ROOT-02）：一次刷新从列举到发布都在锁内，所以任何一次刷新看到的列举都不早于另一次
 * 正在发布的索引。等不到锁沿用索引争用的既有语义（可重试的 `board-index-contended`，调用方静默自愈，
 * 下次刷新补齐）；中止原样穿出。
 */
function withIndexLock<Result>(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  operation: () => Promise<Result>,
): Promise<Result> {
  return withBoardLock(root, signal, operation, (error) =>
    fail("io-failure", "board-index-contended", "$boardIndex", { cause: error, retryable: true }),
  );
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
  /** supplement 包补充的父需求（Q7）；其他包不给，状态文件里不写这一项。 */
  readonly supplements?: string | null;
  /** 非空即 parked，否则 pending。 */
  readonly parkedTrigger: string | null;
  /** 需求记录的测试模式；进状态文件只为索引显示（G11）。 */
  readonly testingMode: NonNullable<WakeflowRequirementClaimState["testingMode"]>;
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
    testingMode: input.testingMode,
    publishedAt: input.publishedAt,
    supersedes: input.supersedes,
    ...(input.supplements === undefined || input.supplements === null
      ? {}
      : { supplements: input.supplements }),
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

/** archived → claimed：continue 从归档重开同一个 Demand，只允许归档时的那个 Demand。 */
export function reclaimRequirementPackage(
  current: RequirementClaimState,
  demandId: string,
  at: UtcInstant,
): RequirementClaimState {
  requireStatus(current, ["archived"], "reclaim");
  if (current.archive === null || current.archive.demandId !== demandId) {
    fail("precondition-failed", "claim-reclaim-other-demand", "$claimState.archive");
  }
  return advance(current, at, {
    status: "claimed",
    archive: null,
    claim: { demandId, claimedAt: parseUtcInstant(at, "$at") },
  });
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
    if (error instanceof StrictTextFileError || error instanceof DeterministicJsonDocumentError) {
      fail("io-failure", "claim-state-read", "$claimState", { cause: error });
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
      entry.name === LEGACY_LOCKS_DIRECTORY_NAME ||
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
  return withClaimStateLock(root, signal, async () => {
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
  await withClaimStateLock(root, signal, async () => {
    // 先清再读（L10）：上一个写者死在"状态文件已链接、创建暂存还没删"的那一刻时，状态文件带着两个链接。
    await settleStagesOfDeadWriters(root, [ref], signal);
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

/** v2（G11，§13.209）：加 Testing 与 Parked 两列；维护 apply 之后陈旧的 v1 索引被重写。 */
const REQUIREMENT_BOARD_INDEX_MARKER = "<!-- wakeflow:board-projection:v2 -->";
/** Parked 列只给触发词的开头：整段触发词在状态文件与 `wakeflow_inspect_board` 里。 */
const PARKED_CELL_MAXIMUM_CODE_POINTS = 40;

/** 索引跟随的工作区语言（与活动投影同一组取值；内核不读配置，由知道配置的调用方给出）。 */
export type RequirementBoardIndexLanguage = "en" | "zh-Hans";

/**
 * 两种语言的固定文字（1.4 第 3 段）。英文的字节与此前完全相同，所以英文工作区的索引不因这次改动变陈旧，
 * Fresh 初始化绑定的空索引摘要也不变；中文的标记多一段语言，索引的语言因此能从它自己读回来。
 * 状态与类型两列是机器取值，不翻译。
 */
const BOARD_INDEX_TEXT: Readonly<
  Record<
    RequirementBoardIndexLanguage,
    Readonly<{ title: string; marker: string; notice: string; header: string }>
  >
> = Object.freeze({
  en: Object.freeze({
    title: "# Requirement Board",
    marker: REQUIREMENT_BOARD_INDEX_MARKER,
    notice:
      "This file is a deterministic projection of the claim states under `board/`; do not edit it by hand.",
    header:
      "| Priority | Status | Requirement | Title | Type | Testing | Parked | Published | Demand |",
  }),
  "zh-Hans": Object.freeze({
    title: "# 需求看板",
    marker: "<!-- wakeflow:board-projection:v2:zh-Hans -->",
    notice: "本文件是 `board/` 下认领状态的确定性投影；请勿手改。",
    header: "| 优先级 | 状态 | 需求包 | 标题 | 类型 | 测试 | 搁置 | 发布时间 | Demand |",
  }),
});

/** 一份已有索引是用哪种语言渲染的：只认它自己的标记，认不出即英文。 */
export function requirementBoardIndexLanguageOf(document: string): RequirementBoardIndexLanguage {
  return document.includes(BOARD_INDEX_TEXT["zh-Hans"].marker) ? "zh-Hans" : "en";
}

function parkedCell(state: RequirementClaimState): string {
  if (state.parked === null) return "—";
  // 列的约定是触发词前 40 个码点、超出时省略号跟在它们之后（§13.209）：码点切分用共享助手
  // （R-ROOT-05），省略号不计入这 40 个，所以在这里补。
  const trigger = state.parked.trigger;
  const shown = truncateToCodePoints(trigger, PARKED_CELL_MAXIMUM_CODE_POINTS, { ellipsis: "" });
  return escapeCell(shown === trigger ? shown : `${shown}…`);
}

/** 人读索引：只列 pending、parked、claimed；已撤回与已归档留在状态文件里（做完的在账本的历史索引里）。 */
export function renderRequirementBoardIndex(
  states: readonly RequirementClaimState[],
  language: RequirementBoardIndexLanguage = "en",
): string {
  const text = BOARD_INDEX_TEXT[language];
  const rows = [...states]
    .filter((state) => state.status !== "withdrawn" && state.status !== "archived")
    .sort(compareRequirementClaimStates)
    .map(
      (state) =>
        `| ${state.priority} | ${state.status} | \`${state.requirementId}\` | ${escapeCell(state.title)} | ${state.demandType} | ${state.testingMode ?? "—"} | ${parkedCell(state)} | ${state.publishedAt} | ${state.claim === null ? "—" : `\`${state.claim.demandId}\``} |`,
    );
  const lines = [
    text.title,
    "",
    text.marker,
    "",
    text.notice,
    "",
    text.header,
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ];
  return `${lines.join("\n")}\n`;
}

/** 没有任何认领状态时的索引摘要；Fresh 初始化写入的就是这一份，初始化权威只绑定它的摘要。 */
const REQUIREMENT_BOARD_EMPTY_INDEX_DIGEST: Sha256Digest = computeSha256Digest(
  encodeUtf8(renderRequirementBoardIndex([]), "$boardIndex"),
  "$boardIndex",
);

/** 看板初始化权威的摘要：布局引用加空索引摘要；维护计划用它做步骤目标。 */
export const REQUIREMENT_BOARD_INITIALIZATION_AUTHORITY_DIGEST: Sha256Digest =
  computeCanonicalJsonSha256Digest({
    kind: "WakeflowRequirementBoardInitializationAuthority",
    schemaVersion: 1,
    rootRef: REQUIREMENT_BOARD_ROOT_REF,
    indexRef: REQUIREMENT_BOARD_INDEX_REF,
    emptyIndexDigest: REQUIREMENT_BOARD_EMPTY_INDEX_DIGEST,
  });

/**
 * 让磁盘上的索引等于当前状态的投影；已相等则不写。给了 `language` 就按它渲染（维护 apply 与初始化知道配置）；
 * 没给就沿用磁盘上那份索引自己的语言——认领、撤回、归档这些调用方不读配置，语言不该因它们的一次刷新而变。
 * 配置的语言与索引不一致时由 verify 的 board-consistency 报 `index-stale`，下一次维护 apply 重写。
 */
export async function publishRequirementBoardIndex(
  root: RootedDirectory,
  states: readonly RequirementClaimState[],
  signal?: AbortSignal,
  language?: RequirementBoardIndexLanguage,
): Promise<Sha256Digest> {
  await materializeRequirementBoardRoot(root, signal);
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
  const document = renderRequirementBoardIndex(
    states,
    language ?? (current === null ? "en" : requirementBoardIndexLanguageOf(current.text)),
  );
  const bytes = encodeUtf8(document, "$boardIndex");
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
 * 重新列出状态并重写索引；变更状态的调用方在提交后调用一次。索引是投影：列举、渲染与发布在索引锁内
 * 连成一步（W29，R-ROOT-02）——此前锁外列举、只对索引文件自身做 CAS，一次读完 pending 后被挂起的旧刷新
 * 可以在 withdrawn 的新刷新之后发布，把索引写回 pending；现在它要么先拿到锁先发布，要么在锁内才列举、
 * 看到的已是新状态。与锁外写者相撞就重列重写，几次后仍撞即报可重试的失败，权威状态已提交不受影响。
 */
export async function refreshRequirementBoardIndex(
  root: RootedDirectory,
  signal?: AbortSignal,
  language?: RequirementBoardIndexLanguage,
): Promise<Sha256Digest> {
  return withIndexLock(root, signal, () =>
    publishCurrentRequirementBoardIndex(root, signal, language),
  );
}

/** 索引锁内的一步：列举当前状态并发布它们的投影；与锁外写者相撞就重列重写。 */
async function publishCurrentRequirementBoardIndex(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  language: RequirementBoardIndexLanguage | undefined,
): Promise<Sha256Digest> {
  for (let attempt = 1; ; attempt += 1) {
    const listing = await listRequirementClaimStates(root, signal);
    try {
      return await publishRequirementBoardIndex(root, listing.states, signal, language);
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
