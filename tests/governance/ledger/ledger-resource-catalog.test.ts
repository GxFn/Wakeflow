import {
  deepEqual,
  equal,
} from "node:assert/strict";
import { test } from "node:test";

import {
  createRequirementRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  createLedgerAuthorityResourceCatalog,
  WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG,
} from "../../../src/governance/ledger/ledger-resource-catalog.js";
import {
  FIXTURE_RECORDED_AT,
  FIXTURE_REQUIREMENT_ID,
  requirementRecordDraft,
} from "./requirement-package.fixture.js";

test("Ledger static catalog separates the durable requirements root from private transactions", () => {
  deepEqual(WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG.map((entry) => (
    entry.declarationId
  )), [
    "ledger.requirements-root",
    "ledger.transactions-root",
  ]);
  for (const entry of WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG) {
    equal(entry.family, "ledger");
    equal(entry.scope, "host-neutral");
    equal(entry.placement.root.kind, "ledger");
    if (entry.declarationId === "ledger.transactions-root") {
      deepEqual(entry.tracking, {
        disposition: "ignored",
        privacy: "runtime-private",
      });
      deepEqual(entry.nodePolicy, {
        kind: "directory",
        mode: "0700",
        symlinkPolicy: "reject",
        existingModePolicy: "observe-without-change",
      });
    } else {
      equal(entry.placement.relativePath, "requirements");
      deepEqual(entry.tracking, {
        disposition: "tracked",
        privacy: "shareable",
      });
      equal(entry.nodePolicy.kind, "directory");
      equal(entry.nodePolicy.mode, "0755");
    }
  }
});

test("concrete Ledger record catalog binds aggregate, facts, intent, and lock", () => {
  const record = createRequirementRecord(requirementRecordDraft(), {
    clock: () => FIXTURE_RECORDED_AT,
  });
  const catalog = createLedgerAuthorityResourceCatalog(record);
  equal(catalog.length, 6);
  const [root, manifest, landing, requirement, intent, lock] = catalog;
  if (
    root === undefined
    || manifest === undefined
    || landing === undefined
    || requirement === undefined
    || intent === undefined
    || lock === undefined
  ) {
    throw new Error("Ledger catalog is incomplete.");
  }

  equal(root.placement.relativePath, `requirements/${FIXTURE_REQUIREMENT_ID}`);
  deepEqual(root.processing, {
    kind: "directory-container",
    materializationRecipe: "exact-directory-publish",
    existingDirectoryPolicy: "owner-validate-existing-target",
    collisionPolicy: "reject-unowned-target",
    descendantAuthority: "separate-declaration-required",
    recoveryStrategy: "owner-forward-recovery",
  });
  equal(manifest.placement.relativePath, `requirements/${FIXTURE_REQUIREMENT_ID}/record.json`);
  for (const fact of [manifest, landing, requirement]) {
    deepEqual(fact.tracking, {
      disposition: "tracked",
      privacy: "shareable",
    });
    equal(fact.nodePolicy.kind, "file");
    equal(fact.nodePolicy.mode, "0644");
    if (fact.processing.kind !== "resource") {
      throw new Error("Ledger fact must be a resource role.");
    }
    equal(fact.processing.role, "immutable-fact");
  }
  equal(landing.placement.relativePath, `requirements/${FIXTURE_REQUIREMENT_ID}/landing.md`);
  equal(requirement.placement.relativePath, `requirements/${FIXTURE_REQUIREMENT_ID}/requirement.md`);
  equal(intent.placement.relativePath, `transactions/${FIXTURE_REQUIREMENT_ID}.intent.json`);
  equal(lock.placement.relativePath, `transactions/${FIXTURE_REQUIREMENT_ID}.lock`);
  for (const transaction of [intent, lock]) {
    deepEqual(transaction.tracking, {
      disposition: "ignored",
      privacy: "runtime-private",
    });
    equal(transaction.nodePolicy.kind, "file");
    equal(transaction.nodePolicy.mode, "0600");
    if (transaction.processing.kind !== "resource") {
      throw new Error("Ledger transaction must be a resource role.");
    }
    equal(transaction.processing.role, "transaction-artifact");
  }
  equal(catalog.some((entry) => (
    entry.placement.relativePath?.endsWith(".stage") === true
  )), false);
});
