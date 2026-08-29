import { types } from "node:util";

import type {
  WakeflowDemandAuthority as DemandAuthorityWire,
} from "../../../contracts/generated/governance/demand/demand-authority.generated.js";
import {
  WAKEFLOW_DEMAND_AUTHORITY_SCHEMA,
} from "../../../contracts/generated/governance/demand/demand-authority.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../../foundation/data/json-value.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../../foundation/schema/runtime-json-schema.js";
import {
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  parseLedgerAuthorityMemberReference,
  type LedgerAuthorityMemberReference,
  type LoadedLedgerAuthorityRecord,
} from "../../ledger/ledger-authority-store.js";
import {
  computeDemandIdentityDigest,
  parseDemandIdentity,
  type DemandIdentity,
  type DemandType,
} from "./demand-identity.js";

/**
 * Wakeflow Governance / Demand Model：事件溯源聚合发布所需的必需权威关系验证。
 *
 * 权威关系记录只保存可解析的 Ledger 成员引用、身份语义摘要和测试决定。旧
 * `entryMode` 已删除；Pod 或隔离执行位置必须由真实 Confirmation 引用、同一 Demand
 * 关系和位置授权共同证明。本模块不写入 Ledger 或 Demand 文件，也不追加事件流。
 */

const DEMAND_AUTHORITY_ARTIFACT_KIND =
  "wakeflow-demand-authority" as const;
const DEMAND_AUTHORITY_SCHEMA_VERSION = 1 as const;

export type DemandTestingMode =
  | "controller-only"
  | "real-environment"
  | "not-applicable";

export interface DemandTestingDecision {
  readonly mode: DemandTestingMode;
  readonly summary: string;
  readonly environmentMemberRef: PortableResourcePath | null;
}

export interface DemandAuthority {
  readonly artifactKind: typeof DEMAND_AUTHORITY_ARTIFACT_KIND;
  readonly schemaVersion: typeof DEMAND_AUTHORITY_SCHEMA_VERSION;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly identityDigest: Sha256Digest;
  readonly authorityRefs: readonly [
    Readonly<LedgerAuthorityMemberReference>,
    ...Readonly<LedgerAuthorityMemberReference>[],
  ];
  readonly testingDecision: Readonly<DemandTestingDecision>;
}

export interface ResolvedDemandAuthorityReference {
  readonly reference: Readonly<LedgerAuthorityMemberReference>;
  readonly record: Readonly<LoadedLedgerAuthorityRecord>;
}

export interface AdmittedDemandAuthority {
  readonly identity: Readonly<DemandIdentity>;
  readonly authority: Readonly<DemandAuthority>;
  readonly resolvedAuthority: readonly Readonly<ResolvedDemandAuthorityReference>[];
}

export type DemandAuthorityErrorReason =
  | "input"
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "text"
  | "reference"
  | "ordering"
  | "identity"
  | "role"
  | "testing"
  | "placement"
  | "resolution"
  | "aborted"
  | "representation";

const ERROR_MESSAGES = {
  "input": "Demand authority input is invalid.",
  "json": "Demand authority is not passive JSON data.",
  "schema": "Demand authority does not satisfy its portable Schema.",
  "identifier": "Demand authority contains an invalid Demand identity.",
  "digest": "Demand authority contains an invalid identity digest.",
  "text": "Demand authority contains non-canonical text.",
  "reference": "Demand authority contains an invalid Ledger member reference.",
  "ordering": "Demand authority references are not in canonical unique order.",
  "identity": "Demand authority does not bind its exact immutable identity.",
  "role": "Demand authority does not contain its required role closure.",
  "testing": "Demand authority testing decision is inconsistent.",
  "placement": "Demand authority does not prove execution placement.",
  "resolution": "Demand authority reference cannot be resolved exactly.",
  "aborted": "Demand authority admission was aborted.",
  "representation": "Demand authority bytes are not its deterministic domain representation.",
} as const satisfies Readonly<Record<DemandAuthorityErrorReason, string>>;

