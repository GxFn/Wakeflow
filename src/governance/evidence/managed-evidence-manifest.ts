import type { WakeflowManagedEvidenceManifest as ManagedEvidenceManifestWire } from "../../contracts/generated/governance/evidence/managed-evidence-manifest.generated.js";
import { WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA } from "../../contracts/generated/governance/evidence/managed-evidence-manifest.generated.js";
import { WAKEFLOW_LOADED_ARTIFACT_TREE_MANIFEST_SCHEMA } from "../../contracts/generated/foundation/loaded-artifact-tree-manifest.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  LOADED_ARTIFACT_TREE_IDENTITY_LIMITS,
  validateLoadedArtifactTreeManifest,
  LoadedArtifactTreeIdentityError,
  type LoadedArtifactTreeManifest,
} from "../../foundation/artifact/loaded-artifact-tree-identity.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import {
  readUtcWallClock,
  UtcWallClockError,
  type UtcWallClock,
} from "../../foundation/time/wall-clock.js";
import {
  parseManagedEvidenceSourceDescriptor,
  ManagedEvidenceSourceSelectionError,
  type ManagedEvidenceSensitivity,
  type ManagedEvidenceSource,
} from "./managed-evidence-source-selection.js";

/**
 * Wakeflow Governance / Evidence：本地managed evidence的不可变内容与来源清单。
 *
 * Manifest把一份已捕获payload的完整Foundation tree identity绑定到Program、Demand、
 * immutable Demand Authority、配置中的逻辑来源和记录窗口。它只描述已经捕获的内容事实：
 * 不保存payload字节，不读取源文件，不提交Event，也不判断Evidence是否真实、充分或可接受。
 *
 * `contentReview`只记录opaque文件是否需要并取得Controller显式复核，不冒充secret扫描、
 * privacy扫描或内容真实性证明。外部HTTPS/Git locator属于另一类Evidence Reference，不进入
 * 本managed manifest。
 */

export const MANAGED_EVIDENCE_MANIFEST_KIND =
  "wakeflow-managed-evidence-manifest" as const;
export const MANAGED_EVIDENCE_MANIFEST_VERSION = 1 as const;
export const MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES = 1024 * 1024;

/**
 * final record还包含一个Manifest文件和`payload/`目录前缀，因此Managed Evidence
 * payload必须在Loaded Artifact硬上限内预留一个文件、两个entry、一个路径层级、
 * `payload/`的8个UTF-8字节，以及最多1 MiB的Manifest文档容量。
 */
export const MANAGED_EVIDENCE_PAYLOAD_LIMITS = Object.freeze({
  maxDepth: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxDepth - 1,
  maxEntries: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxEntries - 2,
  maxFileBytes: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxFileBytes,
  maxFiles: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxFiles - 1,
  maxRefBytes: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxRefBytes - 8,
  maxTotalBytes:
    LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxTotalBytes -
    MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES,
} as const);

export type ManagedEvidenceContentReviewDisposition =
  "controller-confirmed" | "not-required";

export interface ManagedEvidenceRecorder {
  readonly windowId: WakeflowDurableId<"window">;
  readonly configDigest: Sha256Digest;
}

export interface ManagedEvidencePayload {
  readonly artifactDigest: Sha256Digest;
  readonly treeManifest: Readonly<LoadedArtifactTreeManifest>;
}

export interface ManagedEvidenceContentReview {
  readonly disposition: ManagedEvidenceContentReviewDisposition;
  readonly opaqueFileRefs: readonly PortableResourcePath[];
}

export interface ManagedEvidenceManifest {
  readonly artifactKind: typeof MANAGED_EVIDENCE_MANIFEST_KIND;
  readonly schemaVersion: typeof MANAGED_EVIDENCE_MANIFEST_VERSION;
  readonly evidenceId: WakeflowDurableId<"evidence">;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly demandAuthorityDigest: Sha256Digest;
  readonly evidenceType: string;
  readonly capturedAt: UtcInstant;
  readonly recordedBy: Readonly<ManagedEvidenceRecorder>;
  readonly source: Readonly<ManagedEvidenceSource>;
  readonly sensitivity: ManagedEvidenceSensitivity;
  readonly payload: Readonly<ManagedEvidencePayload>;
  readonly contentReview: Readonly<ManagedEvidenceContentReview>;
  readonly manifestDigest: Sha256Digest;
}

