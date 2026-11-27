import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import type { WakeflowDemandAuthority as DemandAuthorityWire } from "../../../contracts/generated/governance/demand/demand-authority.generated.js";
import { WAKEFLOW_DEMAND_AUTHORITY_SCHEMA } from "../../../contracts/generated/governance/demand/demand-authority.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../../foundation/data/deterministic-json-document.js";
import {
  type JsonValue,
  JsonValueError,
  parseJsonValue,
} from "../../../foundation/data/json-value.js";
import {
  PassiveOwnDataError,
  parseDenseArray,
  parsePlainRecord,
} from "../../../foundation/data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../../../foundation/error/module-error.js";
import {
  type PortableResourcePath,
  PortableResourcePathError,
  parsePortableResourcePath,
} from "../../../foundation/filesystem/portable-resource-path.js";
import { throwIfAborted } from "../../../foundation/node/abort-signal.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import {
  type LedgerAuthorityMemberReference,
  type LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  type LoadedLedgerAuthorityRecord,
  parseLedgerAuthorityMemberReference,
} from "../../ledger/ledger-authority-store.js";
import {
  computeDemandIdentityDigest,
  type DemandIdentity,
  type DemandType,
  parseDemandIdentity,
} from "./demand-identity.js";

/**
 * Wakeflow Governance / Demand Model：事件溯源聚合发布所需的必需权威关系验证。
 *
 * 权威关系记录只保存可解析的需求包成员引用、身份语义摘要和测试决定。四类
 * Demand 都要求 `requirement` 与 `landing` 各恰好一个成员（ADR-0011 D3）；测试环境不再
 * 由 Ledger 成员证明，`environmentMemberRef` 恒为 `null`。本模块不写入 Ledger 或
 * Demand 文件，也不追加事件流。
 */

const DEMAND_AUTHORITY_ARTIFACT_KIND = "wakeflow-demand-authority" as const;
const DEMAND_AUTHORITY_SCHEMA_VERSION = 1 as const;

export type DemandTestingMode = "controller-only" | "real-environment" | "not-applicable";

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
  | "resolution"
  | "representation";

export class DemandAuthorityError extends ModuleError<DemandAuthorityErrorReason> {
  static override readonly code = "wakeflow-demand-authority";
}

const fail: Fail<DemandAuthorityErrorReason> = failWith(DemandAuthorityError);

const PACKAGE_ROLES = Object.freeze(["requirement", "landing"] as const);
/**
 * 真实环境Test执行的环境权威成员角色。Confirmation family 退役后，需求包的
 * `landing.md`（落地方案与测试决策）充当环境权威，`requirement.md` 充当Test Basis；
 * Pod 切片按 ADR-0010 接管专用环境权威前，二者由同一需求包记录冻结。
 */
export const TEST_ENVIRONMENT_AUTHORITY_ROLE = "landing" as const;
const REQUIRED_ROLES = Object.freeze({
  requirement: PACKAGE_ROLES,
  bug: PACKAGE_ROLES,
  supplement: PACKAGE_ROLES,
  research: PACKAGE_ROLES,
} as const satisfies Readonly<Record<DemandType, readonly string[]>>);
// biome-ignore lint/suspicious/noControlCharactersInRegex: the pattern exists to reject control characters in record text
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const DRAFT_FIELDS = Object.freeze(["authorityRefs", "testingDecision"] as const);

const validateWire = createRuntimeJsonSchemaValidator<DemandAuthorityWire>(
  WAKEFLOW_DEMAND_AUTHORITY_SCHEMA,
  [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
  ],
);

function referenceLocationKey(reference: Readonly<LedgerAuthorityMemberReference>): string {
  return [
    reference.family,
    reference.recordId,
    reference.recordRef,
    reference.memberPath,
    reference.memberRef,
  ].join("\u0000");
}

