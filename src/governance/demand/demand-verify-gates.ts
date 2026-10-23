import {
  readWakeflowConfigAuthoritySnapshot,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import { parsePortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
} from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import type { RequirementClaimStateSource } from "../../kernel/requirement-board.js";
import { inspectWorkClaim } from "../../kernel/work-claims.js";
import {
  ManagedEvidenceManifestError,
  parseManagedEvidenceManifest,
} from "../evidence/managed-evidence-manifest.js";
import {
  managedEvidenceManifestRef,
  managedEvidencePayloadRootRef,
} from "../evidence/managed-evidence-resource-paths.js";
import { inspectLedgerAuthorityLayout } from "../ledger/ledger-authority-layout.js";
import { readDemandAcceptanceCoverage } from "./demand-acceptance-coverage.js";
import { DemandEventSourcingRepository } from "./event-sourcing/demand-event-sourcing-repository.js";
import type { LoadedDemandEventSourcingRootAuthority } from "./event-sourcing/demand-event-sourcing-root-authority.js";
import type { DemandAggregateState } from "./model/demand-aggregate-state.js";

/**
 * Wakeflow Governance / Demand：一个 Demand 的 verify 门（ADR-0012 D3，能力卡 9 Q4）。
 *
 * 完成与取消的 preview 内嵌这些门，`wakeflow_verify{demandId}` 复用同一份（§13.94 D3）。
 * 每道门只读；读不到即 `unavailable`，与 `fail` 一样阻塞。`payloadBlockers` 为 null 时
 * 不评估 payload-privacy 门（只有完成路径扫描负载正文）。报告确定性，摘要只依赖门的结果。
 */

export interface VerifyGateOutcome {
  readonly gate: string;
  readonly status: "pass" | "fail" | "unavailable";
  readonly detail: string | null;
}

export interface VerifyReport {
  readonly kind: "WakeflowDemandVerifyReport";
  readonly schemaVersion: 1;
  readonly demandId: string;
  readonly gates: readonly VerifyGateOutcome[];
  readonly observationDigest: string;
}

export interface VerifyInput {
  readonly workspaceRoot: RootedDirectory;
  readonly ledgerRoot: RootedDirectory;
  readonly snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly demandRoot: RootedDirectory;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
  readonly claim: RequirementClaimStateSource | null;
  readonly windowIds: readonly string[];
  /** 负载隐私扫描的阻塞项；null 表示本次不扫描负载，不设 payload-privacy 门。 */
  readonly payloadBlockers: readonly string[] | null;
  readonly signal: AbortSignal | undefined;
}

const MANIFEST_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$manifest.maximumBytes");

function computeVerifyObservationDigest(gates: readonly VerifyGateOutcome[]): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseJsonValue({ gates }, "$verify"));
}

/** 本 Demand 曾派工的全部窗口，去重排序；工作声明按窗口检查与释放。 */
export function demandWindowIds(state: Readonly<DemandAggregateState>): readonly string[] {
  return Object.freeze([...new Set(state.targetTasks.map((target) => target.windowId))].sort());
}

function gate(name: string, status: VerifyGateOutcome["status"], detail: string | null = null) {
  return Object.freeze({ gate: name, status, detail });
}

async function guarded<Outcome extends VerifyGateOutcome | null>(
  name: string,
  probe: () => Promise<Outcome>,
): Promise<Outcome | VerifyGateOutcome> {
  try {
    return await probe();
  } catch (error: unknown) {
    const reason =
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      typeof error.reason === "string"
        ? error.reason
        : "error";
    // 中止不是门的失败：照常上抛，剩下的门也不再白跑。
    if (reason === "aborted") throw error;
    return gate(name, "unavailable", reason);
  }
}

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

async function configGate(input: VerifyInput): Promise<VerifyGateOutcome> {
  const current = await readWakeflowConfigAuthoritySnapshot(
    input.workspaceRoot,
    signalOptions(input.signal),
  );
  return current.configDigest === input.snapshot.configDigest
    ? gate("config-authority", "pass")
    : gate("config-authority", "fail", "config-changed");
}

async function ledgerGate(input: VerifyInput): Promise<VerifyGateOutcome> {
  const inspection = await inspectLedgerAuthorityLayout(input.ledgerRoot, input.signal);
  return inspection.status === "current"
    ? gate("ledger-layout", "pass")
    : gate("ledger-layout", "fail", inspection.status);
}

