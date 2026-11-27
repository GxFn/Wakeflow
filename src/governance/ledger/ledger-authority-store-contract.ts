import { types } from "node:util";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { StableFileSource } from "../../foundation/filesystem/stable-file-read.js";
import type { LedgerAuthorityFamily } from "./ledger-authority-paths.js";
import type { LedgerAuthorityDocument, LedgerAuthorityRecord } from "./ledger-authority-record.js";
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

/** 跨领域只读消费一份已验证需求包成员的完整 ref/digest 关系。 */
export interface LedgerAuthorityMemberReference {
  readonly artifactKind: "wakeflow-ledger-authority-member-reference";
  readonly schemaVersion: 1;
  readonly family: LedgerAuthorityFamily;
  readonly recordId: WakeflowDurableId<"requirement">;
  readonly recordRef: PortableResourcePath;
  readonly recordDigest: Sha256Digest;
  readonly memberPath: PortableResourcePath;
  readonly memberRef: PortableResourcePath;
  readonly memberDigest: Sha256Digest;
  readonly role: LedgerAuthorityDocument["role"];
  readonly mediaType: string;
}

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
  | "conflict"
  | "record"
  | "member"
  | "node-policy"
  | "capacity"
  | "operation-failure";

/** Ledger Store 操作失败时返回的稳定、脱敏错误。 */
export class LedgerAuthorityStoreError extends ModuleError<LedgerAuthorityStoreErrorReason> {
  static override readonly code = "wakeflow-ledger-authority-store";
}

export const throwLedgerAuthorityStoreError: Fail<LedgerAuthorityStoreErrorReason> =
  failWith(LedgerAuthorityStoreError);

interface ParsedLedgerAuthorityStoreOptions {
  readonly signal: AbortSignal | undefined;
}

export function isLedgerAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    !types.isProxy(value) &&
    value instanceof AbortSignal
  );
}

export function parseLedgerAuthorityStoreOptions(
  value: unknown,
): Readonly<ParsedLedgerAuthorityStoreOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      throwLedgerAuthorityStoreError("input", "$options", error);
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
    node.kind !== kind ||
    node.permissionBits !==
      (kind === "file" ? LEDGER_DURABLE_FILE_MODE : LEDGER_DURABLE_DIRECTORY_MODE) ||
    (kind === "file" && node.linkCount !== 1n)
  ) {
    throwLedgerAuthorityStoreError("node-policy", path);
  }
}
