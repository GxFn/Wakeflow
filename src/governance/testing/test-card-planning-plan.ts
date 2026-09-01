import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  computeDemandAuthorityDigest,
  parseDemandAuthority,
  DemandAuthorityError,
  type DemandAuthority,
} from "../demand/model/demand-authority.js";
import { parseTestCard, TestCardError, type TestCard } from "./test-card.js";
import {
  parseTestCardGenerationSource,
  TestCardGenerationSourceError,
  type TestCardGenerationSource,
} from "./test-card-generation-source.js";

/** TestCard Planning preview/apply使用的不可变Event计划。 */

const PLAN_KIND = "WakeflowTestCardPlanningPlan" as const;
const PLAN_SCHEMA_VERSION = 1 as const;

export interface TestCardPlanningPlan {
  readonly kind: typeof PLAN_KIND;
  readonly schemaVersion: typeof PLAN_SCHEMA_VERSION;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly expectedStreamRevision: number;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly authority: Readonly<DemandAuthority>;
  readonly testCard: Readonly<TestCard>;
  readonly generationSource: Readonly<TestCardGenerationSource>;
}

export type TestCardPlanningPlanErrorReason =
  | "input"
  | "identifier"
  | "position"
  | "authority"
  | "test-card"
  | "generation-source"
  | "relation";

const ERROR_MESSAGES = {
  input: "TestCard Planning plan input is invalid.",
  identifier: "TestCard Planning plan contains an invalid identity.",
  position: "TestCard Planning plan contains an invalid stream position.",
  authority: "TestCard Planning plan contains an invalid Demand Authority.",
  "test-card": "TestCard Planning plan contains an invalid TestCard.",
  "generation-source":
    "TestCard Planning plan contains an invalid TestCard Generation Source.",
  relation: "TestCard Planning plan fields do not close.",
} as const satisfies Readonly<Record<TestCardPlanningPlanErrorReason, string>>;

export class TestCardPlanningPlanError extends Error {
  override readonly name = "TestCardPlanningPlanError";
  readonly code = "wakeflow-test-card-planning-plan" as const;
  readonly reason: TestCardPlanningPlanErrorReason;
  readonly path: string;

  constructor(reason: TestCardPlanningPlanErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const PLAN_FIELDS = Object.freeze([
  "authority",
  "commitId",
  "demandId",
  "eventId",
  "expectedStreamRevision",
  "generationSource",
  "kind",
  "schemaVersion",
  "testCard",
] as const);
const DRAFT_FIELDS = Object.freeze([
  "authority",
  "commitId",
  "demandId",
  "eventId",
  "expectedStreamRevision",
  "generationSource",
  "testCard",
] as const);

function fail(reason: TestCardPlanningPlanErrorReason, path: string): never {
  throw new TestCardPlanningPlanError(reason, path);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  ) {
    fail("input", path);
  }
  return record;
}

function id<Kind extends "demand" | "demand-event" | "demand-event-commit">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

export function parseTestCardPlanningPlan(
  value: unknown,
): Readonly<TestCardPlanningPlan> {
  const record = exactRecord(value, PLAN_FIELDS, "$plan");
  if (
    record.kind !== PLAN_KIND ||
    record.schemaVersion !== PLAN_SCHEMA_VERSION
  ) {
    fail("input", "$plan");
  }
  if (
    !Number.isSafeInteger(record.expectedStreamRevision) ||
    (record.expectedStreamRevision as number) < 1
  ) {
    fail("position", "$/expectedStreamRevision");
  }
  let authority: Readonly<DemandAuthority>;
  let testCard: Readonly<TestCard>;
  let generationSource: Readonly<TestCardGenerationSource>;
  try {
    authority = parseDemandAuthority(record.authority);
  } catch (error: unknown) {
    if (error instanceof DemandAuthorityError) fail("authority", "$/authority");
    throw error;
  }
  try {
    testCard = parseTestCard(record.testCard);
  } catch (error: unknown) {
    if (error instanceof TestCardError) fail("test-card", "$/testCard");
    throw error;
  }
  try {
    generationSource = parseTestCardGenerationSource(record.generationSource);
  } catch (error: unknown) {
    if (error instanceof TestCardGenerationSourceError) {
      fail("generation-source", "$/generationSource");
    }
    throw error;
  }
  const demandId = id(record.demandId, "demand", "$/demandId");
  if (
    authority.demandId !== demandId ||
    authority.testingDecision.mode !== "real-environment" ||
    computeDemandAuthorityDigest(authority) !==
      testCard.demandAuthorityDigest ||
    authority.testingDecision.environmentMemberRef !==
      testCard.environmentAuthority.memberRef ||
    !authority.authorityRefs.some(
      (reference) =>
        canonicalizeJson(reference, "$authorityReference") ===
        canonicalizeJson(
          testCard.environmentAuthority,
          "$environmentAuthority",
        ),
    ) ||
    !testCard.testBasisAuthorities.every((basisAuthority) =>
      authority.authorityRefs.some(
        (reference) =>
          canonicalizeJson(reference, "$authorityReference") ===
          canonicalizeJson(basisAuthority, "$testBasisAuthority"),
      ),
    ) ||
    testCard.demandId !== demandId ||
    testCard.source.streamRevision !== record.expectedStreamRevision
  ) {
    fail("relation", "$plan");
  }
  return Object.freeze({
    kind: PLAN_KIND,
    schemaVersion: PLAN_SCHEMA_VERSION,
    demandId,
    expectedStreamRevision: record.expectedStreamRevision as number,
    commitId: id(record.commitId, "demand-event-commit", "$/commitId"),
    eventId: id(record.eventId, "demand-event", "$/eventId"),
    authority,
    testCard,
    generationSource,
  });
}

export function createTestCardPlanningPlan(
  value: unknown,
): Readonly<TestCardPlanningPlan> {
  const record = exactRecord(value, DRAFT_FIELDS, "$draft");
  return parseTestCardPlanningPlan({
    kind: PLAN_KIND,
    schemaVersion: PLAN_SCHEMA_VERSION,
    demandId: record.demandId,
    expectedStreamRevision: record.expectedStreamRevision,
    commitId: record.commitId,
    eventId: record.eventId,
    authority: record.authority,
    testCard: record.testCard,
    generationSource: record.generationSource,
  });
}

export function computeTestCardPlanningPlanDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseTestCardPlanningPlan(value));
}
