import { equal } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { durableAtomicFileStageRefForTest } from "../../foundation/filesystem/durable-atomic-file-test-support.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
import {
  createFileCandidateDurably,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { executeDemandEventSourcingCommand } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import {
  createDemandAuthority,
  renderDemandAuthority,
} from "../../../src/governance/demand/model/demand-authority.js";
import {
  createDemandIdentity,
  renderDemandIdentity,
} from "../../../src/governance/demand/model/demand-identity.js";
import {
  createDemandEventSourcingPublicationTransaction,
  renderDemandEventSourcingPublicationTransaction,
} from "../../../src/governance/demand/publication/demand-event-sourcing-publication-transaction.js";
import {
  initializeDemandEventSourcingPublication,
  publishDemandFromTodo,
  recoverDemandPublication,
  DemandEventSourcingPublicationServiceError,
} from "../../../src/governance/demand/publication/demand-event-sourcing-publication-service.js";
import {
  demandFinalRootRef,
  demandPublicationLockRef,
  demandPublicationTransactionRef,
} from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { createRequirementRecord } from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  appendTodoItem,
  claimTodoItem,
  initializeTodoCollection,
  TodoCollectionServiceError,
} from "../../../src/governance/todo/todo-collection-service.js";
import {
  materializeWakeflowActiveLayout,
} from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";
import { todoIntakeDraft } from "../todo/todo-intake.fixture.js";

const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_11111111-1111-4111-8111-111111111111",
  "program",
);
const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_22222222-2222-4222-8222-222222222222",
  "demand",
);
const OTHER_DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_88888888-8888-4888-8888-888888888888",
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
  "demand-event-commit_77777777-7777-4777-8777-777777777777",
  "demand-event-commit",
);
const CREATED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const REQUIRED_ROLES = [
  "code-facts",
  "landing-plan",
  "non-goals",
  "original-plan",
  "requirement-design",
  "user-confirmation",
] as const;

async function fixture(todoId: string) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-publication-"));
  const workspacePath = path.join(fixtureRoot, "workspace");
  const ledgerPath = path.join(fixtureRoot, "ledger");
  mkdirSync(workspacePath, { mode: 0o700 });
  mkdirSync(ledgerPath, { mode: 0o700 });
  const workspaceRoot = await RootedDirectory.open(workspacePath);
  const ledgerRoot = await RootedDirectory.open(ledgerPath);
  await materializeWakeflowActiveLayout(workspaceRoot, {
    recoveringFreshLayout: false,
  });
  await initializeTodoCollection(workspaceRoot, { freshWorkspace: true });

  const ledgerStore = new LedgerAuthorityStore(ledgerRoot);
  await ledgerStore.initialize({ freshLedger: true });
  const members = REQUIRED_ROLES.map((role) => {
    const bytes = encodeUtf8(`# ${role}\n`);
    return {
      role,
      path: `authority/${role}.md`,
      mediaType: "text/markdown",
      digest: computeSha256Digest(bytes),
      bytes,
    };
  });
  const requirement = createRequirementRecord({
    requirementId: REQUIREMENT_ID,
    programId: PROGRAM_ID,
    title: "Demand Event Sourcing",
    documents: members.map(({ bytes: _bytes, ...document }) => document),
  }, { clock: () => CREATED_AT });
  const published = await ledgerStore.publish(
    requirement,
    members.map(({ path: memberPath, bytes }) => ({ path: memberPath, bytes })),
  );
  const requirementAuthorityRefs = published.loaded.documents.map((document) => (
    createLedgerAuthorityMemberReference(published.loaded, document.path)
  ));
  const appended = await appendTodoItem(
    workspaceRoot,
    todoIntakeDraft(todoId, {
      programId: PROGRAM_ID,
      originWindowId: "window_66666666-6666-4666-8666-666666666666",
      controllerWindowId: "window_55555555-5555-4555-8555-555555555555",
      summary: "实现标准 Demand Event Sourcing",
      intakeRationale: "已发布的 Ledger Authority 可以进入 Demand 发布。",
      testingDecision: {
        mode: "controller-only",
        summary: "新增 TypeScript 聚焦测试",
        environmentMemberRef: null,
      },
      authorityRefs: requirementAuthorityRefs,
    }),
    { clock: () => CREATED_AT },
  );
  const identity = createDemandIdentity({
    programId: PROGRAM_ID,
    demandId: DEMAND_ID,
    title: "Demand Event Sourcing",
    goal: "Immutable commit stream 是可变状态唯一权威",
    completionDefinition: "Command、append、TODO 与 recovery 闭合",
    demandType: "requirement",
    source: appended.lineageRef,
    executionPlacement: { mode: "main" },
  }, { clock: () => CREATED_AT });
  const authority = createDemandAuthority(identity, {
    authorityRefs: requirementAuthorityRefs,
    testingDecision: {
      mode: "controller-only",
      summary: "新增 TypeScript 聚焦测试",
      environmentMemberRef: null,
    },
  });
  return {
    fixtureRoot,
    workspacePath,
    workspaceRoot,
    ledgerRoot,
    ledgerStore,
    appended,
    identity,
    authority,
  };
}

