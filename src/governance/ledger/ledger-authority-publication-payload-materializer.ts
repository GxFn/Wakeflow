import { types } from "node:util";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  LedgerAuthorityPublicationInputError,
  parseConfirmationAuthorityPublicationInput,
  parseRequirementAuthorityPublicationInput,
  type LedgerAuthorityPublicationInput,
} from "./ledger-authority-publication-input.js";
import {
  parseLedgerAuthorityPublicationPlan,
  LedgerAuthorityPublicationPlanError,
  type LedgerAuthorityPublicationPlan,
} from "./ledger-authority-publication-plan.js";
import {
  captureLedgerAuthorityPublicationSource,
  materializeLedgerAuthorityPublicationSourcePayload,
  LedgerAuthorityPublicationSourceError,
  type LedgerAuthorityPublicationSourcePayload,
  type LedgerAuthorityPublicationSourceSnapshot,
} from "./ledger-authority-publication-source.js";

/**
 * Wakeflow Governance / Ledger：把exact Publication Plan重新材料化为内存成员字节。
 *
 * 本模块重新加载当前Config，从Plan重建只读Design source选择，先取得稳定描述符并与
 * Record/tree plan逐项核对，再按相同节点读取exact bytes。它不打开Ledger根、不创建
 * intent/stage/final资源，也不决定Apply或Recovery路线。返回字节只供直接Store调用；
 * Store仍会独立重算每个成员摘要。
 */

export interface LedgerAuthorityPublicationPayloadMaterializationOptions {
  readonly signal?: AbortSignal;
}

export type LedgerAuthorityPublicationPayload =
  LedgerAuthorityPublicationSourcePayload;

export type LedgerAuthorityPublicationPayloadMaterializationErrorReason =
  | "input"
  | "plan"
  | "config"
  | "source-root"
  | "source"
  | "source-profile"
  | "source-changed"
  | "capacity"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Ledger authority publication payload materialization input is invalid.",
  plan: "Ledger authority publication payload plan is invalid.",
  config: "Ledger authority publication payload Config authority changed.",
  "source-root": "Ledger authority publication payload Design source root is invalid.",
  source: "Ledger authority publication payload source is unavailable or unsafe.",
  "source-profile": "Ledger authority publication payload source is not strict Markdown text.",
  "source-changed": "Ledger authority publication payload differs from its exact plan.",
  capacity: "Ledger authority publication payload exceeds its bounded capacity.",
  aborted: "Ledger authority publication payload materialization was aborted.",
  "operation-failure": "Ledger authority publication payload materialization failed.",
} as const satisfies Readonly<Record<
  LedgerAuthorityPublicationPayloadMaterializationErrorReason,
  string
>>;

/** Plan无法重新取得一组exact Store成员字节时的稳定、脱敏错误。 */
export class LedgerAuthorityPublicationPayloadMaterializationError
  extends Error {
  override readonly name =
    "LedgerAuthorityPublicationPayloadMaterializationError";
  readonly code =
    "wakeflow-ledger-authority-publication-payload-materialization" as const;
  readonly reason: LedgerAuthorityPublicationPayloadMaterializationErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: LedgerAuthorityPublicationPayloadMaterializationErrorReason,
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

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: LedgerAuthorityPublicationPayloadMaterializationErrorReason,
  cause?: unknown,
): never {
  throw new LedgerAuthorityPublicationPayloadMaterializationError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input");
  }
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error);
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal")
    || (record.signal !== undefined
      && (typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  return Object.freeze({
    signal: record.signal as AbortSignal | undefined,
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted");
}

function parsePlan(value: unknown): Readonly<LedgerAuthorityPublicationPlan> {
  try {
    return parseLedgerAuthorityPublicationPlan(value);
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityPublicationPlanError) {
      fail("plan", error);
    }
    throw error;
  }
}

function sourceInput(
  plan: Readonly<LedgerAuthorityPublicationPlan>,
): Readonly<LedgerAuthorityPublicationInput> {
  const input = {
    title: plan.intent.record.title,
    designSurfaceId: plan.designSurfaceId,
    documents: plan.intent.record.documents.map(({ role, path }) => ({
      role,
      path,
    })),
  };
  try {
    return plan.intent.record.artifactKind === "wakeflow-requirement-record"
      ? parseRequirementAuthorityPublicationInput(input)
      : parseConfirmationAuthorityPublicationInput(input);
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityPublicationInputError) {
      fail("plan", error);
    }
    throw error;
  }
}

async function readConfig(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("config", error);
    }
    throw error;
  }
}

