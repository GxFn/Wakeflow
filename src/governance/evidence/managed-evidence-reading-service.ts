import { types } from "node:util";

import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  sameFileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  ByteCountError,
  parseByteCount,
  type ByteCount,
} from "../../foundation/numeric/byte-count.js";
import {
  closeDemandOperationAuthorityContext,
  openDemandReadAuthorityContext,
  DemandOperationAuthorityContextError,
  type DemandOperationAuthorityContext,
} from "../demand/demand-operation-authority-context.js";
import type { LoadedArtifactTreeFile } from "../../foundation/artifact/loaded-artifact-tree-identity.js";
import type { ManagedEvidenceManifest } from "./managed-evidence-manifest.js";
import {
  loadManagedEvidenceRecord,
  readManagedEvidencePayloadMember,
  verifyManagedEvidenceRecord,
  ManagedEvidenceRecordReaderError,
  type LoadedManagedEvidenceRecord,
} from "./managed-evidence-record-reader.js";
import type { ManagedEvidenceRecordInventoryEntry } from "./managed-evidence-record-set-inventory.js";

/**
 * Wakeflow Governance / Evidence：健康Demand Authority之上的按需Evidence读取服务。
 *
 * Service先完整加载Demand Identity/Authority/Ledger/Event selector与record inventory，
 * 再把某一份final record交给物理Reader。Manifest读取保持payload deferred；成员读取
 * 只验证一个完整文件；完整验证才扫描整棵record。它不解码opaque bytes，不证明内容
 * 真实性，也不拥有Public/MCP的敏感信息披露策略。
 */

export interface ManagedEvidenceReadingOptions {
  readonly signal?: AbortSignal;
}

export interface ManagedEvidencePayloadMemberReadingOptions {
  readonly maximumBytes: ByteCount;
  readonly signal?: AbortSignal;
}

export interface ManagedEvidenceManifestReadResult {
  readonly manifest: Readonly<ManagedEvidenceManifest>;
  readonly recordTreePlanDigest: Sha256Digest;
  readonly payloadVerification: "deferred";
}

export interface ManagedEvidencePayloadMemberReadingResult {
  readonly manifest: Readonly<ManagedEvidenceManifest>;
  readonly recordTreePlanDigest: Sha256Digest;
  readonly member: Readonly<LoadedArtifactTreeFile>;
  readonly opaque: boolean;
  /** 调用方拥有的可变防御副本。 */
  readonly bytes: Uint8Array;
  readonly payloadVerification: "member";
}

export interface ManagedEvidenceRecordVerificationResult {
  readonly manifest: Readonly<ManagedEvidenceManifest>;
  readonly recordTreePlanDigest: Sha256Digest;
  readonly payloadVerification: "complete";
}

export type ManagedEvidenceReadingServiceErrorReason =
  | "input"
  | "config"
  | "demand"
  | "not-found"
  | "authority"
  | "record"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Managed evidence reading input is invalid.",
  config: "Managed evidence reading Config authority is invalid.",
  demand: "Managed evidence reading Demand authority is invalid.",
  "not-found": "Managed evidence reading target does not exist.",
  authority: "Managed evidence record differs from its Event-backed inventory.",
  record: "Managed evidence record content is invalid or changed.",
  capacity: "Managed evidence reading exceeds its caller-provided capacity.",
  aborted: "Managed evidence reading was aborted.",
  "operation-failure": "Managed evidence reading failed.",
} as const satisfies Readonly<
  Record<ManagedEvidenceReadingServiceErrorReason, string>
>;

/** Authority或记录内容无法闭合时的稳定、脱敏读取错误。 */
export class ManagedEvidenceReadingServiceError extends Error {
  override readonly name = "ManagedEvidenceReadingServiceError";
  readonly code = "wakeflow-managed-evidence-reading-service" as const;
  readonly reason: ManagedEvidenceReadingServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: ManagedEvidenceReadingServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

interface ParsedOptions {
  readonly signal: AbortSignal | undefined;
}

interface ParsedMemberOptions extends ParsedOptions {
  readonly maximumBytes: ByteCount;
}

type RecordConsumer<Result> = (
  root: RootedDirectory,
  record: Readonly<LoadedManagedEvidenceRecord>,
) => Promise<Result>;

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: ManagedEvidenceReadingServiceErrorReason,
  cause?: unknown,
): never {
  throw new ManagedEvidenceReadingServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function parseSignal(value: unknown): AbortSignal | undefined {
  if (
    value !== undefined &&
    (typeof value !== "object" ||
      value === null ||
      types.isProxy(value) ||
      !(value instanceof AbortSignal))
  ) {
    fail("input");
  }
  return value as AbortSignal | undefined;
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error);
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "signal")) fail("input");
  return Object.freeze({ signal: parseSignal(record.signal) });
}

