import {
  deepEqual,
  equal,
  rejects,
  throws,
} from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  admitDemandAuthority,
  createDemandAuthority,
  DemandAuthorityError,
  parseDemandAuthority,
} from "../../../src/governance/demand/model/demand-authority.js";
import {
  createDemandIdentity,
  DemandIdentityError,
  parseDemandIdentity,
} from "../../../src/governance/demand/model/demand-identity.js";
import {
  createConfirmationRecord,
  createRequirementRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  parseTodoIntakeLineageReference,
} from "../../../src/governance/todo/todo-intake-lineage.js";
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
const CONFIRMATION_ID = parseWakeflowDurableIdOfKind(
  "confirmation_44444444-4444-4444-8444-444444444444",
  "confirmation",
);
const OTHER_DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_55555555-5555-4555-8555-555555555555",
  "demand",
);
const CREATED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");
const TODO_ID = parseTodoItemId("TODO-RH2-EVENT-SOURCING");
const ROLES = [
  "code-facts",
  "landing-plan",
  "non-goals",
  "original-plan",
  "requirement-design",
  "user-confirmation",
] as const;

const TODO_LINEAGE = parseTodoIntakeLineageReference({
  artifactKind: "wakeflow-todo-intake-lineage",
  schemaVersion: 1,
  todoId: TODO_ID,
  intakeRef: todoIntakeRef(TODO_ID),
  intakeDigest: `sha256:${"a".repeat(64)}`,
});

function identityDraft(
  executionPlacement: unknown = { mode: "main" as const },
) {
  return {
    programId: PROGRAM_ID,
    demandId: DEMAND_ID,
    title: "Demand Event Sourcing",
    goal: "以 immutable domain event 作为 Demand 可变状态唯一权威",
    completionDefinition: "删除 snapshot 后 replay 得到同一 state digest",
    demandType: "requirement" as const,
    source: TODO_LINEAGE,
    executionPlacement,
  };
}

async function ledgerFixture() {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-authority-"));
  const root = await RootedDirectory.open(rootPath);
  const store = new LedgerAuthorityStore(root);
  await store.initialize({ freshLedger: true });
  const members = ROLES.map((role) => {
    const bytes = encodeUtf8(`# ${role}\n`);
    return {
      role,
      path: `authority/${role}.md`,
      mediaType: "text/markdown",
      digest: computeSha256Digest(bytes),
      bytes,
    };
  });
  const record = createRequirementRecord({
    requirementId: REQUIREMENT_ID,
    programId: PROGRAM_ID,
    title: "Demand Event Sourcing requirement",
    documents: members.map(({ bytes: _bytes, ...document }) => document),
  }, { clock: () => CREATED_AT });
  const published = await store.publish(
    record,
    members.map(({ path: memberPath, bytes }) => ({
      path: memberPath,
      bytes,
    })),
  );
  return { rootPath, root, store, published };
}

test("Demand identity binds exact TODO lineage and contains no legacy entry mode", () => {
  const identity = createDemandIdentity(identityDraft(), {
    clock: () => CREATED_AT,
  });

  equal(identity.artifactKind, "wakeflow-demand-identity");
  equal(identity.createdAt, CREATED_AT);
  deepEqual(identity.source, TODO_LINEAGE);
  equal(Object.hasOwn(identity, "entryMode"), false);
  deepEqual(parseDemandIdentity(identity), identity);

  throws(
    () => parseDemandIdentity({ ...identity, entryMode: "design-delivery" }),
    DemandIdentityError,
  );
});

test("Demand identity draft is closed before the wall clock is read", () => {
  let clockCalls = 0;
  throws(
    () => createDemandIdentity({
      ...identityDraft(),
      source: {
        ...TODO_LINEAGE,
        intakeRef: "todo/forged/intake.json",
      },
    }, {
      clock: () => {
        clockCalls += 1;
        return CREATED_AT;
      },
    }),
    DemandIdentityError,
  );
  equal(clockCalls, 0);

  throws(
    () => createDemandIdentity(identityDraft(), {
      clock: () => {
        throw new Error("private clock failure");
      },
    }),
    DemandIdentityError,
  );
});

