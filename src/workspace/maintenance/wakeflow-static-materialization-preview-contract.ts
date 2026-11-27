import {
  parseWakeflowConfig,
  WakeflowConfigError,
  type WakeflowConfigModel,
} from "../../configuration/wakeflow-config.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import {
  PassiveOwnDataError,
  parseDenseArray,
  parsePlainRecord,
} from "../../foundation/data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import {
  createWakeflowGitignoreBodyAuthority,
  WakeflowGitignoreBodyAuthorityError,
} from "../managed-integration/wakeflow-gitignore-body-authority.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
  WakeflowWorkspaceStaticResourceMatrixError,
} from "../wakeflow-workspace-static-resource-matrix.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  type WakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
} from "../workspace-host-resource-profile.js";

/** 静态物化 preview 的闭合词汇、请求准入与稳定错误合同。 */

export const WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS = Object.freeze([
  "fresh-initialize",
  "reconfigure",
  "reconcile",
  "detach-repository",
  "detach-workspace",
] as const);
export type WakeflowStaticMaterializationAction =
  (typeof WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS)[number];

/** 退出路径的两个动作（ADR-0024）：detach-repository 以 publish-config 收尾，detach-workspace 以 retire-config 收尾。 */
export const WAKEFLOW_DETACH_ACTIONS = Object.freeze([
  "detach-repository",
  "detach-workspace",
] as const satisfies readonly WakeflowStaticMaterializationAction[]);
export type WakeflowDetachAction = (typeof WAKEFLOW_DETACH_ACTIONS)[number];

export function isWakeflowDetachAction(
  action: WakeflowStaticMaterializationAction,
): action is WakeflowDetachAction {
  return action === "detach-repository" || action === "detach-workspace";
}

/**
 * 以当前 Config 为期望 Config 的动作：reconcile 收敛到它，detach-workspace 把它改名为
 * `wakeflow.detached.json`（改名后的文件仍带同一摘要）。两者的请求都不带 desiredConfig，
 * 计划的 desiredConfigDigest 等于 currentConfigDigest。
 */
export function wakeflowStaticMaterializationActionUsesCurrentConfig(
  action: WakeflowStaticMaterializationAction,
): boolean {
  return action === "reconcile" || action === "detach-workspace";
}

const WAKEFLOW_STATIC_MATERIALIZATION_STEP_KINDS = Object.freeze([
  "materialize-local-protocol",
  "materialize-shared-coordination-layout",
  "materialize-active-layout",
  "initialize-requirement-board",
  "publish-fresh-active-workspace-projection",
  "materialize-ledger-layout",
  "publish-unregistered-window-runtime",
  "materialize-host-capability-layout",
  "materialize-support-root",
  "recompose-gitignore",
  "recompose-support-gitignore",
  "recompose-program-instruction",
  "recompose-external-instruction",
  "publish-support-memory",
  "publish-config",
  "remove-managed-block",
  "retire-window-projections",
  "remove-portable-settings-rules",
  "remove-statusline-entry",
  "retire-config",
] as const);
export type WakeflowStaticMaterializationStepKind =
  (typeof WAKEFLOW_STATIC_MATERIALIZATION_STEP_KINDS)[number];

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
  | "inspection";

/** 静态物化 preview 构建失败的稳定、脱敏错误。 */
export class WakeflowStaticMaterializationPreviewError extends ModuleError<WakeflowStaticMaterializationPreviewErrorReason> {
  static override readonly code = "wakeflow-static-materialization-preview";
}

export interface ParsedWakeflowStaticMaterializationPreviewRequest {
  readonly action: WakeflowStaticMaterializationAction;
  readonly desiredConfig: WakeflowConfigModel | null;
  readonly currentHostProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly hostProfiles: readonly Readonly<WakeflowWorkspaceHostResourceProfile>[];
  readonly signal: AbortSignal | undefined;
}

export const failWakeflowStaticMaterializationPreview: Fail<WakeflowStaticMaterializationPreviewErrorReason> =
  failWith(WakeflowStaticMaterializationPreviewError);

/**
 * Host Profile 集合的领域关系：逐个解析、整个集合能编译出 Gitignore 正文权威、当前 profile 在集合里
 * 且两者的静态资源矩阵相同。维护意图从盘上读回时靠它准入持久化的 profile 集合（A-spec R9a）。
 */
export function parseWakeflowStaticMaterializationHostProfiles(
  currentHostProfileValue: unknown,
  hostProfileValues: readonly unknown[],
): Readonly<
  Pick<ParsedWakeflowStaticMaterializationPreviewRequest, "currentHostProfile" | "hostProfiles">