function parseMemberOptions(value: unknown): Readonly<ParsedMemberOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error);
    throw error;
  }
  if (
    !Object.hasOwn(record, "maximumBytes") ||
    Object.keys(record).some(
      (key) => key !== "maximumBytes" && key !== "signal",
    )
  ) {
    fail("input");
  }
  let maximumBytes: ByteCount;
  try {
    maximumBytes = parseByteCount(record.maximumBytes, "$/maximumBytes");
  } catch (error: unknown) {
    if (error instanceof ByteCountError) fail("input", error);
    throw error;
  }
  return Object.freeze({
    maximumBytes,
    signal: parseSignal(record.signal),
  });
}

function parseId<K extends "demand" | "evidence">(
  value: unknown,
  kind: K,
): WakeflowDurableId<K> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, `$${kind}Id`);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", error);
    throw error;
  }
}

function mapContextError(error: DemandOperationAuthorityContextError): never {
  if (error.reason === "aborted") fail("aborted", error);
  if (error.reason === "config" || error.reason === "stale-config") {
    fail("config", error);
  }
  fail("demand", error);
}

function mapReaderError(error: ManagedEvidenceRecordReaderError): never {
  if (error.reason === "input") fail("input", error);
  if (error.reason === "aborted") fail("aborted", error);
  if (error.reason === "root-scope") fail("demand", error);
  if (
    error.reason === "not-found" ||
    error.reason === "member-not-found"
  ) {
    fail("not-found", error);
  }
  if (error.reason === "capacity") fail("capacity", error);
  if (error.reason === "operation-failure") {
    fail("operation-failure", error);
  }
  fail("record", error);
}

function assertRecordAuthority(
  record: Readonly<LoadedManagedEvidenceRecord>,
  expected: Readonly<ManagedEvidenceRecordInventoryEntry>,
): void {
  const manifest = record.manifest;
  if (
    manifest.evidenceId !== expected.evidenceId ||
    manifest.programId !== expected.programId ||
    manifest.demandId !== expected.demandId ||
    manifest.demandAuthorityDigest !== expected.demandAuthorityDigest ||
    manifest.manifestDigest !== expected.manifestDigest ||
    manifest.payload.artifactDigest !== expected.payloadArtifactDigest ||
    record.recordTreePlan.planDigest !== expected.recordTreePlanDigest ||
    !sameFileNodeSnapshot(record.rootNode, expected.rootNode) ||
    !sameFileNodeSnapshot(record.manifestNode, expected.manifestNode) ||
    !sameFileNodeSnapshot(record.payloadNode, expected.payloadNode)
  ) {
    fail("authority");
  }
}

function manifestResult(
  record: Readonly<LoadedManagedEvidenceRecord>,
): Readonly<ManagedEvidenceManifestReadResult> {
  return Object.freeze({
    manifest: record.manifest,
    recordTreePlanDigest: record.recordTreePlan.planDigest,
    payloadVerification: "deferred" as const,
  });
}