async function cleanup(value: Awaited<ReturnType<typeof fixture>>) {
  await value.workspaceRoot.close();
  await value.ledgerRoot.close();
  rmSync(value.fixtureRoot, { recursive: true, force: true });
}

function publishInput(value: Awaited<ReturnType<typeof fixture>>) {
  return {
    identity: value.identity,
    authority: value.authority,
    eventId: EVENT_ID,
    commitId: COMMIT_ID,
    recordedAt: CREATED_AT,
    expectedTodoStateDigest: value.appended.item.stateDigest,
    expectedTodoCollectionDigest:
      value.appended.snapshot.collection.collectionDigest,
  };
}

test("publication uses Command Handler and binds exact TODO predecessor", async () => {
  const value = await fixture("todo_e50c89b4-c5e6-4f7e-8a01-33ec39f24bb7");
  try {
    const result = await publishDemandFromTodo(
      value.workspaceRoot,
      value.ledgerStore,
      publishInput(value),
    );
    equal(result.publicationAuthority, "current");
    equal(result.wroteDemandRoot, true);
    equal(result.loaded.aggregate.streamRevision, 1);
    equal(result.loaded.firstCommit.commitId, COMMIT_ID);
    equal(result.todo.item.state.previousStateDigest, value.appended.item.stateDigest);

    const retried = await publishDemandFromTodo(
      value.workspaceRoot,
      value.ledgerStore,
      publishInput(value),
    );
    equal(retried.publicationAuthority, "current");
    equal(retried.wroteDemandRoot, false);
  } finally {
    await cleanup(value);
  }
});

test("sidecar-only publication recovers without an event append journal", async () => {
  const value = await fixture("todo_5dc6c7ed-6bd6-4811-8489-34c053848793");
  try {
    await initializeDemandEventSourcingPublication(value.workspaceRoot);
    const transaction = createDemandEventSourcingPublicationTransaction(
      publishInput(value),
    );
    const ref = demandPublicationTransactionRef(DEMAND_ID);
    const file = path.join(value.workspacePath, ...ref.split("/"));
    writeFileSync(
      file,
      renderDemandEventSourcingPublicationTransaction(transaction),
      { mode: 0o600 },
    );
    const lockRef = demandPublicationLockRef(DEMAND_ID);
    const lockPath = path.join(value.workspacePath, ...lockRef.split("/"));
    writeFileSync(lockPath, rootedExclusiveFileLockRecordTextForTest({
      tokenUuid: "88888888-8888-4888-8888-888888888888",
    }), { mode: 0o600 });
    const foreignTarget = demandPublicationTransactionRef(OTHER_DEMAND_ID);
    const foreignBytes = encodeUtf8("foreign-intent");
    const foreignAddress = issueDurableAtomicFileStageAddress(
      "create",
      foreignTarget,
      computeSha256Digest(foreignBytes),
      0o600,
    );
    const foreignStage = durableAtomicFileStageRefForTest(
      foreignTarget,
      foreignAddress,
    );
    try {
      await createFileCandidateDurably(
        value.workspaceRoot,
        foreignStage,
        encodeUtf8("partial"),
        { mode: 0o600 },
      );
    } finally {
      releaseDurableAtomicFileStageAddress(foreignAddress);
    }

    const recovered = await recoverDemandPublication(
      value.workspaceRoot,
      value.ledgerStore,
      DEMAND_ID,
    );
    equal(recovered.publicationAuthority, "current");
    equal(recovered.wroteDemandRoot, true);
    equal(recovered.loaded.firstCommit.commitId, COMMIT_ID);
    equal(existsSync(file), false);
    equal(existsSync(lockPath), false);
    equal(
      existsSync(path.join(value.workspacePath, ...foreignStage.split("/"))),
      true,
    );
  } finally {
    await cleanup(value);
  }
});

