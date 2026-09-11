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

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
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
  parseRequirementLineageReference,
  RequirementLineageError,
} from "../../../src/governance/demand/model/requirement-lineage.js";
import {
  createLedgerAuthorityMemberReference,
  LedgerAuthorityStore,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import { publishFixtureRequirement } from "../ledger/requirement-package.fixture.js";
import { requirementLineageOf } from "./requirement-board.fixture.js";

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
const CREATED_AT = parseUtcInstant("2026-08-26T10:00:00.000Z");

const REQUIREMENT_LINEAGE = parseRequirementLineageReference({
  artifactKind: "wakeflow-requirement-lineage",
  schemaVersion: 1,
  requirementId: REQUIREMENT_ID,
  recordRef: `requirements/${REQUIREMENT_ID}/record.json`,
  recordDigest: `sha256:${"a".repeat(64)}`,
});

const POD_ID = "pod_99999999-9999-4999-8999-999999999999";

function identityDraft(
  podId: unknown = POD_ID,
  source: unknown = REQUIREMENT_LINEAGE,
) {
  return {
    programId: PROGRAM_ID,
    demandId: DEMAND_ID,
    title: "Demand Event Sourcing",
    goal: "以 immutable domain event 作为 Demand 可变状态唯一权威",
    completionDefinition: "删除 snapshot 后 replay 得到同一 state digest",
    demandType: "requirement" as const,
    source,
    podId,
  };
}

async function ledgerFixture() {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-authority-"));
  const root = await RootedDirectory.open(rootPath);
  const store = new LedgerAuthorityStore(root);
  await store.initialize({ freshLedger: true });
  const loaded = await publishFixtureRequirement(store, {
    requirementId: REQUIREMENT_ID,
  });
  const refs = loaded.documents.map((document) => (
    createLedgerAuthorityMemberReference(loaded, document.path)
  ));
  return { rootPath, root, store, loaded, refs };
}

test("Demand identity binds exact requirement lineage and contains no legacy entry mode", () => {
  const identity = createDemandIdentity(identityDraft(), {
    clock: () => CREATED_AT,
  });

  equal(identity.artifactKind, "wakeflow-demand-identity");
  equal(identity.createdAt, CREATED_AT);
  deepEqual(identity.source, REQUIREMENT_LINEAGE);
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
    () => createDemandIdentity(identityDraft(undefined, {
      ...REQUIREMENT_LINEAGE,
      recordRef: "requirements/forged/record.json",
    }), {
      clock: () => {
        clockCalls += 1;
        return CREATED_AT;
      },
    }),
    (error: unknown) =>
      error instanceof DemandIdentityError && error.reason === "source",
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

test("mandatory Demand authority resolves complete package roles and rejects legacy entryMode", async () => {
  const { rootPath, root, store, loaded, refs } = await ledgerFixture();
  try {
    const identity = createDemandIdentity(
      identityDraft(undefined, requirementLineageOf(loaded)),
      { clock: () => CREATED_AT },
    );
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
    deepEqual(
      authority.authorityRefs.map((reference) => reference.role),
      ["landing", "requirement"],
    );
    const admitted = await admitDemandAuthority(identity, authority, store);
    equal(admitted.resolvedAuthority.length, refs.length);
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
        authorityRefs: refs.filter((reference) => reference.role !== "landing"),
        testingDecision: authority.testingDecision,
      }),
      (error: unknown) =>
        error instanceof DemandAuthorityError && error.reason === "role",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("real-environment testing no longer binds a Ledger environment member", async () => {
  const { rootPath, root, loaded, refs } = await ledgerFixture();
  try {
    const identity = createDemandIdentity(
      identityDraft(undefined, requirementLineageOf(loaded)),
      { clock: () => CREATED_AT },
    );
    const authority = createDemandAuthority(identity, {
      authorityRefs: refs,
      testingDecision: {
        mode: "real-environment",
        summary: "在已确认的真实环境中执行测试卡",
        environmentMemberRef: null,
      },
    });
    equal(authority.testingDecision.environmentMemberRef, null);
    throws(
      () => createDemandAuthority(identity, {
        authorityRefs: refs,
        testingDecision: {
          ...authority.testingDecision,
          environmentMemberRef: refs[0]?.memberRef,
        },
      }),
      (error: unknown) =>
        error instanceof DemandAuthorityError && error.reason === "testing",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("Requirement lineage is a closed JSON reference bound to the Ledger layout", () => {
  equal(
    REQUIREMENT_LINEAGE.recordRef,
    parsePortableResourcePath(REQUIREMENT_LINEAGE.recordRef),
  );
  throws(
    () => parseRequirementLineageReference({
      ...REQUIREMENT_LINEAGE,
      boardRef: ".wakeflow-active/current/board/index.md",
    }),
    (error: unknown) =>
      error instanceof RequirementLineageError && error.reason === "schema",
  );
  throws(
    () => parseRequirementLineageReference({
      ...REQUIREMENT_LINEAGE,
      recordRef: `requirements/${REQUIREMENT_ID}/requirement.md`,
    }),
    (error: unknown) =>
      error instanceof RequirementLineageError && error.reason === "path",
  );
});
