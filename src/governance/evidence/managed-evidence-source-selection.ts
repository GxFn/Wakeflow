import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { isEvidenceKind, type EvidenceKind } from "../../contracts/vocabulary/evidence-kinds.js";
import {
  isWakeflowHostId,
  type WakeflowHostId,
} from "../../contracts/vocabulary/wakeflow-host-id.js";
import { parseSha256Digest, Sha256Error, type Sha256Digest } from "../../foundation/crypto/sha256.js";
import { parsePlainRecord, PassiveOwnDataError } from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import { HOST_HOOK_EVENTS, type HostHookEvent } from "../../kernel/hook-observations.js";

/**
 * Wakeflow Governance / Evidence：调用方可选择的证据来源与 Manifest 里的来源投影（能力卡 8 Q2、Q3）。
 *
 * 选择只表达种类、逻辑来源和内容审阅策略：`managed-path` 指配置根下的文件或目录树，
 * `observation` 指本工作区的一条宿主 hook 观察记录，`link` 与 `commit` 是只做定位的引用。
 * 它不接收绝对路径、来源摘要、Evidence ID、时间或 payload 清单；这些由捕获规划从当前权威
 * 和实际字节派生。Manifest 的来源投影在 `observation` 上多出记录的脱敏字段：事件、时间、
 * 摘要和 transcript 有无，永不包含会话句柄与工作目录。
 */

export type ManagedEvidenceContentReviewPolicy = "reject" | "controller-confirmed";
export type ManagedEvidenceResourceType = "file" | "tree";

export type ManagedEvidenceSourceRoot =
  | Readonly<{
      readonly kind: "repository";
      readonly repositoryId: WakeflowDurableId<"repository">;
    }>
  | Readonly<{
      readonly kind: "support-surface";
      readonly surfaceId: WakeflowDurableId<"surface">;
    }>
  | Readonly<{
      /** worktree pod 产品窗口登记的检出（ADR-0010 后果：能力卡 8 的 `pod-worktree` 根）。 */
      readonly kind: "pod-worktree";
      readonly podId: WakeflowDurableId<"pod">;
      readonly repositoryId: WakeflowDurableId<"repository">;
    }>;

export interface ManagedEvidenceManagedPathSource {
  readonly kind: "managed-path";
  readonly root: ManagedEvidenceSourceRoot;
  readonly path: PortableResourcePath;
  readonly resourceType: ManagedEvidenceResourceType;
}

export interface ManagedEvidenceObservationSelection {
  readonly kind: "observation";
  readonly hostId: WakeflowHostId;
  readonly recordId: string;
}

/** hook 记录的脱敏投影：会话句柄与工作目录永不进入。 */
export interface ManagedEvidenceObservationSource extends ManagedEvidenceObservationSelection {
  readonly event: HostHookEvent;
  readonly recordedAt: UtcInstant;
  readonly turnId: string | null;
  readonly promptDigest: Sha256Digest | null;
  readonly lastAssistantMessageDigest: Sha256Digest | null;
  readonly transcript: "present" | "absent";
  readonly recordDigest: Sha256Digest;
}

export interface ManagedEvidenceLinkSource {
  readonly kind: "link";
  readonly url: string;
  /** 调用方给出的内容摘要；Wakeflow 从不抓取链接。 */
  readonly digest: Sha256Digest | null;
}

export interface ManagedEvidenceCommitSource {
  readonly kind: "commit";
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly commitOid: string;
}

export type ManagedEvidenceSelectionSource =
  | Readonly<ManagedEvidenceManagedPathSource>
  | Readonly<ManagedEvidenceObservationSelection>
  | Readonly<ManagedEvidenceLinkSource>
  | Readonly<ManagedEvidenceCommitSource>;

export type ManagedEvidenceSource =
  | Readonly<ManagedEvidenceManagedPathSource>
  | Readonly<ManagedEvidenceObservationSource>
  | Readonly<ManagedEvidenceLinkSource>
  | Readonly<ManagedEvidenceCommitSource>;

export interface ManagedEvidenceSourceSelection {
  readonly kind: EvidenceKind;
  readonly source: ManagedEvidenceSelectionSource;
  readonly contentReview: ManagedEvidenceContentReviewPolicy;
}

export type ManagedEvidenceSourceSelectionErrorReason =
  | "input"
  | "identifier"
  | "path"
  | "kind"
  | "source"
  | "record"
  | "url"
  | "commit"
  | "digest"
  | "time"
  | "content-review";

