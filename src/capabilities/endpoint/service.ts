import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import type {
  WakeflowConfigPod,
  WakeflowConfigWindow,
} from "../../configuration/wakeflow-config-v3.js";
import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { parseJsonValue, type JsonObject } from "../../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import {
  ExactRegularFileUnlinkError,
  unlinkRegularFileExactly,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import type { UuidV4Factory } from "../../foundation/identity/uuid-v4.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { parseUtcInstant, type UtcInstant } from "../../foundation/time/utc-instant.js";
import { readUtcWallClock, type UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  inspectWorkClaim,
  releaseWorkClaim,
  type WorkClaim,
  WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS,
} from "../../kernel/work-claims.js";
import { runCommandShell } from "../../kernel/command-shell.js";
import { fail } from "../../kernel/error.js";
import {
  HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES,
  readHostHookObservations,
} from "../../kernel/hook-observations.js";
import { hostRuntimeRootRef, parseWakeflowHostId } from "../../kernel/layout.js";
import type { NextProjection } from "../../kernel/next-projection.js";
import {
  admitPodWorktreeObservation,
  candidateWorktreePaths,
  createPodWorktreeReceipt,
  listPodWorktreeReceipts,
  writePodWorktreeReceipt,
  type AdmittedPodWorktree,
  type PodWorktreeReceipt,
} from "../../kernel/pod-worktree-receipts.js";
import {
  createWakeflowWindowHostBinding,
  renderWakeflowWindowHostBinding,
  type WakeflowWindowHostBinding,
} from "../../workspace/window-runtime/wakeflow-window-host-binding.js";
import { createWakeflowWindowHostBindingId } from "../../workspace/window-runtime/wakeflow-window-host-binding-id.js";
import {
  createWakeflowWindowHostBindingInStore,
  inspectWakeflowWindowHostBindingInventory,
  WakeflowWindowHostBindingStoreError,
  withWakeflowWindowHostBindingStore,
  type WakeflowWindowHostBindingStoreAuthority,
  type WakeflowWindowHostBindingStoreContext,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import {
  parseWakeflowWindowHostHandle,
  parseWakeflowWindowHostIdentityProfile,
  WakeflowWindowHostIdentityProfileError,
  type WakeflowWindowHostHandle,
  type WakeflowWindowHostIdentityProfile,
} from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import {
  compileWakeflowWindowLaunchIntents,
  type WakeflowWindowLaunchIntent,
} from "../../workspace/window-runtime/wakeflow-window-launch-intent.js";
import {
  compileWakeflowWindowRuntimeDesiredTopology,
  type WakeflowWindowRuntimeDesiredWindow,
} from "../../workspace/window-runtime/wakeflow-window-runtime-desired-topology.js";
import {
  wakeflowWindowHostBindingMutationLockRef,
  wakeflowWindowHostBindingRef,
  wakeflowWindowHostBindingRootRef,
} from "../../workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { compileWakeflowWindowRuntimeRegisteredProjectionEntry } from "../../workspace/window-runtime/wakeflow-window-runtime-registered-projection.js";
import {
  compileWakeflowWindowRuntimeUnregisteredProjectionSet,
  type WakeflowWindowRuntimeUnregisteredProjectionEntry,
} from "../../workspace/window-runtime/wakeflow-window-runtime-unregistered-projection.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  type WakeflowWorkspaceHostResourceProfile,
} from "../../workspace/workspace-host-resource-profile.js";
import {
  admitWindowBindingResult,
  parseWindowBindingRequest,
  WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
  type WindowBindingOperation,
  type WindowBindingRequest,
  type WindowBindingResult,
} from "./contract.js";
import {
  decideEndpointCommand,
  type ClosureLiveness,
  type EndpointCommand,
  type EndpointState,
} from "./decide.js";
import {
  createWindowLocatorRecord,
  readWindowLocator,
  retireWindowLocator,
  toTmuxLocator,
  writeWindowLocator,
  type WindowLocatorRecord,
} from "./locator-store.js";
import { classifyTmuxPanes, type TmuxPaneObservation } from "./pane-classification.js";
import {
  deriveEndpointNext,
  publishProjectionDocument,
  type ProjectionReceipt,
} from "./projection.js";

/**
 * Wakeflow Capabilities / Endpoint：`wakeflow_register_window_binding` 的薄壳。
 *
 * 一次调用：一次加载（配置权威、期望拓扑、启动意图、绑定登记表、工作声明、定位器、
 * hook 观察），纯决定，然后在绑定登记表的互斥门内做一次变更，刷新投影，派生 `next`。
 * 绑定不进 Demand 事件流；强制释放声明只删声明文件并留下回执，Demand 侧由 delivery
 * 切片对账。
 *
 * worktree pod 的产品窗口（ADR-0010 D4）：`register` 与 `replace` 的观察必须带 worktree
 * 原文，会话的 `session-start` cwd 必须是 porcelain 里的一个非主检出；准入后在同一互斥
 * 门内写 worktree 回执，结果只回 HEAD、分支与锁定状态。Test 窗口的执行说明列出已有回执
 * 的 worktree（相对工作区根的路径）。
 */

export interface WindowBindingHostFacade {
  readonly hostId: WakeflowHostId;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}

