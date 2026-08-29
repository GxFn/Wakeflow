import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  GitIgnoreCandidateObservationError,
  observeGitIgnoreCandidate,
} from "../../foundation/git/git-ignore-candidate-observation.js";
import {
  GitIgnoreObservationError,
  observeGitIgnorePaths,
  type GitIgnorePathObservation,
} from "../../foundation/git/git-ignore-observation.js";
import {
  parseByteCount,
} from "../../foundation/numeric/byte-count.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import {
  decodeUtf8,
  Utf8Error,
} from "../../foundation/text/utf8.js";
import {
  createWakeflowWorkspaceStaticResourceOperationContext,
  WakeflowWorkspaceStaticResourceOperationContextError,
  type WakeflowWorkspaceStaticResourceOperationContext,
} from "../wakeflow-workspace-static-resource-operation-context.js";
import type {
  WakeflowWorkspaceStaticResourceMatrix,
} from "../wakeflow-workspace-static-resource-matrix.js";
import {
  classifyWakeflowGitignoreExactOutsideRules,
  createWakeflowGitignoreBodyAuthority,
  WakeflowGitignoreBodyAuthorityError,
  type WakeflowGitignoreBodyAuthority,
  type WakeflowGitignoreExactOutsideClassification,
  type WakeflowGitignoreRule,
} from "./wakeflow-gitignore-body-authority.js";
import {
  WAKEFLOW_GITIGNORE_REF,
} from "./wakeflow-managed-integration-resource-catalog.js";
import {
  inspectWakeflowManagedTextEnvelope,
  recomposeWakeflowManagedTextEnvelope,
  WakeflowManagedTextEnvelopeError,
  type WakeflowManagedTextEnvelopeInspection,
  type WakeflowManagedTextRecompositionResult,
} from "./wakeflow-managed-text-envelope.js";

/**
 * Wakeflow Workspace / Managed Integration：Workspace 根 `.gitignore` 的只读检查。
 *
 * 本模块组合 digest-bound Operation Context、完整宿主正文权威、稳定文件读取、byte-exact
 * envelope 与 Git 自身的 ignore 判定。它只返回当前结论和候选目标，不创建、替换、删除
 * 或修复文件；全局 excludes 与 `.git/info/exclude` 不替代 tracked `.gitignore` 证据。
 */

export const WAKEFLOW_GITIGNORE_MAXIMUM_BYTES = parseByteCount(
  2 * 1024 * 1024,
  "$gitignore.maximumBytes",
);

const GIT_DIRECTORY_PROBE_NAME = ".wakeflow-ignore-probe";

export interface WakeflowGitignoreRuleCheck {
  readonly rule: WakeflowGitignoreRule;
  readonly probePath: PortableResourcePath;
  readonly ignored: boolean;
}

export type WakeflowGitignoreInspectionStatus =
  | "recompose-required"
  | "satisfied-user-owned"
  | "managed-current";

export interface WakeflowGitignoreInspection {
  readonly kind: "WakeflowGitignoreInspection";
  readonly status: WakeflowGitignoreInspectionStatus;
  readonly context: Readonly<WakeflowWorkspaceStaticResourceOperationContext>;
  readonly authority: Readonly<WakeflowGitignoreBodyAuthority>;
  readonly source: Readonly<StableFileSource> | null;
  readonly envelope: Readonly<WakeflowManagedTextEnvelopeInspection>;
  readonly exactOutside:
    Readonly<WakeflowGitignoreExactOutsideClassification>;
  readonly gitRuleChecks: readonly Readonly<WakeflowGitignoreRuleCheck>[];
  readonly targetGitRuleChecks:
    readonly Readonly<WakeflowGitignoreRuleCheck>[] | null;
  readonly target: Readonly<WakeflowManagedTextRecompositionResult> | null;
}

export interface WakeflowGitignoreInspectionRequest {
  readonly matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  readonly expectedMatrixDigest: Sha256Digest;
  readonly hostProfiles: readonly unknown[];
  readonly signal?: AbortSignal;
}

