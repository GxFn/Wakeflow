import {
  computeSha256Digest,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { encodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import {
  inspectWakeflowManagedTextEnvelope,
  parseWakeflowManagedTextEnvelopeTarget,
  recomposeWakeflowManagedTextEnvelope,
  WakeflowManagedTextEnvelopeError,
  type WakeflowManagedTextEnvelopeInspection,
  type WakeflowManagedTextEnvelopeTarget,
  type WakeflowManagedTextRecompositionResult,
} from "./wakeflow-managed-text-envelope.js";

/**
 * Wakeflow Workspace / Managed Integration：受管正文的 current→desired 转换。
 *
 * 本模块只处理一份完整源字节和调用方已经从领域权威推导出的正文目标。现有受管正文
 * 必须精确等于 desired 或一个明确准入的 current target；合法 marker 本身不授予覆盖
 * 权。未知正文、其他 component/owner 和非法 envelope 均保持冲突。
 *
 * currentTargets 是有界的版本演进接缝：普通 reconcile 传当前渲染，fresh 传空数组，
 * reconfigure 传变更前渲染；未来 renderer 升级只有保留了可重算的前序目标时才能准入。
 * 本层不读取文件、不决定配置转换、不取得锁，也不执行 CAS 或发布。
 */

type WakeflowManagedTextAuthorityTransitionSource =
  | "unmanaged"
  | "desired"
  | "admitted-current";

export interface WakeflowManagedTextAuthorityTransition {
  readonly disposition: "current" | "recompose-required";
  readonly sourceAuthority: WakeflowManagedTextAuthorityTransitionSource;
  readonly target: Readonly<WakeflowManagedTextRecompositionResult> | null;
}

interface WakeflowManagedTextAuthorityTransitionRequest {
  readonly currentTargets: readonly unknown[];
  readonly desiredTarget: unknown;
}

export type WakeflowManagedTextAuthorityTransitionErrorReason =
  | "input"
  | "target"
  | "envelope"
  | "relation"
  | "unadmitted-source";

const ERROR_MESSAGES = {
  input: "Wakeflow managed text authority transition input is invalid.",
  target: "Wakeflow managed text authority transition target is invalid.",
  envelope: "Wakeflow managed text source envelope is invalid.",
  relation: "Wakeflow managed text source belongs to another owner.",
  "unadmitted-source":
    "Wakeflow managed text source body is not an admitted authority render.",
} as const satisfies Readonly<Record<
  WakeflowManagedTextAuthorityTransitionErrorReason,
  string
>>;

/** Managed Text 权威转换失败的稳定、脱敏错误。 */
export class WakeflowManagedTextAuthorityTransitionError extends Error {
  override readonly name = "WakeflowManagedTextAuthorityTransitionError";
  readonly code = "wakeflow-managed-text-authority-transition" as const;
  readonly reason: WakeflowManagedTextAuthorityTransitionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowManagedTextAuthorityTransitionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedTarget {
  readonly target: Readonly<WakeflowManagedTextEnvelopeTarget>;
  readonly bodyDigest: Sha256Digest;
}

interface ParsedRequest {
  readonly currentTargets: readonly Readonly<ParsedTarget>[];
  readonly desiredTarget: Readonly<ParsedTarget>;
}

function fail(
  reason: WakeflowManagedTextAuthorityTransitionErrorReason,
  path: string,
): never {
  throw new WakeflowManagedTextAuthorityTransitionError(reason, path);
}

function parseTarget(value: unknown, path: string): Readonly<ParsedTarget> {
  let target: Readonly<WakeflowManagedTextEnvelopeTarget>;
  try {
    target = parseWakeflowManagedTextEnvelopeTarget(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedTextEnvelopeError) {
      fail("target", path);
    }
    throw error;
  }
  let bodyDigest: Sha256Digest;
  try {
    bodyDigest = computeSha256Digest(encodeUtf8(target.body, path), path);
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("target", path);
    throw error;
  }
  return Object.freeze({ target, bodyDigest });
}

function parseRequest(value: unknown): Readonly<ParsedRequest> {
  let record: Readonly<Record<string, unknown>>;
  let currentValues: readonly unknown[];
  try {
    record = parsePlainRecord(value, "$request");
    currentValues = parseDenseArray(
      record.currentTargets,
      8,
      "$request.currentTargets",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
  if (
    Object.keys(record).sort().join("\u0000")
      !== "currentTargets\u0000desiredTarget"
  ) {
    fail("input", "$request");
  }
  const desiredTarget = parseTarget(
    record.desiredTarget,
    "$request.desiredTarget",
  );
  const currentTargets = Object.freeze(currentValues.map((target, index) => (
    parseTarget(target, `$request.currentTargets/${index}`)
  )));
  const seenDigests = new Set<Sha256Digest>();
  for (const [index, current] of currentTargets.entries()) {
    if (
      current.target.component !== desiredTarget.target.component
      || current.target.owner !== desiredTarget.target.owner
    ) {
      fail("relation", `$request.currentTargets/${index}`);
    }
    if (seenDigests.has(current.bodyDigest)) {
      fail("input", `$request.currentTargets/${index}`);
    }
    seenDigests.add(current.bodyDigest);
  }
  return Object.freeze({ currentTargets, desiredTarget });
}

function inspectSource(
  value: unknown,
): Readonly<WakeflowManagedTextEnvelopeInspection> {
  try {
    return inspectWakeflowManagedTextEnvelope(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedTextEnvelopeError) {
      fail("envelope", "$source");
    }
    throw error;
  }
}

function sameManagedBody(
  envelope: Readonly<WakeflowManagedTextEnvelopeInspection>,
  target: Readonly<ParsedTarget>,
): boolean {
  return envelope.kind === "managed"
    && envelope.bodyDigest === target.bodyDigest
    && envelope.body === target.target.body;
}

/**
 * 检查当前正文所有权并生成零 I/O 的幂等 current 或精确重组候选。
 */
export function planWakeflowManagedTextAuthorityTransition(
  sourceValue: unknown,
  requestValue: WakeflowManagedTextAuthorityTransitionRequest,
): Readonly<WakeflowManagedTextAuthorityTransition> {
  const request = parseRequest(requestValue);
  const sourceEnvelope = inspectSource(sourceValue);
  const desired = request.desiredTarget;
  if (
    sourceEnvelope.kind === "managed"
    && (
      sourceEnvelope.component !== desired.target.component
      || sourceEnvelope.owner !== desired.target.owner
    )
  ) {
    fail("relation", "$source");
  }
  if (sameManagedBody(sourceEnvelope, desired)) {
    return Object.freeze({
      disposition: "current",
      sourceAuthority: "desired",
      target: null,
    });
  }
  if (sourceEnvelope.kind === "managed") {
    const admitted = request.currentTargets.some((target) => (
      sameManagedBody(sourceEnvelope, target)
    ));
    if (!admitted) fail("unadmitted-source", "$source");
  }
  let target: Readonly<WakeflowManagedTextRecompositionResult>;
  try {
    target = recomposeWakeflowManagedTextEnvelope(
      sourceValue,
      desired.target,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedTextEnvelopeError) {
      fail("envelope", "$source");
    }
    throw error;
  }
  if (target.disposition === "current") fail("envelope", "$source");
  return Object.freeze({
    disposition: "recompose-required",
    sourceAuthority: sourceEnvelope.kind === "managed"
      ? "admitted-current"
      : "unmanaged",
    target,
  });
}
