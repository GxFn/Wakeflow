import { types } from "node:util";

import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
  WakeflowConfigError,
  type WakeflowConfigModel,
  type WakeflowConfigPlacement,
} from "../../configuration/wakeflow-config.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "../../configuration/wakeflow-config-root-placement.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  isWakeflowDetachAction,
  WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS,
  type WakeflowStaticMaterializationAction,
  type WakeflowStaticMaterializationStepKind,
} from "../../workspace/maintenance/wakeflow-static-materialization-preview-contract.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  type WakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
} from "../../workspace/workspace-host-resource-profile.js";
import {
  CLAUDE_CODE_PORTABLE_SETTINGS_REF,
  ClaudeCodePortableSettingsPublicationError,
  type ClaudeCodePortableSettingsPublicationOptions,
  inspectClaudeCodePortableSettings,
} from "./claude-code-portable-settings-publication.js";
import {
  type ClaudeCodePortableSettingsTransition,
  type ClaudeCodePortableSettingsTransitionReason,
  claudeCodePortableSettingsRemovedRulesFor,
  claudeCodePortableSettingsRetiredRulesFor,
  claudeCodePortableSettingsRulesFor,
  planClaudeCodePortableSettingsTransition,
} from "./claude-code-portable-settings-transition.js";

/**
 * Wakeflow Host / Claude Code：portable settings 的多根只读 composition。
 *
 * Program 根与 `wakeflow-managed` Support 根是当前唯一 writer-eligible 集合；
 * external-owned Support 和所有 Repository 均不进入 authority。计划只保存逻辑根、
 * source/target digest 与 action，不保存绝对路径或用户 settings 字节。
 *
 * 三个写入动作计划规则的创建或最小更新；退出路径（ADR-0024）的 detach-workspace 对同一组根
 * 计划 Wakeflow 条目的精确删除（`action: "remove"`），detach-repository 因规则只按根与角色划分、
 * 没有仓库维度而计划为空。
 */

/** 组合接受全部维护动作；每个动作在 `planClaudeCodePortableSettingsComposition` 里有自己的分支。 */
export type ClaudeCodePortableSettingsCompositionAction = WakeflowStaticMaterializationAction;

export type ClaudeCodePortableSettingsRoot =
  | Readonly<{
      readonly rootKind: "program";
      readonly rootId: WakeflowDurableId<"program">;
      readonly configuredPlacement: ".";
      readonly resourceRef: typeof CLAUDE_CODE_PORTABLE_SETTINGS_REF;
    }>
  | Readonly<{
      readonly rootKind: "support-surface";
      readonly rootId: WakeflowDurableId<"surface">;
      readonly configuredPlacement: WakeflowConfigPlacement;
      readonly resourceRef: typeof CLAUDE_CODE_PORTABLE_SETTINGS_REF;
      /** 支撑面的角色决定它放行的工具子集（ADR-0020 决定 3）。 */
      readonly role: "design" | "test";
    }>;

export interface ClaudeCodePortableSettingsRootAuthority {
  readonly kind: "ClaudeCodePortableSettingsRootAuthority";
  readonly schemaVersion: 1;
  readonly programId: WakeflowDurableId<"program">;
  readonly hostId: "claude-code";
  readonly configDigest: Sha256Digest;
  readonly roots: readonly Readonly<ClaudeCodePortableSettingsRoot>[];
  readonly authorityDigest: Sha256Digest;
}

/** 写入动作产生 create/update；退出路径只产生 remove（ADR-0024），同一根上两类操作不会同时出现。 */
export type ClaudeCodePortableSettingsOperationAction = "create" | "update" | "remove";

export interface ClaudeCodePortableSettingsOperation {
  readonly operationId: string;
  readonly authorityDigest: Sha256Digest;
  readonly root: Readonly<ClaudeCodePortableSettingsRoot>;
  readonly action: ClaudeCodePortableSettingsOperationAction;
  readonly sourceDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
  readonly operationDigest: Sha256Digest;
}

export interface ClaudeCodePortableSettingsRootPlanEntry {
  readonly root: Readonly<ClaudeCodePortableSettingsRoot>;
  /** `planned-missing`：共享步会先建这个根再写规则；`absent`：退出路径里根不在，无可删。 */
  readonly placementStatus: "present" | "planned-missing" | "absent";
  readonly settingsStatus: "current" | "create" | "update" | "blocked";
  readonly transitionReason: ClaudeCodePortableSettingsTransitionReason | null;
}

