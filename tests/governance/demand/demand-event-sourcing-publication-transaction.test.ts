import {
  deepEqual,
  equal,
} from "node:assert/strict";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { canonicalizeJson } from "../../../src/foundation/data/canonical-json.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createDemandAuthority,
} from "../../../src/governance/demand/model/demand-authority.js";
import {
  createDemandIdentity,
} from "../../../src/governance/demand/model/demand-identity.js";
import {
  createDemandEventSourcingPublicationTransaction,
  parseDemandEventSourcingPublicationTransaction,
  parseDemandEventSourcingPublicationTransactionDocument,
  renderDemandEventSourcingPublicationTransaction,
} from "../../../src/governance/demand/publication/demand-event-sourcing-publication-transaction.js";
import { parseLedgerAuthorityMemberReference } from "../../../src/governance/ledger/ledger-authority-store.js";
import { parseTodoIntakeLineageReference } from "../../../src/governance/todo/todo-intake-lineage.js";
import { parseTodoItemId } from "../../../src/governance/todo/todo-item-id.js";
import { todoIntakeRef } from "../../../src/governance/todo/todo-paths.js";

const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_11111111-1111-4111-8111-111111111111",
  "program",
);
const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_22222222-2222-4222-8222-222222222222",
  "demand",
);
const REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_33333333-3333-4333-8333-333333333333",
  "requirement",
);
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_44444444-4444-4444-8444-444444444444",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_55555555-5555-4555-8555-555555555555",
  "demand-event-commit",
);
const CREATED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const COLLECTION_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const STATE_DIGEST = parseSha256Digest(`sha256:${"c".repeat(64)}`);
const TODO_ID = parseTodoItemId("TODO-RH2-PUBLICATION");
const REQUIRED_ROLES = [
  "code-facts",
  "landing-plan",
  "non-goals",
  "original-plan",
  "requirement-design",
  "user-confirmation",
] as const;

function authorityReference(role: typeof REQUIRED_ROLES[number]) {
  return parseLedgerAuthorityMemberReference({
    artifactKind: "wakeflow-ledger-authority-member-reference",
    schemaVersion: 1,
    family: "requirement",
    recordId: REQUIREMENT_ID,
    recordRef: `requirements/${REQUIREMENT_ID}/record.json`,
    recordDigest: DIGEST,
    memberPath: `authority/${role}.md`,
    memberRef: `requirements/${REQUIREMENT_ID}/authority/${role}.md`,
    memberDigest: DIGEST,
    role,
    mediaType: "text/markdown",
  });
}

test("Demand Event Sourcing publication transaction 自包含 initial command 与 commit", () => {
  const identity = createDemandIdentity({
    programId: PROGRAM_ID,
    demandId: DEMAND_ID,
    title: "Demand publication",
    goal: "发布标准 Event Sourcing root",
    completionDefinition: "TODO 与 revision 1 闭合",
    demandType: "requirement",
    source: parseTodoIntakeLineageReference({
      artifactKind: "wakeflow-todo-intake-lineage",
      schemaVersion: 1,
      todoId: TODO_ID,
      intakeRef: todoIntakeRef(TODO_ID),
      intakeDigest: DIGEST,
    }),
    executionPlacement: { mode: "main" },
  }, { clock: () => CREATED_AT });
  const authority = createDemandAuthority(identity, {
    authorityRefs: REQUIRED_ROLES.map(authorityReference),
    testingDecision: {
      mode: "controller-only",
      summary: "运行聚焦 TypeScript 测试",
      environmentMemberRef: null,
    },
  });

  const transaction = createDemandEventSourcingPublicationTransaction({
    identity,
    authority,
    eventId: EVENT_ID,
    commitId: COMMIT_ID,
    recordedAt: CREATED_AT,
    expectedTodoCollectionDigest: COLLECTION_DIGEST,
    expectedTodoStateDigest: STATE_DIGEST,
  });

  equal(transaction.artifactKind, "wakeflow-demand-event-sourcing-publication-transaction");
  equal(transaction.initialCommand.commandType, "publication.publish-demand");
  equal(transaction.initialCommit.commitId, COMMIT_ID);
  equal(transaction.initialCommit.commitSequence, 1);
  equal(transaction.initialCommit.expectedStreamRevision, 0);
  equal(transaction.expectedTodoCollectionDigest, COLLECTION_DIGEST);

  const text = renderDemandEventSourcingPublicationTransaction(transaction);
  deepEqual(parseDemandEventSourcingPublicationTransactionDocument(text), transaction);
  deepEqual(
    parseDemandEventSourcingPublicationTransaction(
      JSON.parse(canonicalizeJson(transaction, "$transaction")),
    ),
    transaction,
  );
});
