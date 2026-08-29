import { types } from "node:util";

import {
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  createWakeflowGitignoreBodyAuthority,
} from "../managed-integration/wakeflow-gitignore-body-authority.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../wakeflow-workspace-static-resource-matrix.js";

/** 静态物化 preview 的闭合词汇、请求准入与稳定错误合同。 */

export const WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS = Object.freeze([
  "fresh-initialize",
  "reconfigure",
  "reconcile",
] as const);
export type WakeflowStaticMaterializationAction =
  (typeof WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS)[number];

export type WakeflowStaticMaterializationStepKind =
  | "materialize-local-protocol"
  | "materialize-active-layout"
  | "initialize-todo-collection"
  | "publish-fresh-active-workspace-projection"
  | "materialize-ledger-layout"
  | "publish-unregistered-window-runtime"
  | "materialize-host-capability-layout"
  | "materialize-support-root"
  | "recompose-gitignore"
  | "recompose-program-instruction"
  | "publish-support-memory"
  | "publish-config";

export interface WakeflowStaticMaterializationStep {
  readonly stepId: string;
  readonly kind: WakeflowStaticMaterializationStepKind;
  readonly ownerId: string;
  readonly targetKey: string;
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
  readonly dependsOn: readonly string[];
}

export interface WakeflowStaticMaterializationPreview {
  readonly kind: "WakeflowStaticMaterializationPreview";
  readonly schemaVersion: 1;
  readonly executionBoundary: "preview-only";
  readonly action: WakeflowStaticMaterializationAction;
  readonly status: "ready" | "blocked";
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfigDigest: Sha256Digest | null;
  readonly matrixDigest: Sha256Digest;
  readonly coreLayoutInspectionDigest: Sha256Digest;
  readonly blockerCodes: readonly string[];
  readonly steps: readonly Readonly<WakeflowStaticMaterializationStep>[];
  readonly planDigest: Sha256Digest;
}

export interface WakeflowStaticMaterializationPreviewRequest {
  readonly action: WakeflowStaticMaterializationAction;
  readonly desiredConfig: unknown | null;
  readonly currentHostProfile: unknown;
  readonly hostProfiles: readonly unknown[];
  readonly signal?: AbortSignal;
}

export type WakeflowStaticMaterializationPreviewErrorReason =
  | "input"
  | "config"
  | "profile"
  | "root-scope"
  | "inspection"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Wakeflow static materialization preview input is invalid.",
  config: "Wakeflow static materialization preview config is invalid.",
  profile: "Wakeflow static materialization preview host profiles are invalid.",
  "root-scope": "Wakeflow static materialization preview lost workspace scope.",
  inspection: "Wakeflow static materialization preview could not inspect workspace facts.",
  aborted: "Wakeflow static materialization preview was aborted.",
} as const satisfies Readonly<Record<
  WakeflowStaticMaterializationPreviewErrorReason,
  string
>>;

/** 静态物化 preview 构建失败的稳定、脱敏错误。 */
export class WakeflowStaticMaterializationPreviewError extends Error {
  override readonly name = "WakeflowStaticMaterializationPreviewError";
  readonly code = "wakeflow-static-materialization-preview" as const;
  readonly reason: WakeflowStaticMaterializationPreviewErrorReason;
  readonly path: string;