export type WakeflowGitignoreInspectionErrorReason =
  | "input"
  | "context"
  | "authority"
  | "source"
  | "source-policy"
  | "envelope"
  | "outside-conflict"
  | "unknown-managed-body"
  | "target-capacity"
  | "candidate-semantics"
  | "git"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Wakeflow Gitignore inspection input is invalid.",
  context: "Wakeflow Gitignore operation context is invalid.",
  authority: "Wakeflow Gitignore body authority is invalid.",
  source: "Wakeflow Gitignore source cannot be read stably.",
  "source-policy": "Wakeflow Gitignore source violates its node policy.",
  envelope: "Wakeflow Gitignore managed envelope is invalid.",
  "outside-conflict":
    "Wakeflow Gitignore outside rules conflict with managed rules.",
  "unknown-managed-body":
    "Wakeflow Gitignore managed body is not an admitted render.",
  "target-capacity": "Wakeflow Gitignore candidate exceeds its byte budget.",
  "candidate-semantics":
    "Wakeflow Gitignore candidate does not provide its required Git semantics.",
  git: "Wakeflow Gitignore semantics could not be verified by Git.",
  aborted: "Wakeflow Gitignore inspection was aborted.",
} as const satisfies Readonly<Record<
  WakeflowGitignoreInspectionErrorReason,
  string
>>;

/** Gitignore 只读检查失败的稳定、脱敏错误。 */
export class WakeflowGitignoreInspectionError extends Error {
  override readonly name = "WakeflowGitignoreInspectionError";
  readonly code = "wakeflow-gitignore-inspection" as const;
  readonly reason: WakeflowGitignoreInspectionErrorReason;
  readonly path: string;

  constructor(reason: WakeflowGitignoreInspectionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedRequest {
  readonly matrix: Readonly<WakeflowWorkspaceStaticResourceMatrix>;
  readonly expectedMatrixDigest: Sha256Digest;
  readonly hostProfiles: readonly unknown[];
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: WakeflowGitignoreInspectionErrorReason,
  path: string,
): never {
  throw new WakeflowGitignoreInspectionError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function parseRequest(value: unknown): Readonly<ParsedRequest> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$request");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$request");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    (keys.length !== 3 && keys.length !== 4)
    || keys[0] !== "expectedMatrixDigest"
    || keys[1] !== "hostProfiles"
    || keys[2] !== "matrix"
    || (keys.length === 4 && keys[3] !== "signal")
    || (
      record.signal !== undefined
      && (
        types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)
      )
    )
  ) {
    fail("input", "$request");
  }
  return Object.freeze({
    matrix: record.matrix as Readonly<WakeflowWorkspaceStaticResourceMatrix>,
    expectedMatrixDigest: record.expectedMatrixDigest as Sha256Digest,
    hostProfiles: record.hostProfiles as readonly unknown[],
    signal: record.signal as AbortSignal | undefined,
  });
}

function currentUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("source-policy", "$source");
  }
  return BigInt(process.geteuid());
}