export class DemandAuthorityError extends Error {
  override readonly name = "DemandAuthorityError";
  readonly code = "wakeflow-demand-authority" as const;
  readonly reason: DemandAuthorityErrorReason;
  readonly path: string;

  constructor(reason: DemandAuthorityErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const REQUIRED_ROLES = Object.freeze({
  requirement: Object.freeze([
    "original-plan",
    "requirement-design",
    "code-facts",
    "landing-plan",
    "non-goals",
    "user-confirmation",
  ]),
  bug: Object.freeze(["reproduction", "scope", "non-goals"]),
  supplement: Object.freeze([
    "requirement-design",
    "requirement-delta",
    "user-confirmation",
  ]),
  research: Object.freeze(["research-question", "boundaries"]),
} as const satisfies Readonly<Record<DemandType, readonly string[]>>);
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const DRAFT_FIELDS = Object.freeze([
  "authorityRefs",
  "testingDecision",
] as const);

const validateWire = createRuntimeJsonSchemaValidator<DemandAuthorityWire>(
  WAKEFLOW_DEMAND_AUTHORITY_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
  ],
);

function fail(reason: DemandAuthorityErrorReason, path: string): never {
  throw new DemandAuthorityError(reason, path);
}

function referenceLocationKey(
  reference: Readonly<LedgerAuthorityMemberReference>,
): string {
  return [
    reference.family,
    reference.recordId,
    reference.recordRef,
    reference.memberPath,
    reference.memberRef,
  ].join("\u0000");
}

function sameReference(
  left: Readonly<LedgerAuthorityMemberReference>,
  right: Readonly<LedgerAuthorityMemberReference>,
): boolean {
  return left.artifactKind === right.artifactKind
    && left.schemaVersion === right.schemaVersion
    && left.family === right.family
    && left.recordId === right.recordId
    && left.recordRef === right.recordRef
    && left.recordDigest === right.recordDigest
    && left.memberPath === right.memberPath
    && left.memberRef === right.memberRef
    && left.memberDigest === right.memberDigest
    && left.role === right.role
    && left.mediaType === right.mediaType;
}

function parseReferences(
  values: readonly DemandAuthorityWire["authorityRefs"][number][],
): DemandAuthority["authorityRefs"] {
  const parsed = values.map((value, index) => {
    try {
      return parseLedgerAuthorityMemberReference(value);
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityStoreError) {
        fail("reference", `$/authorityRefs/${index}`);
      }
      throw error;
    }
  });
  const first = parsed[0];
  if (first === undefined) fail("schema", "$/authorityRefs");
  const mutableReferences: [
    Readonly<LedgerAuthorityMemberReference>,
    ...Readonly<LedgerAuthorityMemberReference>[],
  ] = [first];
  mutableReferences.push(...parsed.slice(1));
  const references = Object.freeze(mutableReferences);
  for (let index = 1; index < references.length; index += 1) {
    const previous = references[index - 1];
    const current = references[index];
    if (
      previous === undefined
      || current === undefined
      || referenceLocationKey(previous) >= referenceLocationKey(current)
    ) {
      fail("ordering", `$/authorityRefs/${index}`);
    }
  }
  return references;
}

function parseCanonicalText(value: string, path: string): string {
  if (
    !value.isWellFormed()
    || value.normalize("NFC") !== value
    || CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", path);
  }
  return value;
}

function parseTestingDecision(
  value: Readonly<DemandAuthorityWire["testingDecision"]>,
): Readonly<DemandTestingDecision> {
  let environmentMemberRef: PortableResourcePath | null = null;
  if (value.environmentMemberRef !== null) {
    try {
      environmentMemberRef = parsePortableResourcePath(
        value.environmentMemberRef,
        "$/testingDecision/environmentMemberRef",
      );
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) {
        fail("testing", "$/testingDecision/environmentMemberRef");
      }
      throw error;
    }
  }
  return Object.freeze({
    mode: value.mode,
    summary: parseCanonicalText(value.summary, "$/testingDecision/summary"),
    environmentMemberRef,
  });
}

