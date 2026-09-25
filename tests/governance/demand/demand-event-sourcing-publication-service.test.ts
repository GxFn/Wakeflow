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
import {
  closeDemandOperationRoot,
  openDemandOperationRoot,
} from "../../../src/governance/demand/demand-operation-authority-context.js";
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
  publishDemandFromPackage,
  recoverDemandPublication,
  DemandEventSourcingPublicationServiceError,
} from "../../../src/governance/demand/publication/demand-event-sourcing-publication-service.js";
import {
  demandFinalRootRef,
  demandPublicationLockRef,
  demandPublicationTransactionRef,
} from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  REQUIREMENT_BOARD_INDEX_REF,
  requirementClaimStateRef,
} from "../../../src/kernel/layout.js";
import {
  readRequirementClaimState,
  replaceRequirementClaimStateFile,
  withdrawRequirementClaim,
} from "../../../src/kernel/requirement-board.js";
import { materializeActiveLayout } from "../../../src/kernel/active-projection.js";
import {
  FIXTURE_REQUIREMENT_ID,
  publishFixtureRequirement,
} from "../ledger/requirement-package.fixture.js";
import {
  placePendingClaimState,
  requirementLineageOf,
} from "./requirement-board.fixture.js";

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
const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_44444444-4444-4444-8444-444444444444",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_77777777-7777-4777-8777-777777777777",
  "demand-event-commit",
);
const CREATED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");

async function fixture() {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-publication-"));
  const workspacePath = path.join(fixtureRoot, "workspace");
  const ledgerPath = path.join(fixtureRoot, "ledger");
  mkdirSync(workspacePath, { mode: 0o700 });
  mkdirSync(ledgerPath, { mode: 0o700 });
  const workspaceRoot = await RootedDirectory.open(workspacePath);
  const ledgerRoot = await RootedDirectory.open(ledgerPath);
  await materializeActiveLayout(workspaceRoot, { recovering: false });

  const ledgerStore = new LedgerAuthorityStore(ledgerRoot);
  await ledgerStore.initialize({ freshLedger: true });
  const loaded = await publishFixtureRequirement(ledgerStore);
  const authorityRefs = loaded.documents.map((document) => (
    createLedgerAuthorityMemberReference(loaded, document.path)
  ));
  const claim = await placePendingClaimState(workspaceRoot, loaded);
  const identity = createDemandIdentity({
    programId: PROGRAM_ID,
    demandId: DEMAND_ID,
    title: "Demand Event Sourcing",
    goal: "Immutable commit stream 是可变状态唯一权威",
    completionDefinition: "Command、append、看板认领与 recovery 闭合",
    demandType: "requirement",
    source: requirementLineageOf(loaded),
    podId: "pod_99999999-9999-4999-8999-999999999999",
  }, { clock: () => CREATED_AT });
  const authority = createDemandAuthority(identity, {
    authorityRefs,
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
    loaded,
    claim,
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
    expectedClaimStateDigest: value.claim.digest,
  };
}

function workspaceFile(value: Awaited<ReturnType<typeof fixture>>, ref: string) {
  return path.join(value.workspacePath, ...ref.split("/"));
}

test("publication uses Command Handler and binds exact package predecessor", async () => {
  const value = await fixture();
  try {
    const result = await publishDemandFromPackage(
      value.workspaceRoot,
      value.ledgerStore,
      publishInput(value),
    );
    equal(result.publicationAuthority, "current");
    equal(result.wroteDemandRoot, true);
    equal(result.loaded.aggregate.streamRevision, 1);
    equal(result.loaded.firstCommit.commitId, COMMIT_ID);
    equal(result.claim.state.status, "claimed");
    equal(result.claim.state.revision, 2);
    equal(result.claim.state.previousStateDigest, value.claim.digest);
    equal(result.claim.state.claim?.demandId, DEMAND_ID);
    equal(result.claim.state.claim?.claimedAt, CREATED_AT);
    const onBoard = await readRequirementClaimState(
      value.workspaceRoot,
      FIXTURE_REQUIREMENT_ID,
    );
    equal(onBoard?.digest, result.claim.digest);
    equal(existsSync(workspaceFile(value, REQUIREMENT_BOARD_INDEX_REF)), true);

    const retried = await publishDemandFromPackage(
      value.workspaceRoot,
      value.ledgerStore,
      publishInput(value),
    );
    equal(retried.publicationAuthority, "current");
    equal(retried.wroteDemandRoot, false);
    equal(retried.claim.digest, result.claim.digest);
  } finally {
    await cleanup(value);
  }
});

test("sidecar-only publication recovers without an event append journal", async () => {
  const value = await fixture();
  try {
    await initializeDemandEventSourcingPublication(value.workspaceRoot);
    const transaction = createDemandEventSourcingPublicationTransaction(
      publishInput(value),
    );
    const ref = demandPublicationTransactionRef(DEMAND_ID);
    const file = workspaceFile(value, ref);
    writeFileSync(
      file,
      renderDemandEventSourcingPublicationTransaction(transaction),
      { mode: 0o600 },
    );
    const lockRef = demandPublicationLockRef(DEMAND_ID);
    const lockPath = workspaceFile(value, lockRef);
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
    equal(recovered.claim.state.status, "claimed");
    equal(existsSync(file), false);
    equal(existsSync(lockPath), false);
    equal(existsSync(workspaceFile(value, foreignStage)), true);
  } finally {
    await cleanup(value);
  }
});

test("publication recovery 回滚 canonical sidecar 之前的 inactive partial stage", async () => {
  const value = await fixture();
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
    equal(existsSync(workspaceFile(value, stageRef)), false);
  } finally {
    await cleanup(value);
  }
});