  constructor(reason: WakeflowStaticMaterializationPreviewErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export interface ParsedWakeflowStaticMaterializationPreviewRequest {
  readonly action: WakeflowStaticMaterializationAction;
  readonly desiredConfig: WakeflowConfigV3Model | null;
  readonly currentHostProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly hostProfiles:
    readonly Readonly<WakeflowWorkspaceHostResourceProfile>[];
  readonly signal: AbortSignal | undefined;
}

export function failWakeflowStaticMaterializationPreview(
  reason: WakeflowStaticMaterializationPreviewErrorReason,
  path: string,
): never {
  throw new WakeflowStaticMaterializationPreviewError(reason, path);
}

/** 验证 action-specific desired Config 与完整 Host Profile 集合。 */
export function parseWakeflowStaticMaterializationPreviewRequest(
  value: unknown,
): Readonly<ParsedWakeflowStaticMaterializationPreviewRequest> {
  let record: Readonly<Record<string, unknown>>;
  let profileValues: readonly unknown[];
  try {
    record = parsePlainRecord(value, "$request");
    profileValues = parseDenseArray(
      record.hostProfiles,
      WAKEFLOW_WORKSPACE_HOST_IDS.length,
      "$request.hostProfiles",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowStaticMaterializationPreview("input", error.path);
    }
    throw error;
  }
  const required = [
    "action",
    "currentHostProfile",
    "desiredConfig",
    "hostProfiles",
  ];
  const expected = record.signal === undefined
    ? required
    : [...required, "signal"].sort();
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
    || typeof record.action !== "string"
    || !WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS.includes(
      record.action as WakeflowStaticMaterializationAction,
    )
    || (
      record.signal !== undefined
      && (
        typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)
      )
    )
  ) {
    failWakeflowStaticMaterializationPreview("input", "$request");
  }
  const action = record.action as WakeflowStaticMaterializationAction;
  if (
    (action === "reconcile" && record.desiredConfig !== null)
    || (action !== "reconcile" && record.desiredConfig === null)
  ) {
    failWakeflowStaticMaterializationPreview(
      "input",
      "$request.desiredConfig",
    );
  }
  let desiredConfig: WakeflowConfigV3Model | null = null;
  if (record.desiredConfig !== null) {
    try {
      desiredConfig = parseWakeflowConfigV3(record.desiredConfig);
    } catch (error: unknown) {
      if (error instanceof WakeflowConfigV3Error) {
        failWakeflowStaticMaterializationPreview("config", error.path);
      }
      throw error;
    }
  }
  let currentHostProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  try {
    currentHostProfile = parseWakeflowWorkspaceHostResourceProfile(
      record.currentHostProfile,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      failWakeflowStaticMaterializationPreview(
        "profile",
        "$request.currentHostProfile",
      );
    }
    throw error;
  }
  const parsedProfiles = profileValues.map((profile, index) => {
    try {
      return parseWakeflowWorkspaceHostResourceProfile(profile);
    } catch (error: unknown) {
      if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
        failWakeflowStaticMaterializationPreview(
          "profile",
          `$request.hostProfiles/${index}`,
        );
      }
      throw error;
    }
  });
  try {
    createWakeflowGitignoreBodyAuthority(parsedProfiles);
  } catch {
    failWakeflowStaticMaterializationPreview(
      "profile",
      "$request.hostProfiles",
    );
  }
  const matching = parsedProfiles.find((profile) => (
    profile.hostId === currentHostProfile.hostId
  ));
  if (
    matching === undefined
    || createWakeflowWorkspaceStaticResourceMatrix(matching).matrixDigest
      !== createWakeflowWorkspaceStaticResourceMatrix(currentHostProfile)
        .matrixDigest
  ) {
    failWakeflowStaticMaterializationPreview(
      "profile",
      "$request.currentHostProfile",
    );
  }
  return Object.freeze({
    action,
    desiredConfig,
    currentHostProfile,
    hostProfiles: Object.freeze(parsedProfiles),
    signal: record.signal as AbortSignal | undefined,
  });
}

const STEP_KIND_SET = new Set<string>([
  "materialize-local-protocol",
  "materialize-active-layout",
  "initialize-todo-collection",
  "publish-fresh-active-workspace-projection",
  "materialize-ledger-layout",
  "publish-unregistered-window-runtime",
  "materialize-host-capability-layout",
  "materialize-support-root",
  "recompose-gitignore",
  "recompose-program-instruction",
  "publish-support-memory",
  "publish-config",
]);
const STEP_ID_PATTERN = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9_:-]*$/u;
const OWNER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const BLOCKER_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const MAXIMUM_STEPS = 256;
const MAXIMUM_BLOCKERS = 256;

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      failWakeflowStaticMaterializationPreview("input", path);
    }
    throw error;
  }
}

function nullableDigest(value: unknown, path: string): Sha256Digest | null {
  return value === null ? null : digest(value, path);
}

function previewDigestBasis(
  value: Omit<WakeflowStaticMaterializationPreview, "planDigest">,
) {
  return {
    ...value,
    kind: "WakeflowStaticMaterializationPreviewDigestBasis" as const,
  };
}

/** 计算不包含自身摘要字段的 preview 语义摘要。 */
export function computeWakeflowStaticMaterializationPreviewDigest(
  value: Omit<WakeflowStaticMaterializationPreview, "planDigest">,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(previewDigestBasis(value));
}

function parseStep(
  value: unknown,
  index: number,
): Readonly<WakeflowStaticMaterializationStep> {
  let record: Readonly<Record<string, unknown>>;
  let dependencies: readonly unknown[];
  const path = `$preview.steps/${index}`;
  try {
    record = parsePlainRecord(value, path);
    dependencies = parseDenseArray(
      record.dependsOn,
      MAXIMUM_STEPS,
      `${path}.dependsOn`,
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowStaticMaterializationPreview("input", error.path);
    }
    throw error;
  }
  if (
    Object.keys(record).sort().join("\u0000")
      !== "dependsOn\u0000kind\u0000ownerId\u0000sourceDigest\u0000stepId\u0000targetDigest\u0000targetKey"
    || typeof record.stepId !== "string"
    || !STEP_ID_PATTERN.test(record.stepId)
    || typeof record.kind !== "string"
    || !STEP_KIND_SET.has(record.kind)
    || typeof record.ownerId !== "string"
    || !OWNER_ID_PATTERN.test(record.ownerId)
    || typeof record.targetKey !== "string"
    || record.targetKey.length === 0
    || record.targetKey.length > 256
    || !record.targetKey.isWellFormed()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(record.targetKey)
    || dependencies.some((entry) => (
      typeof entry !== "string" || !STEP_ID_PATTERN.test(entry)
    ))
    || new Set(dependencies).size !== dependencies.length
  ) {
    failWakeflowStaticMaterializationPreview("input", path);
  }
  return Object.freeze({
    stepId: record.stepId,
    kind: record.kind as WakeflowStaticMaterializationStepKind,
    ownerId: record.ownerId,
    targetKey: record.targetKey,
    sourceDigest: nullableDigest(record.sourceDigest, `${path}.sourceDigest`),
    targetDigest: digest(record.targetDigest, `${path}.targetDigest`),
    dependsOn: Object.freeze(dependencies as readonly string[]),
  });
}

