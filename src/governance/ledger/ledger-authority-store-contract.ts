import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { StableFileSource } from "../../foundation/filesystem/stable-file-read.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type {
  LedgerAuthorityDocument,
  LedgerAuthorityRecord,
} from "./ledger-authority-record.js";
import type { LedgerAuthorityFamily } from "./ledger-authority-paths.js";
import {
  LEDGER_DURABLE_DIRECTORY_MODE,
  LEDGER_DURABLE_FILE_MODE,
} from "./ledger-authority-storage-policy.js";

/** Ledger Store 的公共数据合同，由物理读取器和发布职责所有者共同复用。 */

export interface LedgerAuthorityMemberInput {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export type LedgerAuthorityFileSource = StableFileSource;

export interface LoadedLedgerAuthorityDocument extends LedgerAuthorityDocument {
  readonly memberRef: PortableResourcePath;
  readonly source: Readonly<LedgerAuthorityFileSource>;
}

export interface LoadedLedgerAuthorityRecord<
  RecordType extends LedgerAuthorityRecord = LedgerAuthorityRecord,
> {
  readonly family: LedgerAuthorityFamily;
  readonly record: Readonly<RecordType>;
  readonly recordRootRef: PortableResourcePath;
  readonly recordRef: PortableResourcePath;
  readonly recordDigest: Sha256Digest;
  readonly recordSource: Readonly<LedgerAuthorityFileSource>;
  readonly documents: readonly Readonly<LoadedLedgerAuthorityDocument>[];
}

export interface LedgerAuthorityPublicationResult<
  RecordType extends LedgerAuthorityRecord = LedgerAuthorityRecord,
> {
  readonly wroteAuthority: boolean;
  readonly loaded: Readonly<LoadedLedgerAuthorityRecord<RecordType>>;
}

interface LedgerAuthorityMemberReferenceFields {
  readonly artifactKind: "wakeflow-ledger-authority-member-reference";
  readonly schemaVersion: 1;
  readonly recordRef: PortableResourcePath;
  readonly recordDigest: Sha256Digest;
  readonly memberPath: PortableResourcePath;
  readonly memberRef: PortableResourcePath;
  readonly memberDigest: Sha256Digest;
  readonly role: LedgerAuthorityDocument["role"];
  readonly mediaType: string;
}

export type LedgerAuthorityMemberReference =
  | Readonly<LedgerAuthorityMemberReferenceFields & {
      readonly family: "requirement";
      readonly recordId: WakeflowDurableId<"requirement">;
    }>
  | Readonly<LedgerAuthorityMemberReferenceFields & {
      readonly family: "confirmation";
      readonly recordId: WakeflowDurableId<"confirmation">;
    }>;

export interface ResolvedLedgerAuthorityMember {
  readonly reference: Readonly<LedgerAuthorityMemberReference>;
  readonly loaded: Readonly<LoadedLedgerAuthorityRecord>;
  readonly document: Readonly<LoadedLedgerAuthorityDocument>;
  readonly bytes: Uint8Array;
  readonly source: Readonly<LedgerAuthorityFileSource>;
}

export interface InitializeLedgerAuthorityStoreOptions {
  readonly freshLedger: true;
  readonly signal?: AbortSignal;
}

export interface LedgerAuthorityStoreOptions {
  readonly signal?: AbortSignal;
}

export type LedgerAuthorityStoreErrorReason =
  | "input"
  | "root-scope"
  | "not-found"
  | "recovery-required"
  | "recovery-input-required"
  | "conflict"
  | "record"
  | "member"
  | "node-policy"
  | "capacity"
  | "lock-timeout"
  | "lock-unsafe"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Ledger authority store input is invalid.",
  "root-scope": "Ledger authority root changed during the operation.",
  "not-found": "Ledger authority record does not exist.",
  "recovery-required": "Ledger authority record has an unresolved publication residue.",
  "recovery-input-required": "Ledger publication stage is incomplete and requires exact caller bytes.",
  conflict: "Ledger authority bytes conflict with an immutable identity.",
  record: "Ledger authority record is invalid.",
  member: "Ledger authority member inventory or bytes are invalid.",
  "node-policy": "Ledger authority resource violates its durable node policy.",
  capacity: "Ledger authority resource exceeds its bounded capacity.",
  "lock-timeout": "Ledger record publication lock could not be acquired before its deadline.",
  "lock-unsafe": "Ledger record publication lock resource is unsafe.",
  aborted: "Ledger authority operation was aborted.",
  "operation-failure": "Ledger authority operation failed.",
} as const satisfies Readonly<Record<LedgerAuthorityStoreErrorReason, string>>;

/** Ledger Store 操作失败时返回的稳定、脱敏错误。 */
export class LedgerAuthorityStoreError extends Error {
  override readonly name = "LedgerAuthorityStoreError";
  readonly code = "wakeflow-ledger-authority-store" as const;
  readonly reason: LedgerAuthorityStoreErrorReason;
  readonly path: string;

  constructor(reason: LedgerAuthorityStoreErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedLedgerAuthorityStoreOptions {
  readonly signal: AbortSignal | undefined;
}

export function throwLedgerAuthorityStoreError(
  reason: LedgerAuthorityStoreErrorReason,
  path: string,
): never {
  throw new LedgerAuthorityStoreError(reason, path);
}

export function isLedgerAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

export function parseLedgerAuthorityStoreOptions(
  value: unknown,
): Readonly<ParsedLedgerAuthorityStoreOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      throwLedgerAuthorityStoreError("input", "$options");
    }
    throw error;
  }
  const unexpected = Object.keys(record).find((key) => key !== "signal");
  if (unexpected !== undefined) {
    throwLedgerAuthorityStoreError("input", `$options/${unexpected}`);
  }
  if (record.signal !== undefined && !isLedgerAbortSignal(record.signal)) {
    throwLedgerAuthorityStoreError("input", "$options/signal");
  }
  return Object.freeze({ signal: record.signal });
}

export function assertLedgerAuthorityNode(
  node: Readonly<FileNodeSnapshot>,
  kind: "file" | "directory",
  path: string,
): void {
  if (
    node.kind !== kind
    || node.permissionBits !== (
      kind === "file"
        ? LEDGER_DURABLE_FILE_MODE
        : LEDGER_DURABLE_DIRECTORY_MODE
    )
    || (kind === "file" && node.linkCount !== 1n)
  ) {
    throwLedgerAuthorityStoreError("node-policy", path);
  }
}
