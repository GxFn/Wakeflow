import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import type {
  WakeflowConfigV3Model,
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
  inspectWindowWorkClaim,
  releaseWindowWorkClaimInStore,
  WindowWorkClaimStoreError,
} from "../../governance/delivery/window-work-claim-store.js";
import type { WindowWorkClaim } from "../../governance/delivery/window-work-claim.js";
import { runCommandShell } from "../../kernel/command-shell.js";
import { fail } from "../../kernel/error.js";
import { readHostHookObservations } from "../../kernel/hook-observations.js";
import { hostRuntimeRootRef, parseWakeflowHostId } from "../../kernel/layout.js";
import type { NextProjection } from "../../kernel/next-projection.js";
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
export const WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS = 2 * 60 * 60 * 1000;

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
  readonly signal: AbortSignal | undefined;
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
}

interface HookSessions {
  readonly started: ReadonlySet<string>;
  readonly ended: ReadonlySet<string>;
}

interface LoadedState {
  readonly bindings: readonly Readonly<WakeflowWindowHostBinding>[];
  readonly binding: Readonly<WakeflowWindowHostBinding> | null;
  readonly bindingDigest: Sha256Digest | null;
  readonly claim: Readonly<WindowWorkClaim> | null;
  readonly claimExpired: boolean;
  readonly locator: Readonly<WindowLocatorRecord> | null;
  readonly sessions: HookSessions;
  readonly now: UtcInstant;
}

interface MutationOutcome {
  readonly disposition: MutationDisposition;
  readonly binding: Readonly<WakeflowWindowHostBinding> | null;
  readonly bindings: readonly Readonly<WakeflowWindowHostBinding>[];
  readonly verification: "machine-verified" | "manual-host-gate" | null;
  readonly projection: Readonly<ProjectionReceipt>;
}

interface AppliedBinding {
  readonly disposition: MutationDisposition;
  readonly binding: Readonly<WakeflowWindowHostBinding> | null;
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

function mapClaimStoreError(error: unknown): never {
  if (error instanceof WindowWorkClaimStoreError) {
    if (error.reason === "not-found")
      fail("not-found", "claim-absent", "$request.windowId", { cause: error });
    if (error.reason === "expectation-mismatch") {
      fail("precondition-failed", "claim-drift", "$request.expectedClaimDigest", { cause: error });
    }
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    fail("io-failure", `claim-${error.reason}`, "$request.windowId", { cause: error });
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
  return Object.freeze({
    root,
    facade,
    snapshot,
    windows: topology.windows,
    programId: topology.programId,
    window: topology.windows.find((entry) => entry.windowId === windowId) ?? null,
    intent: intents.intents.find((entry) => entry.windowId === windowId) ?? null,
    unregisteredEntry: unregistered.entries.find((entry) => entry.windowId === windowId) ?? null,
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
): Promise<Readonly<WindowWorkClaim> | null> {
  try {
    const inspected = await inspectWindowWorkClaim(
      context.root,
      windowId,
      signalOptions(context.signal),
    );
    return inspected.status === "claimed" ? (inspected.claim ?? null) : null;
  } catch (error: unknown) {
    // 声明根尚未建立（还没有任何投递）意味着没有声明，不是布局故障。
    if (
      error instanceof WindowWorkClaimStoreError &&
      error.reason === "layout" &&
      error.path === "$claimRoot"
    ) {
      return null;
    }
    mapClaimStoreError(error);
  }
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

/** hook 观察是端点的会话证据：`session-start` 按窗口根匹配，`session-end` 按会话汇总。 */
async function loadHookSessions(
  context: EndpointContext,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
): Promise<HookSessions> {
  const expectedRoot = path.resolve(context.root.absolutePath, window.configuredPlacement);
  const options = signalOptions(context.signal);
  const started = new Set<string>();
  const ended = new Set<string>();
  const startRecords = await readHostHookObservations(
    context.root,
    context.facade.hostId,
    { event: "session-start" },
    options,
  );
  for (const record of startRecords.records) {
    if (await isWindowRoot(record.cwd, expectedRoot)) started.add(record.sessionId);
  }
  const endRecords = await readHostHookObservations(
    context.root,
    context.facade.hostId,
    { event: "session-end" },
    options,
  );
  for (const record of endRecords.records) ended.add(record.sessionId);
  return Object.freeze({ started, ended });
}

function claimExpiredAt(claim: Readonly<WindowWorkClaim>, now: UtcInstant): boolean {
  return Date.parse(claim.claimedAt) + WORK_CLAIM_RECOVERY_WINDOW_MILLISECONDS <= Date.parse(now);
}

async function loadState(context: EndpointContext): Promise<LoadedState> {
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
      sessions: Object.freeze({ started: new Set<string>(), ended: new Set<string>() }),
      now,
    });
  }
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
    sessions: await loadHookSessions(context, window),
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

/** Agent 执行启动意图所需的参数：只含配置声明与占位符，绝不含绝对路径或宿主句柄。 */
function executionInstructions(
  model: WakeflowConfigV3Model,
  hostId: WakeflowHostId,
  intent: Readonly<WakeflowWindowLaunchIntent>,
): JsonObject {
  const role = intent.role as WakeflowConfigWindow["role"];
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
        "--session-id",
        "<uuid-v4 generated by the Agent>",
        "--permission-mode",
        permissionMode,
        "--effort",
        effort,
        ...(modelName === null ? [] : ["--model", modelName]),
        ...(intent.root.configuredPlacement === "." ? [] : ["--add-dir", "<workspace root>"]),
      ],
      sessionIdPolicy: "agent-generates-uuid-v4",
      registration:
        "report handle kind claude-session with the generated session id plus the tmux socket, session, window, and pane",
    };
  }
  const launch = model.hosts?.codex?.launch;
  return {
    kind: "codex",
    tool: "create_thread",
    title: intent.displayTitle,
    cwd: intent.root.configuredPlacement,
    model: launch?.modelByRole?.[role] ?? launch?.modelByRole?.default ?? null,
    reasoningEffort:
      launch?.reasoningEffortByRole?.[role] ?? launch?.reasoningEffortByRole?.default ?? null,
    followUp: "set_thread_title",
    registration: "report handle kind codex-thread with the created thread id",
  };
}