export interface ExecuteWindowBindingOptions {
  readonly clock?: UtcWallClock;
  /** 测试接缝：固定新绑定的标识；生产不传。 */
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

/** 工作声明的恢复门阈值：固定两小时，只作强制释放的门槛，不自动清理（能力卡 2 Q5）。 */
export { WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS };

const BINDING_MAXIMUM_BYTES = parseByteCount(64 * 1024, "$binding.maximumBytes");
const BINDING_FILE_MODE = 0o600;
const RECEIPT_DIRECTORY_MODE = 0o700;

type RegisterRequest = Extract<WindowBindingRequest, { readonly operation: "register" }>;
type ReplaceRequest = Extract<WindowBindingRequest, { readonly operation: "replace" }>;
type DecommissionRequest = Extract<WindowBindingRequest, { readonly operation: "decommission" }>;
type ReleaseClaimRequest = Extract<WindowBindingRequest, { readonly operation: "release-claim" }>;
type MutationRequest = RegisterRequest | ReplaceRequest | DecommissionRequest;
type CreationObservation = RegisterRequest["observation"];
type LivenessObservation = DecommissionRequest["closure"]["preClose"];
type MutationDecision = Extract<
  ReturnType<typeof decideEndpointCommand>,
  { readonly accepted: true; readonly operation: "register" | "replace" | "decommission" }
>;
type MutationDisposition = "registered" | "replayed" | "replaced" | "decommissioned";

interface Envelope {
  readonly root: string;
  readonly operation: WindowBindingOperation;
  readonly windowId: string;
}

interface AdmittedFacade {
  readonly hostId: WakeflowHostId;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}

interface EndpointContext {
  readonly root: RootedDirectory;
  readonly facade: AdmittedFacade;
  readonly snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly windows: readonly Readonly<WakeflowWindowRuntimeDesiredWindow>[];
  readonly programId: string;
  readonly window: Readonly<WakeflowWindowRuntimeDesiredWindow> | null;
  readonly intent: Readonly<WakeflowWindowLaunchIntent> | null;
  readonly unregisteredEntry: Readonly<WakeflowWindowRuntimeUnregisteredProjectionEntry> | null;
  readonly authority: Readonly<WakeflowWindowHostBindingStoreAuthority>;
  /** 本窗口所属 pod 与本 pod 的全部窗口标识；`next` 只把同 pod 的未登记窗口列为阻塞。 */
  readonly pod: Readonly<WakeflowConfigPod> | null;
  readonly podWindowIds: ReadonlySet<string>;
  /** worktree pod 产品窗口的配置仓库主检出绝对路径；其他窗口为 null。 */
  readonly repositoryRoot: string | null;
  readonly signal: AbortSignal | undefined;
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
}

interface HookSessions {
  readonly started: ReadonlySet<string>;
  readonly ended: ReadonlySet<string>;
  /** 命中的 `session-start` 记录 cwd（最近一条）；worktree 准入用它选出会话所在的检出。 */
  readonly cwdBySession: ReadonlyMap<string, string>;
}

interface LoadedState {
  readonly bindings: readonly Readonly<WakeflowWindowHostBinding>[];
  readonly binding: Readonly<WakeflowWindowHostBinding> | null;
  readonly bindingDigest: Sha256Digest | null;
  readonly claim: Readonly<WorkClaim> | null;
  readonly claimExpired: boolean;
  readonly locator: Readonly<WindowLocatorRecord> | null;
  readonly sessions: HookSessions;
  /** worktree pod 里本 pod 已登记的 worktree 回执；Test 窗口的执行说明据此列附加目录。 */
  readonly worktreeReceipts: readonly Readonly<PodWorktreeReceipt>[];
  readonly now: UtcInstant;
}

interface WorktreeSummary {
  readonly head: string;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly locked: boolean;
}

interface MutationOutcome {
  readonly disposition: MutationDisposition;
  readonly binding: Readonly<WakeflowWindowHostBinding> | null;
  readonly bindings: readonly Readonly<WakeflowWindowHostBinding>[];
  readonly worktree: Readonly<WorktreeSummary> | null;
  readonly verification: "machine-verified" | "manual-host-gate" | null;
  readonly projection: Readonly<ProjectionReceipt>;
}

interface AppliedBinding {
  readonly disposition: MutationDisposition;
  readonly binding: Readonly<WakeflowWindowHostBinding> | null;
  readonly worktree: Readonly<WorktreeSummary> | null;
}

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function admitFacade(facade: Readonly<WindowBindingHostFacade>): AdmittedFacade {
  try {
    const resourceProfile = parseWakeflowWorkspaceHostResourceProfile(facade.resourceProfile);
    const identityProfile = parseWakeflowWindowHostIdentityProfile(facade.identityProfile);
    const hostId = parseWakeflowHostId(facade.hostId, "$facade.hostId");
    if (
      resourceProfile.hostId !== hostId ||
      identityProfile.hostId !== hostId ||
      !resourceProfile.surfaces.windowIdentity
    ) {
      fail("unexpected", "host-facade", "$facade");
    }
    return Object.freeze({ hostId, resourceProfile, identityProfile });
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostIdentityProfileError) {
      fail("unexpected", "host-facade", "$facade", { cause: error });
    }
    throw error;
  }
}

function locatorProvider(hostId: WakeflowHostId): "tmux" | "none" {
  return hostId === "claude-code" ? "tmux" : "none";
}

function bindingDigestOf(binding: Readonly<WakeflowWindowHostBinding>): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseJsonValue(binding, "$binding"));
}

function mapBindingStoreError(error: unknown): never {
  if (error instanceof WakeflowWindowHostBindingStoreError) {
    if (error.reason === "lock") {
      fail("concurrency-conflict", "binding-lock", "$request.windowId", {
        cause: error,
        retryable: true,
      });
    }
    if (error.reason === "recovery-required") {
      fail("recovery-required", "binding-store", "$request.windowId", { cause: error });
    }
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    fail("io-failure", `binding-${error.reason}`, "$request.windowId", { cause: error });
  }
  throw error;
}

async function readConfigSnapshot(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(root, signalOptions(signal));
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("precondition-failed", "config-authority", "$request.root", { cause: error });
    }
    throw error;
  }
}