export interface ClaudeCodePortableSettingsCompositionPlan {
  readonly action: ClaudeCodePortableSettingsCompositionAction;
  readonly status: "ready" | "blocked";
  readonly authorityDigest: Sha256Digest;
  readonly roots: readonly Readonly<ClaudeCodePortableSettingsRootPlanEntry>[];
  readonly operations: readonly Readonly<ClaudeCodePortableSettingsOperation>[];
  readonly blockerCodes: readonly string[];
}

export interface PlanClaudeCodePortableSettingsCompositionRequest {
  readonly action: ClaudeCodePortableSettingsCompositionAction;
  readonly config: unknown;
  readonly profile: unknown;
  readonly signal?: AbortSignal;
}

export type ClaudeCodePortableSettingsCompositionErrorReason =
  | "input"
  | "config"
  | "profile"
  | "placement"
  | "root-open"
  | "inspection"
  | "close-failure"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Claude portable settings composition input is invalid.",
  config: "Claude portable settings composition Config is invalid.",
  profile: "Claude portable settings composition Host Profile is invalid.",
  placement: "Claude portable settings composition root placement is invalid.",
  "root-open": "Claude portable settings composition root could not be opened.",
  inspection: "Claude portable settings composition source inspection failed.",
  "close-failure": "Claude portable settings composition root could not be closed.",
  aborted: "Claude portable settings composition was aborted.",
} as const satisfies Readonly<Record<ClaudeCodePortableSettingsCompositionErrorReason, string>>;

/** Claude portable settings composition 失败的稳定、脱敏错误。 */
class ClaudeCodePortableSettingsCompositionError extends Error {
  override readonly name = "ClaudeCodePortableSettingsCompositionError";
  readonly code = "wakeflow-claude-code-portable-settings-composition" as const;
  readonly reason: ClaudeCodePortableSettingsCompositionErrorReason;
  readonly path: string;

  constructor(reason: ClaudeCodePortableSettingsCompositionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedRequest {
  readonly action: ClaudeCodePortableSettingsCompositionAction;
  readonly model: WakeflowConfigModel;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile> & {
    readonly hostId: "claude-code";
  };
  readonly signal: AbortSignal | undefined;
}

function fail(reason: ClaudeCodePortableSettingsCompositionErrorReason, path: string): never {
  throw new ClaudeCodePortableSettingsCompositionError(reason, path);
}

function parseRequest(value: unknown): Readonly<ParsedRequest> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$request");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$request");
    throw error;
  }
  if (
    !Object.hasOwn(record, "action") ||
    !Object.hasOwn(record, "config") ||
    !Object.hasOwn(record, "profile") ||
    Object.keys(record).some(
      (key) => key !== "action" && key !== "config" && key !== "profile" && key !== "signal",
    ) ||
    typeof record.action !== "string" ||
    !WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS.includes(
      record.action as ClaudeCodePortableSettingsCompositionAction,
    ) ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input", "$request");
  }
  let model: WakeflowConfigModel;
  try {
    model = parseWakeflowConfig(record.config);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigError) fail("config", error.path);
    throw error;
  }
  let profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  try {
    profile = parseWakeflowWorkspaceHostResourceProfile(record.profile);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("profile", error.path);
    }
    throw error;
  }
  if (
    profile.hostId !== "claude-code" ||
    profile.surfaces.settingsIntegration?.portablePath !== CLAUDE_CODE_PORTABLE_SETTINGS_REF
  ) {
    fail("profile", "$/profile");
  }
  return Object.freeze({
    action: record.action as ClaudeCodePortableSettingsCompositionAction,
    model,
    profile: profile as Readonly<WakeflowWorkspaceHostResourceProfile> & {
      readonly hostId: "claude-code";
    },
    signal: record.signal as AbortSignal | undefined,
  });
}

export function compileClaudeCodePortableSettingsRootAuthority(
  model: WakeflowConfigModel,
): Readonly<ClaudeCodePortableSettingsRootAuthority> {
  const roots: ClaudeCodePortableSettingsRoot[] = [
    Object.freeze({
      rootKind: "program" as const,
      rootId: model.program.programId,
      configuredPlacement: "." as const,
      resourceRef: CLAUDE_CODE_PORTABLE_SETTINGS_REF,
    }),
  ];
  for (const surface of [...model.topology.supportSurfaces].sort((left, right) =>
    left.surfaceId < right.surfaceId ? -1 : left.surfaceId > right.surfaceId ? 1 : 0,
  )) {
    if (surface.ownership !== "wakeflow-managed") continue;
    roots.push(
      Object.freeze({
        rootKind: "support-surface" as const,
        rootId: surface.surfaceId,
        configuredPlacement: surface.path,
        resourceRef: CLAUDE_CODE_PORTABLE_SETTINGS_REF,
        role: surface.capability,
      }),
    );
  }
  const frozenRoots = Object.freeze(roots);
  const basis = {
    kind: "ClaudeCodePortableSettingsRootAuthority" as const,
    schemaVersion: 1 as const,
    programId: model.program.programId,
    hostId: "claude-code" as const,
    configDigest: computeWakeflowConfigDigest(model),
    roots: frozenRoots,
  };
  return Object.freeze({
    ...basis,
    authorityDigest: computeCanonicalJsonSha256Digest(basis as unknown as JsonValue),
  });
}

