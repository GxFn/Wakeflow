import path from "node:path";
import {
  parseWakeflowConfig,
  WakeflowConfigError,
  type WakeflowConfigModel,
} from "../../configuration/wakeflow-config.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  WAKEFLOW_CONFIG_FILE_REF,
  WAKEFLOW_DETACHED_CONFIG_FILE_REF,
  type WakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import { deriveWakeflowDetachRepositoryConfig } from "../../configuration/wakeflow-config-detach.js";
import {
  compileWakeflowFreshConfigSelection,
  type WakeflowFreshConfigCompilation,
  WakeflowFreshConfigSelectionError,
} from "../../configuration/wakeflow-fresh-config-selection.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
  type WakeflowMaintenancePublicRequestV1,
} from "../../contracts/generated/entrypoints/wakeflow-maintenance-public-request.generated.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA,
  type WakeflowMaintenancePublicResultV1,
} from "../../contracts/generated/entrypoints/wakeflow-maintenance-public-result.generated.js";
import { parseWakeflowDurableIdOfKind } from "../../contracts/identity/wakeflow-durable-id.js";
import type { WakeflowErrorCode } from "../../contracts/vocabulary/wakeflow-error-code.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  isLocalFilesystemType,
  readFilesystemTypeName,
} from "../../foundation/node/filesystem-type.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  type JsonValue,
  JsonValueError,
  parseJsonValue,
} from "../../foundation/data/json-value.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import {
  readStableFile,
  StableFileReadError,
} from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  closeDemandOperationRoot,
  DemandOperationAuthorityContextError,
  openDemandOperationRoot,
} from "../../governance/demand/demand-operation-authority-context.js";
import {
  applyDemandRuntimeRecovery,
  type DemandRuntimeRecoveryPlan,
  inspectDemandRuntimeRecovery,
} from "../../governance/demand/demand-runtime-recovery.js";
import { loadDemandEventSourcingRootAuthority } from "../../governance/demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { DemandFileEventStoreError } from "../../governance/demand/event-sourcing/demand-file-event-store.js";
import { LedgerAuthorityStore } from "../../governance/ledger/ledger-authority-store.js";
import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import { observeNewestSessionStartArtifactVersion } from "../../governance/observation/workspace-observation.js";
import {
  type HostHookStageResidueEntry,
  listHostHookStageResidue,
  retireHostHookStageResidue,
} from "../../kernel/hook-observations.js";
import { fail, isWakeflowError, WakeflowError } from "../../kernel/error.js";
import { WAKEFLOW_ACTIVE_CURRENT_ROOT_REF } from "../../kernel/layout.js";
import type { NextProjection } from "../../kernel/next-projection.js";
import {
  type PublicationTransactionEnvelope,
  type PublicationTransactionPhase,
  type PublicationTransactionPlan,
  runPublicationTransaction,
} from "../../kernel/publication-transaction.js";
import { refreshRequirementBoardIndex } from "../../kernel/requirement-board.js";
import {
  configuredWakeflowWorkspaceHostTransport,
  selectWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostTransportError,
  type WakeflowWorkspaceHostTransportSource,
} from "../../workspace/host-runtime/wakeflow-host-window-transport.js";
import {
  compareWakeflowArtifactVersions,
  parseWakeflowArtifactManifestIdentity,
  WAKEFLOW_ARTIFACT_MANIFEST_FILE_NAME,
} from "../../kernel/wakeflow-artifact-identity.js";
import { withWorkspaceOperationScope } from "../../kernel/workspace-operation-scope.js";
import type { WakeflowMaintenanceExecutionPlan } from "../../workspace/maintenance/wakeflow-maintenance-execution-plan.js";
import {
  inspectWakeflowMaintenanceGateResidue,
  retireWakeflowMaintenanceGateResidue,
  type WakeflowMaintenanceGateResidue,
  WakeflowMaintenanceGateResidueError,
  type WakeflowMaintenanceGateResidueRetirement,
} from "../../workspace/maintenance/wakeflow-maintenance-gate-residue.js";
import { WakeflowMaintenanceExecutionPreviewError } from "../../workspace/maintenance/wakeflow-maintenance-execution-preview.js";
import {
  WakeflowMaintenanceExecutionTransactionError,
  type WakeflowMaintenanceExecutionTransactionErrorReason,
  type WakeflowMaintenanceExecutionTransactionReceipt,
} from "../../workspace/maintenance/wakeflow-maintenance-execution-transaction.js";
import {
  parseWakeflowMaintenanceOperationId,
  type WakeflowMaintenanceOperationId,
  WakeflowMaintenanceOperationIdError,
} from "../../workspace/maintenance/wakeflow-maintenance-operation-id.js";
import type { WakeflowMaintenancePublicHostFacade } from "../../workspace/maintenance/wakeflow-maintenance-public-host-facade.js";
import type { WakeflowMaintenanceWriter } from "../../workspace/maintenance/wakeflow-maintenance-writer.js";
import {
  convergeWakeflowPrivateModes,
  inspectWakeflowPrivateModes,
  type WakeflowPrivateModeCensus,
  WakeflowPrivateModeCensusError,
  type WakeflowPrivateModeConvergenceReceipt,
  wakeflowPrivateModeAreas,
} from "../../workspace/maintenance/wakeflow-private-mode-census.js";
import {
  isWakeflowDetachAction,
  parseWakeflowStaticMaterializationPreviewRequest,
  type WakeflowStaticMaterializationAction,
  WakeflowStaticMaterializationPreviewError,
  type WakeflowStaticMaterializationPreviewRequest,
} from "../../workspace/maintenance/wakeflow-static-materialization-preview-contract.js";
import {
  compileWakeflowWindowLaunchIntents,
  WakeflowWindowLaunchIntentError,
  type WakeflowWindowLaunchIntentSet,
} from "../../workspace/window-runtime/wakeflow-window-launch-intent.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";

/**
 * Wakeflow Capabilities / Workspace：`wakeflow_maintain_workspace` 切片（ADR-0013 试点）。
 *
 * 效果型调用：preview 零写推导维护计划并返回 `planDigest` 与窗口启动意图；apply 带
 * 同一请求与 `planDigest` 回来，Wakeflow 重算计划、比对摘要，再交给宿主固定的维护
 * 事务执行；recover 只凭操作标识完成被中断的事务。每个结果带 `next`。
 */

export const WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME = "wakeflow_maintain_workspace" as const;
const WAKEFLOW_MAINTENANCE_PUBLIC_SCHEMA_VERSION = 1 as const;

type WakeflowMaintenancePublicRequest = Readonly<WakeflowMaintenancePublicRequestV1>;
export type WakeflowMaintenancePublicResult = Readonly<WakeflowMaintenancePublicResultV1>;

const validateRequest = createRuntimeJsonSchemaValidator<WakeflowMaintenancePublicRequestV1>(
  WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
);
const validateResult = createRuntimeJsonSchemaValidator<WakeflowMaintenancePublicResultV1>(
  WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA,
);

type SliceInput =
  | Readonly<{
      readonly kind: "effect";
      readonly action: WakeflowStaticMaterializationAction;
      readonly body: Readonly<Record<string, JsonValue>>;
    }>
  | Readonly<{ readonly kind: "recover" }>;

interface AdmittedHostProfiles {
  readonly currentHostProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly hostProfiles: readonly Readonly<WakeflowWorkspaceHostResourceProfile>[];
}

/** 公共维护请求的执行选项：取消信号，加组合根注入的本进程写者戳（C11，盖在 apply / recover 写出的意图与日志上）。 */
export interface WakeflowMaintenancePublicRequestOptions {
  readonly signal?: AbortSignal;
  readonly writer?: Readonly<WakeflowMaintenanceWriter> | null;
  /** 读一个绝对路径所在卷的文件系统类型（B11）；缺省是真实探测，只供测试替换。 */
  readonly readFilesystemType?: (absolutePath: string) => Promise<string | null>;
}