async function withAuthorityRecord<Result>(
  workspaceRoot: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
  evidenceId: WakeflowDurableId<"evidence">,
  signal: AbortSignal | undefined,
  consume: RecordConsumer<Result>,
): Promise<Result> {
  let context: Readonly<DemandOperationAuthorityContext> | undefined;
  let result: Result | undefined;
  let completed = false;
  let failure: unknown;
  try {
    try {
      context = await openDemandReadAuthorityContext(
        workspaceRoot,
        demandId,
        signal,
      );
    } catch (error: unknown) {
      if (error instanceof DemandOperationAuthorityContextError) {
        mapContextError(error);
      }
      throw error;
    }
    const expected = context.loaded.inventory.managedEvidence.records.find(
      (candidate) => candidate.evidenceId === evidenceId,
    );
    if (expected === undefined) fail("not-found");
    let record: Readonly<LoadedManagedEvidenceRecord>;
    try {
      record = await loadManagedEvidenceRecord(
        context.demandRoot,
        evidenceId,
        {
          expectedRootNode: expected.rootNode,
          ...(signal === undefined ? {} : { signal }),
        },
      );
    } catch (error: unknown) {
      if (error instanceof ManagedEvidenceRecordReaderError) {
        mapReaderError(error);
      }
      throw error;
    }
    assertRecordAuthority(record, expected);
    try {
      result = await consume(context.demandRoot, record);
    } catch (error: unknown) {
      if (error instanceof ManagedEvidenceRecordReaderError) {
        mapReaderError(error);
      }
      throw error;
    }
    completed = true;
  } catch (error: unknown) {
    failure = error;
  }
  if (context !== undefined) {
    try {
      await closeDemandOperationAuthorityContext(context);
    } catch (error: unknown) {
      if (failure === undefined) {
        failure = error instanceof DemandOperationAuthorityContextError
          ? new ManagedEvidenceReadingServiceError(
              error.reason === "aborted" ? "aborted" : "demand",
              error.code,
              error.reason,
            )
          : error;
      }
    }
  }
  if (failure !== undefined) throw failure;
  if (!completed) fail("operation-failure");
  return result as Result;
}

export class ManagedEvidenceReadingService {
  readonly #workspaceRoot: RootedDirectory;

  constructor(workspaceRoot: RootedDirectory) {
    if (
      typeof workspaceRoot !== "object" ||
      workspaceRoot === null ||
      types.isProxy(workspaceRoot) ||
      !(workspaceRoot instanceof RootedDirectory)
    ) {
      fail("input");
    }
    this.#workspaceRoot = workspaceRoot;
  }

  /** 读取Event-backed Manifest；payload内容明确保持deferred。 */
  async readManifest(
    demandIdValue: unknown,
    evidenceIdValue: unknown,
    optionsValue: ManagedEvidenceReadingOptions = {},
  ): Promise<Readonly<ManagedEvidenceManifestReadResult>> {
    const demandId = parseId(demandIdValue, "demand");
    const evidenceId = parseId(evidenceIdValue, "evidence");
    const options = parseOptions(optionsValue);
    return withAuthorityRecord(
      this.#workspaceRoot,
      demandId,
      evidenceId,
      options.signal,
      async (_root, record) => manifestResult(record),
    );
  }

  /** 读取并验证Manifest声明的一个完整payload member。 */
  async readPayloadMember(
    demandIdValue: unknown,
    evidenceIdValue: unknown,
    memberRefValue: unknown,
    optionsValue: ManagedEvidencePayloadMemberReadingOptions,
  ): Promise<Readonly<ManagedEvidencePayloadMemberReadingResult>> {
    const demandId = parseId(demandIdValue, "demand");
    const evidenceId = parseId(evidenceIdValue, "evidence");
    const options = parseMemberOptions(optionsValue);
    return withAuthorityRecord(
      this.#workspaceRoot,
      demandId,
      evidenceId,
      options.signal,
      async (root, record) => {
        const read = await readManagedEvidencePayloadMember(
          root,
          record,
          memberRefValue,
          {
            maximumBytes: options.maximumBytes,
            ...(options.signal === undefined
              ? {}
              : { signal: options.signal }),
          },
        );
        return Object.freeze({
          manifest: read.record.manifest,
          recordTreePlanDigest: read.record.recordTreePlan.planDigest,
          member: read.member,
          opaque: read.opaque,
          bytes: read.bytes,
          payloadVerification: "member" as const,
        });
      },
    );
  }

  /** 扫描并散列一份Manifest对应的完整final record tree。 */
  async verifyRecord(
    demandIdValue: unknown,
    evidenceIdValue: unknown,
    optionsValue: ManagedEvidenceReadingOptions = {},
  ): Promise<Readonly<ManagedEvidenceRecordVerificationResult>> {
    const demandId = parseId(demandIdValue, "demand");
    const evidenceId = parseId(evidenceIdValue, "evidence");
    const options = parseOptions(optionsValue);
    return withAuthorityRecord(
      this.#workspaceRoot,
      demandId,
      evidenceId,
      options.signal,
      async (root, record) => {
        const verified = await verifyManagedEvidenceRecord(
          root,
          record,
          options.signal === undefined ? undefined : { signal: options.signal },
        );
        return Object.freeze({
          manifest: verified.record.manifest,
          recordTreePlanDigest: verified.record.recordTreePlan.planDigest,
          payloadVerification: "complete" as const,
        });
      },
    );
  }
}