const ERROR_MESSAGES = {
  input: "Managed evidence source selection input is invalid.",
  identifier: "Managed evidence source selection contains an invalid typed identity.",
  path: "Managed evidence source selection contains an invalid portable path.",
  kind: "Managed evidence kind does not match its source.",
  source: "Managed evidence source selection must identify one admitted source.",
  record: "Managed evidence observation source contains an invalid record projection.",
  url: "Managed evidence link source must be one https URL without credentials.",
  commit: "Managed evidence commit source contains an invalid object id.",
  digest: "Managed evidence source contains an invalid digest.",
  time: "Managed evidence source contains an invalid time.",
  "content-review": "Managed evidence source selection content review policy is invalid.",
} as const satisfies Readonly<Record<ManagedEvidenceSourceSelectionErrorReason, string>>;

export class ManagedEvidenceSourceSelectionError extends Error {
  override readonly name = "ManagedEvidenceSourceSelectionError";
  readonly code = "wakeflow-managed-evidence-source-selection" as const;
  readonly reason: ManagedEvidenceSourceSelectionErrorReason;
  readonly path: string;

  constructor(reason: ManagedEvidenceSourceSelectionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const SELECTION_FIELDS = Object.freeze(["contentReview", "kind", "source"] as const);
const MANAGED_PATH_FIELDS = Object.freeze(["kind", "path", "resourceType", "root"] as const);
const OBSERVATION_SELECTION_FIELDS = Object.freeze(["hostId", "kind", "recordId"] as const);
const OBSERVATION_SOURCE_FIELDS = Object.freeze([
  "event",
  "hostId",
  "kind",
  "lastAssistantMessageDigest",
  "promptDigest",
  "recordDigest",
  "recordId",
  "recordedAt",
  "transcript",
  "turnId",
] as const);
const LINK_SELECTION_FIELDS = Object.freeze(["kind", "url"] as const);
const LINK_SOURCE_FIELDS = Object.freeze(["digest", "kind", "url"] as const);
const COMMIT_FIELDS = Object.freeze(["commitOid", "kind", "repositoryId"] as const);
const REPOSITORY_ROOT_FIELDS = Object.freeze(["kind", "repositoryId"] as const);
const SUPPORT_ROOT_FIELDS = Object.freeze(["kind", "surfaceId"] as const);
const POD_WORKTREE_ROOT_FIELDS = Object.freeze(["kind", "podId", "repositoryId"] as const);
const RECORD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
const COMMIT_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const URL_MAXIMUM_LENGTH = 2048;
const RESERVED_SOURCE_ROOT_SEGMENTS = new Set([".git", ".wakeflow-active", ".wakeflow-local"]);

/** 种类与来源的固定关系：`transcript` 只能引用带 transcript 的 hook 记录（Q3）。 */
const KINDS_BY_SOURCE: Readonly<Record<ManagedEvidenceSource["kind"], readonly EvidenceKind[]>> =
  Object.freeze({
    "managed-path": Object.freeze(["test-output", "diff", "document"] as const),
    observation: Object.freeze(["hook-observation", "transcript"] as const),
    link: Object.freeze(["link"] as const),
    commit: Object.freeze(["commit"] as const),
  });

function fail(reason: ManagedEvidenceSourceSelectionErrorReason, path: string): never {
  throw new ManagedEvidenceSourceSelectionError(reason, path);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
  reason: "input" | "source" | "record",
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail(reason, path);
    throw error;
  }
  const keys = Object.keys(record).sort(compareText);
  if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) {
    fail(reason, path);
  }
  return record;
}

function parseId<K extends "repository" | "surface" | "pod">(
  value: unknown,
  kind: K,
  path: string,
): WakeflowDurableId<K> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function parseNullableDigest(value: unknown, path: string): Sha256Digest | null {
  return value === null ? null : parseDigest(value, path);
}

function parseSourceRoot(value: unknown, path: string): ManagedEvidenceSourceRoot {
  let base: Readonly<Record<string, unknown>>;
  try {
    base = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("source", path);
    throw error;
  }
  if (base.kind === "repository") {
    const record = exactRecord(base, REPOSITORY_ROOT_FIELDS, path, "source");
    return Object.freeze({
      kind: "repository" as const,
      repositoryId: parseId(record.repositoryId, "repository", `${path}/repositoryId`),
    });
  }
  if (base.kind === "support-surface") {
    const record = exactRecord(base, SUPPORT_ROOT_FIELDS, path, "source");
    return Object.freeze({
      kind: "support-surface" as const,
      surfaceId: parseId(record.surfaceId, "surface", `${path}/surfaceId`),
    });
  }
  if (base.kind === "pod-worktree") {
    const record = exactRecord(base, POD_WORKTREE_ROOT_FIELDS, path, "source");
    return Object.freeze({
      kind: "pod-worktree" as const,
      podId: parseId(record.podId, "pod", `${path}/podId`),
      repositoryId: parseId(record.repositoryId, "repository", `${path}/repositoryId`),
    });
  }
  fail("source", `${path}/kind`);
}

