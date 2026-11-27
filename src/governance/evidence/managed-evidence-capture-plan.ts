import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import {
  DemandEventStreamPositionError,
  type DemandEventStreamRevision,
  parseDemandEventStreamRevision,
} from "../demand/event-sourcing/demand-event-stream-position.js";
import {
  type ManagedEvidenceManifest,
  ManagedEvidenceManifestError,
  parseManagedEvidenceManifest,
} from "./managed-evidence-manifest.js";

/**
 * Wakeflow Governance / Evidence：零写capture结果的纯计划合同。
 *
 * Capture Planning Service负责读取Config、Demand与source；本模块只关闭它返回的
 * Config摘要、Event Sourcing追加预期和完整Manifest。`planDigest`证明调用方交回的
 * plan仍是同一份preview，不授予文件写入、Event追加或恢复能力。
 */

export const MANAGED_EVIDENCE_CAPTURE_PLAN_KIND = "WakeflowManagedEvidenceCapturePlan" as const;
export const MANAGED_EVIDENCE_CAPTURE_PLAN_VERSION = 1 as const;

export interface ManagedEvidenceCaptureDemandExpectation {
  readonly streamRevision: DemandEventStreamRevision;
  readonly stateDigest: Sha256Digest;
  readonly lastEventId: WakeflowDurableId<"demand-event">;
  readonly lastEventDigest: Sha256Digest;
}

export interface ManagedEvidenceCapturePlan {
  readonly kind: typeof MANAGED_EVIDENCE_CAPTURE_PLAN_KIND;
  readonly schemaVersion: typeof MANAGED_EVIDENCE_CAPTURE_PLAN_VERSION;
  readonly configDigest: Sha256Digest;
  readonly expectedDemand: Readonly<ManagedEvidenceCaptureDemandExpectation>;
  readonly manifest: Readonly<ManagedEvidenceManifest>;
  readonly planDigest: Sha256Digest;
}

export type ManagedEvidenceCapturePlanErrorReason =
  | "input"
  | "identifier"
  | "position"
  | "digest"
  | "manifest"
  | "relation";

/** Capture plan无法形成单一零写preview时的稳定错误。 */
export class ManagedEvidenceCapturePlanError extends ModuleError<ManagedEvidenceCapturePlanErrorReason> {
  static override readonly code = "wakeflow-managed-evidence-capture-plan";
}

const fail: Fail<ManagedEvidenceCapturePlanErrorReason> = failWith(ManagedEvidenceCapturePlanError);

interface ManagedEvidenceCapturePlanBasis {
  readonly kind: typeof MANAGED_EVIDENCE_CAPTURE_PLAN_KIND;
  readonly schemaVersion: typeof MANAGED_EVIDENCE_CAPTURE_PLAN_VERSION;
  readonly configDigest: Sha256Digest;
  readonly expectedDemand: Readonly<ManagedEvidenceCaptureDemandExpectation>;
  readonly manifest: Readonly<ManagedEvidenceManifest>;
}

const CREATE_FIELDS = Object.freeze(["configDigest", "expectedDemand", "manifest"] as const);
const EXPECTATION_FIELDS = Object.freeze([
  "lastEventDigest",
  "lastEventId",
  "stateDigest",
  "streamRevision",
] as const);

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path, error);
    throw error;
  }
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("input", path);
  }
  return record;
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path, error);
    throw error;
  }
}

function parseLastEventId(value: unknown): WakeflowDurableId<"demand-event"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand-event", "$/expectedDemand/lastEventId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("identifier", "$/expectedDemand/lastEventId", error);
    }
    throw error;
  }
}

function parseExpectation(value: unknown): Readonly<ManagedEvidenceCaptureDemandExpectation> {
  const record = exactRecord(value, EXPECTATION_FIELDS, "$/expectedDemand");
  let streamRevision: DemandEventStreamRevision;
  try {
    streamRevision = parseDemandEventStreamRevision(
      record.streamRevision,
      "$/expectedDemand/streamRevision",
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) {
      fail("position", "$/expectedDemand/streamRevision", error);
    }
    throw error;
  }
  return Object.freeze({
    streamRevision,
    stateDigest: parseDigest(record.stateDigest, "$/expectedDemand/stateDigest"),
    lastEventId: parseLastEventId(record.lastEventId),
    lastEventDigest: parseDigest(record.lastEventDigest, "$/expectedDemand/lastEventDigest"),
  });
}

function parseManifest(value: unknown): Readonly<ManagedEvidenceManifest> {
  try {
    return parseManagedEvidenceManifest(value);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceManifestError) {
      fail("manifest", "$/manifest", error);
    }
    throw error;
  }
}

function buildBasis(
  configDigestValue: unknown,
  expectationValue: unknown,
  manifestValue: unknown,
): Readonly<ManagedEvidenceCapturePlanBasis> {
  const configDigest = parseDigest(configDigestValue, "$/configDigest");
  const expectedDemand = parseExpectation(expectationValue);
  const manifest = parseManifest(manifestValue);
  if (configDigest !== manifest.recordedBy.configDigest) {
    fail("relation", "$/configDigest");
  }
  return Object.freeze({
    kind: MANAGED_EVIDENCE_CAPTURE_PLAN_KIND,
    schemaVersion: MANAGED_EVIDENCE_CAPTURE_PLAN_VERSION,
    configDigest,
    expectedDemand,
    manifest,
  });
}

/** 从Planning已确认的三个事实生成确定性capture plan。 */
export function createManagedEvidenceCapturePlan(
  value: unknown,
): Readonly<ManagedEvidenceCapturePlan> {
  const record = exactRecord(value, CREATE_FIELDS, "$input");
  const basis = buildBasis(record.configDigest, record.expectedDemand, record.manifest);
  return Object.freeze({
    ...basis,
    planDigest: computeCanonicalJsonSha256Digest(basis, "$plan"),
  });
}