async function auditGate(input: VerifyInput): Promise<VerifyGateOutcome> {
  const audited = await new DemandEventSourcingRepository(input.demandRoot).audit(
    signalOptions(input.signal),
  );
  return audited.aggregate.stateDigest === input.loaded.aggregate.stateDigest
    ? gate("demand-root-audit", "pass")
    : gate("demand-root-audit", "fail", "state-digest-drift");
}

function boardGate(input: VerifyInput): VerifyGateOutcome {
  const state = input.claim?.state;
  if (state === undefined) return gate("board-claim", "fail", "package-unknown");
  if (state.status !== "claimed") return gate("board-claim", "fail", state.status);
  return state.claim?.demandId === input.loaded.identity.demandId
    ? gate("board-claim", "pass")
    : gate("board-claim", "fail", "claimed-by-other-demand");
}

async function workClaimGate(input: VerifyInput): Promise<VerifyGateOutcome> {
  const held: string[] = [];
  for (const windowId of input.windowIds) {
    const result = await inspectWorkClaim(
      input.workspaceRoot,
      windowId,
      signalOptions(input.signal),
    );
    if (result.status !== "absent") held.push(windowId);
  }
  return held.length === 0
    ? gate("work-claims-released", "pass")
    : gate("work-claims-released", "fail", held.join(","));
}

function appendCandidateGate(input: VerifyInput): VerifyGateOutcome {
  return input.loaded.inventory.appendCandidateCount === 0
    ? gate("append-candidates-clear", "pass")
    : gate("append-candidates-clear", "fail", String(input.loaded.inventory.appendCandidateCount));
}

/**
 * 复审 G6：每条受管证据的负载字节在完成路径上重新哈希——清单树里每个文件的字节数与 sha256 都要
 * 等于磁盘上的；读不到、超长、摘要不等都算该条证据失败（`<evidenceId>:<ref>`）。上限由证据清单
 * 自己的容量（内核 WAKEFLOW_DEMAND_TREE_CAPACITY）压住，所以可归档的证据必然可重哈希。
 */
async function payloadFileMismatch(
  input: VerifyInput,
  evidenceId: string,
  payloadRoot: string,
  file: Readonly<{ readonly ref: string; readonly bytes: number; readonly digest: string }>,
): Promise<string | null> {
  const ref = parsePortableResourcePath(`${payloadRoot}/${file.ref}`, "$evidence");
  let bytes: Uint8Array;
  try {
    bytes = (
      await readStableFile(input.demandRoot, ref, {
        maximumBytes: parseByteCount(Math.max(file.bytes, 1), "$evidence.maximumBytes"),
        ...signalOptions(input.signal),
      })
    ).bytes;
  } catch (error: unknown) {
    if (error instanceof StableFileReadError && error.reason !== "aborted") {
      return `${evidenceId}:${file.ref}`;
    }
    throw error;
  }
  const matches =
    bytes.byteLength === file.bytes && computeSha256Digest(bytes, "$evidence") === file.digest;
  return matches ? null : `${evidenceId}:${file.ref}`;
}

async function evidencePayloadMismatch(
  input: VerifyInput,
  evidenceId: string,
  value: unknown,
): Promise<string | null> {
  let manifest: ReturnType<typeof parseManagedEvidenceManifest>;
  try {
    manifest = parseManagedEvidenceManifest(value);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceManifestError) return `${evidenceId}:manifest`;
    throw error;
  }
  const payloadRoot = managedEvidencePayloadRootRef(evidenceId);
  for (const file of manifest.payload.treeManifest.files) {
    const mismatch = await payloadFileMismatch(input, evidenceId, payloadRoot, file);
    if (mismatch !== null) return mismatch;
  }
  return null;
}

async function evidenceGate(input: VerifyInput): Promise<VerifyGateOutcome> {
  for (const summary of input.loaded.aggregate.state.managedEvidence ?? []) {
    const read = await readDeterministicJsonFile(
      input.demandRoot,
      managedEvidenceManifestRef(summary.evidenceId),
      { maximumBytes: MANIFEST_MAXIMUM_BYTES, ...signalOptions(input.signal) },
    );
    const value = read.value;
    const evidenceId =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).evidenceId
        : undefined;
    if (evidenceId !== summary.evidenceId) {
      return gate("evidence-integrity", "fail", summary.evidenceId);
    }
    const mismatch = await evidencePayloadMismatch(input, summary.evidenceId, value);
    if (mismatch !== null) return gate("evidence-integrity", "fail", mismatch);
  }
  return gate("evidence-integrity", "pass");
}