function assertIdentityRelations(
  authority: Readonly<DemandAuthority>,
  identity: Readonly<DemandIdentity>,
): void {
  if (
    authority.demandId !== identity.demandId
    || authority.identityDigest !== computeDemandIdentityDigest(identity)
  ) {
    fail("identity", "$authority");
  }
  const roles = new Set<string>(
    authority.authorityRefs.map((entry) => entry.role),
  );
  for (const role of REQUIRED_ROLES[identity.demandType]) {
    if (!roles.has(role)) fail("role", "$/authorityRefs");
  }
  if (
    identity.demandType === "research"
      ? authority.testingDecision.mode !== "not-applicable"
      : authority.testingDecision.mode === "not-applicable"
  ) {
    fail("testing", "$/testingDecision/mode");
  }
  const environmentRefs = authority.authorityRefs.filter(
    (entry) => entry.role === "test-environment",
  );
  if (authority.testingDecision.mode === "real-environment") {
    if (
      authority.testingDecision.environmentMemberRef === null
      || environmentRefs.length !== 1
      || environmentRefs[0]?.memberRef
        !== authority.testingDecision.environmentMemberRef
    ) {
      fail("testing", "$/testingDecision/environmentMemberRef");
    }
  } else if (authority.testingDecision.environmentMemberRef !== null) {
    fail("testing", "$/testingDecision/environmentMemberRef");
  }
  if (identity.executionPlacement.mode === "isolated") {
    const expected = identity.executionPlacement.authorizationRef;
    const authorization = authority.authorityRefs.find(
      (entry) => sameReference(entry, expected),
    );
    if (
      authorization === undefined
      || authorization.family !== "confirmation"
      || !["goal-stage-decision", "user-confirmation"].includes(
        authorization.role,
      )
    ) {
      fail("placement", "$/authorityRefs");
    }
  }
}

/** 解析 Demand Authority；提供 Identity 时，同时验证摘要、角色、测试和位置关系。 */
export function parseDemandAuthority(
  value: unknown,
  identityValue?: unknown,
): Readonly<DemandAuthority> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$authority");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  let demandId: WakeflowDurableId<"demand">;
  try {
    demandId = parseWakeflowDurableIdOfKind(
      result.value.demandId,
      "demand",
      "$/demandId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", "$/demandId");
    throw error;
  }
  let identityDigest: Sha256Digest;
  try {
    identityDigest = parseSha256Digest(
      result.value.identityDigest,
      "$/identityDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", "$/identityDigest");
    throw error;
  }
  const authority = Object.freeze({
    artifactKind: DEMAND_AUTHORITY_ARTIFACT_KIND,
    schemaVersion: DEMAND_AUTHORITY_SCHEMA_VERSION,
    demandId,
    identityDigest,
    authorityRefs: parseReferences(result.value.authorityRefs),
    testingDecision: parseTestingDecision(result.value.testingDecision),
  });
  if (identityValue !== undefined) {
    const identity = parseDemandIdentity(identityValue);
    assertIdentityRelations(authority, identity);
  }
  return authority;
}