interface SliceContext {
  readonly root: RootedDirectory;
  readonly facade: Readonly<WakeflowMaintenancePublicHostFacade>;
  readonly readFilesystemType: (absolutePath: string) => Promise<string | null>;
  readonly profiles: Readonly<AdmittedHostProfiles>;
  /** 只含取消信号：它会被原样铺进预览请求与各项只读检查的选项，写者戳不能混进去。 */
  readonly options: Readonly<{ readonly signal?: AbortSignal }>;
  /** 本进程的写者戳；preview 零写不用它，apply 与 recover 交给宿主事务。 */
  readonly writer: Readonly<WakeflowMaintenanceWriter> | null;
}

interface MaterializationPlan {
  readonly kind: "materialization";
  readonly executionPlan: Readonly<WakeflowMaintenanceExecutionPlan>;
  readonly executionRequest: WakeflowStaticMaterializationPreviewRequest;
  readonly compilation: Readonly<WakeflowFreshConfigCompilation> | null;
  readonly launchIntentSet: Readonly<WakeflowWindowLaunchIntentSet> | null;
  /** detach-workspace 不碰并列出的东西（ADR-0024）；其余动作为 null。 */
  readonly leftBehind: readonly string[] | null;
}

/**
 * 私有模式收敛计划（gate-log §13.124 D8，§13.130）：reconcile 在私有树只有安全漂移时先收回
 * 0700 / 0600，不进维护事务——它只收窄当前用户自己节点的权限，逐节点 CAS，可幂等重跑。
 */
interface PrivateModeConvergencePlan {
  readonly kind: "private-mode-convergence";
  readonly census: Readonly<WakeflowPrivateModeCensus>;
  readonly view: Readonly<{
    readonly kind: "WakeflowPrivateModeConvergencePlan";
    readonly schemaVersion: 1;
    readonly driftedDirectories: number;
    readonly driftedFiles: number;
    readonly areas: readonly string[];
  }>;
}

interface RuntimeRecoveryPlan {
  readonly kind: "runtime-recovery";
  readonly recovery: Readonly<DemandRuntimeRecoveryPlan>;
  readonly view: Readonly<{
    kind: "WakeflowDemandRuntimeRecoveryPlan";
    demands: readonly Readonly<{ demandId: string; candidateCount: number }>[];
  }>;
}

/**
 * hook 目录里暂存前缀残留的退役计划（open-items B13）：占着 `.wakeflow-atomic-` 前缀、却不是观察器自己会留下
 * 的暂存的普通文件——名字畸形的，或形状不对且所有者确实不在的。它们让 hook 证据通道的门一直失败，而观察器
 * 自己的修剪从不碰它们。reconcile 把它们列出来，apply 按列出时的节点精确删除；目录与链接只计数、不删。
 */
interface HookStageResiduePlan {
  readonly kind: "hook-stage-residue";
  readonly entries: readonly Readonly<HostHookStageResidueEntry>[];
  readonly digest: Sha256Digest;
  readonly view: Readonly<{
    readonly kind: "WakeflowHookStageResiduePlan";
    readonly schemaVersion: 1;
    readonly hosts: readonly Readonly<{
      readonly hostId: string;
      /** apply 会删除的条目数。 */
      readonly retirable: number;
      /** 不由 Wakeflow 删除的条目数：暂存命名的目录与链接，或所有者还在的暂存。 */
      readonly kept: number;
    }>[];
  }>;
}

/**
 * 没有操作可恢复的维护门残留的退役计划（open-items B9）：进程死在拿到门锁之后、intent 发布之前，留下一把
 * 已死进程的门锁和（可能的）孤儿暂存，协议是 recovery-required 却没有 operation ID 可交给 recover。
 */
interface GateResiduePlan {
  readonly kind: "gate-residue";
  readonly residue: Readonly<WakeflowMaintenanceGateResidue>;
  readonly view: Readonly<{
    readonly kind: "WakeflowMaintenanceGateResiduePlan";
    readonly schemaVersion: 1;
    readonly lock: WakeflowMaintenanceGateResidue["lock"];
    readonly transactionStages: number;
  }>;
}

type SlicePlan =
  | Readonly<MaterializationPlan>
  | Readonly<PrivateModeConvergencePlan>
  | Readonly<RuntimeRecoveryPlan>
  | Readonly<HookStageResiduePlan>
  | Readonly<GateResiduePlan>;

interface PrivateModeConvergenceOutcome {
  readonly status: "completed";
  readonly operationId: null;
  readonly planDigest: Sha256Digest;
  readonly stepReceipts: readonly [
    Readonly<
      {
        readonly kind: "WakeflowPrivateModeConvergenceReceipt";
      } & WakeflowPrivateModeConvergenceReceipt
    >,
  ];
}

type SliceOutcome =
  | Readonly<WakeflowMaintenanceExecutionTransactionReceipt>
  | Readonly<PrivateModeConvergenceOutcome>
  | Readonly<{
      status: "completed";
      operationId: null;
      planDigest: Sha256Digest;
      stepReceipts: readonly Readonly<{
        kind: "WakeflowDemandRuntimeRecoveryReceipt";
        demands: Awaited<ReturnType<typeof applyDemandRuntimeRecovery>>;
      }>[];
    }>
  | Readonly<{
      status: "completed";
      operationId: null;
      planDigest: Sha256Digest;
      stepReceipts: readonly Readonly<{
        kind: "WakeflowHookStageResidueReceipt";
        retired: number;
        skipped: number;
      }>[];
    }>
  | Readonly<{
      status: "completed";
      operationId: null;
      planDigest: Sha256Digest;
      stepReceipts: readonly Readonly<
        { kind: "WakeflowMaintenanceGateResidueReceipt" } & WakeflowMaintenanceGateResidueRetirement
      >[];
    }>;

/** 公共 Maintenance 请求由 wire Schema 解析；失败以 `invalid-request` 报出。 */
function parseWakeflowMaintenancePublicRequest(value: unknown): WakeflowMaintenancePublicRequest {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("invalid-request", "not-json", error.path);
    }
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) {
    fail("invalid-request", "schema", `$request${result.path.slice(1)}`, {
      details: { schema: result.detail },
    });
  }
  return result.value;
}