function parseManagedPath(
  value: unknown,
  path: string,
): Readonly<ManagedEvidenceManagedPathSource> {
  const record = exactRecord(value, MANAGED_PATH_FIELDS, path, "source");
  let resourcePath: PortableResourcePath;
  try {
    resourcePath = parsePortableResourcePath(record.path, `${path}/path`);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("path", `${path}/path`);
    throw error;
  }
  const firstSegment = resourcePath.split("/", 1)[0]?.toLowerCase();
  if (firstSegment !== undefined && RESERVED_SOURCE_ROOT_SEGMENTS.has(firstSegment)) {
    fail("path", `${path}/path`);
  }
  if (record.resourceType !== "file" && record.resourceType !== "tree") {
    fail("source", `${path}/resourceType`);
  }
  return Object.freeze({
    kind: "managed-path" as const,
    root: parseSourceRoot(record.root, `${path}/root`),
    path: resourcePath,
    resourceType: record.resourceType,
  });
}

function parseHostId(value: unknown, path: string): WakeflowHostId {
  if (!isWakeflowHostId(value)) fail("source", path);
  return value;
}

function parseRecordId(value: unknown, path: string): string {
  if (typeof value !== "string" || !RECORD_ID_PATTERN.test(value)) fail("record", path);
  return value;
}

function parseObservationSelection(
  value: unknown,
  path: string,
): Readonly<ManagedEvidenceObservationSelection> {
  const record = exactRecord(value, OBSERVATION_SELECTION_FIELDS, path, "source");
  return Object.freeze({
    kind: "observation" as const,
    hostId: parseHostId(record.hostId, `${path}/hostId`),
    recordId: parseRecordId(record.recordId, `${path}/recordId`),
  });
}

function parseHookEvent(value: unknown, path: string): HostHookEvent {
  if (typeof value !== "string" || !(HOST_HOOK_EVENTS as readonly string[]).includes(value)) {
    fail("record", path);
  }
  return value as HostHookEvent;
}

function parseObservationSource(
  value: unknown,
  path: string,
): Readonly<ManagedEvidenceObservationSource> {
  const record = exactRecord(value, OBSERVATION_SOURCE_FIELDS, path, "record");
  let recordedAt: UtcInstant;
  try {
    recordedAt = parseUtcInstant(record.recordedAt, `${path}/recordedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", `${path}/recordedAt`);
    throw error;
  }
  if (
    record.turnId !== null &&
    (typeof record.turnId !== "string" || !TURN_ID_PATTERN.test(record.turnId))
  ) {
    fail("record", `${path}/turnId`);
  }
  if (record.transcript !== "present" && record.transcript !== "absent") {
    fail("record", `${path}/transcript`);
  }
  return Object.freeze({
    kind: "observation" as const,
    hostId: parseHostId(record.hostId, `${path}/hostId`),
    recordId: parseRecordId(record.recordId, `${path}/recordId`),
    event: parseHookEvent(record.event, `${path}/event`),
    recordedAt,
    turnId: record.turnId as string | null,
    promptDigest: parseNullableDigest(record.promptDigest, `${path}/promptDigest`),
    lastAssistantMessageDigest: parseNullableDigest(
      record.lastAssistantMessageDigest,
      `${path}/lastAssistantMessageDigest`,
    ),
    transcript: record.transcript,
    recordDigest: parseDigest(record.recordDigest, `${path}/recordDigest`),
  });
}

/** 只接受不带凭证、不含空白与引号的 https URL；不做规范化，记录调用方给出的原文。 */
export function parseManagedEvidenceLinkUrl(value: unknown, path = "$/source/url"): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > URL_MAXIMUM_LENGTH ||
    /[\s"'`<>]/u.test(value)
  ) {
    fail("url", path);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("url", path);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hostname.length === 0
  ) {
    fail("url", path);
  }
  return value;
}

function parseLink(
  value: unknown,
  path: string,
  fields: readonly string[],
): Readonly<ManagedEvidenceLinkSource> {
  const record = exactRecord(value, fields, path, "source");
  return Object.freeze({
    kind: "link" as const,
    url: parseManagedEvidenceLinkUrl(record.url, `${path}/url`),
    digest: Object.hasOwn(record, "digest")
      ? parseNullableDigest(record.digest, `${path}/digest`)
      : null,
  });
}

