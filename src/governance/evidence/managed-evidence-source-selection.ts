import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";

/**
 * Wakeflow Governance / Evidence：调用方可选择的本地managed source与内容策略。
 *
 * Selection只表达Config逻辑根、portable path、预期资源类型、领域标签和显式opaque
 * 策略。它不接收绝对路径、来源digest、Evidence ID、时间、Config/Demand摘要或payload
 * manifest；这些事实由Planning从当前权威和实际字节派生。
 */

export type ManagedEvidenceSensitivity = "internal" | "public";
export type ManagedEvidenceResourceType = "file" | "tree";
export type ManagedEvidenceOpaqueContentPolicy =
  "controller-confirmed" | "reject";

export type ManagedEvidenceSourceRoot =
  | Readonly<{
      readonly kind: "repository";
      readonly repositoryId: WakeflowDurableId<"repository">;
    }>
  | Readonly<{
      readonly kind: "support-surface";
      readonly surfaceId: WakeflowDurableId<"surface">;
    }>;

export interface ManagedEvidenceSource {
  readonly root: ManagedEvidenceSourceRoot;
  readonly path: PortableResourcePath;
  readonly resourceType: ManagedEvidenceResourceType;
}

export interface ManagedEvidenceSourceSelection {
  readonly evidenceType: string;
  readonly source: Readonly<ManagedEvidenceSource>;
  readonly sensitivity: ManagedEvidenceSensitivity;
  readonly opaqueContentPolicy: ManagedEvidenceOpaqueContentPolicy;
}

export type ManagedEvidenceSourceSelectionErrorReason =
  | "input"
  | "identifier"
  | "path"
  | "evidence-type"
  | "source"
  | "sensitivity"
  | "opaque-policy";

const ERROR_MESSAGES = {
  input: "Managed evidence source selection input is invalid.",
  identifier:
    "Managed evidence source selection contains an invalid root identity.",
  path: "Managed evidence source selection contains an invalid portable path.",
  "evidence-type":
    "Managed evidence source selection contains an invalid evidence type.",
  source:
    "Managed evidence source selection must identify one local configured source.",
  sensitivity: "Managed evidence source selection sensitivity is invalid.",
  "opaque-policy":
    "Managed evidence source selection opaque content policy is invalid.",
} as const satisfies Readonly<
  Record<ManagedEvidenceSourceSelectionErrorReason, string>
>;

export class ManagedEvidenceSourceSelectionError extends Error {
  override readonly name = "ManagedEvidenceSourceSelectionError";
  readonly code = "wakeflow-managed-evidence-source-selection" as const;
  readonly reason: ManagedEvidenceSourceSelectionErrorReason;
  readonly path: string;

  constructor(reason: ManagedEvidenceSourceSelectionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const SELECTION_FIELDS = Object.freeze([
  "evidenceType",
  "opaqueContentPolicy",
  "sensitivity",
  "source",
] as const);
const SOURCE_FIELDS = Object.freeze(["path", "resourceType", "root"] as const);
const REPOSITORY_ROOT_FIELDS = Object.freeze(["kind", "repositoryId"] as const);
const SUPPORT_ROOT_FIELDS = Object.freeze(["kind", "surfaceId"] as const);
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const RESERVED_SOURCE_ROOT_SEGMENTS = new Set([
  ".git",
  ".wakeflow-active",
  ".wakeflow-local",
]);

function fail(
  reason: ManagedEvidenceSourceSelectionErrorReason,
  path: string,
): never {
  throw new ManagedEvidenceSourceSelectionError(reason, path);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
  reason: "input" | "source",
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail(reason, path);
    throw error;
  }
  const keys = Object.keys(record).sort(compareText);
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  ) {
    fail(reason, path);
  }
  return record;
}

function parseId<K extends "repository" | "surface">(
  value: unknown,
  kind: K,
  path: string,
): WakeflowDurableId<K> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function parseSourceRoot(value: unknown): ManagedEvidenceSourceRoot {
  let base: Readonly<Record<string, unknown>>;
  try {
    base = parsePlainRecord(value, "$/source/root");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("source", "$/source/root");
    throw error;
  }
  if (base.kind === "repository") {
    const record = exactRecord(
      base,
      REPOSITORY_ROOT_FIELDS,
      "$/source/root",
      "source",
    );
    return Object.freeze({
      kind: "repository" as const,
      repositoryId: parseId(
        record.repositoryId,
        "repository",
        "$/source/root/repositoryId",
      ),
    });
  }
  if (base.kind === "support-surface") {
    const record = exactRecord(
      base,
      SUPPORT_ROOT_FIELDS,
      "$/source/root",
      "source",
    );
    return Object.freeze({
      kind: "support-surface" as const,
      surfaceId: parseId(
        record.surfaceId,
        "surface",
        "$/source/root/surfaceId",
      ),
    });
  }
  fail("source", "$/source/root/kind");
}

/** 解析Manifest和Planning共用的本地逻辑来源描述。 */
export function parseManagedEvidenceSourceDescriptor(
  value: unknown,
): Readonly<ManagedEvidenceSource> {
  const record = exactRecord(value, SOURCE_FIELDS, "$/source", "source");
  let path: PortableResourcePath;
  try {
    path = parsePortableResourcePath(record.path, "$/source/path");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError)
      fail("path", "$/source/path");
    throw error;
  }
  const firstSegment = path.split("/", 1)[0]?.toLowerCase();
  if (
    firstSegment !== undefined &&
    RESERVED_SOURCE_ROOT_SEGMENTS.has(firstSegment)
  ) {
    fail("path", "$/source/path");
  }
  if (record.resourceType !== "file" && record.resourceType !== "tree") {
    fail("source", "$/source/resourceType");
  }
  return Object.freeze({
    root: parseSourceRoot(record.root),
    path,
    resourceType: record.resourceType,
  });
}

/** 解析公共层之下仍只包含调用方意图的managed evidence选择。 */
export function parseManagedEvidenceSourceSelection(
  value: unknown,
): Readonly<ManagedEvidenceSourceSelection> {
  const record = exactRecord(value, SELECTION_FIELDS, "$selection", "input");
  if (
    typeof record.evidenceType !== "string" ||
    !TOKEN_PATTERN.test(record.evidenceType)
  ) {
    fail("evidence-type", "$/evidenceType");
  }
  if (record.sensitivity !== "internal" && record.sensitivity !== "public") {
    fail("sensitivity", "$/sensitivity");
  }
  if (
    record.opaqueContentPolicy !== "controller-confirmed" &&
    record.opaqueContentPolicy !== "reject"
  ) {
    fail("opaque-policy", "$/opaqueContentPolicy");
  }
  return Object.freeze({
    evidenceType: record.evidenceType,
    source: parseManagedEvidenceSourceDescriptor(record.source),
    sensitivity: record.sensitivity,
    opaqueContentPolicy: record.opaqueContentPolicy,
  });
}