function assertConfigMatchesPlan(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
): void {
  if (
    config.configDigest !== plan.configDigest
    || config.model.program.programId !== plan.intent.record.programId
  ) {
    fail("config");
  }
}

async function assertConfigCurrent(
  root: RootedDirectory,
  expected: Readonly<WakeflowConfigAuthoritySnapshot>,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const current = await readConfig(root, signal);
  assertConfigMatchesPlan(current, plan);
  if (
    current.workspaceRoot !== expected.workspaceRoot
    || current.source.digest !== expected.source.digest
    || current.ledgerRoot !== expected.ledgerRoot
  ) {
    fail("config");
  }
}

function mapSourceError(error: LedgerAuthorityPublicationSourceError): never {
  if (error.reason === "input") fail("operation-failure", error);
  fail(error.reason, error);
}

async function captureSource(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
  signal: AbortSignal | undefined,
): Promise<Readonly<LedgerAuthorityPublicationSourceSnapshot>> {
  try {
    return await captureLedgerAuthorityPublicationSource(
      config,
      input,
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityPublicationSourceError) {
      mapSourceError(error);
    }
    throw error;
  }
}

async function materializeSource(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  input: Readonly<LedgerAuthorityPublicationInput>,
  source: Readonly<LedgerAuthorityPublicationSourceSnapshot>,
  signal: AbortSignal | undefined,
): Promise<LedgerAuthorityPublicationPayload> {
  try {
    return await materializeLedgerAuthorityPublicationSourcePayload(
      config,
      input,
      source,
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityPublicationSourceError) {
      mapSourceError(error);
    }
    throw error;
  }
}

function memberPlanFile(
  plan: Readonly<LedgerAuthorityPublicationPlan>,
  path: string,
) {
  return plan.intent.treePlan.files.find((file) => file.path === path) ?? null;
}

function assertSourceMatchesPlan(
  source: Readonly<LedgerAuthorityPublicationSourceSnapshot>,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
): void {
  const expected = plan.intent.record.documents;
  if (
    source.designSurfaceId !== plan.designSurfaceId
    || source.documents.length !== expected.length
  ) {
    fail("source-changed");
  }
  for (const [index, document] of source.documents.entries()) {
    const recordDocument = expected[index];
    if (recordDocument === undefined) fail("plan");
    const planFile = memberPlanFile(plan, recordDocument.path);
    if (planFile === null) fail("plan");
    if (
      document.role !== recordDocument.role
      || document.path !== recordDocument.path
      || document.digest !== recordDocument.digest
      || planFile.digest !== document.digest
      || planFile.byteCount !== document.byteCount
    ) {
      fail("source-changed");
    }
  }
}

function assertPayloadMatchesPlan(
  payload: LedgerAuthorityPublicationPayload,
  plan: Readonly<LedgerAuthorityPublicationPlan>,
): void {
  const expected = plan.intent.record.documents;
  if (payload.length !== expected.length) fail("operation-failure");
  for (const [index, member] of payload.entries()) {
    const recordDocument = expected[index];
    if (recordDocument === undefined) fail("operation-failure");
    const planFile = memberPlanFile(plan, recordDocument.path);
    if (
      planFile === null
      || member.path !== recordDocument.path
      || member.bytes.byteLength !== planFile.byteCount
      || computeSha256Digest(member.bytes) !== recordDocument.digest
      || recordDocument.digest !== planFile.digest
    ) {
      fail("operation-failure");
    }
  }
}

/** 按exact Plan无写取得Ledger Store可直接重新验证的成员字节。 */
export async function materializeLedgerAuthorityPublicationPayload(
  workspaceRootValue: RootedDirectory,
  planValue: unknown,
  optionsValue: LedgerAuthorityPublicationPayloadMaterializationOptions = {},
): Promise<LedgerAuthorityPublicationPayload> {
  assertRoot(workspaceRootValue);
  const options = parseOptions(optionsValue);
  assertNotAborted(options.signal);
  const plan = parsePlan(planValue);
  const input = sourceInput(plan);
  const config = await readConfig(workspaceRootValue, options.signal);
  assertConfigMatchesPlan(config, plan);
  const source = await captureSource(config, input, options.signal);
  assertSourceMatchesPlan(source, plan);
  const payload = await materializeSource(
    config,
    input,
    source,
    options.signal,
  );
  assertPayloadMatchesPlan(payload, plan);
  await assertConfigCurrent(
    workspaceRootValue,
    config,
    plan,
    options.signal,
  );
  return payload;
}