export interface ManagedEvidenceManifestDraft {
  readonly evidenceId: WakeflowDurableId<"evidence">;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly demandAuthorityDigest: Sha256Digest;
  readonly evidenceType: string;
  readonly recordedBy: Readonly<ManagedEvidenceRecorder>;
  readonly source: Readonly<ManagedEvidenceSource>;
  readonly sensitivity: ManagedEvidenceSensitivity;
  readonly payload: Readonly<ManagedEvidencePayload>;
  readonly contentReview: Readonly<ManagedEvidenceContentReview>;
}

export interface CreateManagedEvidenceManifestOptions {
  readonly clock?: UtcWallClock;
}

export type ManagedEvidenceManifestErrorReason =
  | "input"
  | "json"
  | "capacity"
  | "schema"
  | "identifier"
  | "digest"
  | "time"
  | "source"
  | "payload"
  | "content-review"
  | "ordering"
  | "representation";

const ERROR_MESSAGES = {
  input: "Managed evidence manifest input is invalid.",
  json: "Managed evidence manifest is not passive JSON data.",
  capacity: "Managed evidence manifest exceeds its metadata capacity.",
  schema: "Managed evidence manifest does not satisfy its portable Schema.",
  identifier: "Managed evidence manifest contains an invalid typed identity.",
  digest: "Managed evidence manifest contains an invalid digest.",
  time: "Managed evidence manifest contains an invalid capture time.",
  source: "Managed evidence manifest contains an invalid local source.",
  payload: "Managed evidence manifest payload identity is inconsistent.",
  "content-review": "Managed evidence manifest content review is inconsistent.",
  ordering: "Managed evidence manifest paths are not in canonical order.",
  representation:
    "Managed evidence manifest bytes are not its deterministic representation.",
} as const satisfies Readonly<
  Record<ManagedEvidenceManifestErrorReason, string>
>;

export class ManagedEvidenceManifestError extends Error {
  override readonly name = "ManagedEvidenceManifestError";
  readonly code = "wakeflow-managed-evidence-manifest" as const;
  readonly reason: ManagedEvidenceManifestErrorReason;
  readonly path: string;

  constructor(reason: ManagedEvidenceManifestErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

type ManifestBasis = Omit<ManagedEvidenceManifest, "manifestDigest">;

const DRAFT_VALIDATION_INSTANT = parseUtcInstant("1970-01-01T00:00:00.000Z");
const DRAFT_FIELDS = Object.freeze([
  "contentReview",
  "demandAuthorityDigest",
  "demandId",
  "evidenceId",
  "evidenceType",
  "payload",
  "programId",
  "recordedBy",
  "sensitivity",
  "source",
] as const);
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

const validateWire =
  createRuntimeJsonSchemaValidator<ManagedEvidenceManifestWire>(
    WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA,
    [
      WAKEFLOW_LOADED_ARTIFACT_TREE_MANIFEST_SCHEMA,
      WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
      WAKEFLOW_SHA256_DIGEST_SCHEMA,
      WAKEFLOW_UTC_INSTANT_SCHEMA,
    ],
  );

function fail(reason: ManagedEvidenceManifestErrorReason, path: string): never {
  throw new ManagedEvidenceManifestError(reason, path);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseId<
  K extends
    "demand" | "evidence" | "program" | "repository" | "surface" | "window",
>(value: unknown, kind: K, path: string): WakeflowDurableId<K> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function parseTime(value: unknown, path: string): UtcInstant {
  try {
    return parseUtcInstant(value, path);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", path);
    throw error;
  }
}

function parseEvidenceType(value: unknown): string {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    fail("schema", "$/evidenceType");
  }
  return value;
}

function parsePayload(
  value: ManagedEvidenceManifestWire["payload"],
): Readonly<ManagedEvidencePayload> {
  let treeManifest: Readonly<LoadedArtifactTreeManifest>;
  try {
    treeManifest = validateLoadedArtifactTreeManifest(value.treeManifest, {
      limits: MANAGED_EVIDENCE_PAYLOAD_LIMITS,
    });
  } catch (error: unknown) {
    if (error instanceof LoadedArtifactTreeIdentityError) {
      if (
        error.reason === "entry-limit" ||
        error.reason === "depth-limit" ||
        error.reason === "file-count" ||
        error.reason === "file-bytes" ||
        error.reason === "total-bytes" ||
        error.reason === "ref-bytes"
      ) {
        fail("capacity", "$/payload/treeManifest");
      }
      fail("payload", "$/payload/treeManifest");
    }
    throw error;
  }
  const artifactDigest = parseDigest(
    value.artifactDigest,
    "$/payload/artifactDigest",
  );
  if (
    computeCanonicalJsonSha256Digest(treeManifest, "$/payload/treeManifest") !==
    artifactDigest
  ) {
    fail("payload", "$/payload/artifactDigest");
  }
  return Object.freeze({ artifactDigest, treeManifest });
}

function parseContentReview(
  value: ManagedEvidenceManifestWire["contentReview"],
  payload: Readonly<ManagedEvidencePayload>,
): Readonly<ManagedEvidenceContentReview> {
  const payloadRefs = new Set(
    payload.treeManifest.files.map((file) => file.ref),
  );
  const opaqueFileRefs = value.opaqueFileRefs.map((entry, index) => {
    let ref: PortableResourcePath;
    try {
      ref = parsePortableResourcePath(
        entry,
        `$/contentReview/opaqueFileRefs/${index}`,
      );
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) {
        fail("content-review", `$/contentReview/opaqueFileRefs/${index}`);
      }
      throw error;
    }
    if (!payloadRefs.has(ref)) {
      fail("content-review", `$/contentReview/opaqueFileRefs/${index}`);
    }
    if (
      index > 0 &&
      compareText(value.opaqueFileRefs[index - 1] ?? "", ref) >= 0
    ) {
      fail("ordering", `$/contentReview/opaqueFileRefs/${index}`);
    }
    return ref;
  });
  if (
    (opaqueFileRefs.length === 0) !==
    (value.disposition === "not-required")
  ) {
    fail("content-review", "$/contentReview");
  }
  return Object.freeze({
    disposition: value.disposition,
    opaqueFileRefs: Object.freeze(opaqueFileRefs),
  });
}

function manifestBasis(
  wire: Readonly<ManagedEvidenceManifestWire>,
): Readonly<ManifestBasis> {
  const payload = parsePayload(wire.payload);
  let source: Readonly<ManagedEvidenceSource>;
  try {
    source = parseManagedEvidenceSourceDescriptor(wire.source);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceSourceSelectionError) {
      fail("source", error.path);
    }
    throw error;
  }
  if (
    source.resourceType === "file" &&
    (payload.treeManifest.fileCount !== 1 ||
      payload.treeManifest.files[0]?.ref !== "content")
  ) {
    fail("payload", "$/payload/treeManifest/files");
  }
  return Object.freeze({
    artifactKind: MANAGED_EVIDENCE_MANIFEST_KIND,
    schemaVersion: MANAGED_EVIDENCE_MANIFEST_VERSION,
    evidenceId: parseId(wire.evidenceId, "evidence", "$/evidenceId"),
    programId: parseId(wire.programId, "program", "$/programId"),
    demandId: parseId(wire.demandId, "demand", "$/demandId"),
    demandAuthorityDigest: parseDigest(
      wire.demandAuthorityDigest,
      "$/demandAuthorityDigest",
    ),
    evidenceType: parseEvidenceType(wire.evidenceType),
    capturedAt: parseTime(wire.capturedAt, "$/capturedAt"),
    recordedBy: Object.freeze({
      windowId: parseId(
        wire.recordedBy.windowId,
        "window",
        "$/recordedBy/windowId",
      ),
      configDigest: parseDigest(
        wire.recordedBy.configDigest,
        "$/recordedBy/configDigest",
      ),
    }),
    source,
    sensitivity: wire.sensitivity,
    payload,
    contentReview: parseContentReview(wire.contentReview, payload),
  });
}