/** 从 Identity 和字段集合严格受限的草稿创建强制 Authority，并规范化引用顺序。 */
export function createDemandAuthority(
  identityValue: unknown,
  draft: unknown,
): Readonly<DemandAuthority> {
  const identity = parseDemandIdentity(identityValue);
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(draft, "$draft");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$draft");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== DRAFT_FIELDS.length
    || keys.some((key, index) => key !== DRAFT_FIELDS[index])
  ) {
    fail("input", "$draft");
  }
  let draftRefs: readonly unknown[];
  try {
    draftRefs = parseDenseArray(record.authorityRefs, 32, "$/authorityRefs");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$/authorityRefs");
    throw error;
  }
  const parsedDraftRefs = draftRefs.map((value, index) => {
    try {
      return parseLedgerAuthorityMemberReference(value);
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityStoreError) {
        fail("reference", `$/authorityRefs/${index}`);
      }
      throw error;
    }
  });
  const sortedRefs = [...parsedDraftRefs].sort((left, right) => {
    const leftKey = referenceLocationKey(left);
    const rightKey = referenceLocationKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return parseDemandAuthority({
    artifactKind: DEMAND_AUTHORITY_ARTIFACT_KIND,
    schemaVersion: DEMAND_AUTHORITY_SCHEMA_VERSION,
    demandId: identity.demandId,
    identityDigest: computeDemandIdentityDigest(identity),
    authorityRefs: sortedRefs,
    testingDecision: record.testingDecision,
  }, identity);
}

/**
 * 通过 `LedgerAuthorityStore` 解析每个成员，并证明 Program、同一 Demand 的
 * Confirmation、测试决定和隔离执行位置授权关系全部成立。
 */
export async function admitDemandAuthority(
  identityValue: unknown,
  authorityValue: unknown,
  ledgerStore: LedgerAuthorityStore,
  options?: { readonly signal?: AbortSignal },
): Promise<Readonly<AdmittedDemandAuthority>> {
  const identity = parseDemandIdentity(identityValue);
  const authority = parseDemandAuthority(authorityValue, identity);
  if (
    typeof ledgerStore !== "object"
    || ledgerStore === null
    || types.isProxy(ledgerStore)
    || !(ledgerStore instanceof LedgerAuthorityStore)
  ) {
    fail("input", "$ledgerStore");
  }
  let optionRecord: Readonly<Record<string, unknown>>;
  try {
    optionRecord = parsePlainRecord(
      options === undefined ? {} : options,
      "$options",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    Object.keys(optionRecord).some((key) => key !== "signal")
    || (
      optionRecord.signal !== undefined
      && (
        typeof optionRecord.signal !== "object"
        || optionRecord.signal === null
        || types.isProxy(optionRecord.signal)
        || !(optionRecord.signal instanceof AbortSignal)
      )
    )
  ) {
    fail("input", "$options");
  }
  const signal = optionRecord.signal as AbortSignal | undefined;
  if (signal?.aborted === true) fail("aborted", "$signal");
  const resolved: ResolvedDemandAuthorityReference[] = [];
  let ledgerResolutions;
  try {
    ledgerResolutions = await ledgerStore.resolveMemberReferences(
      authority.authorityRefs,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("resolution", "$/authorityRefs");
    }
    throw error;
  }
  for (const [index, resolution] of ledgerResolutions.entries()) {
    const record = resolution.loaded;
    if (record.record.programId !== identity.programId) {
      fail("resolution", `$/authorityRefs/${index}`);
    }
    if (
      record.record.artifactKind === "wakeflow-confirmation-record"
      && record.record.demandId !== identity.demandId
    ) {
      fail("resolution", `$/authorityRefs/${index}`);
    }
    resolved.push(Object.freeze({
      reference: resolution.reference,
      record,
    }));
  }
  return Object.freeze({
    identity,
    authority,
    resolvedAuthority: Object.freeze(resolved),
  });
}

export function renderDemandAuthority(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseDemandAuthority(value),
    "$authority",
  );
}

export function parseDemandAuthorityDocument(
  text: unknown,
  identityValue?: unknown,
): Readonly<DemandAuthority> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$authority");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path);
    }
    throw error;
  }
  const authority = parseDemandAuthority(json, identityValue);
  if (renderDemandAuthority(authority) !== text) {
    fail("representation", "$authority");
  }
  return authority;
}

export function computeDemandAuthorityDigest(value: unknown): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseDemandAuthority(value),
  );
}