export function createClaudeCodePortableSettingsOperation(
  authorityDigest: Sha256Digest,
  root: Readonly<ClaudeCodePortableSettingsRoot>,
  action: ClaudeCodePortableSettingsOperationAction,
  sourceDigest: Sha256Digest | null,
  targetDigest: Sha256Digest,
): Readonly<ClaudeCodePortableSettingsOperation> {
  const basis = {
    operationId: `claude-portable-settings:${root.rootKind}:${root.rootId}`,
    authorityDigest,
    root,
    action,
    sourceDigest,
    targetDigest,
  };
  return Object.freeze({
    ...basis,
    operationDigest: computeCanonicalJsonSha256Digest(basis as unknown as JsonValue),
  });
}

/** 退出路径的宿主步种类（ADR-0024）：与共享步骤表里的名字逐字相同，宿主贡献用它做 operationKind。 */
export const CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_OPERATION_KIND =
  "remove-portable-settings-rules" as const satisfies WakeflowStaticMaterializationStepKind;

/** 退出路径里 settings.json 读不出、不是对象或不合写入策略时的 blocker 前缀；后缀是该根的 targetKey。 */
export const CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_BLOCKER = "detach-settings-unreadable" as const;

/** 退出路径宿主步的 targetKey（ADR-0024）：程序根 `program`，托管支撑面 `support:<surfaceId>`。 */
export function claudeCodePortableSettingsRemovalTargetKey(
  root: Readonly<ClaudeCodePortableSettingsRoot>,
): string {
  return root.rootKind === "program" ? "program" : `support:${root.rootId}`;
}

const BLOCKING_PUBLICATION_REASONS: ReadonlySet<string> = new Set([
  "source-policy",
  "directory-policy",
  "root-scope",
]);

type RootSettingsInspection =
  | { readonly transition: ClaudeCodePortableSettingsTransition }
  | { readonly blockedReason: string };

/**
 * 只读检查一个根；用户 settings 节点不合 Wakeflow 的写入策略时降为 blocker，
 * 不让整个 maintenance preview 失败。
 */
async function inspectRootSettings(
  root: RootedDirectory,
  options: ClaudeCodePortableSettingsPublicationOptions,
): Promise<RootSettingsInspection> {
  try {
    return {
      transition: (await inspectClaudeCodePortableSettings(root, options)).transition,
    };
  } catch (error: unknown) {
    if (!(error instanceof ClaudeCodePortableSettingsPublicationError)) {
      throw error;
    }
    if (error.reason === "aborted") fail("aborted", "$signal");
    if (BLOCKING_PUBLICATION_REASONS.has(error.reason)) {
      return { blockedReason: error.reason };
    }
    fail("inspection", "$settings");
  }
}

async function inspectPresentRoot(
  absolutePath: string,
  options: ClaudeCodePortableSettingsPublicationOptions,
): Promise<RootSettingsInspection> {
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(absolutePath, "$configuredRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-open", "$configuredRoot");
    throw error;
  }
  let inspection: RootSettingsInspection | undefined;
  let primaryError: unknown;
  try {
    inspection = await inspectRootSettings(root, options);
  } catch (error: unknown) {
    primaryError = error;
  }
  let closeError: unknown;
  try {
    await root.close();
  } catch (error: unknown) {
    closeError = error;
  }
  if (primaryError !== undefined) throw primaryError;
  if (closeError !== undefined) fail("close-failure", "$configuredRoot");
  if (inspection === undefined) fail("inspection", "$settings");
  return inspection;
}

/**
 * 面根不在时仍能把规则计划成 create 的维护动作（open-items W5 / CR-H6）：fresh-initialize 建新根，
 * reconcile 重建被用户删掉或移走的受管根。两者的共享预览都先计划 `materialize-support-root`，执行
 * 计划又让每条宿主操作依赖前一共享步，所以写规则时根已经在。reconfigure 的缺根仍报
 * `support-root-missing:<surfaceId>`：先 reconcile 修根，再改配置。状态行的支撑面计划共用这一条判据。
 */