async function openContext(
  root: RootedDirectory,
  facade: AdmittedFacade,
  envelope: Readonly<Envelope>,
  options: ExecuteWindowBindingOptions,
): Promise<EndpointContext> {
  const snapshot = await readConfigSnapshot(root, options.signal);
  const topology = compileWakeflowWindowRuntimeDesiredTopology(
    snapshot.model,
    facade.resourceProfile,
  );
  const intents = compileWakeflowWindowLaunchIntents(snapshot.model, facade.resourceProfile);
  const unregistered = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
    snapshot.model,
    facade.resourceProfile,
  );
  const { windowId } = envelope;
  const intent = intents.intents.find((entry) => entry.windowId === windowId) ?? null;
  const pod = intent === null ? null : (snapshot.indexes.podById[intent.podId] ?? null);
  const scope = pod === null ? null : (snapshot.indexes.podScopes[pod.podId] ?? null);
  return Object.freeze({
    root,
    facade,
    snapshot,
    windows: topology.windows,
    programId: topology.programId,
    window: topology.windows.find((entry) => entry.windowId === windowId) ?? null,
    intent,
    unregisteredEntry: unregistered.entries.find((entry) => entry.windowId === windowId) ?? null,
    pod,
    podWindowIds: new Set(scope === null ? [] : scope.windows.map((entry) => entry.windowId)),
    repositoryRoot: intent === null ? null : worktreeRepositoryRoot(snapshot, intent),
    authority: Object.freeze({
      programId: topology.programId,
      resourceProfile: facade.resourceProfile,
      identityProfile: facade.identityProfile,
      bindingRefs: topology.windows.map((entry) =>
        wakeflowWindowHostBindingRef(facade.resourceProfile, entry.windowId),
      ),
      bindingRootRef: wakeflowWindowHostBindingRootRef(facade.resourceProfile),
      lockRef: wakeflowWindowHostBindingMutationLockRef(facade.resourceProfile),
    }),
    signal: options.signal,
    clock: options.clock,
    uuidFactory: options.uuidFactory,
  });
}

/** worktree pod 产品窗口的仓库主检出：配置位置报告里的绝对路径；不是 worktree 窗口即 null。 */
function worktreeRepositoryRoot(
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  intent: Readonly<WakeflowWindowLaunchIntent>,
): string | null {
  if (intent.worktree === null) return null;
  const placement = snapshot.placements.roots.find(
    (entry) => entry.key === `repository.${intent.worktree?.repositoryId}.root`,
  );
  return placement?.absolutePath ?? null;
}

async function loadBindings(
  context: EndpointContext,
): Promise<readonly Readonly<WakeflowWindowHostBinding>[]> {
  try {
    const inventory = await inspectWakeflowWindowHostBindingInventory(
      context.root,
      context.authority,
      signalOptions(context.signal),
    );
    return inventory.bindings;
  } catch (error: unknown) {
    mapBindingStoreError(error);
  }
}

async function loadClaim(
  context: EndpointContext,
  windowId: WakeflowWindowRuntimeDesiredWindow["windowId"],
): Promise<Readonly<WorkClaim> | null> {
  // 声明根尚未建立（还没有任何投递）意味着没有声明，内核返回 absent 而不是布局故障。
  return (await inspectWorkClaim(context.root, windowId, signalOptions(context.signal))).claim;
}

/**
 * 宿主 hook 报告的 cwd 可能是符号链接路径（例如 macOS 的临时目录），而工作区根是
 * 规范路径；先按字面比较，再按 realpath 比较，目录已不存在时视为不匹配。
 */
async function isWindowRoot(cwd: string, expectedRoot: string): Promise<boolean> {
  const literal = path.resolve(cwd);
  if (literal === expectedRoot) return true;
  try {
    return (await realpath(literal)) === expectedRoot;
  } catch {
    return false;
  }
}

async function realpathOrNull(candidate: string): Promise<string | null> {
  try {
    return await realpath(path.resolve(candidate));
  } catch {
    return null;
  }
}

/**
 * `session-start` 记录属于本窗口的判据：普通窗口按配置根；worktree pod 的产品窗口按
 * 观察里 porcelain 列出的非主检出（登记与换代），没有观察时按已有回执的检出路径。
 */
async function sessionRootMatcher(
  context: EndpointContext,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
  observation: CreationObservation | null,
  receipts: readonly Readonly<PodWorktreeReceipt>[],
): Promise<(cwd: string) => Promise<boolean>> {
  if (
    context.intent?.worktree === null ||
    context.intent === null ||
    context.repositoryRoot === null
  ) {
    const expectedRoot = path.resolve(context.root.absolutePath, window.configuredPlacement);
    return (cwd) => isWindowRoot(cwd, expectedRoot);
  }
  const candidates = new Set(
    observation?.worktree === undefined
      ? receipts
          .filter((receipt) => receipt.windowId === window.windowId)
          .map((receipt) => receipt.path)
      : await candidateWorktreePaths(observation.worktree.porcelain, context.repositoryRoot),
  );
  // 主检出里的会话也算"这个窗口的会话"，好让准入报 main-checkout 而不是缺 hook 证据。
  const repositoryReal = await realpathOrNull(context.repositoryRoot);
  if (observation?.worktree !== undefined && repositoryReal !== null)
    candidates.add(repositoryReal);
  return async (cwd) => {
    const real = await realpathOrNull(cwd);
    return real !== null && candidates.has(real);
  };
}

/** hook 观察是端点的会话证据：`session-start` 按窗口根匹配，`session-end` 按会话汇总。 */
async function loadHookSessions(
  context: EndpointContext,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
  observation: CreationObservation | null,
  receipts: readonly Readonly<PodWorktreeReceipt>[],
): Promise<HookSessions> {
  const matches = await sessionRootMatcher(context, window, observation, receipts);
  const options = signalOptions(context.signal);
  const started = new Set<string>();
  const cwdBySession = new Map<string, string>();
  const ended = new Set<string>();
  // 读取上限等于目录列举上限：让保留策略而不是读取上限决定可见集合（§13.97 D7d）。
  const startRecords = await readHostHookObservations(
    context.root,
    context.facade.hostId,
    { event: "session-start", limit: HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES },
    options,
  );
  for (const record of startRecords.records) {
    if (!(await matches(record.cwd))) continue;
    started.add(record.sessionId);
    cwdBySession.set(record.sessionId, record.cwd);
  }
  const endRecords = await readHostHookObservations(
    context.root,
    context.facade.hostId,
    { event: "session-end", limit: HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES },
    options,
  );
  for (const record of endRecords.records) ended.add(record.sessionId);
  return Object.freeze({ started, ended, cwdBySession });
}

async function loadWorktreeReceipts(
  context: EndpointContext,
): Promise<readonly Readonly<PodWorktreeReceipt>[]> {
  if (context.pod === null || context.pod.placement !== "worktree") return Object.freeze([]);
  return listPodWorktreeReceipts(
    context.root,
    context.facade.hostId,
    context.pod.podId,
    signalOptions(context.signal),
  );
}

