import { WAKEFLOW_LOADED_ARTIFACT_TREE_MANIFEST_SCHEMA } from "../../contracts/generated/foundation/loaded-artifact-tree-manifest.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA } from "../../contracts/generated/governance/evidence/managed-evidence-manifest.generated.js";
import type { WakeflowManagedEvidencePublicationTransaction as TransactionWire } from "../../contracts/generated/governance/evidence/managed-evidence-publication-transaction.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_SCHEMA } from "../../contracts/generated/governance/evidence/managed-evidence-publication-transaction.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import {
  type JsonValue,
  JsonValueError,
  parseJsonValue,
} from "../../foundation/data/json-value.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  computeDemandEventSourcingCommandDigest,
  DemandEventSourcingDecisionError,
  parseDemandEventSourcingCommand,
  type RecordManagedEvidenceCommand,
} from "../demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  DemandEventStreamPositionError,
  type DemandEventStreamRevision,
  parseDemandEventStreamRevision,
} from "../../contracts/identity/demand-event-stream-position.js";
import {
  createManagedEvidenceCapturePlan,
  type ManagedEvidenceCapturePlan,
  ManagedEvidenceCapturePlanError,
} from "./managed-evidence-capture-plan.js";
import {
  type ManagedEvidenceManifest,
  ManagedEvidenceManifestError,
  parseManagedEvidenceManifest,
} from "./managed-evidence-manifest.js";
import {
  type ManagedEvidenceRecordTreePlan,
  ManagedEvidenceRecordTreePlanError,
  planManagedEvidenceRecordTree,
} from "./managed-evidence-record-tree-plan.js";

/**
 * Wakeflow Governance / Evidence：Managed Evidence跨资源发布的不可变事务合同。
 *
 * Transaction把一份已确认capture plan绑定到完整record tree，以及Demand Event
 * Sourcing的一次乐观追加。它只保存恢复所需且无法从Manifest完全推导的摘要、CAS
 * 预期与稳定ID；stage/final路径、完整record plan和Event command均由codec重建。
 *
 * 本文件不保存可变phase，不读取source，不创建journal/stage/final，不追加Event，
 * 也不决定Event前退休或Event后前向完成。物理状态由后续Inventory与Application观察。
 */

const MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_KIND =
  "wakeflow-managed-evidence-publication-transaction" as const;
const MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_VERSION = 1 as const;
/** Manifest上限之外为CAS、摘要、typed ID和确定性文档格式保留固定余量。 */
export const MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_MAXIMUM_BYTES = 2 * 1024 * 1024;

export interface ManagedEvidencePublicationDemandEventSourcingAppend {
  readonly expectedStreamRevision: DemandEventStreamRevision;
  readonly expectedStateDigest: Sha256Digest;
  readonly expectedLastEventId: WakeflowDurableId<"demand-event">;
  readonly expectedLastEventDigest: Sha256Digest;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly commandDigest: Sha256Digest;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
}

export interface ManagedEvidencePublicationTransaction {
  readonly artifactKind: typeof MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_KIND;
  readonly schemaVersion: typeof MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_VERSION;
  readonly capturePlanDigest: Sha256Digest;
  readonly manifest: Readonly<ManagedEvidenceManifest>;
  readonly recordTreePlanDigest: Sha256Digest;
  readonly demandEventSourcingAppend: Readonly<ManagedEvidencePublicationDemandEventSourcingAppend>;
}

export type ManagedEvidencePublicationTransactionErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "position"
  | "digest"
  | "manifest"
  | "record-plan"
  | "event-sourcing"
  | "relation"
  | "representation";

/** Publication transaction准入或关系重建失败时的稳定、脱敏错误。 */
export class ManagedEvidencePublicationTransactionError extends ModuleError<ManagedEvidencePublicationTransactionErrorReason> {
  static override readonly code = "wakeflow-managed-evidence-publication-transaction";
}

const fail: Fail<ManagedEvidencePublicationTransactionErrorReason> = failWith(
  ManagedEvidencePublicationTransactionError,
);

const validateWire = createRuntimeJsonSchemaValidator<TransactionWire>(
  WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_SCHEMA,
  [
    WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA,
    WAKEFLOW_LOADED_ARTIFACT_TREE_MANIFEST_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path, error);
    throw error;
  }
}