export function claudeCodeMaintenanceMaterializesMissingSupportRoot(
  action: ClaudeCodePortableSettingsCompositionAction,
): boolean {
  return action === "fresh-initialize" || action === "reconcile";
}

type RootPlacements = Awaited<ReturnType<typeof validateWakeflowConfigRootPlacements>>;

/** 一次组合的收集器：根条目、操作与去重后的 blocker，由每个根的计划函数追加。 */
interface PlanCollector {
  readonly rootEntries: ClaudeCodePortableSettingsRootPlanEntry[];
  readonly operations: ClaudeCodePortableSettingsOperation[];
  readonly blockerCodes: Set<string>;
}

interface RootPlanContext {
  readonly workspaceRoot: RootedDirectory;
  readonly request: Readonly<ParsedRequest>;
  readonly authority: Readonly<ClaudeCodePortableSettingsRootAuthority>;
  readonly placements: RootPlacements;
  readonly plan: PlanCollector;
}

function rootEntry(
  root: Readonly<ClaudeCodePortableSettingsRoot>,
  placementStatus: ClaudeCodePortableSettingsRootPlanEntry["placementStatus"],
  settingsStatus: ClaudeCodePortableSettingsRootPlanEntry["settingsStatus"],
  transitionReason: ClaudeCodePortableSettingsTransitionReason | null,
): Readonly<ClaudeCodePortableSettingsRootPlanEntry> {
  return Object.freeze({ root, placementStatus, settingsStatus, transitionReason });
}

async function rootPlacements(
  workspaceRoot: RootedDirectory,
  model: WakeflowConfigModel,
): Promise<RootPlacements> {
  try {
    return await validateWakeflowConfigRootPlacements(workspaceRoot, model);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      fail("placement", error.path);
    }
    throw error;
  }
}

function supportPlacement(
  placements: RootPlacements,
  root: Readonly<ClaudeCodePortableSettingsRoot>,
): RootPlacements["roots"][number] {
  const placement = placements.roots.find((entry) => entry.key === `support.${root.rootId}.root`);
  if (placement === undefined) fail("placement", "$supportRoot");
  return placement;
}

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

/** 写入动作的一个根：程序根直接读；支撑面缺根时按动作决定计划 create 还是报 `support-root-missing`。 */
async function planPublicationRoot(
  context: RootPlanContext,
  root: Readonly<ClaudeCodePortableSettingsRoot>,
): Promise<void> {
  const { request, authority, plan } = context;
  const rules = claudeCodePortableSettingsRulesFor(root);
  const retiredRules = claudeCodePortableSettingsRetiredRulesFor(root);
  const options = { rules, retiredRules, ...signalOptions(request.signal) };
  let placementStatus: "present" | "planned-missing";
  let inspection: RootSettingsInspection;
  if (root.rootKind === "program") {
    placementStatus = "present";
    inspection = await inspectRootSettings(context.workspaceRoot, options);
  } else {
    const placement = supportPlacement(context.placements, root);
    if (placement.state === "missing") {
      if (!claudeCodeMaintenanceMaterializesMissingSupportRoot(request.action)) {
        plan.blockerCodes.add(`support-root-missing:${root.rootId}`);
        plan.rootEntries.push(rootEntry(root, "planned-missing", "blocked", null));
        return;
      }
      placementStatus = "planned-missing";
      inspection = {
        transition: planClaudeCodePortableSettingsTransition(null, rules, retiredRules),
      };
    } else {
      placementStatus = "present";
      inspection = await inspectPresentRoot(placement.absolutePath, options);
    }
  }
  if ("blockedReason" in inspection) {
    plan.blockerCodes.add(
      `settings-blocked:${root.rootKind}:${root.rootId}:${inspection.blockedReason}`,
    );
    plan.rootEntries.push(rootEntry(root, placementStatus, "blocked", null));
    return;
  }
  const { transition } = inspection;
  if (transition.status === "blocked") {
    plan.blockerCodes.add(`settings-blocked:${root.rootKind}:${root.rootId}:${transition.reason}`);
  } else if (transition.status === "create" || transition.status === "update") {
    if (transition.desiredDigest === null) fail("inspection", "$transition");
    plan.operations.push(
      createClaudeCodePortableSettingsOperation(
        authority.authorityDigest,
        root,
        transition.status,
        transition.sourceDigest,
        transition.desiredDigest,
      ),
    );
  }
  plan.rootEntries.push(rootEntry(root, placementStatus, transition.status, transition.reason));
}