function claimExpiredAt(claim: Readonly<WorkClaim>, now: UtcInstant): boolean {
  return Date.parse(claim.claimedAt) + WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS <= Date.parse(now);
}

async function loadState(
  context: EndpointContext,
  observation: CreationObservation | null,
): Promise<LoadedState> {
  const bindings = await loadBindings(context);
  const now = readUtcWallClock(context.clock);
  const window = context.window;
  if (window === null) {
    return Object.freeze({
      bindings,
      binding: null,
      bindingDigest: null,
      claim: null,
      claimExpired: false,
      locator: null,
      sessions: Object.freeze({
        started: new Set<string>(),
        ended: new Set<string>(),
        cwdBySession: new Map<string, string>(),
      }),
      worktreeReceipts: Object.freeze([]),
      now,
    });
  }
  const worktreeReceipts = await loadWorktreeReceipts(context);
  const binding = bindings.find((entry) => entry.windowId === window.windowId) ?? null;
  const claim = await loadClaim(context, window.windowId);
  const locator =
    locatorProvider(context.facade.hostId) === "tmux"
      ? await readWindowLocator(
          context.root,
          context.facade.hostId,
          window.windowId,
          context.signal,
        )
      : null;
  return Object.freeze({
    bindings,
    binding,
    bindingDigest: binding === null ? null : bindingDigestOf(binding),
    claim,
    claimExpired: claim !== null && claimExpiredAt(claim, now),
    locator,
    sessions: await loadHookSessions(context, window, observation, worktreeReceipts),
    worktreeReceipts,
    now,
  });
}

function endpointState(context: EndpointContext, loaded: LoadedState): EndpointState {
  const handleOwners = new Map<string, string>();
  for (const binding of loaded.bindings) handleOwners.set(binding.handle.value, binding.windowId);
  return Object.freeze({
    windowKnown: context.window !== null && context.intent !== null,
    launchIntentDigest: context.intent?.intentDigest ?? "",
    locatorProvider: locatorProvider(context.facade.hostId),
    worktreeRequired: context.intent !== null && context.intent.worktree !== null,
    binding:
      loaded.binding === null || loaded.bindingDigest === null
        ? null
        : Object.freeze({
            bindingId: loaded.binding.bindingId,
            bindingDigest: loaded.bindingDigest,
            handleValue: loaded.binding.handle.value,
            launchIntentDigest: loaded.binding.source.launchIntentDigest,
          }),
    claim:
      loaded.claim === null
        ? null
        : Object.freeze({
            claimId: loaded.claim.claimId,
            claimDigest: loaded.claim.claimDigest,
            expired: loaded.claimExpired,
          }),
    handleOwners,
    startedSessions: loaded.sessions.started,
    endedSessions: loaded.sessions.ended,
  });
}

function admitHandle(
  context: EndpointContext,
  observation: CreationObservation,
): Readonly<WakeflowWindowHostHandle> {
  try {
    return parseWakeflowWindowHostHandle(context.facade.identityProfile, observation.handle);
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostIdentityProfileError) {
      fail("invalid-request", "handle", "$request.observation.handle", { cause: error });
    }
    throw error;
  }
}

function classifyLiveness(
  context: EndpointContext,
  loaded: LoadedState,
  observation: LivenessObservation,
): ClosureLiveness {
  if (observation.kind === "tmux-panes") {
    if (loaded.locator === null || loaded.binding === null) {
      return Object.freeze({ kind: "tmux-panes" as const, status: "no-locator" as const });
    }
    const socketName = context.snapshot.model.hosts?.["claude-code"]?.tmux?.socketName ?? null;
    const status = classifyTmuxPanes(
      toTmuxLocator(loaded.locator),
      { bindingId: loaded.binding.bindingId, socketName },
      observation.panes as readonly TmuxPaneObservation[],
    );
    return Object.freeze({ kind: "tmux-panes" as const, status });
  }
  if (observation.kind === "codex-thread") {
    return Object.freeze({ kind: "codex-thread" as const, status: observation.status });
  }
  return Object.freeze({ kind: "unobserved" as const });
}

function creationCommand(observation: CreationObservation) {
  return Object.freeze({
    handleValue: observation.handle.value,
    launchIntentDigest: observation.launchIntentDigest,
    hasTmuxCoordinates: observation.tmux !== undefined,
    hasWorktreeObservation: observation.worktree !== undefined,
  });
}

function toCommand(
  context: EndpointContext,
  loaded: LoadedState,
  request: Exclude<WindowBindingRequest, { readonly operation: "inspect" }>,
): EndpointCommand {
  switch (request.operation) {
    case "register":
      return Object.freeze({
        operation: "register" as const,
        observation: creationCommand(request.observation),
      });
    case "replace":
      return Object.freeze({
        operation: "replace" as const,
        observation: creationCommand(request.observation),
        expectedBindingId: request.expectedBindingId,
        expectedBindingDigest: request.expectedBindingDigest,
      });
    case "decommission":
      return Object.freeze({
        operation: "decommission" as const,
        expectedBindingId: request.expectedBindingId,
        expectedBindingDigest: request.expectedBindingDigest,
        preClose: classifyLiveness(context, loaded, request.closure.preClose),
        closeResult: request.closure.closeResult.status,
        postClose: classifyLiveness(context, loaded, request.closure.postClose),
      });
    case "release-claim":
      return Object.freeze({
        operation: "release-claim" as const,
        expectedClaimDigest: request.expectedClaimDigest,
        liveness: classifyLiveness(context, loaded, request.evidence.liveness),
      });
  }
}

type AttachedWorktreeView = {
  readonly repositoryId: string;
  readonly status: "receipt-present" | "receipt-missing";
  /** 从工作区根到 worktree 检出的相对路径；没有回执时为 null。 */
  readonly pathFromWorkspaceRoot: string | null;
};

