import type { WakeflowConfigModel } from "../../configuration/wakeflow-config.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
import {
  ExactRegularFileUnlinkError,
  unlinkRegularFileExactly,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { isWakeflowError } from "../../kernel/error.js";
import { configuredWakeflowWorkspaceHostTransport } from "../../workspace/host-runtime/wakeflow-host-window-transport.js";
import type {
  ExecuteWakeflowHostMaintenanceOperationRequest,
  PlanWakeflowHostMaintenanceContributionRequest,
  WakeflowHostMaintenanceOperationReceipt,
} from "../../workspace/maintenance/wakeflow-host-maintenance-capability.js";
import type { WakeflowHostMaintenanceOperationInput } from "../../workspace/maintenance/wakeflow-host-maintenance-contribution.js";
import type { WakeflowWindowHostBinding } from "../../workspace/window-runtime/wakeflow-window-host-binding.js";
import {
  inspectWakeflowWindowHostBindingInventory,
  WakeflowWindowHostBindingStoreError,
  withWakeflowWindowHostBindingStore,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import {
  compileWakeflowWindowHostBindingStoreAuthority,
  WakeflowWindowHostBindingStoreAuthorityError,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import { wakeflowWindowHostBindingRef } from "../../workspace/window-runtime/wakeflow-window-runtime-paths.js";
import {
  inspectWakeflowWindowRuntimeProjectionDocument,
  publishWakeflowWindowRuntimeProjectionDocument,
} from "../../workspace/window-runtime/wakeflow-window-runtime-projection-document.js";
import {
  admitWakeflowWindowRuntimeProjectionInputs,
  compileWakeflowWindowRuntimeProjectionExpectedEntries,
  WakeflowWindowRuntimeProjectionError,
} from "../../workspace/window-runtime/wakeflow-window-runtime-projection-inspection.js";
import { wakeflowHostWindowLocatorsRootRef } from "../../workspace/workspace-host-runtime-paths.js";
import { claudeCodeWindowHostIdentityProfile } from "./claude-code-window-host-identity-profile.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostTransportTable,
} from "./wakeflow-workspace-host-resource-profile.js";

/**
 * Wakeflow Host / Claude Code：reconfigure 切换窗口传输时退役旧传输的窗口登记（ADR-0025 K2，桌面适配方案
 * 第 11 节裁定 4："退役全部窗口投影后按新传输开窗"）。
 *
 * 一个窗口在一种传输下的登记有三处：绑定（`identity/window-bindings/<windowId>.json`，身份与登记意图）、
 * 定位器（`identity/window-locators/<windowId>.json`，tmux 四元组或桌面会话 id，provider 就是登记时的传输）
 * 与运行投影（`projections/window-runtime/<windowId>.json`，registered 或 unregistered）。切换之后旧传输的
 * 定位器指向新传输找不到的地方，旧会话也不在新传输里运行，所以绑定不留：只退役定位器而保留绑定，`wakeflow_status`
 * 会把窗口报成 registered、Controller 却无从投递。每个有绑定或定位器的窗口出一条宿主操作，在维护事务里
 * 一次做完三件事——在绑定 store 的锁内精确删除绑定文件与定位器文件，再把运行投影发布成 unregistered——之后
 * 由 Controller 用新传输的助手开窗、`register` 出新的绑定代际。
 *
 * 切换由宿主自己判定：当前 Config 选的传输键与期望 Config 的不同（只在 reconfigure）。传输键归本宿主，
 * 共享层只把期望 Config 与选出的 profile 交进来。阻塞（活动 Demand、未关闭的 worktree pod）由能力层在
 * 计划之前给出；工作声明不在这里看——没有活动 Demand 时它们是待释放的残留，由 status 报出。定位器文件名与
 * `src/capabilities/endpoint/locator-store.ts` 的 `<windowId>.json` 同一约定（宿主层不引用能力切片）。
 */

export const CLAUDE_CODE_WINDOW_TRANSPORT_RETIREMENT_OPERATION_KIND =
  "window-transport-retirement" as const;
export const CLAUDE_CODE_WINDOW_TRANSPORT_RETIREMENT_OWNER_ID =
  "claude-code-window-transport" as const;
/** 排在同一窗口的 `window-runtime-projection:` 操作之前（操作按标识排序执行）。 */
const OPERATION_ID_PREFIX = "window-host-retirement:" as const;
/** 绑定 inventory 读不稳（锁在、stage 残留、清单外文件）时宿主贡献报出的 blocker。 */
const CLAUDE_CODE_WINDOW_TRANSPORT_RETIREMENT_BLOCKER =
  "window-transport-retirement-unavailable" as const;

const TRANSPORT_SOURCE = Object.freeze({
  hostId: "claude-code",
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  transports: claudeCodeWorkspaceHostTransportTable,
});

export type ClaudeCodeWindowTransportRetirementErrorReason =
  | "operation"
  | "plan"
  | "source-stale"
  | "effect"
  | "aborted";

const ERROR_MESSAGES = {
  operation: "Claude Code window transport retirement operation is invalid.",
  plan: "Claude Code window transport retirement no longer matches its plan.",
  "source-stale": "Claude Code window transport retirement source changed since the plan.",
  effect: "Claude Code window transport retirement could not complete safely.",
  aborted: "Claude Code window transport retirement was aborted.",
} as const satisfies Readonly<Record<ClaudeCodeWindowTransportRetirementErrorReason, string>>;

/** 退役计划或执行失败的稳定、脱敏错误；维护 capability 把它映射成 owner 失败。 */
export class ClaudeCodeWindowTransportRetirementError extends Error {
  override readonly name = "ClaudeCodeWindowTransportRetirementError";
  readonly code = "wakeflow-claude-code-window-transport-retirement" as const;
  readonly reason: ClaudeCodeWindowTransportRetirementErrorReason;
  readonly path: string;

  constructor(reason: ClaudeCodeWindowTransportRetirementErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: ClaudeCodeWindowTransportRetirementErrorReason, path: string): never {
  throw new ClaudeCodeWindowTransportRetirementError(reason, path);
}

export interface ClaudeCodeWindowTransportRetirementPlan {
  /** 期望 Config 换了窗口传输：宿主贡献按它退役旧登记，并且不为被退役的窗口另出投影操作。 */
  readonly switching: boolean;
  readonly retiredWindowIds: readonly string[];
  readonly operations: readonly WakeflowHostMaintenanceOperationInput[];
  readonly blockerCodes: readonly string[];
}

const NOT_SWITCHING: Readonly<ClaudeCodeWindowTransportRetirementPlan> = Object.freeze({
  switching: false,
  retiredWindowIds: Object.freeze([]),
  operations: Object.freeze([]),
  blockerCodes: Object.freeze([]),
});

function locatorRef(
  profile: PlanWakeflowHostMaintenanceContributionRequest["profile"],
  windowId: string,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${wakeflowHostWindowLocatorsRootRef(profile)}/${windowId}.json`,
    "$locator",
  );
}

/** 资源的节点快照；不存在为 null，其余读不稳的情况按 effect 失败。 */
async function existingNode(root: RootedDirectory, ref: PortableResourcePath, path: string) {
  try {
    return (await root.inspectExistingResource(ref, path)).node;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") return null;
    if (error instanceof RootedDirectoryError) fail("effect", path);
    throw error;
  }
}

function sourceDigest(windowId: string, bindingId: string | null, locatorPresent: boolean) {
  return computeCanonicalJsonSha256Digest({
    kind: "ClaudeCodeWindowTransportRetirementSource",
    schemaVersion: 1,
    windowId,
    bindingId,
    locatorPresent,
  });
}

function targetDigest(windowId: string, projectionDocumentDigest: Sha256Digest): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    kind: "ClaudeCodeWindowTransportRetirementAuthority",
    schemaVersion: 1,
    windowId,
    bindings: "absent",
    locators: "absent",
    projectionDocumentDigest,
  });
}

type ProjectionTarget = Parameters<typeof publishWakeflowWindowRuntimeProjectionDocument>[1];

/** 期望 Config 与选出 profile 下每个窗口的 unregistered 投影目标（不看绑定）。 */
function unregisteredTargets(
  root: RootedDirectory,
  config: WakeflowConfigModel,
  profile: PlanWakeflowHostMaintenanceContributionRequest["profile"],
) {
  try {
    const inputs = admitWakeflowWindowRuntimeProjectionInputs(
      root,
      config,
      profile,
      claudeCodeWindowHostIdentityProfile,
    );
    return new Map(
      compileWakeflowWindowRuntimeProjectionExpectedEntries(inputs, { bindings: [] }).map(
        (entry) => [entry.windowId, entry.target] as const,
      ),
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowRuntimeProjectionError) fail("plan", error.path);
    throw error;
  }
}

function bindingStoreAuthority(
  config: WakeflowConfigModel,
  profile: PlanWakeflowHostMaintenanceContributionRequest["profile"],
) {
  try {
    return compileWakeflowWindowHostBindingStoreAuthority(
      config,
      profile,
      claudeCodeWindowHostIdentityProfile,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingStoreAuthorityError) fail("plan", error.path);
    throw error;
  }
}

/** 当前 Config 是否选了另一种传输；读不出当前 Config 不算切换（共享预览自己报出配置问题）。 */
async function transportSwitching(
  root: RootedDirectory,
  request: PlanWakeflowHostMaintenanceContributionRequest,
): Promise<boolean> {
  if (request.action !== "reconfigure") return false;
  let current: WakeflowConfigModel;
  try {
    current = (
      await readWakeflowConfigAuthoritySnapshot(
        root,
        request.signal === undefined ? {} : { signal: request.signal },
      )
    ).model;
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      return false;
    }
    throw error;
  }
  return (
    configuredWakeflowWorkspaceHostTransport(TRANSPORT_SOURCE, current) !==
    configuredWakeflowWorkspaceHostTransport(TRANSPORT_SOURCE, request.config)
  );
}

/** 零写入读出绑定 inventory；绑定目录还不存在即没有绑定，读不稳返回 null（贡献 blocked）。 */
async function inspectBindings(
  root: RootedDirectory,
  request: PlanWakeflowHostMaintenanceContributionRequest,
): Promise<readonly Readonly<WakeflowWindowHostBinding>[] | null> {
  const authority = bindingStoreAuthority(request.config, request.profile);
  if ((await existingNode(root, authority.bindingRootRef, "$bindingRoot")) === null) {
    return Object.freeze([]);
  }
  try {
    return (
      await inspectWakeflowWindowHostBindingInventory(
        root,
        authority,
        request.signal === undefined ? {} : { signal: request.signal },
      )
    ).bindings;
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingStoreError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      return null;
    }
    throw error;
  }
}

/**
 * 零写入计划：不切换传输即空计划；切换时期望 Config 里每个有绑定或定位器的窗口一条退役操作，来源摘要
 * 钉住绑定代际与定位器是否在场（preview 与 apply 之间有人重新登记，apply 重算出的计划摘要就不同）。
 */
export async function planClaudeCodeWindowTransportRetirement(
  root: RootedDirectory,
  request: PlanWakeflowHostMaintenanceContributionRequest,
): Promise<Readonly<ClaudeCodeWindowTransportRetirementPlan>> {
  if (!(await transportSwitching(root, request))) return NOT_SWITCHING;
  const bindings = await inspectBindings(root, request);
  if (bindings === null) {
    return Object.freeze({
      switching: true,
      retiredWindowIds: Object.freeze([]),
      operations: Object.freeze([]),
      blockerCodes: Object.freeze([CLAUDE_CODE_WINDOW_TRANSPORT_RETIREMENT_BLOCKER]),
    });
  }
  const targets = unregisteredTargets(root, request.config, request.profile);
  const operations: WakeflowHostMaintenanceOperationInput[] = [];
  for (const window of request.config.topology.windows) {
    if (request.signal?.aborted === true) fail("aborted", "$signal");
    const windowId = String(window.windowId);
    const bindingId = bindings.find((binding) => binding.windowId === windowId)?.bindingId ?? null;
    const locatorPresent =
      (await existingNode(root, locatorRef(request.profile, windowId), "$locator")) !== null;
    const target = targets.get(windowId);
    if ((bindingId === null && !locatorPresent) || target === undefined) continue;
    operations.push({
      operationId: `${OPERATION_ID_PREFIX}${windowId}`,
      operationKind: CLAUDE_CODE_WINDOW_TRANSPORT_RETIREMENT_OPERATION_KIND,
      ownerId: CLAUDE_CODE_WINDOW_TRANSPORT_RETIREMENT_OWNER_ID,
      targetKey: windowId,
      sourceDigest: sourceDigest(windowId, bindingId, locatorPresent),
      targetDigest: targetDigest(windowId, target.documentDigest),
      payload: { windowId, bindingId, locatorPresent },
    });
  }
  return Object.freeze({
    switching: true,
    retiredWindowIds: Object.freeze(operations.map((operation) => operation.targetKey)),
    operations: Object.freeze(operations),
    blockerCodes: Object.freeze([]),
  });
}

function parsePayload(value: JsonValue): Readonly<{ readonly windowId: string }> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$operation.payload");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("operation", error.path);
    throw error;
  }
  if (
    Object.keys(record).sort().join(" ") !== "bindingId locatorPresent windowId" ||
    typeof record.windowId !== "string" ||
    !(record.bindingId === null || typeof record.bindingId === "string") ||
    typeof record.locatorPresent !== "boolean"
  ) {
    fail("operation", "$operation.payload");
  }
  return Object.freeze({ windowId: record.windowId });
}

async function unlinkExactly(
  root: RootedDirectory,
  ref: PortableResourcePath,
  node: NonNullable<Awaited<ReturnType<typeof existingNode>>>,
  path: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await unlinkRegularFileExactly(root, ref, {
      expectedNode: node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      fail(error.reason === "aborted" ? "aborted" : "effect", path);
    }
    throw error;
  }
}

/** 操作身份与目标都从期望 Config 与选出的 profile 重算，与计划不一致即拒绝，不做任何效果。 */
function admitOperation(
  root: RootedDirectory,
  request: ExecuteWakeflowHostMaintenanceOperationRequest,
): Readonly<{ readonly windowId: string; readonly target: ProjectionTarget }> {
  const { windowId } = parsePayload(request.operation.payload);
  if (
    request.operation.operationId !== `${OPERATION_ID_PREFIX}${windowId}` ||
    request.operation.targetKey !== windowId
  ) {
    fail("operation", "$operation");
  }
  const target = unregisteredTargets(root, request.config, request.profile).get(windowId);
  if (
    target === undefined ||
    targetDigest(windowId, target.documentDigest) !== request.operation.targetDigest
  ) {
    fail("plan", "$operation.targetDigest");
  }
  return Object.freeze({ windowId, target });
}

function mapExecutionError(error: unknown): never {
  if (error instanceof WakeflowWindowHostBindingStoreError) {
    fail(error.reason === "aborted" ? "aborted" : "effect", "$bindings");
  }
  if (isWakeflowError(error)) {
    fail(error.reason === "aborted" ? "aborted" : "effect", "$projection");
  }
  throw error;
}

/** 锁内的一条退役：读出绑定、定位器与投影的现状，目标已成立即 current，否则核对来源后删除并发布。 */
async function retireUnderLock(
  root: RootedDirectory,
  request: ExecuteWakeflowHostMaintenanceOperationRequest,
  windowId: string,
  target: ProjectionTarget,
  bindings: readonly Readonly<WakeflowWindowHostBinding>[],
): Promise<"current" | "updated"> {
  const signal = request.signal;
  const binding = bindings.find((entry) => entry.windowId === windowId);
  const bindingRef = wakeflowWindowHostBindingRef(request.profile, windowId);
  const bindingNode =
    binding === undefined ? null : await existingNode(root, bindingRef, "$binding");
  const locator = locatorRef(request.profile, windowId);
  const locatorNode = await existingNode(root, locator, "$locator");
  const projection = await inspectWakeflowWindowRuntimeProjectionDocument(root, target, signal);
  if (bindingNode === null && locatorNode === null && projection.status === "current") {
    return "current";
  }
  if (
    !request.recoveringAffectedOperation &&
    sourceDigest(windowId, binding?.bindingId ?? null, locatorNode !== null) !==
      request.operation.sourceDigest
  ) {
    fail("source-stale", "$operation.sourceDigest");
  }
  if (bindingNode !== null) await unlinkExactly(root, bindingRef, bindingNode, "$binding", signal);
  if (locatorNode !== null) await unlinkExactly(root, locator, locatorNode, "$locator", signal);
  await publishWakeflowWindowRuntimeProjectionDocument(root, target, signal);
  return "updated";
}

/**
 * 在维护事务内、绑定 store 的锁内执行一条退役：目标已成立（没有绑定、没有定位器、投影已是 unregistered）即
 * current；否则来源必须与计划时相同（affected 恢复放开——半途中断时绑定可能已删、定位器还在），再精确删除
 * 绑定与定位器、发布 unregistered 投影。
 */
export async function executeClaudeCodeWindowTransportRetirement(
  root: RootedDirectory,
  request: ExecuteWakeflowHostMaintenanceOperationRequest,
): Promise<Readonly<WakeflowHostMaintenanceOperationReceipt>> {
  const { windowId, target } = admitOperation(root, request);
  let disposition: "current" | "updated";
  try {
    disposition = await withWakeflowWindowHostBindingStore(
      root,
      bindingStoreAuthority(request.config, request.profile),
      request.signal === undefined ? {} : { signal: request.signal },
      (store) => retireUnderLock(root, request, windowId, target, store.inventory.bindings),
    );
  } catch (error: unknown) {
    mapExecutionError(error);
  }
  return Object.freeze({
    operationId: request.operation.operationId,
    disposition,
    observationDigest: request.operation.targetDigest,
  });
}