/** 解析并递归冻结一份关系闭合的managed evidence manifest。 */
export function parseManagedEvidenceManifest(
  value: unknown,
): Readonly<ManagedEvidenceManifest> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$manifest");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  if (
    encodeCanonicalJson(json, "$manifest").byteLength + 1 >
    MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES
  ) {
    fail("capacity", "$manifest");
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  const basis = manifestBasis(result.value);
  const manifestDigest = parseDigest(
    result.value.manifestDigest,
    "$/manifestDigest",
  );
  if (computeCanonicalJsonSha256Digest(basis, "$manifest") !== manifestDigest) {
    fail("digest", "$/manifestDigest");
  }
  return Object.freeze({ ...basis, manifestDigest });
}

function exactDraftRecord(value: unknown): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$draft");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$draft");
    throw error;
  }
  const keys = Object.keys(record).sort(compareText);
  if (
    keys.length !== DRAFT_FIELDS.length ||
    keys.some((key, index) => key !== DRAFT_FIELDS[index])
  ) {
    fail("input", "$draft");
  }
  return record;
}

function candidateManifest(
  record: Readonly<Record<string, unknown>>,
  capturedAt: UtcInstant,
): unknown {
  const basis = {
    artifactKind: MANAGED_EVIDENCE_MANIFEST_KIND,
    schemaVersion: MANAGED_EVIDENCE_MANIFEST_VERSION,
    evidenceId: record.evidenceId,
    programId: record.programId,
    demandId: record.demandId,
    demandAuthorityDigest: record.demandAuthorityDigest,
    evidenceType: record.evidenceType,
    capturedAt,
    recordedBy: record.recordedBy,
    source: record.source,
    sensitivity: record.sensitivity,
    payload: record.payload,
    contentReview: record.contentReview,
  };
  let json: JsonValue;
  try {
    json = parseJsonValue(basis, "$draft");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", error.path);
    throw error;
  }
  if (json === null || Array.isArray(json) || typeof json !== "object") {
    fail("input", "$draft");
  }
  return Object.freeze({
    ...json,
    manifestDigest: computeCanonicalJsonSha256Digest(json, "$draft"),
  });
}

function readCaptureTime(
  options: CreateManagedEvidenceManifestOptions,
): UtcInstant {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(options, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "clock")) {
    fail("input", "$options");
  }
  try {
    return readUtcWallClock(record.clock as UtcWallClock | undefined);
  } catch (error: unknown) {
    if (error instanceof UtcWallClockError) fail("time", "$options/clock");
    throw error;
  }
}

/** 从关闭草稿创建Manifest；草稿关系在读取wall clock之前完成复验。 */
export function createManagedEvidenceManifest(
  draft: unknown,
  options: CreateManagedEvidenceManifestOptions = {},
): Readonly<ManagedEvidenceManifest> {
  const record = exactDraftRecord(draft);
  parseManagedEvidenceManifest(
    candidateManifest(record, DRAFT_VALIDATION_INSTANT),
  );
  return parseManagedEvidenceManifest(
    candidateManifest(record, readCaptureTime(options)),
  );
}

/** 渲染managed evidence manifest的唯一确定性JSON文件表示。 */
export function renderManagedEvidenceManifest(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseManagedEvidenceManifest(value),
    "$manifest",
  );
}

/** 只接受与领域确定性表示逐字节相同的Manifest文档。 */
export function parseManagedEvidenceManifestDocument(
  text: unknown,
): Readonly<ManagedEvidenceManifest> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$manifest");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$manifest");
    }
    throw error;
  }
  const manifest = parseManagedEvidenceManifest(json);
  if (renderManagedEvidenceManifest(manifest) !== text) {
    fail("representation", "$manifest");
  }
  return manifest;
}

/** 返回已经由codec验证并绑定完整Manifest basis的领域摘要。 */
export function computeManagedEvidenceManifestDigest(
  value: unknown,
): Sha256Digest {
  return parseManagedEvidenceManifest(value).manifestDigest;
}