test("mandatory Demand authority resolves complete Ledger roles and rejects legacy entryMode", async () => {
  const { rootPath, root, store, published } = await ledgerFixture();
  try {
    const identity = createDemandIdentity(identityDraft(), {
      clock: () => CREATED_AT,
    });
    const refs = published.loaded.documents.map((document) => (
      createLedgerAuthorityMemberReference(
        published.loaded,
        document.path,
      )
    ));
    const authority = createDemandAuthority(identity, {
      authorityRefs: refs,
      testingDecision: {
        mode: "controller-only",
        summary: "运行新增 TypeScript 聚焦测试",
        environmentMemberRef: null,
      },
    });

    equal(authority.artifactKind, "wakeflow-demand-authority");
    equal(authority.demandId, DEMAND_ID);
    equal(Object.hasOwn(authority, "entryMode"), false);
    const admitted = await admitDemandAuthority(identity, authority, store);
    equal(admitted.resolvedAuthority.length, ROLES.length);
    const controller = new AbortController();
    controller.abort();
    await rejects(
      admitDemandAuthority(identity, authority, store, {
        signal: controller.signal,
      }),
      (error: unknown) => (
        error instanceof DemandAuthorityError
        && error.reason === "aborted"
      ),
    );

    throws(
      () => parseDemandAuthority({
        ...authority,
        entryMode: "controller-inline",
      }, identity),
      DemandAuthorityError,
    );
    throws(
      () => createDemandAuthority(identity, {
        authorityRefs: refs.slice(1),
        testingDecision: authority.testingDecision,
      }),
      DemandAuthorityError,
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("Todo lineage is a closed JSON reference rather than a Markdown row identity", () => {
  equal(TODO_LINEAGE.intakeRef, parsePortableResourcePath(TODO_LINEAGE.intakeRef));
  throws(
    () => parseTodoIntakeLineageReference({
      ...TODO_LINEAGE,
      boardRef: ".wakeflow-active/current/global-todo-board.md",
    }),
  );
  throws(
    () => parseTodoIntakeLineageReference({
      ...TODO_LINEAGE,
      intakeRef:
        ".wakeflow-active/current/todo/items/item-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/intake.json",
    }),
  );
});

test("isolated placement is proven by a same-demand confirmation instead of entryMode", async () => {
  const { rootPath, root, store, published } = await ledgerFixture();
  try {
    const confirmationBytes = encodeUtf8("# Goal stage confirmed\n");
    const confirmation = createConfirmationRecord({
      confirmationId: CONFIRMATION_ID,
      programId: PROGRAM_ID,
      demandId: DEMAND_ID,
      title: "Authorize isolated placement",
      documents: [{
        role: "goal-stage-decision",
        path: "decisions/goal-stage.md",
        mediaType: "text/markdown",
        digest: computeSha256Digest(confirmationBytes),
      }],
    }, { clock: () => CREATED_AT });
    const publishedConfirmation = await store.publish(confirmation, [{
      path: "decisions/goal-stage.md",
      bytes: confirmationBytes,
    }]);
    const placementRef = createLedgerAuthorityMemberReference(
      publishedConfirmation.loaded,
      "decisions/goal-stage.md",
    );
    const identity = createDemandIdentity(identityDraft({
      mode: "isolated",
      authorizationRef: placementRef,
    }), { clock: () => CREATED_AT });
    const refs = [
      ...published.loaded.documents.map((document) => (
        createLedgerAuthorityMemberReference(published.loaded, document.path)
      )),
      placementRef,
    ];
    const authority = createDemandAuthority(identity, {
      authorityRefs: refs,
      testingDecision: {
        mode: "controller-only",
        summary: "运行新增 TypeScript 聚焦测试",
        environmentMemberRef: null,
      },
    });
    equal(
      (await admitDemandAuthority(identity, authority, store))
        .resolvedAuthority.length,
      refs.length,
    );

    const stalePlacementIdentity = createDemandIdentity(identityDraft({
      mode: "isolated",
      authorizationRef: {
        ...placementRef,
        memberDigest: `sha256:${"f".repeat(64)}`,
      },
    }), { clock: () => CREATED_AT });
    throws(
      () => createDemandAuthority(stalePlacementIdentity, {
        authorityRefs: refs,
        testingDecision: authority.testingDecision,
      }),
      DemandAuthorityError,
    );

    const wrongDemandConfirmation = createConfirmationRecord({
      confirmationId: parseWakeflowDurableIdOfKind(
        "confirmation_66666666-6666-4666-8666-666666666666",
        "confirmation",
      ),
      programId: PROGRAM_ID,
      demandId: OTHER_DEMAND_ID,
      title: "Wrong Demand placement",
      documents: [{
        role: "goal-stage-decision",
        path: "decisions/wrong-demand.md",
        mediaType: "text/markdown",
        digest: computeSha256Digest(confirmationBytes),
      }],
    }, { clock: () => CREATED_AT });
    const wrongPublished = await store.publish(wrongDemandConfirmation, [{
      path: "decisions/wrong-demand.md",
      bytes: confirmationBytes,
    }]);
    const wrongRef = createLedgerAuthorityMemberReference(
      wrongPublished.loaded,
      "decisions/wrong-demand.md",
    );
    const wrongIdentity = createDemandIdentity(identityDraft({
      mode: "isolated",
      authorizationRef: wrongRef,
    }), { clock: () => CREATED_AT });
    const wrongAuthority = createDemandAuthority(wrongIdentity, {
      authorityRefs: [...refs.slice(0, -1), wrongRef],
      testingDecision: authority.testingDecision,
    });
    await (async () => {
      let caught: unknown;
      try {
        await admitDemandAuthority(wrongIdentity, wrongAuthority, store);
      } catch (error: unknown) {
        caught = error;
      }
      equal(caught instanceof DemandAuthorityError, true);
    })();
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