function parseReferences(
  values: readonly DemandAuthorityWire["authorityRefs"][number][],
): DemandAuthority["authorityRefs"] {
  const parsed = values.map((value, index) => {
    try {
      return parseLedgerAuthorityMemberReference(value);
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityStoreError) {
        fail("reference", `$/authorityRefs/${index}`, error);
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
      previous === undefined ||
      current === undefined ||
      referenceLocationKey(previous) >= referenceLocationKey(current)
    ) {
      fail("ordering", `$/authorityRefs/${index}`);
    }
  }
  return references;
}

function parseCanonicalText(value: string, path: string): string {
  if (
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
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
        fail("testing", "$/testingDecision/environmentMemberRef", error);
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
    authority.demandId !== identity.demandId ||
    authority.identityDigest !== computeDemandIdentityDigest(identity)
  ) {
    fail("identity", "$authority");
  }
  // 每个成员都必须来自身份所记录的同一个需求包记录。
  if (
    authority.authorityRefs.some(
      (entry) =>
        entry.recordId !== identity.source.requirementId ||
        entry.recordRef !== identity.source.recordRef ||
        entry.recordDigest !== identity.source.recordDigest,
    )
  ) {
    fail("identity", "$/authorityRefs");
  }
  // 每个必需角色恰好一个成员：下游按角色 `.find` 环境权威，不允许两个成员争同一角色。
  const roleCounts = new Map<string, number>();
  for (const entry of authority.authorityRefs) {
    roleCounts.set(entry.role, (roleCounts.get(entry.role) ?? 0) + 1);
  }
  for (const role of REQUIRED_ROLES[identity.demandType]) {
    if (roleCounts.get(role) !== 1) fail("role", "$/authorityRefs");
  }
  if (
    identity.demandType === "research"
      ? authority.testingDecision.mode !== "not-applicable"
      : authority.testingDecision.mode === "not-applicable"
  ) {
    fail("testing", "$/testingDecision/mode");
  }
  if (authority.testingDecision.environmentMemberRef !== null) {
    fail("testing", "$/testingDecision/environmentMemberRef");
  }
}

/** 解析 Demand Authority；提供 Identity 时，同时验证摘要、角色、测试和位置关系。 */
export function parseDemandAuthority(
  value: unknown,
  identity?: Readonly<DemandIdentity>,
): Readonly<DemandAuthority> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$authority");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path, error);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  let demandId: WakeflowDurableId<"demand">;
  try {
    demandId = parseWakeflowDurableIdOfKind(result.value.demandId, "demand", "$/demandId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", "$/demandId", error);
    throw error;
  }
  let identityDigest: Sha256Digest;
  try {
    identityDigest = parseSha256Digest(result.value.identityDigest, "$/identityDigest");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", "$/identityDigest", error);
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
  if (identity !== undefined) assertIdentityRelations(authority, identity);
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
    if (error instanceof PassiveOwnDataError) fail("input", "$draft", error);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== DRAFT_FIELDS.length ||
    keys.some((key, index) => key !== DRAFT_FIELDS[index])
  ) {
    fail("input", "$draft");
  }
  let draftRefs: readonly unknown[];
  try {
    draftRefs = parseDenseArray(record.authorityRefs, 32, "$/authorityRefs");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$/authorityRefs", error);
    throw error;
  }
  const parsedDraftRefs = draftRefs.map((value, index) => {
    try {
      return parseLedgerAuthorityMemberReference(value);
    } catch (error: unknown) {
      if (error instanceof LedgerAuthorityStoreError) {
        fail("reference", `$/authorityRefs/${index}`, error);
      }
      throw error;
    }
  });
  const sortedRefs = [...parsedDraftRefs].sort((left, right) => {
    const leftKey = referenceLocationKey(left);
    const rightKey = referenceLocationKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return parseDemandAuthority(
    {
      artifactKind: DEMAND_AUTHORITY_ARTIFACT_KIND,
      schemaVersion: DEMAND_AUTHORITY_SCHEMA_VERSION,
      demandId: identity.demandId,
      identityDigest: computeDemandIdentityDigest(identity),
      authorityRefs: sortedRefs,
      testingDecision: record.testingDecision,
    },
    identity,
  );
}

/** 向账本解析权威引用；账本自己的失败归成解析失败，中止原样上抛。 */
async function resolveAuthorityReferences(
  ledgerStore: LedgerAuthorityStore,
  references: Parameters<LedgerAuthorityStore["resolveMemberReferences"]>[0],
  signal: AbortSignal | undefined,
): Promise<Awaited<ReturnType<LedgerAuthorityStore["resolveMemberReferences"]>>> {
  try {
    return await ledgerStore.resolveMemberReferences(
      references,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) {
      fail("resolution", "$/authorityRefs", error);
    }
    throw error;
  }
}

/**
 * 通过 `LedgerAuthorityStore` 解析每个成员，并证明每个成员都属于同一 Program；
 * 成员与身份需求包记录的绑定由解析时的身份关系检查保证。
 */
export async function admitDemandAuthority(
  identity: Readonly<DemandIdentity>,
  authority: Readonly<DemandAuthority>,
  ledgerStore: LedgerAuthorityStore,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Readonly<AdmittedDemandAuthority>> {
  const { signal } = options;
  throwIfAborted(signal);
  const resolved: ResolvedDemandAuthorityReference[] = [];
  const ledgerResolutions = await resolveAuthorityReferences(
    ledgerStore,
    authority.authorityRefs,
    signal,
  );
  for (const [index, resolution] of ledgerResolutions.entries()) {
    const record = resolution.loaded;
    if (record.record.programId !== identity.programId) {
      fail("resolution", `$/authorityRefs/${index}`);
    }
    resolved.push(
      Object.freeze({
        reference: resolution.reference,
        record,
      }),
    );
  }
  return Object.freeze({
    identity,
    authority,
    resolvedAuthority: Object.freeze(resolved),
  });
}

export function renderDemandAuthority(authority: Readonly<DemandAuthority>): string {
  return renderDeterministicJsonDocument(authority, "$authority");
}

export function parseDemandAuthorityDocument(
  text: unknown,
  identity?: Readonly<DemandIdentity>,
): Readonly<DemandAuthority> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$authority");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path, error);
    }
    throw error;
  }
  const authority = parseDemandAuthority(json, identity);
  if (renderDemandAuthority(authority) !== text) {
    fail("representation", "$authority");
  }
  return authority;
}

export function computeDemandAuthorityDigest(authority: Readonly<DemandAuthority>): Sha256Digest {
  return computeCanonicalJsonSha256Digest(authority);
}
