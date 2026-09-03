import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import {
  parseManagedEvidenceCapturePlan,
  ManagedEvidenceCapturePlanError,
} from "../../../src/governance/evidence/managed-evidence-capture-plan.js";
import {
  computeManagedEvidencePublicationTransactionDigest,
  createManagedEvidencePublicationTransaction,
  deriveManagedEvidencePublicationEventSourcingCommand,
  deriveManagedEvidencePublicationRecordTreePlan,
  parseManagedEvidencePublicationTransaction,
  parseManagedEvidencePublicationTransactionDocument,
  renderManagedEvidencePublicationTransaction,
  ManagedEvidencePublicationTransactionError,
  type ManagedEvidencePublicationTransactionErrorReason,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";
import {
  createManagedEvidenceCapturePlanFixture,
  MANAGED_EVIDENCE_PUBLICATION_TEST_DIGESTS as DIGESTS,
  MANAGED_EVIDENCE_PUBLICATION_TEST_IDS as IDS,
} from "./managed-evidence-publication.fixture.js";

const capturePlan = createManagedEvidenceCapturePlanFixture;

function expectTransactionError(
  action: () => unknown,
  reason: ManagedEvidencePublicationTransactionErrorReason,
): void {
  throws(
    action,
    (error: unknown) =>
      error instanceof ManagedEvidencePublicationTransactionError &&
      error.reason === reason,
  );
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("Capture plan纯合同重验Planning输出并拒绝摘要漂移", () => {
  const plan = capturePlan();
  deepEqual(parseManagedEvidenceCapturePlan(structuredClone(plan)), plan);
  throws(
    () =>
      parseManagedEvidenceCapturePlan({
        ...plan,
        planDigest: DIGESTS.replacement,
      }),
    (error: unknown) =>
      error instanceof ManagedEvidenceCapturePlanError &&
      error.reason === "relation" &&
      error.path === "$/planDigest",
  );
  assertDeepFrozen(plan);
});

test("Publication transaction只持久化Manifest、计划摘要与明确Event Sourcing追加意图", () => {
  const plan = capturePlan();
  const transaction = createManagedEvidencePublicationTransaction({
    capturePlan: plan,
    eventId: IDS.event,
    commitId: IDS.commit,
  });

  equal(
    transaction.artifactKind,
    "wakeflow-managed-evidence-publication-transaction",
  );
  equal(transaction.capturePlanDigest, plan.planDigest);
  equal(
    transaction.demandEventSourcingAppend.expectedStreamRevision,
    plan.expectedDemand.streamRevision,
  );
  equal(transaction.demandEventSourcingAppend.eventId, IDS.event);
  equal(transaction.demandEventSourcingAppend.commitId, IDS.commit);
  equal(Object.hasOwn(transaction, "phase"), false);
  equal(Object.hasOwn(transaction, "stageRef"), false);
  equal(Object.hasOwn(transaction, "finalRootRef"), false);
  equal(Object.hasOwn(transaction, "demandId"), false);
  equal(Object.hasOwn(transaction, "evidenceId"), false);

  const command = deriveManagedEvidencePublicationEventSourcingCommand(
    transaction,
  );
  equal(command.commandType, "evidence.record-managed-evidence");
  equal(command.eventId, IDS.event);
  equal(command.manifest.manifestDigest, plan.manifest.manifestDigest);
  const recordPlan = deriveManagedEvidencePublicationRecordTreePlan(
    transaction,
  );
  equal(recordPlan.planDigest, transaction.recordTreePlanDigest);
  deepEqual(recordPlan.manifest, transaction.manifest);

  const text = renderManagedEvidencePublicationTransaction(transaction);
  deepEqual(
    parseManagedEvidencePublicationTransactionDocument(text),
    transaction,
  );
  deepEqual(
    parseManagedEvidencePublicationTransaction(structuredClone(transaction)),
    transaction,
  );
  equal(
    computeManagedEvidencePublicationTransactionDigest(transaction),
    computeCanonicalJsonSha256Digest(transaction),
  );
  assertDeepFrozen(transaction);
});

test("Publication transaction拒绝capture、record与Event Sourcing关系被分别替换", () => {
  const plan = capturePlan();
  const transaction = createManagedEvidencePublicationTransaction({
    capturePlan: plan,
    eventId: IDS.event,
    commitId: IDS.commit,
  });

  expectTransactionError(
    () =>
      parseManagedEvidencePublicationTransaction({
        ...transaction,
        capturePlanDigest: DIGESTS.replacement,
      }),
    "relation",
  );
  expectTransactionError(
    () =>
      parseManagedEvidencePublicationTransaction({
        ...transaction,
        recordTreePlanDigest: DIGESTS.replacement,
      }),
    "relation",
  );
  expectTransactionError(
    () =>
      parseManagedEvidencePublicationTransaction({
        ...transaction,
        demandEventSourcingAppend: {
          ...transaction.demandEventSourcingAppend,
          commandDigest: DIGESTS.replacement,
        },
      }),
    "relation",
  );
  expectTransactionError(
    () =>
      parseManagedEvidencePublicationTransaction({
        ...transaction,
        demandEventSourcingAppend: {
          ...transaction.demandEventSourcingAppend,
          eventId: transaction.demandEventSourcingAppend.expectedLastEventId,
        },
      }),
    "relation",
  );
  expectTransactionError(
    () =>
      createManagedEvidencePublicationTransaction({
        capturePlan: { ...plan, planDigest: DIGESTS.replacement },
        eventId: IDS.event,
        commitId: IDS.commit,
      }),
    "capture-plan",
  );
  expectTransactionError(
    () =>
      parseManagedEvidencePublicationTransaction({
        ...transaction,
        futurePhase: "prepared",
      }),
    "schema",
  );
});

test("Publication transaction文档拒绝非确定性JSON表示", () => {
  const transaction = createManagedEvidencePublicationTransaction({
    capturePlan: capturePlan(),
    eventId: IDS.event,
    commitId: IDS.commit,
  });
  expectTransactionError(
    () =>
      parseManagedEvidencePublicationTransactionDocument(
        JSON.stringify(transaction),
      ),
    "representation",
  );
});