/** Test 窗口要读的 worktree：有回执的给相对工作区根的路径，没有的只报缺失。 */
function attachedWorktreeViews(
  context: EndpointContext,
  intent: Readonly<WakeflowWindowLaunchIntent>,
  receipts: readonly Readonly<PodWorktreeReceipt>[],
): readonly AttachedWorktreeView[] {
  return intent.attachedWorktrees.map((attached) => {
    const receipt = receipts.find((entry) => entry.repositoryId === attached.repositoryId);
    return Object.freeze({
      repositoryId: attached.repositoryId,
      status: receipt === undefined ? ("receipt-missing" as const) : ("receipt-present" as const),
      pathFromWorkspaceRoot:
        receipt === undefined ? null : path.relative(context.root.absolutePath, receipt.path),
    });
  });
}

/** worktree 意图在执行说明里的投影：建议名称、基线策略与宿主动作，从不含路径。 */
function worktreeInstructions(
  context: EndpointContext,
  intent: Readonly<WakeflowWindowLaunchIntent>,
): JsonObject | null {
  if (intent.worktree === null) return null;
  const template = context.facade.resourceProfile.surfaces.worktree;
  const shared = {
    repositoryId: intent.worktree.repositoryId,
    suggestedName: intent.worktree.suggestedName,
    basePolicy: intent.worktree.basePolicy,
    registration:
      "after the session starts inside the worktree, report the handle plus the verbatim output of `git worktree list --porcelain` and `git rev-parse --git-common-dir` run in the session cwd",
  };
  if (template.launch === "claude-worktree-flag") {
    return {
      ...shared,
      launch: template.launch,
      hostBranch: `worktree-${intent.worktree.suggestedName}`,
      note: "claude --worktree creates the checkout under .claude/worktrees/<name> from the local HEAD; the session cwd is that checkout",
    };
  }
  return {
    ...shared,
    launch: template.launch,
    hostBranch: null,
    note: `create_thread with a worktree environment starts on a detached HEAD; run git switch -c ${intent.worktree.suggestedName} before the first result import`,
  };
}

function claudeAddDirArguments(
  intent: Readonly<WakeflowWindowLaunchIntent>,
  attached: readonly AttachedWorktreeView[],
): readonly string[] {
  const arguments_: string[] = [];
  if (intent.root.configuredPlacement !== ".") arguments_.push("--add-dir", "<workspace root>");
  for (const view of attached) {
    if (view.pathFromWorkspaceRoot !== null) {
      arguments_.push("--add-dir", `<workspace root>/${view.pathFromWorkspaceRoot}`);
    }
  }
  return arguments_;
}

/** Agent 执行启动意图所需的参数：只含配置声明与占位符，绝不含绝对路径或宿主句柄。 */
function executionInstructions(
  context: EndpointContext,
  intent: Readonly<WakeflowWindowLaunchIntent>,
  receipts: readonly Readonly<PodWorktreeReceipt>[],
): JsonObject {
  const model = context.snapshot.model;
  const hostId = context.facade.hostId;
  const role = intent.role as WakeflowConfigWindow["role"];
  const attached = attachedWorktreeViews(context, intent, receipts);
  const worktree = worktreeInstructions(context, intent);
  if (hostId === "claude-code") {
    const host = model.hosts?.["claude-code"];
    const launch = host?.launch;
    const effort =
      launch?.reasoningEffortByRole?.[role] ??
      launch?.reasoningEffortByRole?.default ??
      (role === "controller" ? "max" : "xhigh");
    const modelName = launch?.modelByRole?.[role] ?? launch?.modelByRole?.default ?? null;
    const permissionMode = launch?.permissionMode ?? "acceptEdits";
    return {
      kind: "claude-code",
      tmux: {
        socketName: host?.tmux?.socketName ?? null,
        sessionName: host?.tmux?.sessionName ?? "wakeflow",
        windowName: intent.displayTitle,
        cwd: intent.root.configuredPlacement,
      },
      command: "claude",
      arguments: [
        ...(intent.worktree === null ? [] : ["--worktree", intent.worktree.suggestedName]),
        "--session-id",
        "<uuid-v4 generated by the Agent>",
        "--permission-mode",
        permissionMode,
        "--effort",
        effort,
        ...(modelName === null ? [] : ["--model", modelName]),
        ...claudeAddDirArguments(intent, attached),
      ],
      sessionIdPolicy: "agent-generates-uuid-v4",
      registration:
        "report handle kind claude-session with the generated session id plus the tmux socket, session, window, and pane",
      worktree,
      attachedWorktrees: attached,
    };
  }
  const launch = model.hosts?.codex?.launch;
  return {
    kind: "codex",
    tool: "create_thread",
    title: intent.displayTitle,
    cwd: intent.root.configuredPlacement,
    environment: intent.worktree === null ? "local" : "worktree",
    model: launch?.modelByRole?.[role] ?? launch?.modelByRole?.default ?? null,
    reasoningEffort:
      launch?.reasoningEffortByRole?.[role] ?? launch?.reasoningEffortByRole?.default ?? null,
    followUp: "set_thread_title",
    registration: "report handle kind codex-thread with the created thread id",
    worktree,
    attachedWorktrees: attached,
  };
}

function nextFor(
  context: EndpointContext,
  bindings: readonly Readonly<WakeflowWindowHostBinding>[],
  registered: boolean,
  claim: Readonly<WorkClaim> | null,
  claimExpired: boolean,
): Readonly<NextProjection> {
  const bound = new Set(bindings.map((entry) => entry.windowId));
  const unregisteredWindowIds = context.windows
    .filter(
      (entry) =>
        context.podWindowIds.has(entry.windowId) &&
        !bound.has(entry.windowId) &&
        entry.windowId !== context.window?.windowId,
    )
    .map((entry) => entry.windowId);
  return deriveEndpointNext({
    registered,
    claimHeld: claim !== null,
    claimExpired,
    unregisteredWindowIds,
  });
}

function bindingSummary(binding: Readonly<WakeflowWindowHostBinding>) {
  return {
    bindingId: binding.bindingId,
    bindingDigest: bindingDigestOf(binding),
    registeredAt: binding.registeredAt,
    launchIntentDigest: binding.source.launchIntentDigest,
  };
}

