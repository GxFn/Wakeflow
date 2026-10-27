import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { truncateToCodePoints } from "../../foundation/text/bounded-text.js";
import {
  parseUtcInstant,
  type UtcInstant,
  UtcInstantError,
} from "../../foundation/time/utc-instant.js";
import { fail } from "../../kernel/error.js";
import { demandArchiveRef, demandArchivesRootRef } from "../../kernel/layout.js";

/**
 * Wakeflow Governance / Observation：已归档 Demand 的回执摘要（`wakeflow_status{demandId}`），
 * 也供 `archived-demand-observation.ts` 的归档观察使用。
 *
 * 只读归档清单里公开的几个字段（结局、时间、终态事件、清单摘要、pod），不解析整份清单；
 * 归档观察用 podId 做 unmergedAccepted 扫描（§13.130）。归档包本身由 demand 切片封装与读回。
 */

export interface LocatedDemandArchiveSummary {
  readonly demandId: string;
  readonly archiveRef: PortableResourcePath;
  readonly outcome: "completed" | "cancelled";
  readonly archivedAt: UtcInstant;
  readonly terminalEvent: Readonly<{ readonly eventId: string; readonly streamRevision: number }>;
  readonly manifestDigest: Sha256Digest;
  /** 归档时 Demand 所在的 pod（§13.130）；清单里没有合法值时为 null。 */
  readonly podId: string | null;
  /** 封档时 verify 报告的门数与失败数（清单 `verify`）；清单里没有合法值时为 null。 */
  readonly verify: Readonly<{ readonly gateCount: number; readonly failedCount: number }> | null;
}

/** 已接受的实现目标在归档负载里留下的落点（复审 G7/G1，裁决 R8）。 */
export interface DemandArchiveAcceptedTarget {
  readonly targetTaskId: string;
  readonly repositoryId: string | null;
  readonly branch: string | null;
  readonly commit: string | null;
  readonly summary: string | null;
}

/**
 * `wakeflow_status{demandId}` 对已归档 Demand 的读回（裁决 R8）：不加持久成员，全部从归档负载现读——
 * 标题与目标来自 `payload/identity.json`，测试模式来自 `payload/authority.json`，证据数是受管证据目录的条目数，
 * 已接受目标来自事件提交（最后一次导入的报告加 accept 决定）。文本都截断到有界长度。
 */
export interface DemandArchiveReadback {
  readonly title: string;
  readonly goal: string;
  readonly testingMode: string | null;
  readonly evidenceCount: number;
  readonly acceptedTargets: readonly Readonly<DemandArchiveAcceptedTarget>[];
}

const ARCHIVE_NAME_PATTERN = /^[0-9]{10}$/u;
const COMMIT_NAME_PATTERN = /^[0-9]{16}$/u;
const MAXIMUM_COMMITS = 8192;
const MAXIMUM_EVIDENCE_ENTRIES = 4096;
const PAYLOAD_JSON_MAXIMUM_BYTES = parseByteCount(
  16 * 1024 * 1024,
  "$archive.payload.maximumBytes",
);
const TITLE_MAXIMUM_CHARACTERS = 256;
const GOAL_MAXIMUM_CHARACTERS = 512;
const SUMMARY_MAXIMUM_CHARACTERS = 280;
const POD_ID_PATTERN = /^pod_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAXIMUM_ARCHIVES_PER_DEMAND = 4096;
const MANIFEST_MAXIMUM_BYTES = parseByteCount(16 * 1024 * 1024, "$manifest.maximumBytes");
const EVENT_ID_PATTERN =
  /^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("precondition-failed", "archive-manifest", path);
  }
  return value as Readonly<Record<string, unknown>>;
}

function recordOrNull(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function summarize(
  demandId: string,
  archiveRef: PortableResourcePath,
  value: unknown,
): Readonly<LocatedDemandArchiveSummary> {
  const manifest = record(value, "$archive/manifest");
  const terminal = record(manifest.terminalEvent, "$archive/manifest/terminalEvent");
  const outcome = manifest.outcome;
  if (outcome !== "completed" && outcome !== "cancelled") {
    fail("precondition-failed", "archive-manifest", "$archive/manifest/outcome");
  }
  if (typeof terminal.eventId !== "string" || !EVENT_ID_PATTERN.test(terminal.eventId)) {
    fail("precondition-failed", "archive-manifest", "$archive/manifest/terminalEvent/eventId");
  }
  if (!Number.isSafeInteger(terminal.streamRevision) || (terminal.streamRevision as number) < 2) {
    fail(
      "precondition-failed",
      "archive-manifest",
      "$archive/manifest/terminalEvent/streamRevision",
    );
  }
  let archivedAt: UtcInstant;
  let manifestDigest: Sha256Digest;
  try {
    archivedAt = parseUtcInstant(manifest.archivedAt, "$archive/manifest/archivedAt");
    manifestDigest = parseSha256Digest(manifest.manifestDigest, "$archive/manifest/manifestDigest");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError || error instanceof Sha256Error) {
      fail("precondition-failed", "archive-manifest", "$archive/manifest", { cause: error });
    }
    throw error;
  }
  const verify = recordOrNull(manifest.verify);
  return Object.freeze({
    demandId,
    archiveRef,
    outcome,
    archivedAt,
    terminalEvent: Object.freeze({
      eventId: terminal.eventId,
      streamRevision: terminal.streamRevision as number,
    }),
    manifestDigest,
    podId:
      typeof manifest.podId === "string" && POD_ID_PATTERN.test(manifest.podId)
        ? manifest.podId
        : null,
    verify:
      verify !== null && isCount(verify.gateCount) && isCount(verify.failedCount)
        ? Object.freeze({ gateCount: verify.gateCount, failedCount: verify.failedCount })
        : null,
  });
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/gu, " ").trim();
  if (text.length === 0) return null;
  // 按码点截断（Codex 审阅 R-ROOT-05）：旧归档的 goal/summary 在上限处是 emoji 时不能留下 lone surrogate。
  return truncateToCodePoints(text, maximum);
}