test("publication recovery 回滚 canonical sidecar 之前的 inactive partial stage", async () => {
  const value = await fixture("todo_0d587ce5-c18f-4262-8074-f799d7a2b894");
  try {
    await initializeDemandEventSourcingPublication(value.workspaceRoot);
    const transaction = createDemandEventSourcingPublicationTransaction(
      publishInput(value),
    );
    const targetRef = demandPublicationTransactionRef(DEMAND_ID);
    const intendedBytes = encodeUtf8(
      renderDemandEventSourcingPublicationTransaction(transaction),
    );
    const address = issueDurableAtomicFileStageAddress(
      "create",
      targetRef,
      computeSha256Digest(intendedBytes),
      0o600,
    );
    const stageRef = durableAtomicFileStageRefForTest(targetRef, address);
    try {
      await createFileCandidateDurably(
        value.workspaceRoot,
        stageRef,
        encodeUtf8("partial"),
        { mode: 0o600 },
      );
    } finally {
      releaseDurableAtomicFileStageAddress(address);
    }

    let caught: unknown;
    try {
      await recoverDemandPublication(
        value.workspaceRoot,
        value.ledgerStore,
        DEMAND_ID,
      );
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof DemandEventSourcingPublicationServiceError, true);
    if (caught instanceof DemandEventSourcingPublicationServiceError) {
      equal(caught.reason, "not-found");
      equal(caught.publicationAuthority, "unknown");
    }
    equal(existsSync(path.join(value.workspacePath, ...stageRef.split("/"))), false);
  } finally {
    await cleanup(value);
  }
});

test("recovery without publication storage performs no initialization effects", async () => {
  const value = await fixture("todo_78f8ebd7-3d85-408d-8305-10dc34f996fe");
  try {
    let caught: unknown;
    try {
      await recoverDemandPublication(
        value.workspaceRoot,
        value.ledgerStore,
        DEMAND_ID,
      );
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof DemandEventSourcingPublicationServiceError, true);
    if (caught instanceof DemandEventSourcingPublicationServiceError) {
      equal(caught.reason, "not-found");
      equal(caught.publicationAuthority, "unknown");
    }
    equal(existsSync(path.join(
      value.workspacePath,
      ".wakeflow-active/current/demand-publication",
    )), false);
  } finally {
    await cleanup(value);
  }
});

test("published root marker is settled before normal authority load", async () => {
  const value = await fixture("todo_269fc19a-d964-4ae7-8552-2c79c36dfa28");
  try {
    await initializeDemandEventSourcingPublication(value.workspaceRoot);
    const transaction = createDemandEventSourcingPublicationTransaction(
      publishInput(value),
    );
    const text = renderDemandEventSourcingPublicationTransaction(transaction);
    const sidecarRef = demandPublicationTransactionRef(DEMAND_ID);
    const sidecarPath = path.join(value.workspacePath, ...sidecarRef.split("/"));
    writeFileSync(sidecarPath, text, { mode: 0o600 });

    const finalRef = demandFinalRootRef(DEMAND_ID);
    const finalPath = path.join(value.workspacePath, ...finalRef.split("/"));
    mkdirSync(finalPath, { mode: 0o700 });
    const demandRoot = await RootedDirectory.open(finalPath);
    try {
      const eventStore = new DemandFileEventStore(demandRoot);
      await eventStore.initialize();
      mkdirSync(path.join(finalPath, "artifacts"), { mode: 0o700 });
      mkdirSync(path.join(finalPath, "artifacts", "task-packages"), {
        mode: 0o700,
      });
      mkdirSync(path.join(finalPath, "transactions"), { mode: 0o700 });
      writeFileSync(
        path.join(finalPath, "identity.json"),
        renderDemandIdentity(transaction.identity),
        { mode: 0o600 },
      );
      writeFileSync(
        path.join(finalPath, "authority.json"),
        renderDemandAuthority(transaction.authority),
        { mode: 0o600 },
      );
      writeFileSync(
        path.join(finalPath, "transactions", "publication.json"),
        text,
        { mode: 0o600 },
      );
      const repository = new DemandEventSourcingRepository(demandRoot);
      const created = await executeDemandEventSourcingCommand(
        repository,
        transaction.initialCommand,
        {
          commitId: transaction.initialCommit.commitId,
          expectedStreamRevision: 0,
        },
      );
      await repository.publishSnapshot(created.aggregate);
    } finally {
      await demandRoot.close();
    }

    const recovered = await recoverDemandPublication(
      value.workspaceRoot,
      value.ledgerStore,
      DEMAND_ID,
    );
    equal(recovered.publicationAuthority, "current");
    equal(recovered.wroteDemandRoot, false);
    equal(recovered.todo.item.state.status, "claimed");
    equal(existsSync(path.join(finalPath, "transactions", "publication.json")), false);
    equal(existsSync(sidecarPath), false);
  } finally {
    await cleanup(value);
  }
});