function parseId<K extends "demand-event" | "demand-event-commit">(
  value: unknown,
  kind: K,
  path: string,
): WakeflowDurableId<K> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path, error);
    throw error;
  }
}

function parseManifest(value: unknown): Readonly<ManagedEvidenceManifest> {
  try {
    return parseManagedEvidenceManifest(value);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceManifestError) {
      fail("manifest", "$/manifest", error);
    }
    throw error;
  }
}

function parseStreamRevision(value: unknown): DemandEventStreamRevision {
  let revision: DemandEventStreamRevision;
  try {
    revision = parseDemandEventStreamRevision(
      value,
      "$/demandEventSourcingAppend/expectedStreamRevision",
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) {
      fail("position", "$/demandEventSourcingAppend/expectedStreamRevision", error);
    }
    throw error;
  }
  if (revision >= Number.MAX_SAFE_INTEGER) {
    fail("position", "$/demandEventSourcingAppend/expectedStreamRevision");
  }
  return revision;
}

function buildEventSourcingCommand(
  manifest: Readonly<ManagedEvidenceManifest>,
  eventId: WakeflowDurableId<"demand-event">,
): Readonly<RecordManagedEvidenceCommand> {
  try {
    const command = parseDemandEventSourcingCommand({
      commandType: "evidence.record-managed-evidence",
      commandVersion: 1,
      eventId,
      manifest,
    });
    if (command.commandType !== "evidence.record-managed-evidence") {
      fail("event-sourcing", "$/demandEventSourcingAppend");
    }
    return command;
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingDecisionError) {
      fail("event-sourcing", "$/demandEventSourcingAppend", error);
    }
    throw error;
  }
}

function deriveRecordTreePlan(
  manifest: Readonly<ManagedEvidenceManifest>,
): Readonly<ManagedEvidenceRecordTreePlan> {
  try {
    return planManagedEvidenceRecordTree(manifest);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceRecordTreePlanError) {
      fail("record-plan", "$/manifest", error);
    }
    throw error;
  }
}

function capturePlanFromTransaction(
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): Readonly<ManagedEvidenceCapturePlan> {
  try {
    return createManagedEvidenceCapturePlan({
      configDigest: transaction.manifest.recordedBy.configDigest,
      expectedDemand: {
        streamRevision: transaction.demandEventSourcingAppend.expectedStreamRevision,
        stateDigest: transaction.demandEventSourcingAppend.expectedStateDigest,
        lastEventId: transaction.demandEventSourcingAppend.expectedLastEventId,
        lastEventDigest: transaction.demandEventSourcingAppend.expectedLastEventDigest,
      },
      manifest: transaction.manifest,
    });
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceCapturePlanError) {
      fail("relation", "$/capturePlanDigest", error);
    }
    throw error;
  }
}

function normalizeAppend(
  wire: Readonly<TransactionWire["demandEventSourcingAppend"]>,
): Readonly<ManagedEvidencePublicationDemandEventSourcingAppend> {
  return Object.freeze({
    expectedStreamRevision: parseStreamRevision(wire.expectedStreamRevision),
    expectedStateDigest: parseDigest(
      wire.expectedStateDigest,
      "$/demandEventSourcingAppend/expectedStateDigest",
    ),
    expectedLastEventId: parseId(
      wire.expectedLastEventId,
      "demand-event",
      "$/demandEventSourcingAppend/expectedLastEventId",
    ),
    expectedLastEventDigest: parseDigest(
      wire.expectedLastEventDigest,
      "$/demandEventSourcingAppend/expectedLastEventDigest",
    ),
    eventId: parseId(wire.eventId, "demand-event", "$/demandEventSourcingAppend/eventId"),
    commandDigest: parseDigest(wire.commandDigest, "$/demandEventSourcingAppend/commandDigest"),
    commitId: parseId(wire.commitId, "demand-event-commit", "$/demandEventSourcingAppend/commitId"),
  });
}