function nextFor(
  context: EndpointContext,
  bindings: readonly Readonly<WakeflowWindowHostBinding>[],
  registered: boolean,
  claim: Readonly<WindowWorkClaim> | null,
  claimExpired: boolean,
): Readonly<NextProjection> {
  const bound = new Set(bindings.map((entry) => entry.windowId));
  const unregisteredWindowIds = context.windows
    .filter((entry) => !bound.has(entry.windowId) && entry.windowId !== context.window?.windowId)
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

function claimSummary(claim: Readonly<WindowWorkClaim> | null, expired: boolean) {
  if (claim === null) return { status: "absent" };
  return {
    status: "held",
    claimId: claim.claimId,
    claimDigest: claim.claimDigest,
    demandId: claim.target.demandId,
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
      displayTitle: context.intent.displayTitle,
      root: {
        kind: context.intent.root.kind,
        rootId: context.intent.root.rootId,
        configuredPlacement: context.intent.root.configuredPlacement,
      },
      execution: executionInstructions(
        context.snapshot.model,
        context.facade.hostId,
        context.intent,
      ),
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

async function applyRegister(
  context: EndpointContext,
  store: WakeflowWindowHostBindingStoreContext,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
  current: Readonly<WakeflowWindowHostBinding> | null,
  request: RegisterRequest,
  replayed: boolean,
): Promise<AppliedBinding> {
  if (replayed) return Object.freeze({ disposition: "replayed" as const, binding: current });
  const observation = request.observation;
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
  return Object.freeze({ disposition: "registered" as const, binding });
}

async function applyReplace(
  context: EndpointContext,
  store: WakeflowWindowHostBindingStoreContext,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
  current: Readonly<WakeflowWindowHostBinding> | null,
  request: ReplaceRequest,
): Promise<AppliedBinding> {
  if (current === null) fail("not-found", "binding-absent", "$request.windowId");
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
  return Object.freeze({ disposition: "replaced" as const, binding: replacement });
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
  return Object.freeze({ disposition: "decommissioned" as const, binding: null });
}

async function applyMutation(
  context: EndpointContext,
  store: WakeflowWindowHostBindingStoreContext,
  window: Readonly<WakeflowWindowRuntimeDesiredWindow>,
  current: Readonly<WakeflowWindowHostBinding> | null,
  request: MutationRequest,
  decision: MutationDecision,
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
      );
    case "replace":
      return applyReplace(context, store, window, current, request);
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
        const applied = await applyMutation(context, store, window, current, request, decision);
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
  claim: Readonly<WindowWorkClaim>,
  loaded: LoadedState,
  request: ReleaseClaimRequest,
): Promise<void> {
  const receipt = {
    kind: "WakeflowWorkClaimForcedRelease",
    schemaVersion: 1,
    hostId: context.facade.hostId,
    windowId: claim.route.windowId,
    claimId: claim.claimId,
    claimDigest: claim.claimDigest,
    demandId: claim.target.demandId,
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
  try {
    await releaseWindowWorkClaimInStore(context.root, claim, signalOptions(context.signal));
  } catch (error: unknown) {
    mapClaimStoreError(error);
  }
  await writeClaimReleaseReceipt(context, claim, loaded, request);
  return Object.freeze({ claimId: claim.claimId, claimDigest: claim.claimDigest });
}

interface MutationResultInput {
  readonly disposition: MutationDisposition | "claim-released";
  readonly binding: Readonly<WakeflowWindowHostBinding> | null;
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
  const loaded = await loadState(context);
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
