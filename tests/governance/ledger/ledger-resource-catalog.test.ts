import {
  deepEqual,
  equal,
} from "node:assert/strict";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createRequirementRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import {
  createLedgerAuthorityResourceCatalog,
  WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG,
} from "../../../src/governance/ledger/ledger-resource-catalog.js";

const REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_11111111-1111-4111-8111-111111111111",
  "requirement",
);
const PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_22222222-2222-4222-8222-222222222222",
  "program",
);
const RECORDED_AT = parseUtcInstant("2026-08-27T08:00:00.000Z");
const MEMBER_BYTES = encodeUtf8("# Requirement\n");

test("Ledger static catalog separates durable roots from private transactions", () => {
  deepEqual(WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG.map((entry) => (
    entry.declarationId
  )), [
    "ledger.confirmations-root",
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
  const record = createRequirementRecord({
    requirementId: REQUIREMENT_ID,
    programId: PROGRAM_ID,
    title: "Ledger resource catalog",
    documents: [{
      role: "requirement-design",
      path: "design/requirement.md",
      mediaType: "text/markdown",
      digest: computeSha256Digest(MEMBER_BYTES),
    }],
  }, { clock: () => RECORDED_AT });
  const catalog = createLedgerAuthorityResourceCatalog(record);
  equal(catalog.length, 5);
  const [root, manifest, member, intent, lock] = catalog;
  if (
    root === undefined
    || manifest === undefined
    || member === undefined
    || intent === undefined
    || lock === undefined
  ) {
    throw new Error("Ledger catalog is incomplete.");
  }

  equal(root.placement.relativePath, `requirements/${REQUIREMENT_ID}`);
  deepEqual(root.processing, {
    kind: "directory-container",
    materializationRecipe: "exact-directory-publish",
    existingDirectoryPolicy: "owner-validate-existing-target",
    collisionPolicy: "reject-unowned-target",
    descendantAuthority: "separate-declaration-required",
    recoveryStrategy: "owner-forward-recovery",
  });
  for (const fact of [manifest, member]) {
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
  equal(member.placement.relativePath, `requirements/${REQUIREMENT_ID}/design/requirement.md`);
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