test("publication recovery first settles an interrupted TODO claim", async () => {
  const value = await fixture("todo_6fa009bc-2390-47f6-84d9-cf9a182f7732");
  const projectionPath = path.join(
    value.workspacePath,
    ".wakeflow-active/current/todo/global-todo-board.md",
  );
  const outside = path.join(value.workspacePath, "outside-projection.md");
  try {
    writeFileSync(outside, "outside\n", { mode: 0o600 });
    rmSync(projectionPath);
    symlinkSync(outside, projectionPath);
    let publishError: unknown;
    try {
      await publishDemandFromTodo(
        value.workspaceRoot,
        value.ledgerStore,
        publishInput(value),
      );
    } catch (error: unknown) {
      publishError = error;
    }
    equal(
      publishError instanceof DemandEventSourcingPublicationServiceError,
      true,
    );
    if (publishError instanceof DemandEventSourcingPublicationServiceError) {
      equal(publishError.publicationAuthority, "recoverable");
    }
    rmSync(projectionPath);

    const recovered = await recoverDemandPublication(
      value.workspaceRoot,
      value.ledgerStore,
      DEMAND_ID,
    );
    equal(recovered.publicationAuthority, "current");
    equal(recovered.todo.item.state.status, "claimed");
    equal(recovered.loaded.aggregate.streamRevision, 1);
  } finally {
    await cleanup(value);
  }
});

test("normal publication does not recover TODO residue before sidecar commit", async () => {
  const value = await fixture("todo_a4620e01-3f57-4adc-8499-36d218d8cd0a");
  const projectionPath = path.join(
    value.workspacePath,
    ".wakeflow-active/current/todo/global-todo-board.md",
  );
  const outside = path.join(value.workspacePath, "outside-preflight.md");
  try {
    const transaction = createDemandEventSourcingPublicationTransaction(
      publishInput(value),
    );
    writeFileSync(outside, "outside\n", { mode: 0o600 });
    rmSync(projectionPath);
    symlinkSync(outside, projectionPath);
    let claimError: unknown;
    try {
      await claimTodoItem(value.workspaceRoot, {
        todoId: value.appended.item.todoId,
        intakeDigest: value.appended.item.intakeDigest,
        stateDigest: value.appended.item.stateDigest,
        mount: {
          demandId: transaction.demandId,
          stateRootRef: transaction.finalRootRef,
          identityDigest: transaction.identityDigest,
        },
      }, { clock: () => CREATED_AT });
    } catch (error: unknown) {
      claimError = error;
    }
    equal(claimError instanceof TodoCollectionServiceError, true);
    if (claimError instanceof TodoCollectionServiceError) {
      equal(claimError.reason, "projection-unsafe");
    }
    rmSync(projectionPath);

    let caught: unknown;
    try {
      await publishDemandFromTodo(
        value.workspaceRoot,
        value.ledgerStore,
        publishInput(value),
      );
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof DemandEventSourcingPublicationServiceError, true);
    if (caught instanceof DemandEventSourcingPublicationServiceError) {
      equal(caught.reason, "recovery-required");
      equal(caught.publicationAuthority, "unchanged");
    }
    equal(existsSync(path.join(
      value.workspacePath,
      ".wakeflow-active/current/demand-publication",
    )), false);
  } finally {
    await cleanup(value);
  }
});

test("unresolved Authority has no publication effects", async () => {
  const value = await fixture("todo_aed61111-87fb-45e0-8aba-77adb0f507af");
  try {
    const badAuthority = {
      ...value.authority,
      authorityRefs: value.authority.authorityRefs.map((reference, index) => (
        index === 0
          ? { ...reference, memberDigest: `sha256:${"f".repeat(64)}` }
          : reference
      )),
    };
    let caught: unknown;
    try {
      await publishDemandFromTodo(value.workspaceRoot, value.ledgerStore, {
        ...publishInput(value),
        authority: badAuthority,
      });
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof DemandEventSourcingPublicationServiceError, true);
    if (caught instanceof DemandEventSourcingPublicationServiceError) {
      equal(caught.publicationAuthority, "unchanged");
    }
    equal(existsSync(path.join(
      value.workspacePath,
      ".wakeflow-active/current/demand-publication",
    )), false);
    equal(existsSync(path.join(
      value.workspacePath,
      `.wakeflow-active/current/${DEMAND_ID}`,
    )), false);
  } finally {
    await cleanup(value);
  }
});