function admitHostFacade(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
): Readonly<AdmittedHostProfiles> {
  try {
    if (
      typeof facade !== "object" ||
      facade === null ||
      !Object.isFrozen(facade) ||
      !Object.isFrozen(facade.hostProfiles) ||
      typeof facade.preview !== "function" ||
      typeof facade.apply !== "function" ||
      typeof facade.recover !== "function" ||
      !(
        facade.artifactRoot === null ||
        (typeof facade.artifactRoot === "string" && path.isAbsolute(facade.artifactRoot))
      )
    ) {
      fail("unexpected", "host-facade", "$facade");
    }
    const parsed = parseWakeflowStaticMaterializationPreviewRequest({
      action: "reconcile",
      desiredConfig: null,
      currentHostProfile: facade.currentHostProfile,
      hostProfiles: facade.hostProfiles,
    });
    if (parsed.currentHostProfile.hostId !== facade.hostId || parsed.signal !== undefined) {
      fail("unexpected", "host-facade", "$facade");
    }
    return Object.freeze({
      currentHostProfile: parsed.currentHostProfile,
      hostProfiles: parsed.hostProfiles,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationPreviewError) {
      fail("unexpected", "host-facade", "$facade", { cause: error });
    }
    throw error;
  }
}

/** 选择器眼中的本宿主：组合根的缺省 profile 加它的传输表（单传输宿主没有表，选择即缺省）。 */
function transportSourceOf(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
  admitted: Readonly<AdmittedHostProfiles>,
): Readonly<WakeflowWorkspaceHostTransportSource> {
  return Object.freeze({
    hostId: facade.hostId,
    resourceProfile: admitted.currentHostProfile,
    transports: facade.transports,
  });
}

/**
 * ADR-0025 D1：多传输宿主按配置选出本次请求的 profile 集合——fresh-initialize 按选择编译出的期望配置（当前
 * 配置还不存在），其余动作按当前配置；配置不可用（`null`）时沿用组合根的缺省，共享预览随后按它自己的规则阻塞。
 * 选出的 profile 同时替换 `hostProfiles` 里本宿主的那份：静态资源矩阵、意图与宿主贡献都从同一份 profile 出发。
 */
function selectHostProfiles(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
  admitted: Readonly<AdmittedHostProfiles>,
  model: WakeflowConfigModel | null,
): Readonly<AdmittedHostProfiles> {
  if (model === null || facade.transports === undefined) return admitted;
  let currentHostProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  try {
    currentHostProfile = selectWakeflowWorkspaceHostResourceProfile(
      transportSourceOf(facade, admitted),
      model,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostTransportError) {
      fail("unexpected", "host-facade", "$facade", { cause: error });
    }
    throw error;
  }
  if (currentHostProfile === admitted.currentHostProfile) return admitted;
  return Object.freeze({
    currentHostProfile,
    hostProfiles: Object.freeze(
      admitted.hostProfiles.map((profile) =>
        profile.hostId === facade.hostId ? currentHostProfile : profile,
      ),
    ),
  });
}

/** 期望配置选出的传输键与当前配置不同：只比较键是否相等，不认识键的含义；单传输宿主两边都没有键。 */
function transportChanges(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
  admitted: Readonly<AdmittedHostProfiles>,
  currentModel: WakeflowConfigModel,
  desiredConfig: WakeflowConfigModel,
): boolean {
  const source = transportSourceOf(facade, admitted);
  return (
    configuredWakeflowWorkspaceHostTransport(source, currentModel) !==
    configuredWakeflowWorkspaceHostTransport(source, desiredConfig)
  );
}

interface SelectedWriteProfiles {
  readonly profiles: Readonly<AdmittedHostProfiles>;
  readonly blockers: readonly string[];
  /** reconfigure 换了窗口传输（ADR-0025 K2）：结果带新传输的启动意图，窗口都要按新传输重开。 */
  readonly transportSwitch: boolean;
}

/**
 * 写入动作选出的 profile 集合（ADR-0025 D1）：fresh-initialize 按选择编译出的配置，reconcile 与 reconfigure 按
 * 当前配置。reconfigure 换了传输键（K2，桌面适配方案第 11 节裁定 4）时按期望配置选新传输的 profile：静态步骤、
 * 宿主资产集合（新助手与它的规则，离开 tmux 时删状态行条目）与宿主对旧登记的退役都从这份 profile 出发；前提是
 * 没有活动 Demand、没有未关闭的 worktree pod，阻塞码与退出路径同形（`transport-change-demand-active:<id>`、
 * `transport-change-pod-open:<podId>`）——换传输要重开每一个窗口，进行中的投递与 pod 检出里的窗口不能被拆掉。
 */
async function selectWriteProfiles(
  context: SliceContext,
  action: WakeflowStaticMaterializationAction,
  desiredConfig: WakeflowConfigModel | null,
): Promise<Readonly<SelectedWriteProfiles>> {
  if (action === "fresh-initialize") {
    return Object.freeze({
      profiles: selectHostProfiles(context.facade, context.profiles, desiredConfig),
      blockers: Object.freeze([]),
      transportSwitch: false,
    });
  }
  const snapshot = await currentSnapshotOrNull(context);
  const currentModel = snapshot?.model ?? null;
  if (
    action === "reconfigure" &&
    snapshot !== null &&
    desiredConfig !== null &&
    transportChanges(context.facade, context.profiles, snapshot.model, desiredConfig)
  ) {
    const blockers = new Set<string>(
      occupancyPodBlockers(snapshot.model, null, TRANSPORT_CHANGE_BLOCKER_PREFIX),
    );
    const demands = await occupancyDemandBlockers(
      context,
      snapshot,
      null,
      TRANSPORT_CHANGE_BLOCKER_PREFIX,
    );
    for (const code of demands) blockers.add(code);
    return Object.freeze({
      profiles: selectHostProfiles(context.facade, context.profiles, desiredConfig),
      blockers: Object.freeze([...blockers].sort()),
      transportSwitch: true,
    });
  }
  return Object.freeze({
    profiles: selectHostProfiles(context.facade, context.profiles, currentModel),
    blockers: Object.freeze([]),
    transportSwitch: false,
  });
}

function desiredConfigFor(
  input: Extract<SliceInput, { readonly kind: "effect" }>,
  workspaceRoot: string,
): Readonly<{
  readonly desiredConfig: WakeflowConfigModel | null;
  readonly compilation: Readonly<WakeflowFreshConfigCompilation> | null;
}> {
  try {
    if (input.action === "fresh-initialize") {
      const compilation = compileWakeflowFreshConfigSelection(input.body.selection, {
        workspaceRoot,
      });
      return Object.freeze({ desiredConfig: compilation.config, compilation });
    }
    if (input.action === "reconfigure") {
      return Object.freeze({
        desiredConfig: parseWakeflowConfig(input.body.desiredConfig),
        compilation: null,
      });
    }
    return Object.freeze({ desiredConfig: null, compilation: null });
  } catch (error: unknown) {
    if (error instanceof WakeflowFreshConfigSelectionError) {
      // §13.181 F-L1-6：点名选择里出问题的位置与规则（`$/topology/windows/0/root` → `topology.windows.0.root`），
      // Agent 不必猜也不必读实现。
      fail("invalid-request", "selection", "$request.request.selection", {
        cause: error,
        details: {
          selection: error.reason,
          at: error.path.replace(/^\$\/?/u, "").replace(/\//gu, ".") || "selection",
        },
      });
    }
    if (error instanceof WakeflowConfigError) {
      // 配置文法的拒绝点名到条目（§13.130 审查 D9-2）：路径指到 desiredConfig 里的那一处，
      // details.configReason 是文法原因（topology、reference……），原因码保持 desired-config。
      const detailed = `$request.request.desiredConfig${error.path.startsWith("$/") ? error.path.slice(1) : ""}`;
      fail(
        "invalid-request",
        "desired-config",
        detailed.length <= 256 && /^\$[A-Za-z0-9_.[\]$/-]*$/u.test(detailed)
          ? detailed
          : "$request.request.desiredConfig",
        { cause: error, details: { configReason: error.reason } },
      );
    }
    throw error;
  }
}

function mapPreviewError(error: unknown): never {
  if (error instanceof WakeflowMaintenanceExecutionPreviewError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    if (error.reason === "input")
      fail("invalid-request", "preview-input", "$request", { cause: error });
    fail("precondition-failed", error.reason, "$request", { cause: error });
  }
  if (error instanceof WakeflowStaticMaterializationPreviewError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    if (error.reason === "root-scope")
      fail("root-invalid", "root-scope", "$request.root", { cause: error });
    if (error.reason === "inspection")
      fail("io-failure", "inspection", "$request.root", { cause: error });
    if (error.reason === "config")
      fail("precondition-failed", "config", "$request", { cause: error });
    fail("invalid-request", error.reason, "$request", { cause: error });
  }
  if (error instanceof WakeflowWindowLaunchIntentError) {
    fail("precondition-failed", "launch-intent", "$request", { cause: error });
  }
  throw error;
}

// 穷尽表：事务新增 reason 时编译器要求在此显式决定其公开映射。
const TRANSACTION_ERROR_TABLE: Readonly<
  Record<
    WakeflowMaintenanceExecutionTransactionErrorReason,
    readonly [WakeflowErrorCode, string | null, string]
  >
> = Object.freeze({
  aborted: ["io-failure", "aborted", "$signal"],
  input: ["invalid-request", "transaction-input", "$request"],
  "plan-blocked": ["precondition-failed", null, "$request.planDigest"],
  "plan-stale": ["precondition-failed", null, "$request.planDigest"],
  "source-config": ["precondition-failed", null, "$request.planDigest"],
  capability: ["precondition-failed", null, "$request.planDigest"],
  gate: ["concurrency-conflict", "maintenance-gate", "$request.root"],
  "recovery-required": ["recovery-required", null, "$request.root"],
  intent: ["recovery-required", null, "$request.root"],
  journal: ["recovery-required", null, "$request.root"],
  "terminal-closure": ["recovery-required", null, "$request.root"],
  transaction: ["io-failure", null, "$request.root"],
  step: ["io-failure", null, "$request.root"],
  // B8：被中断的事务是另一版制品写的，本构建恢复不了它；details 带那一版与操作标识。
  "artifact-mismatch": [
    "recovery-required",
    "maintenance-recovery-artifact-mismatch",
    "$request.root",
  ],
});

function mapTransactionError(error: unknown): never {
  if (error instanceof WakeflowMaintenanceExecutionTransactionError) {
    const [code, reason, path] = TRANSACTION_ERROR_TABLE[error.reason];
    // 事务已登记的操作标识随错误公开：中断后 Agent 只凭它调用 recover。
    const details =
      error.operationId === null || code === "invalid-request" || code === "precondition-failed"
        ? {}
        : {
            details: {
              operationId: error.operationId,
              ...(error.writerVersion === null ? {} : { writerVersion: error.writerVersion }),
            },
          };
    fail(code, reason ?? error.reason, path, {
      cause: error,
      retryable: code === "concurrency-conflict",
      ...details,
    });
  }
  if (error instanceof WakeflowMaintenanceOperationIdError) {
    fail("invalid-request", "operation-id", "$request.operationId", { cause: error });
  }
  throw error;
}

/** fresh-initialize 与换传输的 reconfigure（K2）带启动意图：两者之后每个窗口都按选出的 profile 开窗。 */
function expectedLaunchIntents(
  plan: Readonly<WakeflowMaintenanceExecutionPlan>,
  request: WakeflowStaticMaterializationPreviewRequest,
  profiles: Readonly<AdmittedHostProfiles>,
  transportSwitch: boolean,
): Readonly<WakeflowWindowLaunchIntentSet> | null {
  if (
    (request.action !== "fresh-initialize" && !transportSwitch) ||
    plan.status !== "ready" ||
    request.desiredConfig === null
  ) {
    return null;
  }
  return compileWakeflowWindowLaunchIntents(request.desiredConfig, profiles.currentHostProfile);
}

/** a 包含 b（或相等）：用规范化绝对路径的词法关系判断。 */
function pathContains(container: string, candidate: string): boolean {
  const relative = path.relative(container, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * 工作区不得包含已装载的制品、不得位于其中，配置根也不得与之重叠（旧实现 bootstrap 的两条护栏）：
 * 否则维护会把受管文件写进插件自己的目录，或把插件目录当成产品仓库。reconcile 没有 desired
 * Config，只查工作区根；fresh 与 reconfigure 连配置根一起查。
 */
function deriveArtifactOverlapBlockers(
  rootPath: string,
  desiredConfig: WakeflowConfigModel | null,
  artifactRoot: string | null,
): readonly string[] {
  if (artifactRoot === null) return Object.freeze([]);
  const blockers: string[] = [];
  if (pathContains(rootPath, artifactRoot) || pathContains(artifactRoot, rootPath)) {
    blockers.push("workspace-root-overlaps-artifact");
  }
  if (desiredConfig !== null) {
    const placements = [
      ...desiredConfig.topology.repositories.map((entry) => entry.path),
      ...desiredConfig.topology.supportSurfaces.map((entry) => entry.path),
      desiredConfig.storage.ledgerRoot,
    ];
    if (
      placements.some((placement) => {
        const resolved = path.resolve(rootPath, placement);
        return pathContains(resolved, artifactRoot) || pathContains(artifactRoot, resolved);
      })
    ) {
      blockers.push("configured-root-overlaps-artifact");
    }
  }
  return Object.freeze(blockers);
}

/**
 * 非本地文件系统在维护预览里阻塞（open-items B11，ADR-0021）。锁、原子发布与私有模式依赖本地文件系统的
 * link、rename 与权限语义，平台范围是 macOS 的本地文件系统；工作区根与账本根（可以在另一个卷上）各探一次。
 * 读不出类型（别的平台、探测失败）不是证据，不阻塞。
 */
async function deriveFilesystemBlockers(
  context: SliceContext,
  desiredConfig: WakeflowConfigModel | null,
): Promise<readonly string[]> {
  const blockers: string[] = [];
  const rootPath = context.root.absolutePath;
  const rootType = await context.readFilesystemType(rootPath);
  if (rootType !== null && !isLocalFilesystemType(rootType)) {
    blockers.push(`filesystem-unsupported:${rootType}`);
  }
  const ledgerRoot =
    desiredConfig?.storage.ledgerRoot ??
    (await currentSnapshotOrNull(context))?.model.storage.ledgerRoot ??
    null;
  if (ledgerRoot !== null) {
    // 账本根在 fresh-initialize 之前还不存在：探测自己会退到最近的已存在祖先。
    const ledgerType = await context.readFilesystemType(path.resolve(rootPath, ledgerRoot));
    if (ledgerType !== null && !isLocalFilesystemType(ledgerType)) {
      blockers.push(`ledger-filesystem-unsupported:${ledgerType}`);
    }
  }
  return Object.freeze(blockers);
}

/** 制品 manifest 的读取上限：清单列出每个文件的摘要，今天约 230 KB。 */
const ARTIFACT_MANIFEST_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$artifactManifest");

/**
 * 已装载制品 manifest 的 `version`：制品根未知、manifest 读不出或没有合法版本为 null——不知道不阻塞。
 * 制品根在工作区之外，所以单独开一个只读的根作用域；同路径覆盖由入口的 `assertUnchanged` 在 apply 前拒绝。
 */
async function runningArtifactVersion(context: SliceContext): Promise<string | null> {
  const artifactRoot = context.facade.artifactRoot;
  if (artifactRoot === null) return null;
  let rooted: RootedDirectory;
  try {
    rooted = await RootedDirectory.open(artifactRoot, "$facade.artifactRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) return null;
    throw error;
  }
  try {
    const read = await readStableFile(
      rooted,
      parsePortableResourcePath(WAKEFLOW_ARTIFACT_MANIFEST_FILE_NAME, "$artifactManifest"),
      { maximumBytes: ARTIFACT_MANIFEST_MAXIMUM_BYTES, ...context.options },
    );
    return parseWakeflowArtifactManifestIdentity(read.bytes).version;
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      return null;
    }
    throw error;
  } finally {
    await rooted.close();
  }
}

/**
 * 过期进程的守卫（1.2 计划 §3.6 C6）：任一宿主的 hook 会话曾在更高版本的制品下启动，本进程就不该再
 * 维护这个工作区——它会把旧资产与旧渲染写回去。preview 以 `runtime-artifact-outdated:<newest>` 阻塞；
 * apply 重算同一计划，所以同样被挡。与 status / verify 的 `superseded` 是同一条规则。
 */
async function deriveRuntimeArtifactBlockers(context: SliceContext): Promise<readonly string[]> {
  const version = await runningArtifactVersion(context);
  if (version === null) return Object.freeze([]);
  const newest = await observeNewestSessionStartArtifactVersion(
    context.root,
    context.profiles.hostProfiles.map((profile) => profile.hostId),
    context.options.signal,
  );
  if (newest === null || compareWakeflowArtifactVersions(newest, version) <= 0) {
    return Object.freeze([]);
  }
  return Object.freeze([`runtime-artifact-outdated:${newest}`]);
}

function blockedPlan(blockers: readonly string[]): Readonly<PublicationTransactionPlan<SlicePlan>> {
  return Object.freeze({
    status: "blocked",
    blockers: Object.freeze(blockers),
    plan: null,
    digest: null,
  });
}

function mapCensusError(error: unknown): never {
  if (error instanceof WakeflowPrivateModeCensusError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    if (error.reason === "input")
      fail("unexpected", "private-mode-census", "$request.root", { cause: error });
    fail("io-failure", "private-mode-convergence", "$request.root", { cause: error });
  }
  throw error;
}

/**
 * 私有树的模式普查先于布局预览（§13.124 D8，§13.130）：只有安全漂移时，reconcile 的计划就是收敛
 * 本身，摘要是普查摘要；其余意图以 `private-mode-drift` 阻塞（先 reconcile）。unsafe 节点一律
 * 阻塞并按区域报出，只报告、从不修。普查读不出不遮蔽预览，由布局检查照常报告。
 */
async function privateModePlan(
  context: SliceContext,
  action: WakeflowStaticMaterializationAction,
): Promise<Readonly<PublicationTransactionPlan<SlicePlan>> | null> {
  let census: Readonly<WakeflowPrivateModeCensus>;
  try {
    census = await inspectWakeflowPrivateModes(context.root, context.options);
  } catch (error: unknown) {
    mapCensusError(error);
  }
  if (census.status === "current" || census.status === "unavailable") return null;
  if (census.status === "unsafe") {
    return blockedPlan(
      wakeflowPrivateModeAreas(census.unsafe).map((area) =>
        `private-mode-unsafe:${area}`.slice(0, 128),
      ),
    );
  }
  if (action !== "reconcile") return blockedPlan(["private-mode-drift"]);
  const directories = census.drifted.filter((entry) => entry.node.kind === "directory").length;
  const view = Object.freeze({
    kind: "WakeflowPrivateModeConvergencePlan" as const,
    schemaVersion: 1 as const,
    driftedDirectories: directories,
    driftedFiles: census.drifted.length - directories,
    areas: wakeflowPrivateModeAreas(census.drifted.map((entry) => entry.resourcePath)),
  });
  return Object.freeze({
    status: "ready",
    blockers: Object.freeze([]),
    plan: Object.freeze({ kind: "private-mode-convergence" as const, census, view }),
    digest: census.censusDigest,
  });
}

async function convergePrivateModes(
  context: SliceContext,
  plan: Readonly<PrivateModeConvergencePlan>,
): Promise<SliceOutcome> {
  let receipt: Readonly<WakeflowPrivateModeConvergenceReceipt>;
  try {
    receipt = await convergeWakeflowPrivateModes(context.root, plan.census, context.options);
  } catch (error: unknown) {
    mapCensusError(error);
  }
  return Object.freeze({
    status: "completed",
    operationId: null,
    planDigest: plan.census.censusDigest,
    stepReceipts: Object.freeze([
      Object.freeze({
        kind: "WakeflowPrivateModeConvergenceReceipt" as const,
        converged: receipt.converged,
        current: receipt.current,
        changed: receipt.changed,
      }),
    ] as const),
  });
}

async function hasRecoveryConfig(context: SliceContext): Promise<boolean> {
  try {
    // 缺失或不可用配置仍由原静态维护计划解释，不借恢复入口重建未知权威。
    await readWakeflowConfigAuthoritySnapshot(context.root, context.options);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal");
      return false;
    }
    throw error;
  }
  return true;
}

/**
 * reconcile 在静态物化之前先退役 hook 目录里暂存前缀的残留（B13）。没有可退役的条目就没有这份计划：留下的
 * 目录、链接与活着的暂存仍由 verify 点名，那是用户自己的事。
 */
async function planHookStageResidue(
  context: SliceContext,
): Promise<Readonly<PublicationTransactionPlan<SlicePlan>> | null> {
  const entries: Readonly<HostHookStageResidueEntry>[] = [];
  const hosts: { hostId: string; retirable: number; kept: number }[] = [];
  for (const hostId of context.profiles.hostProfiles.map((profile) => profile.hostId)) {
    const listed = await listHostHookStageResidue(context.root, hostId, context.options);
    if (listed.length === 0) continue;
    const retirable = listed.filter((entry) => entry.retirable);
    entries.push(...retirable);
    hosts.push({ hostId, retirable: retirable.length, kept: listed.length - retirable.length });
  }
  if (entries.length === 0) return null;
  const digest = computeCanonicalJsonSha256Digest(
    parseJsonValue(
      entries.map((entry) => [
        entry.resourcePath,
        entry.node.deviceId.toString(),
        entry.node.inodeId.toString(),
        entry.node.modifiedAtNanoseconds.toString(),
      ]),
      "$hookStageResidue",
    ),
  );
  return Object.freeze({
    status: "ready",
    blockers: Object.freeze([]),
    digest,
    plan: Object.freeze({
      kind: "hook-stage-residue" as const,
      entries: Object.freeze(entries),
      digest,
      view: Object.freeze({
        kind: "WakeflowHookStageResiduePlan" as const,
        schemaVersion: 1 as const,
        hosts: Object.freeze(hosts.map((host) => Object.freeze(host))),
      }),
    }),
  });
}

/**
 * reconcile 最先看维护门自己：没有操作可恢复的残留（B9）挡着每一次维护预览，所以它排在别的计划之前。
 * 有 intent 或 journal 的残留不在这里——那是按 operation ID 的 recover。
 */
async function planGateResidue(
  context: SliceContext,
): Promise<Readonly<PublicationTransactionPlan<SlicePlan>> | null> {
  let residue: Readonly<WakeflowMaintenanceGateResidue> | null;
  try {
    residue = await inspectWakeflowMaintenanceGateResidue(context.root, context.options);
  } catch (error: unknown) {
    mapGateResidueError(error);
  }
  if (residue === null) return null;
  return Object.freeze({
    status: "ready",
    blockers: Object.freeze([]),
    digest: residue.digest,
    plan: Object.freeze({
      kind: "gate-residue" as const,
      residue,
      view: Object.freeze({
        kind: "WakeflowMaintenanceGateResiduePlan" as const,
        schemaVersion: 1 as const,
        lock: residue.lock,
        transactionStages: residue.transactionStages,
      }),
    }),
  });
}

function mapGateResidueError(error: unknown): never {
  if (error instanceof WakeflowMaintenanceGateResidueError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    if (error.reason === "changed") {
      fail("precondition-failed", "plan-stale", "$request.planDigest", { cause: error });
    }
    // 属主还活着或说不清的暂存、对不上的锁：不强行清理，留给用户看。
    fail("recovery-required", "maintenance-gate-residue", "$request.root", { cause: error });
  }
  throw error;
}

async function retireGateResidue(context: SliceContext, plan: Readonly<GateResiduePlan>) {
  try {
    const retirement = await retireWakeflowMaintenanceGateResidue(
      context.root,
      plan.residue,
      context.options,
    );
    return Object.freeze({
      status: "completed" as const,
      operationId: null,
      planDigest: plan.residue.digest,
      stepReceipts: Object.freeze([
        Object.freeze({ kind: "WakeflowMaintenanceGateResidueReceipt" as const, ...retirement }),
      ]),
    });
  } catch (error: unknown) {
    mapGateResidueError(error);
  }
}

/** reconcile 先结算已知 Demand 候选，再在下一轮做静态物化；preview 始终零写。 */
async function planRuntimeRecovery(
  context: SliceContext,
): Promise<Readonly<PublicationTransactionPlan<SlicePlan>> | null> {
  if (!(await hasRecoveryConfig(context))) return null;
  try {
    const recovery = await inspectDemandRuntimeRecovery(context.root, context.options);
    if (recovery.demands.length === 0) return null;
    if (recovery.blockers.length > 0) return blockedPlan(recovery.blockers);
    return Object.freeze({
      status: "ready",
      blockers: Object.freeze([]),
      digest: recovery.digest,
      plan: Object.freeze({
        kind: "runtime-recovery",
        recovery,
        view: Object.freeze({
          kind: "WakeflowDemandRuntimeRecoveryPlan",
          demands: Object.freeze(
            recovery.demands.map(({ demandId, candidateCount }) =>
              Object.freeze({ demandId, candidateCount }),
            ),
          ),
        }),
      }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") return null;
    if (
      error instanceof DemandFileEventStoreError ||
      error instanceof DemandOperationAuthorityContextError ||
      error instanceof StableDirectoryReadError
    ) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal");
      return blockedPlan([`demand-recovery-${error.reason}`]);
    }
    throw error;
  }
}

// ---- 退出路径（ADR-0024）------------------------------------------------------------------------

type EffectInput = Extract<SliceInput, { readonly kind: "effect" }>;

const DEMAND_DIRECTORY_PATTERN =
  /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DEMAND_DIRECTORY_MAXIMUM_ENTRIES = 4096;

async function resourceExists(
  context: SliceContext,
  resourcePath: PortableResourcePath,
): Promise<boolean> {
  try {
    await context.root.inspectExistingResource(resourcePath, "$request.root");
    return true;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
      return false;
    }
    if (error instanceof RootedDirectoryError) {
      fail("io-failure", "inspection", "$request.root", { cause: error });
    }
    throw error;
  }
}

/**
 * 终态之后（ADR-0024）：`wakeflow.config.json` 不在而 `wakeflow.detached.json` 在，reconcile、reconfigure
 * 与两个 detach 的 preview 阻塞 `workspace-detached`；fresh-initialize 只要退役文件在就阻塞
 * `detached-file-present`——用户先把它移走，再重新启用。
 */
async function detachedBlockers(
  context: SliceContext,
  action: WakeflowStaticMaterializationAction,
): Promise<readonly string[]> {
  if (!(await resourceExists(context, WAKEFLOW_DETACHED_CONFIG_FILE_REF))) {
    return Object.freeze([]);
  }
  if (action === "fresh-initialize") return Object.freeze(["detached-file-present"]);
  return (await resourceExists(context, WAKEFLOW_CONFIG_FILE_REF))
    ? Object.freeze([])
    : Object.freeze(["workspace-detached"]);
}

/** detach-repository 要求 `repositoryId`，detach-workspace 不接受它（Schema 共用一个请求体，这里准入）。 */
function detachRepositoryIdOf(input: EffectInput): string | null {
  const value = input.body.repositoryId;
  if (input.action === "detach-repository") {
    if (typeof value !== "string") {
      fail("invalid-request", "repository-id-required", "$request.request.repositoryId");
    }
    return value;
  }
  if (value !== undefined) {
    fail("invalid-request", "repository-id-unexpected", "$request.request.repositoryId");
  }
  return null;
}

async function currentSnapshotOrNull(
  context: SliceContext,
  blockers?: string[],
): Promise<Readonly<WakeflowConfigAuthoritySnapshot> | null> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(context.root, context.options);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      // C7：版本不认识的配置单独点名。
      if (error.reason === "config-version" && error.schemaVersion !== null) {
        blockers?.push(`config-version-unsupported:${error.schemaVersion}`);
      }
      return null;
    }
    throw error;
  }
}

/** 占用阻塞码的前缀：退出路径（ADR-0024）与换传输的 reconfigure（ADR-0025 K2）用同形的码。 */
type OccupancyBlockerPrefix = "detach" | "transport-change";
const DETACH_BLOCKER_PREFIX: OccupancyBlockerPrefix = "detach";
const TRANSPORT_CHANGE_BLOCKER_PREFIX: OccupancyBlockerPrefix = "transport-change";

/** 未关闭的 worktree pod：detach-repository 看含该仓库检出的，detach-workspace 与换传输看全部。 */
function occupancyPodBlockers(
  model: WakeflowConfigModel,
  repositoryId: string | null,
  prefix: OccupancyBlockerPrefix,
): readonly string[] {
  return model.pods
    .filter(
      (pod) =>
        pod.placement !== "primary" &&
        (repositoryId === null ||
          pod.worktrees.some((worktree) => worktree.repositoryId === repositoryId)),
    )
    .map((pod) => `${prefix}-pod-open:${pod.podId}`);
}

/** 活动目录里的 Demand 目录名；目录不在即没有 Demand；读不出为 "unavailable"。 */
async function activeDemandDirectoryNames(
  context: SliceContext,
): Promise<readonly string[] | "unavailable"> {
  try {
    const listing = await readStableResourceDirectory(
      context.root,
      WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
      {
        maximumEntries: DEMAND_DIRECTORY_MAXIMUM_ENTRIES,
        ...context.options,
      },
    );
    return listing.entries
      .filter(
        (entry) => entry.node.kind === "directory" && DEMAND_DIRECTORY_PATTERN.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort();
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "not-found") return Object.freeze([]);
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      return "unavailable";
    }
    throw error;
  }
}

function reasonOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const reason = (error as { readonly reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

/**
 * 一个 Demand 是否占用：lifecycle 为 active，且 detach-workspace 不看目标、detach-repository 要有该仓库
 * 的实现目标（test 目标没有仓库）。读不出的 Demand 按占用对待——不知道不放行；中止照常收敛。
 */
async function demandOccupies(
  context: SliceContext,
  store: LedgerAuthorityStore,
  demandId: ReturnType<typeof parseWakeflowDurableIdOfKind<"demand">>,
  repositoryId: string | null,
): Promise<boolean> {
  let demandRoot: RootedDirectory | null = null;
  try {
    demandRoot = await openDemandOperationRoot(context.root, demandId);
    const loaded = await loadDemandEventSourcingRootAuthority(demandRoot, store, context.options);
    const state = loaded.aggregate.state;
    return (
      state.lifecycle === "active" &&
      (repositoryId === null ||
        state.targetTasks.some(
          (target) => "repositoryId" in target && target.repositoryId === repositoryId,
        ))
    );
  } catch (error: unknown) {
    if (isWakeflowError(error) && error.reason === "aborted") throw error;
    if (reasonOf(error) === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    return true;
  } finally {
    if (demandRoot !== null) await closeDemandOperationRoot(demandRoot);
  }
}

/** 活动 Demand：detach-repository 看有该仓库目标的，detach-workspace 与换传输看全部。 */
async function occupancyDemandBlockers(
  context: SliceContext,
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  repositoryId: string | null,
  prefix: OccupancyBlockerPrefix,
): Promise<readonly string[]> {
  const names = await activeDemandDirectoryNames(context);
  if (names === "unavailable") return Object.freeze([`${prefix}-demands-unavailable`]);
  if (names.length === 0) return Object.freeze([]);
  let ledgerRoot: RootedDirectory;
  try {
    ledgerRoot = await RootedDirectory.open(snapshot.ledgerRoot, "$ledgerRoot", {
      durability: context.root.durability,
    });
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) return Object.freeze(["ledger-root-unavailable"]);
    throw error;
  }
  try {
    const store = new LedgerAuthorityStore(ledgerRoot);
    const blockers: string[] = [];
    for (const name of names) {
      const demandId = parseWakeflowDurableIdOfKind(name, "demand");
      if (await demandOccupies(context, store, demandId, repositoryId)) {
        blockers.push(`${prefix}-demand-active:${demandId}`);
      }
    }
    return Object.freeze(blockers);
  } finally {
    await ledgerRoot.close();
  }
}

/**
 * 退出路径不碰并列出的东西（ADR-0024）：工作区根下的相对路径，或 `<种类>:<相对路径>` / 种类名；
 * 不含绝对路径。
 */
function detachWorkspaceLeftBehind(model: WakeflowConfigModel): readonly string[] {
  return Object.freeze([
    ".wakeflow-active",
    ".wakeflow-local",
    `ledger-root:${String(model.storage.ledgerRoot)}`,
    ...model.topology.supportSurfaces
      .filter((surface) => surface.ownership === "wakeflow-managed")
      .map((surface) => `support-surface:${String(surface.path)}`),
    "worktree-checkouts",
    "branches",
    "plugin-hooks",
  ]);
}

/**
 * 退出路径的前提阻塞（ADR-0024）与 detach-repository 的期望 Config：未知或最后一个仓库、含该仓库
 * 检出的 worktree pod、有该仓库目标的活动 Demand（detach-workspace 对任何 pod 与 Demand），加私有树
 * 的模式漂移（先 reconcile）；一并排序报出，Controller 一次看全。
 */
async function detachOccupancy(
  context: SliceContext,
  input: EffectInput,
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  repositoryId: string | null,
): Promise<
  Readonly<{
    readonly blockers: readonly string[];
    readonly desiredConfig: WakeflowConfigModel | null;
  }>
> {
  const blockers = new Set<string>();
  let desiredConfig: WakeflowConfigModel | null = null;
  if (repositoryId !== null) {
    const derivation = deriveWakeflowDetachRepositoryConfig(snapshot.model, repositoryId);
    if (derivation.kind === "blocked") blockers.add(derivation.blockerCode);
    else desiredConfig = derivation.model;
  }
  for (const code of occupancyPodBlockers(snapshot.model, repositoryId, DETACH_BLOCKER_PREFIX)) {
    blockers.add(code);
  }
  for (const code of await occupancyDemandBlockers(
    context,
    snapshot,
    repositoryId,
    DETACH_BLOCKER_PREFIX,
  )) {
    blockers.add(code);
  }
  const privateModes = await privateModePlan(context, input.action);
  for (const code of privateModes?.blockers ?? []) blockers.add(code);
  return Object.freeze({ blockers: Object.freeze([...blockers].sort()), desiredConfig });
}

/**
 * 退出路径的计划（ADR-0024）：先算前提阻塞，再让共享预览按精确准入算出步骤。阻塞让 preview 为
 * blocked、planDigest 为 null，apply 重算同路得 plan-blocked。
 */
async function planDetach(
  context: SliceContext,
  input: EffectInput,
): Promise<Readonly<PublicationTransactionPlan<SlicePlan>>> {
  const repositoryId = detachRepositoryIdOf(input);
  const overlap = deriveArtifactOverlapBlockers(
    context.root.absolutePath,
    null,
    context.facade.artifactRoot,
  );
  if (overlap.length > 0) return blockedPlan(overlap);
  const outdated = await deriveRuntimeArtifactBlockers(context);
  if (outdated.length > 0) return blockedPlan(outdated);
  const unreadable: string[] = ["current-config-unavailable"];
  const snapshot = await currentSnapshotOrNull(context, unreadable);
  if (snapshot === null) return blockedPlan(unreadable);
  const occupancy = await detachOccupancy(context, input, snapshot, repositoryId);
  if (occupancy.blockers.length > 0) return blockedPlan(occupancy.blockers);
  const desiredConfig = occupancy.desiredConfig;
  // 退出路径按当前配置选 profile（ADR-0025 D6）：要删的就是这个传输发布过的助手规则与条目。
  const profiles = selectHostProfiles(context.facade, context.profiles, snapshot.model);
  const executionRequest: WakeflowStaticMaterializationPreviewRequest = Object.freeze({
    action: input.action,
    desiredConfig,
    currentHostProfile: profiles.currentHostProfile,
    hostProfiles: profiles.hostProfiles,
    ...context.options,
  });
  let executionPlan: Readonly<WakeflowMaintenanceExecutionPlan>;
  try {
    executionPlan = await context.facade.preview(context.root, executionRequest);
  } catch (error: unknown) {
    mapPreviewError(error);
  }
  const ready = executionPlan.status === "ready";
  return Object.freeze({
    status: executionPlan.status,
    blockers: executionPlan.blockerCodes,
    plan: ready
      ? Object.freeze({
          kind: "materialization" as const,
          executionPlan,
          executionRequest,
          compilation: null,
          launchIntentSet: null,
          leftBehind:
            input.action === "detach-workspace" ? detachWorkspaceLeftBehind(snapshot.model) : null,
        })
      : null,
    digest: ready ? executionPlan.planDigest : null,
  });
}

/** 计划之前先看环境：工作区与制品不重叠、卷是本地文件系统、没有更新的制品在跑。第一类有阻塞就不再往下看。 */
async function deriveEnvironmentBlockers(
  context: SliceContext,
  desiredConfig: WakeflowConfigModel | null,
): Promise<readonly string[]> {
  const overlap = deriveArtifactOverlapBlockers(
    context.root.absolutePath,
    desiredConfig,
    context.facade.artifactRoot,
  );
  if (overlap.length > 0) return overlap;
  const filesystem = await deriveFilesystemBlockers(context, desiredConfig);
  if (filesystem.length > 0) return filesystem;
  return deriveRuntimeArtifactBlockers(context);
}

/**
 * reconcile 在静态物化之前的恢复计划，一次只出一份、按这个顺序：维护门自己的残留（它挡着后面所有预览）、
 * 已知 Demand 的候选残留、hook 目录的暂存残留。都没有就是平常的布局维护。
 */
async function planReconcileRecovery(
  context: SliceContext,
): Promise<Readonly<PublicationTransactionPlan<SlicePlan>> | null> {
  return (
    (await planGateResidue(context)) ??
    (await planRuntimeRecovery(context)) ??
    (await planHookStageResidue(context))
  );
}

async function planMaintenance(
  context: SliceContext,
  input: SliceInput,
): Promise<Readonly<PublicationTransactionPlan<SlicePlan>>> {
  if (input.kind !== "effect") {
    fail("invalid-request", "mode", "$request.mode");
  }
  const detached = await detachedBlockers(context, input.action);
  if (detached.length > 0) return blockedPlan(detached);
  if (isWakeflowDetachAction(input.action)) return planDetach(context, input);
  const { desiredConfig, compilation } = desiredConfigFor(input, context.root.absolutePath);
  const environment = await deriveEnvironmentBlockers(context, desiredConfig);
  if (environment.length > 0) return blockedPlan(environment);
  const privateModes = await privateModePlan(context, input.action);
  if (privateModes !== null) return privateModes;
  if (input.action === "reconcile") {
    const recovery = await planReconcileRecovery(context);
    if (recovery !== null) return recovery;
  }
  const selected = await selectWriteProfiles(context, input.action, desiredConfig);
  if (selected.blockers.length > 0) return blockedPlan(selected.blockers);
  const { profiles } = selected;
  const executionRequest: WakeflowStaticMaterializationPreviewRequest = Object.freeze({
    action: input.action,
    desiredConfig,
    currentHostProfile: profiles.currentHostProfile,
    hostProfiles: profiles.hostProfiles,
    ...context.options,
  });
  let executionPlan: Readonly<WakeflowMaintenanceExecutionPlan>;
  let launchIntentSet: Readonly<WakeflowWindowLaunchIntentSet> | null;
  try {
    executionPlan = await context.facade.preview(context.root, executionRequest);
    launchIntentSet = expectedLaunchIntents(
      executionPlan,
      executionRequest,
      profiles,
      selected.transportSwitch,
    );
  } catch (error: unknown) {
    mapPreviewError(error);
  }
  const ready = executionPlan.status === "ready";
  return Object.freeze({
    status: executionPlan.status,
    blockers: executionPlan.blockerCodes,
    plan: ready
      ? Object.freeze({
          kind: "materialization" as const,
          executionPlan,
          executionRequest,
          compilation,
          launchIntentSet,
          leftBehind: null,
        })
      : null,
    digest: ready ? executionPlan.planDigest : null,
  });
}

function nextAfterLaunchIntents(
  launchIntentSet: Readonly<WakeflowWindowLaunchIntentSet> | null,
): Readonly<NextProjection> {
  if (launchIntentSet === null || launchIntentSet.intents.length === 0) {
    return Object.freeze({
      frontier: null,
      owner: "none",
      suggestedTool: null,
      blockers: Object.freeze([]),
    });
  }
  return Object.freeze({
    frontier: "window-launch",
    // 开窗是执行维护的会话（Controller 或首跑的引导会话）自己用宿主手段做的下一步，不是用户的动作（现场 L22）。
    owner: "controller",
    // 切片之间不互相引用；公共工具名是词汇，不是依赖。
    suggestedTool: "wakeflow_register_window_binding",
    blockers: Object.freeze([]),
  });
}

function deriveNext(
  phase: PublicationTransactionPhase<SlicePlan, SliceOutcome>,
): Readonly<NextProjection> {
  if (phase.mode === "preview") {
    if (phase.planned.status === "ready") {
      return Object.freeze({
        frontier: "workspace-maintenance-apply",
        // 模式收回只恢复 Wakeflow 私有树的权限位、不改任何内容（不安全的节点已在计划阶段阻塞）：这一步归
        // Controller 自己执行，随后再预览；其余计划改动的是用户的目录，由用户确认（现场 L20，§13.226）。
        owner: phase.planned.plan?.kind === "private-mode-convergence" ? "controller" : "user",
        suggestedTool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
        blockers: Object.freeze([]),
      });
    }
    return Object.freeze({
      frontier: "workspace-maintenance-blocked",
      owner: "user",
      suggestedTool: null,
      blockers: Object.freeze([...phase.planned.blockers].slice(0, 32)),
    });
  }
  if (phase.mode === "apply") {
    if (phase.plan.kind !== "materialization") {
      // 模式收回之后布局检查才看得见其余问题：再预览一次 reconcile。
      return Object.freeze({
        frontier: "workspace-maintenance",
        owner: "controller",
        suggestedTool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
        blockers: Object.freeze([]),
      });
    }
    return nextAfterLaunchIntents(phase.plan.launchIntentSet);
  }
  return nextAfterLaunchIntents(null);
}

function freshCompilationView(compilation: Readonly<WakeflowFreshConfigCompilation> | null) {
  return compilation === null
    ? null
    : Object.freeze({
        selectionDigest: compilation.selectionDigest,
        configDigest: compilation.configDigest,
        allocations: compilation.allocations,
      });
}

function publicResult(value: unknown): WakeflowMaintenancePublicResult {
  const result = validateResult(parseJsonValue(value, "$result"));
  if (!result.ok) {
    fail("output-boundary", "result-schema", `$result${result.path.slice(1)}`);
  }
  return result.value;
}

function materializationOf(plan: SlicePlan | null): Readonly<MaterializationPlan> | null {
  return plan?.kind === "materialization" ? plan : null;
}

/** preview 的 `plan`：物化计划公开执行计划，私有模式收敛公开它的视图（§13.130 D8）。 */
function previewResultOf(
  base: Readonly<Record<string, unknown>>,
  action: WakeflowStaticMaterializationAction,
  planned: Readonly<PublicationTransactionPlan<SlicePlan>>,
): WakeflowMaintenancePublicResult {
  const materialization = materializationOf(planned.plan);
  const launchIntentSet = materialization?.launchIntentSet ?? null;
  return publicResult({
    kind: "WakeflowMaintenancePublicPreviewResult",
    ...base,
    mode: "preview",
    action,
    status: planned.status,
    blockerCodes: planned.blockers,
    planDigest: planned.digest,
    plan:
      materialization?.executionPlan ??
      (planned.plan !== null && planned.plan.kind !== "materialization" ? planned.plan.view : null),
    freshConfigCompilation: freshCompilationView(materialization?.compilation ?? null),
    launchIntents: launchIntentSet?.intents ?? [],
    launchSetDigest: launchIntentSet?.launchSetDigest ?? null,
  });
}

function assembleResult(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
  input: SliceInput,
  phase: PublicationTransactionPhase<SlicePlan, SliceOutcome>,
  next: Readonly<NextProjection>,
): WakeflowMaintenancePublicResult {
  const base = {
    schemaVersion: WAKEFLOW_MAINTENANCE_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    hostId: facade.hostId,
    next,
  };
  if (phase.mode === "preview") {
    if (input.kind !== "effect") fail("unexpected", "phase-input", "$request");
    return previewResultOf(base, input.action, phase.planned);
  }
  if (phase.mode === "apply") {
    if (input.kind !== "effect") fail("unexpected", "phase-input", "$request");
    const materialization = materializationOf(phase.plan);
    const launchIntentSet = materialization?.launchIntentSet ?? null;
    const leftBehind = materialization?.leftBehind ?? null;
    return publicResult({
      kind: "WakeflowMaintenancePublicMutationResult",
      ...base,
      mode: "apply",
      action: input.action,
      status: phase.outcome.status,
      operationId: phase.outcome.operationId,
      planDigest: phase.outcome.planDigest,
      stepReceipts: phase.outcome.stepReceipts,
      launchIntents: launchIntentSet?.intents ?? [],
      launchSetDigest: launchIntentSet?.launchSetDigest ?? null,
      // detach-workspace 的结果列出不碰的东西（ADR-0024）；其余动作没有这一项。
      ...(leftBehind === null ? {} : { leftBehind }),
    });
  }
  return publicResult({
    kind: "WakeflowMaintenancePublicMutationResult",
    ...base,
    mode: "recover",
    action: null,
    status: phase.outcome.status,
    operationId: phase.outcome.operationId,
    planDigest: phase.outcome.planDigest,
    stepReceipts: phase.outcome.stepReceipts,
    launchIntents: [],
    launchSetDigest: null,
  });
}

function parseRequest(value: unknown): Readonly<{
  readonly envelope: PublicationTransactionEnvelope;
  readonly input: SliceInput;
}> {
  const request = parseWakeflowMaintenancePublicRequest(value);
  if (request.mode === "recover") {
    let operationId: WakeflowMaintenanceOperationId;
    try {
      operationId = parseWakeflowMaintenanceOperationId(
        request.operationId,
        "$request.operationId",
      );
    } catch (error: unknown) {
      mapTransactionError(error);
    }
    return Object.freeze({
      envelope: Object.freeze({
        root: request.root,
        mode: "recover" as const,
        planDigest: null,
        operationId,
      }),
      input: Object.freeze({ kind: "recover" as const }),
    });
  }
  const planDigest = request.mode === "apply" ? (request.planDigest as Sha256Digest) : null;
  return Object.freeze({
    envelope: Object.freeze({
      root: request.root,
      mode: request.mode,
      planDigest,
      operationId: null,
    }),
    input: Object.freeze({
      kind: "effect" as const,
      action: request.action,
      body: request.request as Readonly<Record<string, JsonValue>>,
    }),
  });
}

/** 使用宿主 entrypoint 固定提供的 facade 执行一个公共 Maintenance 请求。 */
/** 看板索引重写失败不让维护失败：索引是投影，陈旧由 verify 的 board-consistency 报出（G11）。 */
async function refreshRequirementBoardIndexQuietly(
  root: RootedDirectory,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await refreshRequirementBoardIndex(root, signal);
  } catch (error: unknown) {
    if (!(error instanceof WakeflowError)) throw error;
  }
}

export async function executeWakeflowMaintenancePublicRequest(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
  value: unknown,
  options: Readonly<WakeflowMaintenancePublicRequestOptions> = {},
): Promise<WakeflowMaintenancePublicResult> {
  const profiles = admitHostFacade(facade);
  const signalOptions = options.signal === undefined ? {} : { signal: options.signal };
  const writer = options.writer ?? null;
  return runPublicationTransaction<
    SliceInput,
    SliceContext,
    SlicePlan,
    SliceOutcome,
    WakeflowMaintenancePublicResult
  >(
    {
      mutationScope: "maintenance",
      tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
      parseRequest,
      open: async (root) =>
        Object.freeze({
          root,
          facade,
          readFilesystemType: options.readFilesystemType ?? readFilesystemTypeName,
          profiles,
          options: signalOptions,
          writer,
        }),
      close: async () => {},
      plan: planMaintenance,
      apply: async (context, _input, plan) => {
        if (plan.kind === "private-mode-convergence") return convergePrivateModes(context, plan);
        if (plan.kind === "gate-residue") return retireGateResidue(context, plan);
        if (plan.kind === "hook-stage-residue") {
          const retired = await retireHostHookStageResidue(
            context.root,
            plan.entries,
            context.options,
          );
          return Object.freeze({
            status: "completed" as const,
            operationId: null,
            planDigest: plan.digest,
            stepReceipts: Object.freeze([
              Object.freeze({
                kind: "WakeflowHookStageResidueReceipt" as const,
                retired,
                // 列出之后节点变了或已经不在的：没有删，下一次预览再看。
                skipped: plan.entries.length - retired,
              }),
            ]),
          });
        }
        if (plan.kind === "runtime-recovery") {
          const demands = await withWorkspaceOperationScope(
            context.root,
            "exclusive",
            () => applyDemandRuntimeRecovery(context.root, plan.recovery, context.options),
            context.options,
          );
          return Object.freeze({
            status: "completed" as const,
            operationId: null,
            planDigest: plan.recovery.digest,
            stepReceipts: Object.freeze([
              Object.freeze({ kind: "WakeflowDemandRuntimeRecoveryReceipt" as const, demands }),
            ]),
          });
        }
        try {
          // 维护 apply 之后刷新一次活动投影：reconfigure 换语言或配置摘要、reconcile 重建派生文件（§13.94 D5）。
          const applied = await afterMutationRefresh(context.root, options.signal, () =>
            context.facade.apply(context.root, plan.executionPlan, plan.executionRequest, {
              ...signalOptions,
              writer: context.writer,
            }),
          );
          // 看板索引是认领状态的投影：渲染器升级后现存工作区的索引陈旧（board-consistency 报 index-stale），
          // 任何一次维护 apply——含零步的 reconcile——之后按当前渲染重写一次；写不动留给 verify（G11，§13.209）。
          await refreshRequirementBoardIndexQuietly(context.root, options.signal);
          return applied;
        } catch (error: unknown) {
          mapTransactionError(error);
        }
      },
      recover: async (context, operationId) => {
        try {
          return await context.facade.recover(
            context.root,
            parseWakeflowMaintenanceOperationId(operationId, "$request.operationId"),
            { ...signalOptions, writer: context.writer },
          );
        } catch (error: unknown) {
          mapTransactionError(error);
        }
      },
      next: async (_context, phase) => deriveNext(phase),
      result: (_envelope, input, phase, next) => assembleResult(facade, input, phase, next),
    },
    value,
  );
}