function privacyGate(payloadBlockers: readonly string[]): VerifyGateOutcome {
  return payloadBlockers.length === 0
    ? gate("payload-privacy", "pass")
    : gate("payload-privacy", "fail", String(payloadBlockers.length));
}

/** research Demand 的完成物：至少一条 document 类受管证据（§13.94 D8）；其他类型不设此门。 */
function researchEvidenceGate(input: VerifyInput): VerifyGateOutcome | null {
  if (input.loaded.identity.demandType !== "research") return null;
  const documents = (input.loaded.aggregate.state.managedEvidence ?? []).filter(
    (summary) => summary.kind === "document",
  );
  return documents.length > 0
    ? gate("research-evidence", "pass")
    : gate("research-evidence", "fail", "document-evidence-missing");
}

/**
 * 任务包声明的证据要求（R4）：所有已规划包 `requiredEvidenceKinds` 的并集都要在受管证据里出现；
 * 没有任何包声明时不设此门。包从已规划事件重读（与 coverage 同一做法）。
 */
async function requiredEvidenceGate(input: VerifyInput): Promise<VerifyGateOutcome | null> {
  const repository = new DemandEventSourcingRepository(input.demandRoot);
  const required = new Set<string>();
  for (const target of input.loaded.aggregate.state.targetTasks) {
    const planned = await repository.findTargetTaskPlannedEvent(
      target.taskPackageId,
      signalOptions(input.signal),
    );
    for (const kind of planned?.event.data.taskPackage.requiredEvidenceKinds ?? [])
      required.add(kind);
  }
  if (required.size === 0) return null;
  const held = new Set<string>(
    (input.loaded.aggregate.state.managedEvidence ?? []).map((summary) => summary.kind),
  );
  const missing = [...required].filter((kind) => !held.has(kind)).sort();
  return missing.length === 0
    ? gate("required-evidence", "pass")
    : gate("required-evidence", "fail", `missing:${missing.join(",")}`);
}

/** 门按固定顺序评估；报告确定性，摘要只依赖门的结果。 */
export async function evaluateVerifyGates(input: VerifyInput): Promise<VerifyReport> {
  const research = researchEvidenceGate(input);
  const requiredEvidence = await guarded("required-evidence", () => requiredEvidenceGate(input));
  const gates: VerifyGateOutcome[] = [
    await guarded("config-authority", () => configGate(input)),
    await guarded("ledger-layout", () => ledgerGate(input)),
    await guarded("demand-root-audit", () => auditGate(input)),
    boardGate(input),
    await guarded("work-claims-released", () => workClaimGate(input)),
    appendCandidateGate(input),
    await guarded("evidence-integrity", () => evidenceGate(input)),
    ...(input.payloadBlockers === null ? [] : [privacyGate(input.payloadBlockers)]),
    ...(research === null ? [] : [research]),
    ...(requiredEvidence === null ? [] : [requiredEvidence]),
    ...(input.loaded.identity.demandType === "research" ||
    input.loaded.aggregate.state.lifecycle !== "active"
      ? []
      : [
          await guarded("requirement-coverage", async () => {
            const coverage = await readDemandAcceptanceCoverage(
              input.demandRoot,
              input.ledgerRoot,
              input.loaded,
              input.signal,
            );
            if (coverage.total === 0)
              return gate("requirement-coverage", "fail", "acceptance-criteria-empty");
            if (coverage.uncovered.length === 0) return gate("requirement-coverage", "pass");
            const shown = coverage.uncovered.slice(0, 20).join(",");
            return gate(
              "requirement-coverage",
              "fail",
              `uncovered:${coverage.uncovered.length}:${shown}`,
            );
          }),
        ]),
  ];
  return Object.freeze({
    kind: "WakeflowDemandVerifyReport",
    schemaVersion: 1,
    demandId: input.loaded.identity.demandId,
    gates: Object.freeze(gates),
    observationDigest: computeVerifyObservationDigest(gates),
  });
}