/** 重验 preview 的闭合 shape、拓扑顺序和自身摘要。 */
export function parseWakeflowStaticMaterializationPreview(
  value: unknown,
): Readonly<WakeflowStaticMaterializationPreview> {
  let record: Readonly<Record<string, unknown>>;
  let blockerValues: readonly unknown[];
  let stepValues: readonly unknown[];
  try {
    record = parsePlainRecord(value, "$preview");
    blockerValues = parseDenseArray(
      record.blockerCodes,
      MAXIMUM_BLOCKERS,
      "$preview.blockerCodes",
    );
    stepValues = parseDenseArray(
      record.steps,
      MAXIMUM_STEPS,
      "$preview.steps",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowStaticMaterializationPreview("input", error.path);
    }
    throw error;
  }
  if (
    Object.keys(record).sort().join("\u0000")
      !== "action\u0000blockerCodes\u0000coreLayoutInspectionDigest\u0000currentConfigDigest\u0000desiredConfigDigest\u0000executionBoundary\u0000kind\u0000matrixDigest\u0000planDigest\u0000schemaVersion\u0000status\u0000steps"
    || record.kind !== "WakeflowStaticMaterializationPreview"
    || record.schemaVersion !== 1
    || record.executionBoundary !== "preview-only"
    || typeof record.action !== "string"
    || !WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS.includes(
      record.action as WakeflowStaticMaterializationAction,
    )
    || (record.status !== "ready" && record.status !== "blocked")
    || blockerValues.some((entry) => (
      typeof entry !== "string" || !BLOCKER_PATTERN.test(entry)
    ))
  ) {
    failWakeflowStaticMaterializationPreview("input", "$preview");
  }
  const blockerCodes = Object.freeze(blockerValues as readonly string[]);
  if (
    new Set(blockerCodes).size !== blockerCodes.length
    || blockerCodes.some((entry, index) => (
      index > 0 && (blockerCodes[index - 1] ?? "") >= entry
    ))
    || (record.status === "ready") !== (blockerCodes.length === 0)
  ) {
    failWakeflowStaticMaterializationPreview("input", "$preview.blockerCodes");
  }
  const steps = Object.freeze(stepValues.map(parseStep));
  const stepIds = new Set<string>();
  for (const [index, entry] of steps.entries()) {
    if (stepIds.has(entry.stepId)) {
      failWakeflowStaticMaterializationPreview(
        "input",
        `$preview.steps/${index}.stepId`,
      );
    }
    if (entry.dependsOn.some((dependency) => !stepIds.has(dependency))) {
      failWakeflowStaticMaterializationPreview(
        "input",
        `$preview.steps/${index}.dependsOn`,
      );
    }
    stepIds.add(entry.stepId);
  }
  const configIndexes = steps.flatMap((entry, index) => (
    entry.kind === "publish-config" ? [index] : []
  ));
  if (
    configIndexes.length > 1
    || (
      configIndexes.length === 1
      && (
        configIndexes[0] !== steps.length - 1
        || steps.at(-1)?.dependsOn.length !== steps.length - 1
      )
    )
  ) {
    failWakeflowStaticMaterializationPreview("input", "$preview.steps");
  }
  const plan: Omit<WakeflowStaticMaterializationPreview, "planDigest"> =
    Object.freeze({
      kind: "WakeflowStaticMaterializationPreview",
      schemaVersion: 1,
      executionBoundary: "preview-only",
      action: record.action as WakeflowStaticMaterializationAction,
      status: record.status,
      currentConfigDigest: nullableDigest(
        record.currentConfigDigest,
        "$preview.currentConfigDigest",
      ),
      desiredConfigDigest: nullableDigest(
        record.desiredConfigDigest,
        "$preview.desiredConfigDigest",
      ),
      matrixDigest: digest(record.matrixDigest, "$preview.matrixDigest"),
      coreLayoutInspectionDigest: digest(
        record.coreLayoutInspectionDigest,
        "$preview.coreLayoutInspectionDigest",
      ),
      blockerCodes,
      steps,
    });
  const planDigest = digest(record.planDigest, "$preview.planDigest");
  if (computeWakeflowStaticMaterializationPreviewDigest(plan) !== planDigest) {
    failWakeflowStaticMaterializationPreview("input", "$preview.planDigest");
  }
  return Object.freeze({ ...plan, planDigest });
}