async function readSource(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  expectedUserId: bigint,
): Promise<Readonly<{
  readonly facts: Readonly<StableFileSource>;
  readonly bytes: Uint8Array;
}> | null> {
  try {
    const read = await readStableFile(root, WAKEFLOW_GITIGNORE_REF, {
      maximumBytes: WAKEFLOW_GITIGNORE_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
    if (
      read.node.kind !== "file"
      || read.node.permissionBits !== 0o644
      || read.node.linkCount !== 1n
      || read.node.userId !== expectedUserId
    ) {
      fail("source-policy", "$source");
    }
    return Object.freeze({
      facts: Object.freeze({
        resourcePath: read.resourcePath,
        node: read.node,
        byteCount: read.byteCount,
        digest: read.digest,
      }),
      bytes: read.bytes,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowGitignoreInspectionError) throw error;
    if (error instanceof StableFileReadError) {
      if (error.reason === "not-found") return null;
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (
        error.reason === "symlink"
        || error.reason === "not-file"
      ) {
        fail("source-policy", "$source");
      }
      fail("source", "$source");
    }
    throw error;
  }
}

async function revalidateSource(
  root: RootedDirectory,
  initial: Awaited<ReturnType<typeof readSource>>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const current = await readStableFile(root, WAKEFLOW_GITIGNORE_REF, {
      maximumBytes: WAKEFLOW_GITIGNORE_MAXIMUM_BYTES,
      ...(initial === null ? {} : { expectedNode: initial.facts.node }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (
      initial === null
      || current.digest !== initial.facts.digest
      || current.byteCount !== initial.facts.byteCount
    ) {
      fail("source", "$source");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowGitignoreInspectionError) throw error;
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (initial === null && error.reason === "not-found") return;
      fail("source", "$source");
    }
    throw error;
  }
}

function decodeOutside(
  bytes: Uint8Array,
  envelope: Readonly<WakeflowManagedTextEnvelopeInspection>,
): Readonly<{ readonly prefix: string; readonly suffix: string }> {
  try {
    if (envelope.kind === "unmanaged") {
      return Object.freeze({ prefix: decodeUtf8(bytes), suffix: "" });
    }
    return Object.freeze({
      prefix: decodeUtf8(bytes.subarray(
        envelope.prefixOutsideRange.offset,
        envelope.prefixOutsideRange.endExclusive,
      )),
      suffix: decodeUtf8(bytes.subarray(
        envelope.suffixOutsideRange.offset,
        envelope.suffixOutsideRange.endExclusive,
      )),
    });
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("envelope", "$source");
    throw error;
  }
}

function decodeLiteralRule(rule: WakeflowGitignoreRule): Readonly<{
  readonly resourcePath: PortableResourcePath;
  readonly directory: boolean;
}> {
  const directory = rule.endsWith("/");
  const encoded = rule.slice(1, directory ? -1 : undefined);
  let resourcePath = "";
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character === "\\") {
      const escaped = encoded[index + 1];
      if (escaped === undefined) fail("authority", "$authority.rules");
      resourcePath += escaped;
      index += 1;
    } else {
      resourcePath += character;
    }
  }
  try {
    return Object.freeze({
      resourcePath: parsePortableResourcePath(resourcePath),
      directory,
    });
  } catch {
    fail("authority", "$authority.rules");
  }
}

function probePath(rule: WakeflowGitignoreRule): PortableResourcePath {
  const decoded = decodeLiteralRule(rule);
  return decoded.directory
    ? parsePortableResourcePath(
      `${decoded.resourcePath}/${GIT_DIRECTORY_PROBE_NAME}`,
    )
    : decoded.resourcePath;
}

async function observeRules(
  root: RootedDirectory,
  rules: readonly WakeflowGitignoreRule[],
  signal: AbortSignal | undefined,
): Promise<readonly Readonly<WakeflowGitignoreRuleCheck>[]> {
  const probes = Object.freeze(rules.map((rule) => probePath(rule)));
  let observed;
  try {
    observed = await observeGitIgnorePaths(
      root,
      probes,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof GitIgnoreObservationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("git", "$git");
    }
    throw error;
  }
  return ruleChecks(rules, probes, observed.paths);
}

function ruleChecks(
  rules: readonly WakeflowGitignoreRule[],
  probes: readonly PortableResourcePath[],
  observations: readonly Readonly<GitIgnorePathObservation>[],
): readonly Readonly<WakeflowGitignoreRuleCheck>[] {
  if (
    observations.length !== rules.length
    || probes.length !== rules.length
  ) {
    fail("git", "$git");
  }
  return Object.freeze(rules.map((rule, index) => {
    const pathObservation = observations[index];
    const probe = probes[index];
    if (pathObservation === undefined || pathObservation.path !== probe) {
      fail("git", "$git");
    }
    return Object.freeze({
      rule,
      probePath: pathObservation.path,
      ignored: pathObservation.ignored
        && pathObservation.decision?.source === ".gitignore",
    });
  }));
}

async function observeTargetRules(
  root: RootedDirectory,
  rules: readonly WakeflowGitignoreRule[],
  target: Readonly<WakeflowManagedTextRecompositionResult>,
  signal: AbortSignal | undefined,
): Promise<readonly Readonly<WakeflowGitignoreRuleCheck>[]> {
  if (target.byteCount > WAKEFLOW_GITIGNORE_MAXIMUM_BYTES) {
    fail("target-capacity", "$target");
  }
  const probes = Object.freeze(rules.map((rule) => probePath(rule)));
  let observed;
  try {
    observed = await observeGitIgnoreCandidate(
      root,
      target.bytes,
      probes,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof GitIgnoreCandidateObservationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "capacity") fail("target-capacity", "$target");
      fail("git", "$git");
    }
    throw error;
  }
  if (
    observed.candidateByteCount !== target.byteCount
    || observed.candidateDigest !== target.digest
  ) {
    fail("git", "$git");
  }
  const checks = ruleChecks(rules, probes, observed.paths);
  if (checks.some((entry) => !entry.ignored)) {
    fail("candidate-semantics", "$target");
  }
  return checks;
}

function inspectEnvelope(bytes: Uint8Array) {
  try {
    return inspectWakeflowManagedTextEnvelope(bytes);
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedTextEnvelopeError) {
      fail("envelope", "$source");
    }
    throw error;
  }
}