test("recovery without publication storage performs no initialization effects", async () => {
  const value = await fixture();
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
    const onBoard = await readRequirementClaimState(
      value.workspaceRoot,
      FIXTURE_REQUIREMENT_ID,
    );
    equal(onBoard?.state.status, "pending");
    equal(onBoard?.digest, value.claim.digest);
  } finally {
    await cleanup(value);
  }
});

test("published root marker is settled before normal authority load", async () => {
  const value = await fixture();
  try {
    await initializeDemandEventSourcingPublication(value.workspaceRoot);
    const transaction = createDemandEventSourcingPublicationTransaction(
      publishInput(value),
    );
    const text = renderDemandEventSourcingPublicationTransaction(transaction);
    const sidecarRef = demandPublicationTransactionRef(DEMAND_ID);
    const sidecarPath = workspaceFile(value, sidecarRef);
    writeFileSync(sidecarPath, text, { mode: 0o600 });

    const finalRef = demandFinalRootRef(DEMAND_ID);
    const finalPath = workspaceFile(value, finalRef);
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
    equal(recovered.claim.state.status, "claimed");
    equal(existsSync(path.join(finalPath, "transactions", "publication.json")), false);
    equal(existsSync(sidecarPath), false);
  } finally {
    await cleanup(value);
  }
});

test("publication recovery first settles an interrupted package claim", async () => {
  const value = await fixture();
  const indexPath = workspaceFile(value, REQUIREMENT_BOARD_INDEX_REF);
  const outside = path.join(value.workspacePath, "outside-projection.md");
  try {
    writeFileSync(outside, "outside\n", { mode: 0o600 });
    rmSync(indexPath);
    symlinkSync(outside, indexPath);
    let publishError: unknown;
    try {
      await publishDemandFromPackage(
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
    const claimed = await readRequirementClaimState(
      value.workspaceRoot,
      FIXTURE_REQUIREMENT_ID,
    );
    equal(claimed?.state.status, "claimed");
    rmSync(indexPath);

    const recovered = await recoverDemandPublication(
      value.workspaceRoot,
      value.ledgerStore,
      DEMAND_ID,
    );
    equal(recovered.publicationAuthority, "current");
    equal(recovered.claim.state.status, "claimed");
    equal(recovered.claim.digest, claimed?.digest);
    equal(recovered.loaded.aggregate.streamRevision, 1);
    equal(existsSync(indexPath), true);
  } finally {
    await cleanup(value);
  }
});

test("publication refuses a claim state that drifted from the plan", async () => {
  const value = await fixture();
  try {
    const source = await readRequirementClaimState(
      value.workspaceRoot,
      FIXTURE_REQUIREMENT_ID,
    );
    if (source === null) throw new Error("Expected pending claim state fixture.");
    await replaceRequirementClaimStateFile(
      value.workspaceRoot,
      { digest: source.digest, read: source.read },
      withdrawRequirementClaim(source.state, "计划形成后需求包被撤回", CREATED_AT),
    );

    let caught: unknown;
    try {
      await publishDemandFromPackage(
        value.workspaceRoot,
        value.ledgerStore,
        publishInput(value),
      );
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof DemandEventSourcingPublicationServiceError, true);
    if (caught instanceof DemandEventSourcingPublicationServiceError) {
      equal(caught.reason, "cas-mismatch");
      equal(caught.publicationAuthority, "unchanged");
    }

    rmSync(workspaceFile(value, requirementClaimStateRef(FIXTURE_REQUIREMENT_ID)));
    let missing: unknown;
    try {
      await publishDemandFromPackage(
        value.workspaceRoot,
        value.ledgerStore,
        publishInput(value),
      );
    } catch (error: unknown) {
      missing = error;
    }
    equal(missing instanceof DemandEventSourcingPublicationServiceError, true);
    if (missing instanceof DemandEventSourcingPublicationServiceError) {
      equal(missing.reason, "package-not-found");
      equal(missing.publicationAuthority, "unchanged");
    }
    equal(existsSync(path.join(
      value.workspacePath,
      ".wakeflow-active/current/demand-publication",
    )), false);
    equal(existsSync(workspaceFile(value, demandFinalRootRef(DEMAND_ID))), false);
  } finally {
    await cleanup(value);
  }
});

test("unresolved Authority has no publication effects", async () => {
  const value = await fixture();
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
      await publishDemandFromPackage(value.workspaceRoot, value.ledgerStore, {
        ...publishInput(value),
        authority: badAuthority,
      });
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof DemandEventSourcingPublicationServiceError, true);
    if (caught instanceof DemandEventSourcingPublicationServiceError) {
      equal(caught.publicationAuthority, "unchanged");
      equal(caught.reason, "authority");
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

/**
 * 派生根的持久化级别来自来源根，而不是某个常量：同一个已发布的 Demand，从 `none` 的工作区根
 * 派生出的操作根是 `none`，从默认根派生出的是 `fsync`（§13.99 同批确认的可选持久化级别）。
 */
test("Demand 操作根继承来源工作区根的持久化级别", async () => {
  const value = await fixture();
  try {
    await publishDemandFromPackage(value.workspaceRoot, value.ledgerStore, publishInput(value));
    for (const expected of ["none", "fsync"] as const) {
      const source = await RootedDirectory.open(
        value.workspaceRoot.absolutePath,
        "$root",
        { durability: expected },
      );
      try {
        const derived = await openDemandOperationRoot(source, DEMAND_ID);
        try {
          equal(derived.durability, expected);
        } finally {
          await closeDemandOperationRoot(derived);
        }
      } finally {
        await source.close();
      }
    }
  } finally {
    await cleanup(value);
  }
});
