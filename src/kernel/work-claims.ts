import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, type Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../foundation/data/deterministic-json-document.js";
import { parseJsonValue, type JsonObject, type JsonValue } from "../foundation/data/json-value.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { readDeterministicJsonFile } from "../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../foundation/filesystem/durable-atomic-file-write.js";
import {
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../foundation/filesystem/durable-directory-materialization.js";
import {
  ExactRegularFileUnlinkError,
  unlinkRegularFileExactly,
} from "../foundation/filesystem/exact-regular-file-unlink.js";
import type { FileNodeSnapshot } from "../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../foundation/time/utc-instant.js";
import { fail } from "./error.js";
import { deriveDurableId } from "./ids.js";
import type { WakeflowHostId } from "../contracts/vocabulary/wakeflow-host-id.js";
import { parseUuidV4 } from "../foundation/identity/uuid-v4.js";
import { parseWakeflowHostId, WORK_CLAIMS_ROOT_REF, workClaimRef } from "./layout.js";

/**
 * Wakeflow Kernel / Work Claims：对执行端点注意力与工作树的工作声明（ADR-0009 决定 3）。
 *
 * 一个稳定窗口同一时刻至多一份当前声明，跨 Demand 排他。声明没有 TTL，不会因时间
 * 自动失效；正确性靠围栏令牌（声明摘要进入投递信封，结果必须带回同一令牌）而不靠
 * 时钟。持有者只能用同一份声明精确释放；过期只开恢复门（endpoint 的 release-claim）。
 * 目录 0700、文件 0600，原始句柄从不进入声明。
 */

const CLAIM_KIND = "WakeflowWorkClaim" as const;
const CLAIM_SCHEMA_VERSION = 1 as const;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const CLAIM_MAXIMUM_BYTES = parseByteCount(16 * 1024, "$claim.maximumBytes");
const CLAIM_FIELDS = Object.freeze([
  "bindingId",
  "claimDigest",
  "claimId",
  "claimedAt",
  "holder",
  "hostId",
  "kind",
  "schemaVersion",
  "windowId",
] as const);
const HOLDER_FIELDS = Object.freeze([
  "deliveryId",
  "demandId",
  "generation",
  "targetTaskId",
] as const);
const BINDING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
/** 声明代际上限；投递的 rearm 上限由它派生（`DELIVERY_REARM_LIMIT = MAXIMUM_WORK_CLAIM_GENERATION - 1`）。 */
export const MAXIMUM_WORK_CLAIM_GENERATION = 4;

export interface WorkClaimHolder {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly deliveryId: WakeflowDurableId<"target-delivery">;
  readonly generation: number;
}

export interface WorkClaim {
  readonly kind: typeof CLAIM_KIND;
  readonly schemaVersion: typeof CLAIM_SCHEMA_VERSION;
  readonly claimId: WakeflowDurableId<"work-claim">;
  readonly hostId: WakeflowHostId;
  readonly windowId: WakeflowDurableId<"window">;
  readonly bindingId: string;
  readonly holder: Readonly<WorkClaimHolder>;
  readonly claimedAt: UtcInstant;
  readonly claimDigest: Sha256Digest;
}

export type WorkClaimDraft = Omit<WorkClaim, "kind" | "schemaVersion" | "claimDigest">;

export interface InspectWorkClaimResult {
  readonly status: "absent" | "claimed";
  readonly claim: Readonly<WorkClaim> | null;
  readonly node: Readonly<FileNodeSnapshot> | null;
}

export interface TakeWorkClaimResult {
  readonly disposition: "created" | "current";
  readonly claim: Readonly<WorkClaim>;
}

export interface ReleaseWorkClaimResult {
  readonly disposition: "released";
  readonly claim: Readonly<WorkClaim>;
}

type Signal = { readonly signal?: AbortSignal };

function signalOptions(signal: AbortSignal | undefined): Signal {
  return signal === undefined ? {} : { signal };
}

function parseId<
  Kind extends "work-claim" | "window" | "demand" | "target-task" | "target-delivery",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("invalid-request", "claim-identity", path, { cause: error });
    }
    throw error;
  }
}