function parseCommit(value: unknown, path: string): Readonly<ManagedEvidenceCommitSource> {
  const record = exactRecord(value, COMMIT_FIELDS, path, "source");
  if (typeof record.commitOid !== "string" || !COMMIT_OID_PATTERN.test(record.commitOid)) {
    fail("commit", `${path}/commitOid`);
  }
  return Object.freeze({
    kind: "commit" as const,
    repositoryId: parseId(record.repositoryId, "repository", `${path}/repositoryId`),
    commitOid: record.commitOid,
  });
}

function sourceKindOf(value: unknown, path: string): string {
  let base: Readonly<Record<string, unknown>>;
  try {
    base = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("source", path);
    throw error;
  }
  if (typeof base.kind !== "string") fail("source", `${path}/kind`);
  return base.kind;
}

/** 解析调用方选择里的来源：observation 只带记录身份，link 的摘要可省略。 */
export function parseManagedEvidenceSelectionSource(
  value: unknown,
  path = "$/source",
): ManagedEvidenceSelectionSource {
  switch (sourceKindOf(value, path)) {
    case "managed-path":
      return parseManagedPath(value, path);
    case "observation":
      return parseObservationSelection(value, path);
    case "link": {
      const kind = Object.hasOwn(value as object, "digest")
        ? LINK_SOURCE_FIELDS
        : LINK_SELECTION_FIELDS;
      return parseLink(value, path, kind);
    }
    case "commit":
      return parseCommit(value, path);
    default:
      fail("source", `${path}/kind`);
  }
}

/** 解析 Manifest 与规划共用的来源投影：observation 带完整脱敏字段，link 的摘要必须显式。 */
export function parseManagedEvidenceSourceDescriptor(
  value: unknown,
  path = "$/source",
): ManagedEvidenceSource {
  switch (sourceKindOf(value, path)) {
    case "managed-path":
      return parseManagedPath(value, path);
    case "observation":
      return parseObservationSource(value, path);
    case "link":
      return parseLink(value, path, LINK_SOURCE_FIELDS);
    case "commit":
      return parseCommit(value, path);
    default:
      fail("source", `${path}/kind`);
  }
}

/** 种类必须属于来源允许的集合；`transcript` 还要求记录带 transcript。 */
export function assertManagedEvidenceKindMatchesSource(
  kind: EvidenceKind,
  source: ManagedEvidenceSelectionSource | ManagedEvidenceSource,
  path = "$/kind",
): void {
  if (!KINDS_BY_SOURCE[source.kind].includes(kind)) fail("kind", path);
  if (
    kind === "transcript" &&
    source.kind === "observation" &&
    "transcript" in source &&
    source.transcript !== "present"
  ) {
    fail("kind", path);
  }
}

/** 解析公共层之下仍只包含调用方意图的证据选择。 */
export function parseManagedEvidenceSourceSelection(
  value: unknown,
): Readonly<ManagedEvidenceSourceSelection> {
  const record = exactRecord(value, SELECTION_FIELDS, "$selection", "input");
  if (!isEvidenceKind(record.kind)) fail("kind", "$/kind");
  if (record.contentReview !== "reject" && record.contentReview !== "controller-confirmed") {
    fail("content-review", "$/contentReview");
  }
  const source = parseManagedEvidenceSelectionSource(record.source);
  assertManagedEvidenceKindMatchesSource(record.kind, source);
  return Object.freeze({ kind: record.kind, source, contentReview: record.contentReview });
}

function sourceRootKey(root: ManagedEvidenceSourceRoot): string {
  switch (root.kind) {
    case "repository":
      return `repository:${root.repositoryId}`;
    case "support-surface":
      return `support-surface:${root.surfaceId}`;
    case "pod-worktree":
      return `pod-worktree:${root.podId}:${root.repositoryId}`;
    default: {
      const exhaustive: never = root;
      return exhaustive;
    }
  }
}

/** 来源的稳定键：同一 Demand 里同键同内容的记录只有一份（切片 8 D1）。 */
export function managedEvidenceSourceKey(source: ManagedEvidenceSelectionSource): string {
  switch (source.kind) {
    case "managed-path":
      return `managed-path:${sourceRootKey(source.root)}:${source.resourceType}:${source.path}`;
    case "observation":
      return `observation:${source.hostId}:${source.recordId}`;
    case "link":
      return `link:${source.url}`;
    case "commit":
      return `commit:${source.repositoryId}:${source.commitOid}`;
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}