function claimSummary(claim: Readonly<WorkClaim> | null, expired: boolean) {
  if (claim === null) return { status: "absent" };
  return {
    status: "held",
    claimId: claim.claimId,
    claimDigest: claim.claimDigest,
    demandId: claim.holder.demandId,
    claimedAt: claim.claimedAt,
    expiresAt: new Date(
      Date.parse(claim.claimedAt) + WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS,
    ).toISOString(),
    expired,
  };
}

function inspectionResult(context: EndpointContext, loaded: LoadedState): WindowBindingResult {
  if (context.window === null || context.intent === null) {
    fail("not-found", "window-unknown", "$request.windowId");
  }
  return admitWindowBindingResult({
    kind: "WakeflowWindowBindingInspection",
    schemaVersion: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    hostId: context.facade.hostId,
    windowId: context.window.windowId,
    role: context.window.role,
    launchIntent: {
      intentDigest: context.intent.intentDigest,
      podId: context.intent.podId,
      podName: context.intent.podName,
      podPlacement: context.intent.podPlacement,
      displayTitle: context.intent.displayTitle,
      root: {
        kind: context.intent.root.kind,
        rootId: context.intent.root.rootId,
        configuredPlacement: context.intent.root.configuredPlacement,
      },
      worktree: context.intent.worktree,
      attachedWorktrees: context.intent.attachedWorktrees,
      execution: executionInstructions(context, context.intent, loaded.worktreeReceipts),
    },
    binding:
      loaded.binding === null
        ? { status: "unregistered" }
        : { status: "registered", ...bindingSummary(loaded.binding) },
    claim: claimSummary(loaded.claim, loaded.claimExpired),
    locator:
      locatorProvider(context.facade.hostId) === "none"
        ? { status: "not-applicable" }
        : { status: loaded.locator === null ? "absent" : "present" },
    next: nextFor(
      context,
      loaded.bindings,
      loaded.binding !== null,
      loaded.claim,
      loaded.claimExpired,
    ),
  });
}