/**
 * 退出路径（ADR-0024 `remove-portable-settings-rules`）的一个根：支撑面根不在即无可删（absent）；
 * 文件读不出、不是对象或不合写入策略即 `detach-settings-unreadable:<targetKey>`，不猜；有 Wakeflow
 * 当前或退役的条目即一条 remove；没有即 current，零写。
 */
async function planRemovalRoot(
  context: RootPlanContext,
  root: Readonly<ClaudeCodePortableSettingsRoot>,
): Promise<void> {
  const { request, authority, plan } = context;
  const options = {
    removedRules: claudeCodePortableSettingsRemovedRulesFor(root),
    ...signalOptions(request.signal),
  };
  let inspection: RootSettingsInspection;
  if (root.rootKind === "program") {
    inspection = await inspectRootSettings(context.workspaceRoot, options);
  } else {
    const placement = supportPlacement(context.placements, root);
    if (placement.state === "missing") {
      plan.rootEntries.push(rootEntry(root, "absent", "current", null));
      return;
    }
    inspection = await inspectPresentRoot(placement.absolutePath, options);
  }
  if ("blockedReason" in inspection || inspection.transition.status === "blocked") {
    plan.blockerCodes.add(
      `${CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_BLOCKER}:${claudeCodePortableSettingsRemovalTargetKey(root)}`,
    );
    const reason = "blockedReason" in inspection ? null : inspection.transition.reason;
    plan.rootEntries.push(rootEntry(root, "present", "blocked", reason));
    return;
  }
  const { transition } = inspection;
  if (transition.status === "update") {
    if (transition.sourceDigest === null || transition.desiredDigest === null) {
      fail("inspection", "$transition");
    }
    plan.operations.push(
      createClaudeCodePortableSettingsOperation(
        authority.authorityDigest,
        root,
        "remove",
        transition.sourceDigest,
        transition.desiredDigest,
      ),
    );
  } else if (transition.status !== "current") {
    // 删除规划器从不产生 create：文件不存在就是 current。
    fail("inspection", "$transition");
  }
  plan.rootEntries.push(rootEntry(root, "present", transition.status, transition.reason));
}

function assemblePlan(
  action: ClaudeCodePortableSettingsCompositionAction,
  authority: Readonly<ClaudeCodePortableSettingsRootAuthority>,
  plan: PlanCollector,
): Readonly<ClaudeCodePortableSettingsCompositionPlan> {
  const sortedBlockers = Object.freeze([...plan.blockerCodes].sort());
  return Object.freeze({
    action,
    status: sortedBlockers.length === 0 ? ("ready" as const) : ("blocked" as const),
    authorityDigest: authority.authorityDigest,
    roots: Object.freeze([...plan.rootEntries]),
    operations: Object.freeze([...plan.operations]),
    blockerCodes: sortedBlockers,
  });
}

/**
 * 为 Program 与 Wakeflow-managed Support roots 生成零写入 portable settings 计划：写入动作计划规则的
 * 创建或最小更新，detach-workspace 计划 Wakeflow 条目的精确删除，detach-repository 计划为空（规则
 * 没有仓库维度，ADR-0024）。
 */
export async function planClaudeCodePortableSettingsComposition(
  workspaceRootValue: RootedDirectory,
  requestValue: PlanClaudeCodePortableSettingsCompositionRequest,
): Promise<Readonly<ClaudeCodePortableSettingsCompositionPlan>> {
  if (
    typeof workspaceRootValue !== "object" ||
    workspaceRootValue === null ||
    types.isProxy(workspaceRootValue) ||
    !(workspaceRootValue instanceof RootedDirectory)
  ) {
    fail("input", "$workspaceRoot");
  }
  const request = parseRequest(requestValue);
  if (request.signal?.aborted === true) fail("aborted", "$signal");
  const authority = compileClaudeCodePortableSettingsRootAuthority(request.model);
  const plan: PlanCollector = { rootEntries: [], operations: [], blockerCodes: new Set() };
  if (request.action === "detach-repository") {
    return assemblePlan(request.action, authority, plan);
  }
  const context: RootPlanContext = {
    workspaceRoot: workspaceRootValue,
    request,
    authority,
    placements: await rootPlacements(workspaceRootValue, request.model),
    plan,
  };
  const planRoot = isWakeflowDetachAction(request.action) ? planRemovalRoot : planPublicationRoot;
  for (const root of authority.roots) {
    await planRoot(context, root);
  }
  return assemblePlan(request.action, authority, plan);
}