/** 负载里的一份 JSON：读不到即 null（归档负载不完整只让读回变空，不让 status 失败）。 */
async function readPayloadJson(
  ledgerRoot: RootedDirectory,
  archiveRef: PortableResourcePath,
  relative: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  try {
    const read = await readDeterministicJsonFile(
      ledgerRoot,
      parsePortableResourcePath(`${archiveRef}/payload/${relative}`, "$archive"),
      { maximumBytes: PAYLOAD_JSON_MAXIMUM_BYTES, ...signalOptions(signal) },
    );
    return read.value;
  } catch (error: unknown) {
    if (error instanceof StableFileReadError && error.reason === "aborted") {
      fail("io-failure", "aborted", "$signal", { cause: error });
    }
    if (
      error instanceof StableFileReadError ||
      error instanceof StrictTextFileError ||
      error instanceof DeterministicJsonDocumentError
    ) {
      return null;
    }
    throw error;
  }
}

async function listPayloadDirectory(
  ledgerRoot: RootedDirectory,
  archiveRef: PortableResourcePath,
  relative: string,
  maximumEntries: number,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> {
  try {
    const listing = await readStableResourceDirectory(
      ledgerRoot,
      parsePortableResourcePath(`${archiveRef}/payload/${relative}`, "$archive"),
      { maximumEntries, ...signalOptions(signal) },
    );
    return listing.entries
      .filter((entry) => entry.node.kind === "directory" || entry.node.kind === "file")
      .map((entry) => entry.name);
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      return Object.freeze([]);
    }
    throw error;
  }
}

interface TargetLanding {
  repositoryId: string | null;
  branch: string | null;
  commit: string | null;
  summary: string | null;
  accepted: boolean;
}

function repositoryIdOf(
  change: Readonly<Record<string, unknown>> | null,
  assignment: Readonly<Record<string, unknown>> | null,
): string | null {
  if (typeof change?.repositoryId === "string") return change.repositoryId;
  return typeof assignment?.repositoryId === "string" ? assignment.repositoryId : null;
}

function lastCommitOf(change: Readonly<Record<string, unknown>> | null): string | null {
  const commits = Array.isArray(change?.commits) ? change.commits : [];
  const last = recordOrNull(commits.at(-1));
  return typeof last?.value === "string" ? last.value : null;
}

/** 一次导入的报告给出的落点：仓库、分支、末次提交与摘要（只收实现目标）。 */
function landingOf(data: Readonly<Record<string, unknown>>): Readonly<{
  readonly targetTaskId: string;
  readonly landing: Omit<TargetLanding, "accepted">;
}> | null {
  const result = recordOrNull(data.result);
  if (result === null || result.workType !== "implementation") return null;
  if (typeof result.targetTaskId !== "string") return null;
  const report = recordOrNull(result.report);
  const change = recordOrNull(report?.repositoryChange);
  return {
    targetTaskId: result.targetTaskId,
    landing: {
      repositoryId: repositoryIdOf(change, recordOrNull(result.assignment)),
      branch: typeof change?.branch === "string" ? change.branch : null,
      commit: lastCommitOf(change),
      summary: boundedText(report?.summary, SUMMARY_MAXIMUM_CHARACTERS),
    },
  };
}

function foldResultEvent(
  data: Readonly<Record<string, unknown>>,
  landings: Map<string, TargetLanding>,
): void {
  const imported = landingOf(data);
  if (imported === null) return;
  const previous = landings.get(imported.targetTaskId);
  landings.set(imported.targetTaskId, {
    ...imported.landing,
    accepted: previous?.accepted ?? false,
  });
}

function foldDecisionEvent(
  data: Readonly<Record<string, unknown>>,
  landings: Map<string, TargetLanding>,
): void {
  const decision = recordOrNull(data.decision);
  if (decision === null || typeof decision.targetTaskId !== "string") return;
  const current = landings.get(decision.targetTaskId);
  if (current !== undefined) current.accepted = decision.decision === "accept";
}

