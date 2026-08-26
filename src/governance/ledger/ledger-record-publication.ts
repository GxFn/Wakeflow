import { types } from "node:util";

import type {
  WakeflowLedgerRecordPublication as LedgerRecordPublicationWire,
} from "../../contracts/generated/governance/ledger/ledger-record-publication.generated.js";
import {
  WAKEFLOW_LEDGER_RECORD_PUBLICATION_SCHEMA,
} from "../../contracts/generated/governance/ledger/ledger-record-publication.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
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
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../foundation/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  decodeBase64Url,
  encodeBase64Url,
  Base64UrlError,
} from "../../foundation/text/base64url.js";
import { decodeUtf8, encodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import {
  computeLedgerAuthorityRecordDigest,
  parseLedgerAuthorityRecord,
  parseLedgerAuthorityRecordDocument,
  renderLedgerAuthorityRecord,
  LedgerAuthorityRecordError,
  type LedgerAuthorityRecord,
} from "./ledger-authority-record.js";
import {
  ledgerAuthorityFamily,
  ledgerAuthorityRecordId,
  ledgerAuthorityRecordRef,
  type LedgerAuthorityFamily,
} from "./ledger-authority-paths.js";

/**
 * Wakeflow Governance / Ledger：immutable authority publish 的自包含恢复计划。
 *
 * Journal 以 canonical unpadded base64url 保存 exact record/member bytes，并在准入时
 * 重新解析 record、计算所有 digest、核对 path/order。进程重启后 Store 可以只依赖
 * journal 前向完成 publication，不要求原调用方重新提供内存中的成员字节。
 */

export const LEDGER_RECORD_PUBLICATION_ARTIFACT_KIND =
  "wakeflow-ledger-record-publication" as const;
export const LEDGER_RECORD_PUBLICATION_SCHEMA_VERSION = 1 as const;
const MEMBER_MAXIMUM_BYTES = 4 * 1024 * 1024;

export interface LedgerRecordPublicationDocument {
  readonly path: PortableResourcePath;
  readonly digest: Sha256Digest;
  readonly bytes: string;
}

export interface LedgerRecordPublication {
  readonly artifactKind: typeof LEDGER_RECORD_PUBLICATION_ARTIFACT_KIND;
  readonly schemaVersion: typeof LEDGER_RECORD_PUBLICATION_SCHEMA_VERSION;
  readonly family: LedgerAuthorityFamily;
  readonly recordId:
    | WakeflowDurableId<"requirement">
    | WakeflowDurableId<"confirmation">;
  readonly recordRef: PortableResourcePath;
  readonly recordDigest: Sha256Digest;
  readonly recordBytes: string;
  readonly documents: readonly [
    Readonly<LedgerRecordPublicationDocument>,
    ...Readonly<LedgerRecordPublicationDocument>[],
  ];
}

export interface DecodedLedgerRecordPublication {
  readonly record: Readonly<LedgerAuthorityRecord>;
  readonly members: readonly Readonly<{
    readonly path: PortableResourcePath;
    readonly bytes: Uint8Array;
  }>[];
}

export type LedgerRecordPublicationErrorReason =
  | "input"
  | "json"
  | "schema"
  | "identifier"
  | "path"
  | "digest"
  | "bytes"
  | "record"
  | "relation"
  | "representation";

const ERROR_MESSAGES = {
  "input": "Ledger record publication input is invalid.",
  "json": "Ledger record publication is not passive JSON data.",
  "schema": "Ledger record publication does not satisfy its portable Schema.",
  "identifier": "Ledger record publication contains an invalid typed identity.",
  "path": "Ledger record publication contains an invalid resource path.",
  "digest": "Ledger record publication contains an invalid digest.",
  "bytes": "Ledger record publication contains invalid canonical bytes.",
  "record": "Ledger record publication contains an invalid authority record.",
  "relation": "Ledger record publication fields do not describe one exact record tree.",
  "representation": "Ledger record publication bytes are not deterministic.",
} as const satisfies Readonly<Record<LedgerRecordPublicationErrorReason, string>>;

export class LedgerRecordPublicationError extends Error {
  override readonly name = "LedgerRecordPublicationError";
  readonly code = "wakeflow-ledger-record-publication" as const;
  readonly reason: LedgerRecordPublicationErrorReason;
  readonly path: string;

  constructor(reason: LedgerRecordPublicationErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<LedgerRecordPublicationWire>(
  WAKEFLOW_LEDGER_RECORD_PUBLICATION_SCHEMA,
  [WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA, WAKEFLOW_SHA256_DIGEST_SCHEMA],
);

function fail(reason: LedgerRecordPublicationErrorReason, path: string): never {
  throw new LedgerRecordPublicationError(reason, path);
}

function parsePath(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("path", path);
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

function decodeBytes(value: unknown, path: string): Uint8Array {
  try {
    return decodeBase64Url(value as string, path);
  } catch (error: unknown) {
    if (error instanceof Base64UrlError) fail("bytes", path);
    throw error;
  }
}

function parseRecordBytes(value: unknown): Readonly<LedgerAuthorityRecord> {
  const bytes = decodeBytes(value, "$/recordBytes");
  let text: string;
  try {
    text = decodeUtf8(bytes, "$/recordBytes");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("record", "$/recordBytes");
    throw error;
  }
  try {
    return parseLedgerAuthorityRecordDocument(text);
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityRecordError) {
      fail("record", "$/recordBytes");
    }
    throw error;
  }
}

function parseRecordId(
  family: LedgerAuthorityFamily,
  value: unknown,
): LedgerRecordPublication["recordId"] {
  try {
    return family === "requirement"
      ? parseWakeflowDurableIdOfKind(value, "requirement", "$/recordId")
      : parseWakeflowDurableIdOfKind(value, "confirmation", "$/recordId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("identifier", "$/recordId");
    }
    throw error;
  }
}

function normalize(
  wire: Readonly<LedgerRecordPublicationWire>,
): Readonly<LedgerRecordPublication> {
  const record = parseRecordBytes(wire.recordBytes);
  const recordId = parseRecordId(wire.family, wire.recordId);
  const recordDigest = parseDigest(wire.recordDigest, "$/recordDigest");
  const recordBytes = encodeBase64Url(
    encodeUtf8(renderLedgerAuthorityRecord(record)),
  );
  if (
    recordBytes !== wire.recordBytes
    || wire.family !== ledgerAuthorityFamily(record)
    || recordId !== ledgerAuthorityRecordId(record)
    || wire.recordRef !== ledgerAuthorityRecordRef(record)
    || recordDigest !== computeLedgerAuthorityRecordDigest(record)
  ) {
    fail("relation", "$publication");
  }
  const documents = Object.freeze(wire.documents.map((document, index) => {
    const path = parsePath(document.path, `$/documents/${index}/path`);
    const digest = parseDigest(document.digest, `$/documents/${index}/digest`);
    const bytes = decodeBytes(document.bytes, `$/documents/${index}/bytes`);
    if (
      encodeBase64Url(bytes) !== document.bytes
      || computeSha256Digest(bytes) !== digest
    ) {
      fail("relation", `$/documents/${index}`);
    }
    return Object.freeze({ path, digest, bytes: document.bytes });
  })) as LedgerRecordPublication["documents"];
  if (documents.length !== record.documents.length) {
    fail("relation", "$/documents");
  }
  for (const [index, document] of documents.entries()) {
    const declared = record.documents[index];
    if (
      declared === undefined
      || declared.path !== document.path
      || declared.digest !== document.digest
      || (index > 0 && documents[index - 1]!.path >= document.path)
    ) {
      fail("relation", `$/documents/${index}`);
    }
  }
  return Object.freeze({
    artifactKind: LEDGER_RECORD_PUBLICATION_ARTIFACT_KIND,
    schemaVersion: LEDGER_RECORD_PUBLICATION_SCHEMA_VERSION,
    family: wire.family,
    recordId,
    recordRef: parsePath(wire.recordRef, "$/recordRef"),
    recordDigest,
    recordBytes,
    documents,
  });
}

export function parseLedgerRecordPublication(
  value: unknown,
): Readonly<LedgerRecordPublication> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$publication");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  return normalize(result.value);
}

function parseMemberInputs(
  value: unknown,
  record: Readonly<LedgerAuthorityRecord>,
): readonly Readonly<{ readonly path: PortableResourcePath; readonly bytes: Uint8Array }>[] {
  let entries: readonly unknown[];
  try {
    entries = parseDenseArray(value, 32, "$members");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$members");
    throw error;
  }
  if (entries.length !== record.documents.length) fail("relation", "$members");
  return Object.freeze(entries.map((entry, index) => {
    let input: Readonly<Record<string, unknown>>;
    try {
      input = parsePlainRecord(entry, `$/members/${index}`);
    } catch (error: unknown) {
      if (error instanceof PassiveOwnDataError) fail("input", `$/members/${index}`);
      throw error;
    }
    const keys = Object.keys(input).sort();
    if (
      !(
        (keys.length === 2 && keys[0] === "bytes" && keys[1] === "path")
        || (
          keys.length === 3
          && keys[0] === "bytes"
          && keys[1] === "digest"
          && keys[2] === "path"
        )
      )
    ) {
      fail("input", `$/members/${index}`);
    }
    const path = parsePath(input.path, `$/members/${index}/path`);
    if (
      !ArrayBuffer.isView(input.bytes)
      || !(input.bytes instanceof Uint8Array)
      || types.isProxy(input.bytes)
      || input.bytes.byteLength > MEMBER_MAXIMUM_BYTES
    ) {
      fail("bytes", `$/members/${index}/bytes`);
    }
    const bytes = new Uint8Array(input.bytes);
    const digest = computeSha256Digest(bytes);
    if (
      Object.hasOwn(input, "digest")
      && parseDigest(input.digest, `$/members/${index}/digest`) !== digest
    ) {
      fail("relation", `$/members/${index}/digest`);
    }
    const declared = record.documents[index];
    if (
      declared === undefined
      || declared.path !== path
      || declared.digest !== digest
    ) {
      fail("relation", `$/members/${index}`);
    }
    return Object.freeze({ path, bytes });
  }));
}

export function createLedgerRecordPublication(
  recordValue: unknown,
  membersValue: readonly unknown[],
): Readonly<LedgerRecordPublication> {
  const record = parseLedgerAuthorityRecord(recordValue);
  const members = parseMemberInputs(membersValue, record);
  return parseLedgerRecordPublication({
    artifactKind: LEDGER_RECORD_PUBLICATION_ARTIFACT_KIND,
    schemaVersion: LEDGER_RECORD_PUBLICATION_SCHEMA_VERSION,
    family: ledgerAuthorityFamily(record),
    recordId: ledgerAuthorityRecordId(record),
    recordRef: ledgerAuthorityRecordRef(record),
    recordDigest: computeLedgerAuthorityRecordDigest(record),
    recordBytes: encodeBase64Url(encodeUtf8(renderLedgerAuthorityRecord(record))),
    documents: members.map((member, index) => ({
      path: member.path,
      digest: record.documents[index]!.digest,
      bytes: encodeBase64Url(member.bytes),
    })),
  });
}

export function decodeLedgerRecordPublication(
  value: unknown,
): Readonly<DecodedLedgerRecordPublication> {
  const publication = parseLedgerRecordPublication(value);
  return Object.freeze({
    record: parseRecordBytes(publication.recordBytes),
    members: Object.freeze(publication.documents.map((document) => (
      Object.freeze({
        path: document.path,
        bytes: decodeBytes(document.bytes, "$publication/documents/bytes"),
      })
    ))),
  });
}

export function assertLedgerRecordPublicationMatches(
  publicationValue: unknown,
  recordValue: unknown,
): Readonly<LedgerRecordPublication> {
  const publication = parseLedgerRecordPublication(publicationValue);
  const record = parseLedgerAuthorityRecord(recordValue);
  const decoded = decodeLedgerRecordPublication(publication);
  if (
    computeCanonicalJsonSha256Digest(
      decoded.record as unknown as JsonValue,
    ) !== computeCanonicalJsonSha256Digest(record as unknown as JsonValue)
  ) {
    fail("relation", "$publication");
  }
  return publication;
}

export function renderLedgerRecordPublication(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseLedgerRecordPublication(value) as unknown as JsonValue,
    "$publication",
  );
}

export function parseLedgerRecordPublicationDocument(
  text: unknown,
): Readonly<LedgerRecordPublication> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$publication");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", error.path);
    }
    throw error;
  }
  const publication = parseLedgerRecordPublication(json);
  if (renderLedgerRecordPublication(publication) !== text) {
    fail("representation", "$publication");
  }
  return publication;
}