/** 稳定检查当前 `.gitignore` 并生成零写入的下一操作候选。 */
export async function inspectWakeflowWorkspaceGitignore(
  rootValue: unknown,
  requestValue: unknown,
): Promise<Readonly<WakeflowGitignoreInspection>> {
  assertRoot(rootValue);
  const request = parseRequest(requestValue);
  if (request.signal?.aborted === true) fail("aborted", "$signal");
  const expectedUserId = currentUserId();
  let context: Readonly<WakeflowWorkspaceStaticResourceOperationContext>;
  try {
    context = createWakeflowWorkspaceStaticResourceOperationContext(
      request.matrix,
      {
        expectedMatrixDigest: request.expectedMatrixDigest,
        declarationId: "workspace.ignore-integration",
        recipe: "exact-source-recompose",
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceStaticResourceOperationContextError) {
      fail("context", "$context");
    }
    throw error;
  }
  let authority: Readonly<WakeflowGitignoreBodyAuthority>;
  try {
    authority = createWakeflowGitignoreBodyAuthority(request.hostProfiles);
  } catch (error: unknown) {
    if (error instanceof WakeflowGitignoreBodyAuthorityError) {
      fail("authority", "$authority");
    }
    throw error;
  }
  const read = await readSource(rootValue, request.signal, expectedUserId);
  const bytes = read?.bytes ?? new Uint8Array();
  const envelope = inspectEnvelope(bytes);
  if (
    envelope.kind === "managed"
    && (
      envelope.component !== authority.envelopeTarget.component
      || envelope.owner !== authority.envelopeTarget.owner
    )
  ) {
    fail("envelope", "$source");
  }
  if (
    envelope.kind === "managed"
    && (
      envelope.bodyDigest !== authority.bodyDigest
      || envelope.body !== authority.body
    )
  ) {
    fail("unknown-managed-body", "$source");
  }
  const exactOutside = classifyWakeflowGitignoreExactOutsideRules(
    authority,
    decodeOutside(bytes, envelope),
  );
  if (exactOutside.kind === "conflict") {
    fail("outside-conflict", "$source");
  }
  const gitRuleChecks = await observeRules(
    rootValue,
    authority.rules,
    request.signal,
  );
  await revalidateSource(rootValue, read, request.signal);
  const allIgnored = gitRuleChecks.every((entry) => entry.ignored);
  if (envelope.kind === "managed") {
    if (!allIgnored) fail("outside-conflict", "$git");
    return Object.freeze({
      kind: "WakeflowGitignoreInspection",
      status: "managed-current",
      context,
      authority,
      source: read?.facts ?? null,
      envelope,
      exactOutside,
      gitRuleChecks,
      targetGitRuleChecks: null,
      target: null,
    });
  }
  if (read !== null && allIgnored) {
    return Object.freeze({
      kind: "WakeflowGitignoreInspection",
      status: "satisfied-user-owned",
      context,
      authority,
      source: read.facts,
      envelope,
      exactOutside,
      gitRuleChecks,
      targetGitRuleChecks: null,
      target: null,
    });
  }
  const target = recomposeWakeflowManagedTextEnvelope(
    bytes,
    authority.envelopeTarget,
  );
  const targetGitRuleChecks = await observeTargetRules(
    rootValue,
    authority.rules,
    target,
    request.signal,
  );
  await revalidateSource(rootValue, read, request.signal);
  return Object.freeze({
    kind: "WakeflowGitignoreInspection",
    status: "recompose-required",
    context,
    authority,
    source: read?.facts ?? null,
    envelope,
    exactOutside,
    gitRuleChecks,
    targetGitRuleChecks,
    target,
  });
}