async function readBindingSource(context: EndpointContext, ref: PortableResourcePath) {
  try {
    return await readDeterministicJsonFile(context.root, ref, {
      maximumBytes: BINDING_MAXIMUM_BYTES,
      ...signalOptions(context.signal),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      fail("concurrency-conflict", "binding-changed", "$request.windowId", {
        cause: error,
        retryable: true,
      });
    }
    throw error;
  }
}

async function refreshLocator(
  context: EndpointContext,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
  binding: Readonly<WakeflowWindowHostBinding> | null,
  observation: CreationObservation | null,
): Promise<void> {
  if (locatorProvider(context.facade.hostId) !== "tmux") return;
  if (binding === null || observation?.tmux === undefined) {
    await retireWindowLocator(context.root, context.facade.hostId, window.windowId, context.signal);
    return;
  }
  await writeWindowLocator(
    context.root,
    createWindowLocatorRecord({
      programId: context.programId,
      hostId: context.facade.hostId,
      windowId: binding.windowId,
      bindingId: binding.bindingId,
      tmux: {
        socketName: observation.tmux.socketName,
        sessionName: observation.tmux.sessionName,
        windowId: observation.tmux.windowId,
        paneId: observation.tmux.paneId,
      },
      registeredAt: binding.registeredAt,
    }),
    context.signal,
  );
}

async function refreshProjection(
  context: EndpointContext,
  entry: Readonly<WakeflowWindowRuntimeUnregisteredProjectionEntry>,
  binding: Readonly<WakeflowWindowHostBinding> | null,
): Promise<Readonly<ProjectionReceipt>> {
  const target =
    binding === null
      ? entry
      : compileWakeflowWindowRuntimeRegisteredProjectionEntry(
          context.facade.resourceProfile,
          context.facade.identityProfile,
          entry.projection,
          binding,
        );
  return publishProjectionDocument(
    context.root,
    {
      resourceRef: target.resourceRef,
      document: target.document,
      documentDigest: target.documentDigest,
      projectionDigest: target.projection.projectionDigest,
    },
    context.signal,
  );
}

/** worktree pod 产品窗口：准入观察里的 git 事实（文件系统核对），返回可写进回执的检出。 */
async function admitWorktree(
  context: EndpointContext,
  loaded: LoadedState,
  observation: CreationObservation,
): Promise<Readonly<AdmittedPodWorktree> | null> {
  if (context.intent?.worktree === null || context.intent === null) return null;
  if (observation.worktree === undefined) {
    fail("invalid-request", "worktree-receipt-required", "$request.observation.worktree");
  }
  if (context.repositoryRoot === null) {
    fail("precondition-failed", "worktree-repository-unavailable", "$request.observation.worktree");
  }
  const sessionCwd = loaded.sessions.cwdBySession.get(observation.handle.value);
  if (sessionCwd === undefined) {
    fail("precondition-failed", "hook-evidence-missing", "$request.observation.handle");
  }
  return admitPodWorktreeObservation({
    observation: observation.worktree,
    sessionCwd,
    repositoryRoot: context.repositoryRoot,
  });
}

async function recordWorktree(
  context: EndpointContext,
  binding: Readonly<WakeflowWindowHostBinding>,
  worktree: Readonly<AdmittedPodWorktree> | null,
  observedAt: string,
): Promise<Readonly<WorktreeSummary> | null> {
  if (worktree === null || context.intent?.worktree === null || context.intent === null)
    return null;
  await writePodWorktreeReceipt(
    context.root,
    createPodWorktreeReceipt({
      hostId: context.facade.hostId,
      podId: context.intent.podId,
      windowId: binding.windowId,
      repositoryId: context.intent.worktree.repositoryId,
      bindingId: binding.bindingId,
      worktree,
      observedAt: parseUtcInstant(observedAt, "$request.observation.observedAt"),
    }),
    signalOptions(context.signal),
  );
  return Object.freeze({
    head: worktree.head,
    branch: worktree.branch,
    detached: worktree.branch === null,
    locked: worktree.locked,
  });
}

async function applyRegister(
  context: EndpointContext,
  store: WakeflowWindowHostBindingStoreContext,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
  current: Readonly<WakeflowWindowHostBinding> | null,
  request: RegisterRequest,
  replayed: boolean,
  loaded: LoadedState,
): Promise<AppliedBinding> {
  const observation = request.observation;
  const worktree = await admitWorktree(context, loaded, observation);
  if (replayed) {
    // 同句柄重放：绑定不动；worktree 回执缺失或换过检出时按当前观察补写，保持幂等。
    const summary =
      current === null
        ? null
        : await recordWorktree(context, current, worktree, observation.observedAt);
    return Object.freeze({ disposition: "replayed" as const, binding: current, worktree: summary });
  }
  const binding = await createWakeflowWindowHostBindingInStore(
    context.root,
    {
      ...context.authority,
      windowId: window.windowId,
      bindingRef: wakeflowWindowHostBindingRef(context.facade.resourceProfile, window.windowId),
      launchIntentDigest: observation.launchIntentDigest as Sha256Digest,
      handle: admitHandle(context, observation),
      observedAt: parseUtcInstant(observation.observedAt, "$request.observation.observedAt"),
    },
    store,
  );
  const summary = await recordWorktree(context, binding, worktree, observation.observedAt);
  return Object.freeze({ disposition: "registered" as const, binding, worktree: summary });
}

async function applyReplace(
  context: EndpointContext,
  store: WakeflowWindowHostBindingStoreContext,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
  current: Readonly<WakeflowWindowHostBinding> | null,
  request: ReplaceRequest,
  loaded: LoadedState,
): Promise<AppliedBinding> {
  if (current === null) fail("not-found", "binding-absent", "$request.windowId");
  const worktree = await admitWorktree(context, loaded, request.observation);
  const bindingRef = wakeflowWindowHostBindingRef(context.facade.resourceProfile, window.windowId);
  const source = await readBindingSource(context, bindingRef);
  const registeredAt = readUtcWallClock(store.wallClock);
  if (Date.parse(registeredAt) <= Date.parse(current.registeredAt)) {
    fail("precondition-failed", "registered-at-not-monotonic", "$request.observation.observedAt");
  }
  const observation = request.observation;
  const replacement = createWakeflowWindowHostBinding(
    {
      programId: current.programId,
      hostId: current.hostId,
      windowId: current.windowId,
      bindingId: createWakeflowWindowHostBindingId(store.uuidFactory),
      handle: admitHandle(context, observation),
      launchIntentDigest: observation.launchIntentDigest as Sha256Digest,
      observedAt: parseUtcInstant(observation.observedAt, "$request.observation.observedAt"),
      registeredAt,
    },
    context.facade.identityProfile,
  );
  try {
    await replaceFileAtomically(
      context.root,
      bindingRef,
      encodeUtf8(
        renderWakeflowWindowHostBinding(replacement, context.facade.identityProfile),
        "$binding",
      ),
      {
        mode: BINDING_FILE_MODE,
        expected: {
          resourcePath: source.resourcePath,
          node: source.node,
          byteCount: source.byteCount,
          digest: source.digest,
        },
        ...signalOptions(context.signal),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      fail("io-failure", `binding-replace-${error.reason}`, "$request.windowId", { cause: error });
    }
    throw error;
  }
  const summary = await recordWorktree(context, replacement, worktree, observation.observedAt);
  return Object.freeze({
    disposition: "replaced" as const,
    binding: replacement,
    worktree: summary,
  });
}

async function applyDecommission(
  context: EndpointContext,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
  current: Readonly<WakeflowWindowHostBinding> | null,
): Promise<AppliedBinding> {
  if (current === null) fail("not-found", "binding-absent", "$request.windowId");
  const bindingRef = wakeflowWindowHostBindingRef(context.facade.resourceProfile, window.windowId);
  const source = await readBindingSource(context, bindingRef);
  try {
    await unlinkRegularFileExactly(context.root, bindingRef, {
      expectedNode: source.node,
      ...signalOptions(context.signal),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      fail("io-failure", `binding-retire-${error.reason}`, "$request.windowId", { cause: error });
    }
    throw error;
  }
  return Object.freeze({ disposition: "decommissioned" as const, binding: null, worktree: null });
}

async function applyMutation(
  context: EndpointContext,
  store: WakeflowWindowHostBindingStoreContext,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
  current: Readonly<WakeflowWindowHostBinding> | null,
  request: MutationRequest,
  decision: MutationDecision,
  loaded: LoadedState,
): Promise<AppliedBinding> {
  switch (request.operation) {
    case "register":
      return applyRegister(
        context,
        store,
        window,
        current,
        request,
        decision.disposition === "replayed",
        loaded,
      );
    case "replace":
      return applyReplace(context, store, window, current, request, loaded);
    case "decommission":
      return applyDecommission(context, window, current);
  }
}

async function mutateBinding(
  context: EndpointContext,
  loaded: LoadedState,
  request: MutationRequest,
  decision: MutationDecision,
): Promise<MutationOutcome> {
  const window = context.window;
  const entry = context.unregisteredEntry;
  if (window === null || entry === null) fail("not-found", "window-unknown", "$request.windowId");
  const storeOptions = {
    ...signalOptions(context.signal),
    ...(context.clock === undefined ? {} : { wallClock: context.clock }),
    ...(context.uuidFactory === undefined ? {} : { uuidFactory: context.uuidFactory }),
  };
  try {
    return await withWakeflowWindowHostBindingStore(
      context.root,
      context.authority,
      storeOptions,
      async (store) => {
        const current =
          store.inventory.bindings.find((candidate) => candidate.windowId === window.windowId) ??
          null;
        const currentDigest = current === null ? null : bindingDigestOf(current);
        if (currentDigest !== loaded.bindingDigest) {
          fail("concurrency-conflict", "binding-changed", "$request.windowId", { retryable: true });
        }
        const applied = await applyMutation(
          context,
          store,
          window,
          current,
          request,
          decision,
          loaded,
        );
        const observation = request.operation === "decommission" ? null : request.observation;
        await refreshLocator(context, window, applied.binding, observation);
        const projection = await refreshProjection(context, entry, applied.binding);
        const bindings = store.inventory.bindings
          .filter((candidate) => candidate.windowId !== window.windowId)
          .concat(applied.binding === null ? [] : [applied.binding]);
        return Object.freeze({
          disposition: applied.disposition,
          binding: applied.binding,
          bindings,
          worktree: applied.worktree,
          verification: decision.operation === "decommission" ? decision.verification : null,
          projection,
        });
      },
    );
  } catch (error: unknown) {
    mapBindingStoreError(error);
  }
}

async function writeClaimReleaseReceipt(
  context: EndpointContext,
  claim: Readonly<WorkClaim>,
  loaded: LoadedState,
  request: ReleaseClaimRequest,
): Promise<void> {
  const receipt = {
    kind: "WakeflowWorkClaimForcedRelease",
    schemaVersion: 1,
    hostId: context.facade.hostId,
    windowId: claim.windowId,
    claimId: claim.claimId,
    claimDigest: claim.claimDigest,
    demandId: claim.holder.demandId,
    releasedAt: loaded.now,
    evidence: request.evidence.liveness.kind,
    claimExpired: loaded.claimExpired,
  };
  const options = signalOptions(context.signal);
  const directory = `${hostRuntimeRootRef(context.facade.hostId)}/observations/claim-releases`;
  try {
    await materializeDirectoryPath(
      context.root,
      parsePortableResourcePath(directory, "$claimRelease"),
      {
        mode: RECEIPT_DIRECTORY_MODE,
        ...options,
      },
    );
    await createFileAtomically(
      context.root,
      parsePortableResourcePath(`${directory}/${claim.claimId}.json`, "$claimRelease"),
      encodeUtf8(`${JSON.stringify(receipt, null, 2)}\n`, "$claimRelease"),
      { mode: BINDING_FILE_MODE, ...options },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError && error.reason === "target-exists") return;
    if (
      error instanceof DurableAtomicFileWriteError ||
      error instanceof DurableDirectoryMaterializationError
    ) {
      fail("io-failure", `claim-release-receipt-${error.reason}`, "$request.windowId", {
        cause: error,
      });
    }
    throw error;
  }
}

async function releaseClaim(
  context: EndpointContext,
  loaded: LoadedState,
  request: ReleaseClaimRequest,
): Promise<Readonly<{ readonly claimId: string; readonly claimDigest: Sha256Digest }>> {
  const claim = loaded.claim;
  if (claim === null) fail("not-found", "claim-absent", "$request.windowId");
  await releaseWorkClaim(context.root, claim, signalOptions(context.signal));
  await writeClaimReleaseReceipt(context, claim, loaded, request);
  return Object.freeze({ claimId: claim.claimId, claimDigest: claim.claimDigest });
}

interface MutationResultInput {
  readonly disposition: MutationDisposition | "claim-released";
  readonly binding: Readonly<WakeflowWindowHostBinding> | null;
  readonly worktree: Readonly<WorktreeSummary> | null;
  readonly verification: "machine-verified" | "manual-host-gate" | null;
  readonly claim: Readonly<{ readonly claimId: string; readonly claimDigest: Sha256Digest }> | null;
  readonly projection: Readonly<ProjectionReceipt> | null;
  readonly next: Readonly<NextProjection>;
}

function mutationResult(
  context: EndpointContext,
  request: Exclude<WindowBindingRequest, { readonly operation: "inspect" }>,
  outcome: Readonly<MutationResultInput>,
): WindowBindingResult {
  return admitWindowBindingResult({
    kind: "WakeflowWindowBindingMutation",
    schemaVersion: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    hostId: context.facade.hostId,
    windowId: request.windowId,
    operation: request.operation,
    disposition: outcome.disposition,
    binding: outcome.binding === null ? null : bindingSummary(outcome.binding),
    worktree: outcome.worktree,
    verification: outcome.verification,
    claim: outcome.claim,
    projection: outcome.projection,
    next: outcome.next,
  });
}

async function executeOperation(
  context: EndpointContext,
  request: WindowBindingRequest,
): Promise<WindowBindingResult> {
  const loaded = await loadState(
    context,
    request.operation === "register" || request.operation === "replace"
      ? request.observation
      : null,
  );
  if (request.operation === "inspect") return inspectionResult(context, loaded);
  const decision = decideEndpointCommand(
    request.windowId,
    endpointState(context, loaded),
    toCommand(context, loaded, request),
  );
  if (!decision.accepted) fail(decision.code, decision.reason, decision.path);
  if (decision.operation === "release-claim") {
    const claim = await releaseClaim(context, loaded, request as ReleaseClaimRequest);
    return mutationResult(context, request, {
      disposition: "claim-released",
      binding: loaded.binding,
      worktree: null,
      verification: null,
      claim,
      projection: null,
      next: nextFor(context, loaded.bindings, loaded.binding !== null, null, false),
    });
  }
  const outcome = await mutateBinding(context, loaded, request as MutationRequest, decision);
  return mutationResult(context, request, {
    disposition: outcome.disposition,
    binding: outcome.binding,
    worktree: outcome.worktree,
    verification: outcome.verification,
    claim: null,
    projection: outcome.projection,
    next: nextFor(
      context,
      outcome.bindings,
      outcome.binding !== null,
      loaded.claim,
      loaded.claimExpired,
    ),
  });
}

/** 执行一次公共窗口绑定操作。 */
export async function executeWindowBindingRequest(
  facadeValue: Readonly<WindowBindingHostFacade>,
  value: unknown,
  options: ExecuteWindowBindingOptions = {},
): Promise<WindowBindingResult> {
  const facade = admitFacade(facadeValue);
  return runCommandShell<Envelope, WindowBindingRequest, EndpointContext, WindowBindingResult>(
    {
      tool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const parsed = parseWindowBindingRequest(raw);
        return {
          envelope: { root: parsed.root, operation: parsed.operation, windowId: parsed.windowId },
          input: parsed,
        };
      },
      open: (root, envelope) => openContext(root, facade, envelope, options),
      close: async () => {},
      privateValues: (context) => [context.snapshot.ledgerRoot],
    },
    value,
    () => {},
    (context, binding) => executeOperation(context, binding.input),
  );
}