function assertRelations(transaction: Readonly<ManagedEvidencePublicationTransaction>): void {
  const append = transaction.demandEventSourcingAppend;
  const command = buildEventSourcingCommand(transaction.manifest, append.eventId);
  const recordTreePlan = deriveRecordTreePlan(transaction.manifest);
  const capturePlan = capturePlanFromTransaction(transaction);
  if (
    append.eventId === append.expectedLastEventId ||
    append.commandDigest !== computeDemandEventSourcingCommandDigest(command) ||
    transaction.recordTreePlanDigest !== recordTreePlan.planDigest ||
    transaction.capturePlanDigest !== capturePlan.planDigest
  ) {
    fail("relation", "$transaction");
  }
}

/** 把任意JSON值解析为不可变、无phase的Managed Evidence发布恢复计划。 */
export function parseManagedEvidencePublicationTransaction(
  value: unknown,
): Readonly<ManagedEvidencePublicationTransaction> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$transaction");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path, error);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  const wire = result.value;
  const transaction = Object.freeze({
    artifactKind: MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_KIND,
    schemaVersion: MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_VERSION,
    capturePlanDigest: parseDigest(wire.capturePlanDigest, "$/capturePlanDigest"),
    manifest: parseManifest(wire.manifest),
    recordTreePlanDigest: parseDigest(wire.recordTreePlanDigest, "$/recordTreePlanDigest"),
    demandEventSourcingAppend: normalizeAppend(wire.demandEventSourcingAppend),
  });
  assertRelations(transaction);
  return transaction;
}

/** 创建事务的草稿：一份已确认的 capture plan 与一次性 Event/Commit ID。 */
export interface ManagedEvidencePublicationTransactionDraft {
  readonly capturePlan: Readonly<ManagedEvidenceCapturePlan>;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
}

/** 从已确认capture plan和一次性Event/Commit ID生成完整持久事务；组装结果经过一次完整解析。 */
export function createManagedEvidencePublicationTransaction(
  draft: Readonly<ManagedEvidencePublicationTransactionDraft>,
): Readonly<ManagedEvidencePublicationTransaction> {
  const { capturePlan, eventId, commitId } = draft;
  const command = buildEventSourcingCommand(capturePlan.manifest, eventId);
  const recordTreePlan = deriveRecordTreePlan(capturePlan.manifest);
  return parseManagedEvidencePublicationTransaction({
    artifactKind: MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_KIND,
    schemaVersion: MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_VERSION,
    capturePlanDigest: capturePlan.planDigest,
    manifest: capturePlan.manifest,
    recordTreePlanDigest: recordTreePlan.planDigest,
    demandEventSourcingAppend: {
      expectedStreamRevision: capturePlan.expectedDemand.streamRevision,
      expectedStateDigest: capturePlan.expectedDemand.stateDigest,
      expectedLastEventId: capturePlan.expectedDemand.lastEventId,
      expectedLastEventDigest: capturePlan.expectedDemand.lastEventDigest,
      eventId,
      commandDigest: computeDemandEventSourcingCommandDigest(command),
      commitId,
    },
  });
}

/** 从事务重建将交给Demand Command Handler的exact Event Sourcing命令。 */
export function deriveManagedEvidencePublicationEventSourcingCommand(
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): Readonly<RecordManagedEvidenceCommand> {
  return buildEventSourcingCommand(
    transaction.manifest,
    transaction.demandEventSourcingAppend.eventId,
  );
}

/** 从事务中的单份Manifest重建exact stage/final record tree计划。 */
export function deriveManagedEvidencePublicationRecordTreePlan(
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): Readonly<ManagedEvidenceRecordTreePlan> {
  return deriveRecordTreePlan(transaction.manifest);
}

export function renderManagedEvidencePublicationTransaction(
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): string {
  return renderDeterministicJsonDocument(transaction, "$transaction");
}

export function parseManagedEvidencePublicationTransactionDocument(
  text: unknown,
): Readonly<ManagedEvidencePublicationTransaction> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$transaction");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$transaction", error);
    }
    throw error;
  }
  const transaction = parseManagedEvidencePublicationTransaction(json);
  if (renderManagedEvidencePublicationTransaction(transaction) !== text) {
    fail("representation", "$transaction");
  }
  return transaction;
}

/** 事务是本编解码签发或读回的类型化值；规范 JSON 摘要自己做 JSON 准入。 */
export function computeManagedEvidencePublicationTransactionDigest(
  transaction: Readonly<ManagedEvidencePublicationTransaction>,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(transaction, "$transaction");
}