> {
  let currentHostProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  try {
    currentHostProfile = parseWakeflowWorkspaceHostResourceProfile(currentHostProfileValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      failWakeflowStaticMaterializationPreview("profile", "$request.currentHostProfile", error);
    }
    throw error;
  }
  const parsedProfiles = hostProfileValues.map((profile, index) => {
    try {
      return parseWakeflowWorkspaceHostResourceProfile(profile);
    } catch (error: unknown) {
      if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
        failWakeflowStaticMaterializationPreview(
          "profile",
          `$request.hostProfiles/${index}`,
          error,
        );
      }
      throw error;
    }
  });
  try {
    createWakeflowGitignoreBodyAuthority(parsedProfiles);
  } catch (error: unknown) {
    if (
      error instanceof WakeflowGitignoreBodyAuthorityError ||
      error instanceof WakeflowWorkspaceStaticResourceMatrixError
    ) {
      failWakeflowStaticMaterializationPreview("profile", "$request.hostProfiles", error);
    }
    throw error;
  }
  const matching = parsedProfiles.find((profile) => profile.hostId === currentHostProfile.hostId);
  if (matching === undefined || !sameStaticResourceMatrix(matching, currentHostProfile)) {
    failWakeflowStaticMaterializationPreview("profile", "$request.currentHostProfile");
  }
  return Object.freeze({ currentHostProfile, hostProfiles: Object.freeze(parsedProfiles) });
}

/**
 * 把组合根交来的已类型化请求变成执行用的模型。`action` 与 `signal` 已经有类型，直接使用；请求接口里
 * `desiredConfig` 与两份 profile 仍声明为 `unknown`，所以这里还要解析一次——接口在 A-spec 第 2 步收紧
 * 之后这一步随之删掉。
 */
export function admitWakeflowStaticMaterializationPreviewRequest({
  action,
  desiredConfig: desiredConfigValue,
  currentHostProfile,
  hostProfiles,
  signal,
}: WakeflowStaticMaterializationPreviewRequest): Readonly<ParsedWakeflowStaticMaterializationPreviewRequest> {
  let desiredConfig: WakeflowConfigModel | null = null;
  if (desiredConfigValue !== null) {
    try {
      desiredConfig = parseWakeflowConfig(desiredConfigValue);
    } catch (error: unknown) {
      if (error instanceof WakeflowConfigError) {
        failWakeflowStaticMaterializationPreview("config", error.path, error);
      }
      throw error;
    }
  }
  return Object.freeze({
    action,
    desiredConfig,
    ...parseWakeflowStaticMaterializationHostProfiles(currentHostProfile, hostProfiles),
    signal,
  });
}

// A current profile whose declarations do not compile is a profile mismatch,
// never a raw matrix error.
function sameStaticResourceMatrix(
  matching: Parameters<typeof createWakeflowWorkspaceStaticResourceMatrix>[0],
  current: Parameters<typeof createWakeflowWorkspaceStaticResourceMatrix>[0],
): boolean {
  try {
    return (
      createWakeflowWorkspaceStaticResourceMatrix(matching).matrixDigest ===
      createWakeflowWorkspaceStaticResourceMatrix(current).matrixDigest
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceStaticResourceMatrixError) {
      return false;
    }
    throw error;
  }
}

const STEP_KIND_SET = new Set<string>(WAKEFLOW_STATIC_MATERIALIZATION_STEP_KINDS);
const STEP_ID_PATTERN = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9_:-]*$/u;
const OWNER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
// 阻塞码是短横线词，可带冒号分隔的目标段（ADR-0024 的 `detach-unknown-managed-body:<targetKey>`）。
const BLOCKER_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?::[a-z0-9_.][a-z0-9_.-]*)*$/u;
const TARGET_KEY_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,255}$/u;
const MAXIMUM_STEPS = 256;
const MAXIMUM_BLOCKERS = 256;
const MAXIMUM_IDENTITY_LENGTH = 256;

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      failWakeflowStaticMaterializationPreview("input", path, error);
    }
    throw error;
  }
}

function nullableDigest(value: unknown, path: string): Sha256Digest | null {
  return value === null ? null : digest(value, path);
}