function exactObject<Field extends string>(
  value: unknown,
  fields: readonly Field[],
  path: string,
): Readonly<Record<Field, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid-request", "claim-shape", path);
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) {
    fail("invalid-request", "claim-shape", path);
  }
  return value as Readonly<Record<Field, unknown>>;
}

function claimBasis(draft: Readonly<WorkClaimDraft>): Omit<WorkClaim, "claimDigest"> {
  return Object.freeze({
    kind: CLAIM_KIND,
    schemaVersion: CLAIM_SCHEMA_VERSION,
    claimId: draft.claimId,
    hostId: draft.hostId,
    windowId: draft.windowId,
    bindingId: draft.bindingId,
    holder: Object.freeze({
      demandId: draft.holder.demandId,
      targetTaskId: draft.holder.targetTaskId,
      deliveryId: draft.holder.deliveryId,
      generation: draft.holder.generation,
    }),
    claimedAt: draft.claimedAt,
  });
}

/** 严格解析一份声明记录；摘要必须等于其规范 JSON 摘要。 */
function parseWorkClaim(value: unknown, path = "$claim"): Readonly<WorkClaim> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, path);
  } catch (error: unknown) {
    fail("invalid-request", "claim-json", path, { cause: error });
  }
  const record = exactObject(json, CLAIM_FIELDS, path) as Readonly<Record<string, JsonValue>>;
  if (record.kind !== CLAIM_KIND || record.schemaVersion !== CLAIM_SCHEMA_VERSION) {
    fail("invalid-request", "claim-kind", `${path}/kind`);
  }
  const holderRecord = exactObject(record.holder, HOLDER_FIELDS, `${path}/holder`) as Readonly<
    Record<string, JsonValue>
  >;
  const generation = holderRecord.generation;
  if (
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    generation > MAXIMUM_WORK_CLAIM_GENERATION
  ) {
    fail("invalid-request", "claim-generation", `${path}/holder/generation`);
  }
  if (typeof record.bindingId !== "string" || !BINDING_ID_PATTERN.test(record.bindingId)) {
    fail("invalid-request", "claim-binding", `${path}/bindingId`);
  }
  let claimedAt: UtcInstant;
  try {
    claimedAt = parseUtcInstant(record.claimedAt, `${path}/claimedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError)
      fail("invalid-request", "claim-time", `${path}/claimedAt`);
    throw error;
  }
  let claimDigest: Sha256Digest;
  try {
    claimDigest = parseSha256Digest(record.claimDigest, `${path}/claimDigest`);
  } catch (error: unknown) {
    if (error instanceof Sha256Error)
      fail("invalid-request", "claim-digest", `${path}/claimDigest`);
    throw error;
  }
  const basis = claimBasis({
    claimId: parseId(record.claimId, "work-claim", `${path}/claimId`),
    hostId: parseWakeflowHostId(record.hostId, `${path}/hostId`),
    windowId: parseId(record.windowId, "window", `${path}/windowId`),
    bindingId: record.bindingId,
    holder: {
      demandId: parseId(holderRecord.demandId, "demand", `${path}/holder/demandId`),
      targetTaskId: parseId(
        holderRecord.targetTaskId,
        "target-task",
        `${path}/holder/targetTaskId`,
      ),
      deliveryId: parseId(holderRecord.deliveryId, "target-delivery", `${path}/holder/deliveryId`),
      generation,
    },
    claimedAt,
  });
  if (computeCanonicalJsonSha256Digest(basis as unknown as JsonObject) !== claimDigest) {
    fail("invalid-request", "claim-digest", `${path}/claimDigest`);
  }
  return Object.freeze({ ...basis, claimDigest });
}

/** 从草稿创建声明记录并封摘要。 */
export function createWorkClaim(draft: Readonly<WorkClaimDraft>): Readonly<WorkClaim> {
  const basis = claimBasis(draft);
  return parseWorkClaim({
    ...basis,
    claimDigest: computeCanonicalJsonSha256Digest(basis as unknown as JsonObject),
  });
}

/** 声明标识由 Demand 与客户端幂等键派生：同一请求重试命中同一声明。 */
export function deriveWorkClaimId(
  namespace: string,
  demandId: string,
  idempotencyKey: string,
): WakeflowDurableId<"work-claim"> {
  return deriveDurableId("work-claim", namespace, demandId, idempotencyKey);
}

/** 用声明标识里的 UUID 派生同源的其他身份，例如结果记录标识。 */
function workClaimUuid(claimId: WakeflowDurableId<"work-claim">): string {
  return claimId.slice("work-claim_".length);
}

export function derivedIdFromWorkClaim<
  Kind extends "target-result" | "demand-event" | "demand-event-commit",
>(kind: Kind, claimId: WakeflowDurableId<"work-claim">): WakeflowDurableId<Kind> {
  return createWakeflowDurableId(kind, parseUuidV4(workClaimUuid(claimId), "$claimId"));
}

function renderWorkClaim(claim: Readonly<WorkClaim>): string {
  return renderDeterministicJsonDocument(claim as unknown as JsonObject, "$claim");
}

function assertRoot(root: unknown): asserts root is RootedDirectory {
  if (!(root instanceof RootedDirectory)) fail("invalid-request", "claim-root", "$root");
}

function assertNode(
  node: Readonly<FileNodeSnapshot>,
  kind: "directory" | "file",
  path: string,
): void {
  if (
    node.kind !== kind ||
    node.permissionBits !== (kind === "directory" ? DIRECTORY_MODE : FILE_MODE) ||
    (kind === "file" && node.linkCount !== 1n)
  ) {
    fail("root-invalid", "claim-layout", path);
  }
}

/** 零写入检查一个窗口当前是否已有声明；声明目录尚未建立视为无声明。 */
export async function inspectWorkClaim(
  root: RootedDirectory,
  windowIdValue: string,
  options: Signal = {},
): Promise<Readonly<InspectWorkClaimResult>> {
  assertRoot(root);
  const windowId = parseId(windowIdValue, "window", "$windowId");
  const ref = workClaimRef(windowId);
  let node: Readonly<FileNodeSnapshot>;
  try {
    node = (await root.inspectExistingResource(ref, "$claim")).node;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
      return Object.freeze({ status: "absent" as const, claim: null, node: null });
    }
    if (error instanceof RootedDirectoryError) {
      fail("root-invalid", "claim-layout", "$claim", { cause: error });
    }
    throw error;
  }
  assertNode(node, "file", "$claim");
  let text: string;
  try {
    const read = await readDeterministicJsonFile(root, ref, {
      maximumBytes: CLAIM_MAXIMUM_BYTES,
      expectedNode: node,
      ...signalOptions(options.signal),
    });
    text = read.text;
  } catch (error: unknown) {
    if (error instanceof StableFileReadError && error.reason === "aborted") {
      fail("io-failure", "aborted", "$signal", { cause: error });
    }
    if (error instanceof StableFileReadError || error instanceof DeterministicJsonDocumentError) {
      fail("io-failure", "claim-read", "$claim", { cause: error });
    }
    throw error;
  }
  const claim = parseWorkClaim(parseDeterministicJsonDocument(text, "$claim"));
  if (claim.windowId !== windowId || renderWorkClaim(claim) !== text) {
    fail("io-failure", "claim-representation", "$claim");
  }
  return Object.freeze({ status: "claimed" as const, claim, node });
}

/**
 * 以独占创建取得声明：同字节重放为 `current`；被其他声明占用即
 * `precondition-failed/window-claimed`，details 列出持有者。
 */
export async function takeWorkClaim(
  root: RootedDirectory,
  claimValue: unknown,
  options: Signal = {},
): Promise<Readonly<TakeWorkClaimResult>> {
  assertRoot(root);
  const claim = parseWorkClaim(claimValue);
  const signal = signalOptions(options.signal);
  try {
    await materializeDirectoryPath(root, WORK_CLAIMS_ROOT_REF, { mode: DIRECTORY_MODE, ...signal });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      fail("io-failure", `claim-directory-${error.reason}`, "$claim", { cause: error });
    }
    throw error;
  }
  const document = renderWorkClaim(claim);
  try {
    await createFileAtomically(root, workClaimRef(claim.windowId), encodeUtf8(document, "$claim"), {
      mode: FILE_MODE,
      ...signal,
    });
    return Object.freeze({ disposition: "created" as const, claim });
  } catch (error: unknown) {
    if (!(error instanceof DurableAtomicFileWriteError) || error.reason !== "target-exists") {
      if (error instanceof DurableAtomicFileWriteError) {
        fail("io-failure", `claim-write-${error.reason}`, "$claim", { cause: error });
      }
      throw error;
    }
  }
  const inspected = await inspectWorkClaim(root, claim.windowId, signal);
  if (inspected.claim === null) fail("io-failure", "claim-write", "$claim");
  if (inspected.claim.claimDigest === claim.claimDigest) {
    return Object.freeze({ disposition: "current" as const, claim: inspected.claim });
  }
  fail("precondition-failed", "window-claimed", "$claim", {
    details: {
      windowId: claim.windowId,
      holderDemandId: inspected.claim.holder.demandId,
      holderTargetTaskId: inspected.claim.holder.targetTaskId,
      holderDeliveryId: inspected.claim.holder.deliveryId,
      claimId: inspected.claim.claimId,
      claimedAt: inspected.claim.claimedAt,
    },
  });
}

/** 精确释放同一份声明：缺失为 `not-found/claim-absent`，不同声明为 `precondition-failed/claim-drift`。 */
export async function releaseWorkClaim(
  root: RootedDirectory,
  expectedValue: unknown,
  options: Signal = {},
): Promise<Readonly<ReleaseWorkClaimResult>> {
  assertRoot(root);
  const expected = parseWorkClaim(expectedValue);
  const signal = signalOptions(options.signal);
  const inspected = await inspectWorkClaim(root, expected.windowId, signal);
  if (inspected.claim === null || inspected.node === null) {
    fail("not-found", "claim-absent", "$claim");
  }
  if (inspected.claim.claimDigest !== expected.claimDigest) {
    fail("precondition-failed", "claim-drift", "$claim", {
      details: { claimId: inspected.claim.claimId, claimDigest: inspected.claim.claimDigest },
    });
  }
  try {
    await unlinkRegularFileExactly(root, workClaimRef(expected.windowId), {
      expectedNode: inspected.node,
      settlement: "replacement-allowed",
      ...signal,
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("io-failure", `claim-release-${error.reason}`, "$claim", { cause: error });
    }
    throw error;
  }
  return Object.freeze({ disposition: "released" as const, claim: inspected.claim });
}

export interface ReleaseWorkClaimIfHeldResult {
  readonly disposition: "released" | "absent" | "foreign";
}

/**
 * 释放仍由指定围栏持有的声明。缺失或已换成别的声明都不是错误，只报告 `absent` / `foreign`：
 * 供事件提交之后的清理步骤在首次与重放路径共用，清理找不到目标不能否定已经落地的事件。
 */
export async function releaseWorkClaimIfHeld(
  root: RootedDirectory,
  windowIdValue: string,
  fence: Readonly<{ readonly claimId: string; readonly claimDigest: string }>,
  options: Signal = {},
): Promise<Readonly<ReleaseWorkClaimIfHeldResult>> {
  const signal = signalOptions(options.signal);
  const inspected = await inspectWorkClaim(root, windowIdValue, signal);
  if (inspected.claim === null) return Object.freeze({ disposition: "absent" as const });
  if (
    inspected.claim.claimId !== fence.claimId ||
    inspected.claim.claimDigest !== fence.claimDigest
  ) {
    return Object.freeze({ disposition: "foreign" as const });
  }
  await releaseWorkClaim(root, inspected.claim, signal);
  return Object.freeze({ disposition: "released" as const });
}