/** 一条事件提交里的结果与决定：最后一次导入的落点覆盖之前的，accept 决定把目标标为已接受。 */
function foldCommitEvents(commit: unknown, landings: Map<string, TargetLanding>): void {
  const events = recordOrNull(commit)?.events;
  if (!Array.isArray(events)) return;
  for (const event of events) {
    const envelope = recordOrNull(event);
    const data = recordOrNull(envelope?.data);
    if (envelope === null || data === null) continue;
    if (envelope.eventType === "result.target-result-recorded") foldResultEvent(data, landings);
    else if (envelope.eventType === "review.target-result-decided")
      foldDecisionEvent(data, landings);
  }
}

/** 读回一份已归档 Demand 的业务摘要（裁决 R8）；只读负载，读不到的部分变空而不是失败。 */
export async function describeDemandArchive(
  ledgerRoot: RootedDirectory,
  summary: Readonly<LocatedDemandArchiveSummary>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandArchiveReadback>> {
  const identity = recordOrNull(
    await readPayloadJson(ledgerRoot, summary.archiveRef, "identity.json", signal),
  );
  const authority = recordOrNull(
    await readPayloadJson(ledgerRoot, summary.archiveRef, "authority.json", signal),
  );
  const testing = recordOrNull(authority?.testingDecision);
  const evidenceEntries = await listPayloadDirectory(
    ledgerRoot,
    summary.archiveRef,
    "artifacts/managed-evidence",
    MAXIMUM_EVIDENCE_ENTRIES,
    signal,
  );
  const commitNames = (
    await listPayloadDirectory(
      ledgerRoot,
      summary.archiveRef,
      "event-sourcing/commits",
      MAXIMUM_COMMITS,
      signal,
    )
  )
    .filter((name) => name.endsWith(".json") && COMMIT_NAME_PATTERN.test(name.slice(0, -5)))
    .sort();
  const landings = new Map<string, TargetLanding>();
  for (const name of commitNames) {
    foldCommitEvents(
      await readPayloadJson(
        ledgerRoot,
        summary.archiveRef,
        `event-sourcing/commits/${name}`,
        signal,
      ),
      landings,
    );
  }
  const acceptedTargets = [...landings.entries()]
    .filter(([, landing]) => landing.accepted)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([targetTaskId, landing]) =>
      Object.freeze({
        targetTaskId,
        repositoryId: landing.repositoryId,
        branch: landing.branch,
        commit: landing.commit,
        summary: landing.summary,
      }),
    );
  return Object.freeze({
    title: boundedText(identity?.title, TITLE_MAXIMUM_CHARACTERS) ?? "",
    goal: boundedText(identity?.goal, GOAL_MAXIMUM_CHARACTERS) ?? "",
    testingMode: typeof testing?.mode === "string" ? testing.mode : null,
    evidenceCount: evidenceEntries.filter((name) => name.startsWith("evidence_")).length,
    acceptedTargets: Object.freeze(acceptedTargets),
  });
}

/**
 * 读回归档清单，读取失败与目录列举同形地编码：取消仍是 `io-failure`/`aborted`，
 * 其余读取与严格文本失败是 `io-failure`/`archive-manifest-<原因>`，
 * 结构坏掉的清单与 `summarize` 共用 `precondition-failed`/`archive-manifest`。
 * 基础层错误不是 WakeflowError，放任它逃逸会被外层收敛成 `unexpected`。
 */
async function readManifest(
  ledgerRoot: RootedDirectory,
  archiveRef: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  try {
    const read = await readDeterministicJsonFile(
      ledgerRoot,
      parsePortableResourcePath(`${archiveRef}/manifest.json`, "$archive"),
      { maximumBytes: MANIFEST_MAXIMUM_BYTES, ...signalOptions(signal) },
    );
    return read.value;
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("io-failure", `archive-manifest-${error.reason}`, "$archive/manifest", { cause: error });
    }
    if (error instanceof StrictTextFileError) {
      fail("io-failure", `archive-manifest-${error.reason}`, "$archive/manifest", { cause: error });
    }
    if (error instanceof DeterministicJsonDocumentError) {
      fail("precondition-failed", "archive-manifest", "$archive/manifest", { cause: error });
    }
    throw error;
  }
}

/** 一个 Demand 最近的归档包（修订号最大者）的回执摘要；没有归档为 null。 */
export async function locateLatestDemandArchive(
  ledgerRoot: RootedDirectory,
  demandId: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<LocatedDemandArchiveSummary> | null> {
  let listing: Awaited<ReturnType<typeof readStableResourceDirectory>>;
  try {
    listing = await readStableResourceDirectory(ledgerRoot, demandArchivesRootRef(demandId), {
      maximumEntries: MAXIMUM_ARCHIVES_PER_DEMAND,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") return null;
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("io-failure", `archive-list-${error.reason}`, "$archive", { cause: error });
    }
    throw error;
  }
  const latest = listing.entries
    .filter((entry) => entry.node.kind === "directory" && ARCHIVE_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (latest === undefined) return null;
  const archiveRef = demandArchiveRef(demandId, Number(latest));
  return summarize(demandId, archiveRef, await readManifest(ledgerRoot, archiveRef, signal));
}