function previewDigestBasis(value: Omit<WakeflowStaticMaterializationPreview, "planDigest">) {
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

function parseStep(value: unknown, index: number): Readonly<WakeflowStaticMaterializationStep> {
  let record: Readonly<Record<string, unknown>>;
  let dependencies: readonly unknown[];
  const path = `$preview.steps/${index}`;
  try {
    record = parsePlainRecord(value, path);
    dependencies = parseDenseArray(record.dependsOn, MAXIMUM_STEPS, `${path}.dependsOn`);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowStaticMaterializationPreview("input", error.path, error);
    }
    throw error;
  }
  if (
    Object.keys(record).sort().join("\u0000") !==
      "dependsOn\u0000kind\u0000ownerId\u0000sourceDigest\u0000stepId\u0000targetDigest\u0000targetKey" ||
    typeof record.stepId !== "string" ||
    record.stepId.length > MAXIMUM_IDENTITY_LENGTH ||
    !record.stepId.isWellFormed() ||
    !STEP_ID_PATTERN.test(record.stepId) ||
    typeof record.kind !== "string" ||
    !STEP_KIND_SET.has(record.kind) ||
    typeof record.ownerId !== "string" ||
    record.ownerId.length > MAXIMUM_IDENTITY_LENGTH ||
    !record.ownerId.isWellFormed() ||
    !OWNER_ID_PATTERN.test(record.ownerId) ||
    typeof record.targetKey !== "string" ||
    !record.targetKey.isWellFormed() ||
    !TARGET_KEY_PATTERN.test(record.targetKey) ||
    dependencies.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.length > MAXIMUM_IDENTITY_LENGTH ||
        !entry.isWellFormed() ||
        !STEP_ID_PATTERN.test(entry),
    ) ||
    new Set(dependencies).size !== dependencies.length
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
    blockerValues = parseDenseArray(record.blockerCodes, MAXIMUM_BLOCKERS, "$preview.blockerCodes");
    stepValues = parseDenseArray(record.steps, MAXIMUM_STEPS, "$preview.steps");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowStaticMaterializationPreview("input", error.path, error);
    }
    throw error;
  }
  if (
    Object.keys(record).sort().join("\u0000") !==
      "action\u0000blockerCodes\u0000coreLayoutInspectionDigest\u0000currentConfigDigest\u0000desiredConfigDigest\u0000executionBoundary\u0000kind\u0000matrixDigest\u0000planDigest\u0000schemaVersion\u0000status\u0000steps" ||
    record.kind !== "WakeflowStaticMaterializationPreview" ||
    record.schemaVersion !== 1 ||
    record.executionBoundary !== "preview-only" ||
    typeof record.action !== "string" ||
    !WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS.includes(
      record.action as WakeflowStaticMaterializationAction,
    ) ||
    (record.status !== "ready" && record.status !== "blocked") ||
    blockerValues.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.length > MAXIMUM_IDENTITY_LENGTH ||
        !entry.isWellFormed() ||
        !BLOCKER_PATTERN.test(entry),
    )
  ) {
    failWakeflowStaticMaterializationPreview("input", "$preview");
  }
  const blockerCodes = Object.freeze(blockerValues as readonly string[]);
  if (
    new Set(blockerCodes).size !== blockerCodes.length ||
    blockerCodes.some((entry, index) => index > 0 && (blockerCodes[index - 1] ?? "") >= entry) ||
    (record.status === "ready") !== (blockerCodes.length === 0)
  ) {
    failWakeflowStaticMaterializationPreview("input", "$preview.blockerCodes");
  }
  const steps = Object.freeze(stepValues.map(parseStep));
  const stepPositions = new Map<string, number>();
  for (const [index, entry] of steps.entries()) {
    if (stepPositions.has(entry.stepId)) {
      failWakeflowStaticMaterializationPreview("input", `$preview.steps/${index}.stepId`);
    }
    let previousPosition = -1;
    for (const dependency of entry.dependsOn) {
      const position = stepPositions.get(dependency);
      if (position === undefined || position <= previousPosition) {
        failWakeflowStaticMaterializationPreview("input", `$preview.steps/${index}.dependsOn`);
      }
      previousPosition = position;
    }
    stepPositions.set(entry.stepId, index);
  }
  // The Config authority step (publish-config, or retire-config for detach-workspace) is the
  // single terminal step and depends on every step before it.
  const configIndexes = steps.flatMap((entry, index) =>
    entry.kind === "publish-config" ? [index] : [],
  );
  const retireIndexes = steps.flatMap((entry, index) =>
    entry.kind === "retire-config" ? [index] : [],
  );
  const terminalIndexes = [...configIndexes, ...retireIndexes];
  if (
    terminalIndexes.length > 1 ||
    (terminalIndexes.length === 1 &&
      (terminalIndexes[0] !== steps.length - 1 ||
        steps.at(-1)?.dependsOn.length !== steps.length - 1))
  ) {
    failWakeflowStaticMaterializationPreview("input", "$preview.steps");
  }
  const action = record.action as WakeflowStaticMaterializationAction;
  const status = record.status;
  const currentConfigDigest = nullableDigest(
    record.currentConfigDigest,
    "$preview.currentConfigDigest",
  );
  const desiredConfigDigest = nullableDigest(
    record.desiredConfigDigest,
    "$preview.desiredConfigDigest",
  );
  const publishesConfig = !wakeflowStaticMaterializationActionUsesCurrentConfig(action);
  if (
    (publishesConfig && desiredConfigDigest === null) ||
    (!publishesConfig && desiredConfigDigest !== currentConfigDigest) ||
    (!publishesConfig && configIndexes.length !== 0) ||
    (action !== "detach-workspace" && retireIndexes.length !== 0) ||
    (action === "detach-repository" && desiredConfigDigest === currentConfigDigest) ||
    (status === "ready" &&
      ((action === "fresh-initialize" && currentConfigDigest !== null) ||
        (action !== "fresh-initialize" && currentConfigDigest === null) ||
        (publishesConfig &&
          configIndexes.length !== (currentConfigDigest === desiredConfigDigest ? 0 : 1)) ||
        (action === "detach-workspace" && retireIndexes.length !== 1)))
  ) {
    failWakeflowStaticMaterializationPreview("input", "$preview");
  }
  const plan: Omit<WakeflowStaticMaterializationPreview, "planDigest"> = Object.freeze({
    kind: "WakeflowStaticMaterializationPreview",
    schemaVersion: 1,
    executionBoundary: "preview-only",
    action,
    status,
    currentConfigDigest,
    desiredConfigDigest,
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
