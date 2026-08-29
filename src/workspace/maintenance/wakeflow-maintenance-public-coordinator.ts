import {
  compileWakeflowFreshConfigSelection,
  type WakeflowFreshConfigCompilation,
} from "../../configuration/wakeflow-fresh-config-selection.js";
import {
  parseWakeflowConfigV3,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  canonicalizeJson,
  encodeCanonicalJson,
} from "../../foundation/data/canonical-json.js";
import {
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import type {
  WakeflowWindowLaunchIntent,
} from "../window-runtime/wakeflow-window-launch-intent.js";
import {
  createWakeflowMaintenanceConfirmation,
  parseWakeflowMaintenanceConfirmation,
  type WakeflowMaintenanceConfirmation,
} from "./wakeflow-maintenance-confirmation.js";
import {
  WakeflowMaintenanceExecutionTransactionError,
  type WakeflowMaintenanceExecutionStepReceipt,
} from "./wakeflow-maintenance-execution-transaction.js";
import type {
  WakeflowMaintenancePublicHostFacade,
} from "./wakeflow-maintenance-public-host-facade.js";
import {
  parseWakeflowMaintenancePublicRequest,
  WAKEFLOW_MAINTENANCE_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  type WakeflowMaintenancePublicPreviewRequest,
} from "./wakeflow-maintenance-public-contract.js";
import type {
  WakeflowMaintenanceOperationId,
} from "./wakeflow-maintenance-operation-id.js";
import type {
  WakeflowStaticMaterializationAction,
  WakeflowStaticMaterializationPreviewRequest,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：公共 preview/apply/recover 的唯一编排边界。
 *
 * 协调器只把公共 JSON 编译为既有 typed owner 的输入，并使用 entrypoint 固定注入的
 * 单个宿主 facade。它不持有状态、不解释 plan step、不执行窗口创建，也不把摘要当作
 * 授权；apply 仍由内部 transaction 在 mutation gate 前重新推导完整计划。
 */

export const WAKEFLOW_MAINTENANCE_PUBLIC_MAXIMUM_RESULT_BYTES =
  8 * 1024 * 1024;

export interface WakeflowMaintenancePublicPreviewResult {
  readonly kind: "WakeflowMaintenancePublicPreviewResult";
  readonly schemaVersion: 1;
  readonly tool: typeof WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME;
  readonly hostId: WakeflowMaintenancePublicHostFacade["hostId"];
  readonly mode: "preview";
  readonly action: WakeflowStaticMaterializationAction;
  readonly status: "ready" | "blocked";
  readonly blockerCodes: readonly string[];
  readonly confirmation: Readonly<WakeflowMaintenanceConfirmation> | null;
  readonly confirmationDigest: Sha256Digest | null;
  readonly freshConfigCompilation: Readonly<{
    readonly selectionDigest: Sha256Digest;
    readonly configDigest: Sha256Digest;
    readonly allocations: WakeflowFreshConfigCompilation["allocations"];
  }> | null;
  readonly launchIntents: readonly Readonly<WakeflowWindowLaunchIntent>[];
  readonly launchSetDigest: Sha256Digest | null;
}

export interface WakeflowMaintenancePublicMutationResult {
  readonly kind: "WakeflowMaintenancePublicMutationResult";
  readonly schemaVersion: 1;
  readonly tool: typeof WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME;
  readonly hostId: WakeflowMaintenancePublicHostFacade["hostId"];
  readonly mode: "apply" | "recover";
  readonly action: WakeflowStaticMaterializationAction | null;
  readonly status: "completed" | "no-op" | "recovered";
  readonly operationId: WakeflowMaintenanceOperationId | null;
  readonly planDigest: Sha256Digest;
  readonly stepReceipts:
    readonly Readonly<WakeflowMaintenanceExecutionStepReceipt>[];
  readonly confirmationDigest: Sha256Digest | null;
  readonly launchIntents: readonly Readonly<WakeflowWindowLaunchIntent>[];
  readonly launchSetDigest: Sha256Digest | null;
}

export type WakeflowMaintenancePublicResult =
  | WakeflowMaintenancePublicPreviewResult
  | WakeflowMaintenancePublicMutationResult;

export type WakeflowMaintenancePublicCoordinatorErrorReason =
  | "host"
  | "root"
  | "preview"
  | "confirmation"
  | "apply"
  | "recover"
  | "output";

const ERROR_MESSAGES = {
  host: "Wakeflow public maintenance host composition is invalid.",
  root: "Wakeflow public maintenance workspace root is invalid.",
  preview: "Wakeflow public maintenance preview failed.",
  confirmation: "Wakeflow public maintenance confirmation is invalid.",
  apply: "Wakeflow public maintenance apply failed.",
  recover: "Wakeflow public maintenance recovery failed.",
  output: "Wakeflow public maintenance result violated its public boundary.",
} as const satisfies Readonly<Record<
  WakeflowMaintenancePublicCoordinatorErrorReason,
  string
>>;

/** 公共 Maintenance 编排失败的稳定、脱敏错误。 */
export class WakeflowMaintenancePublicCoordinatorError extends Error {
  override readonly name = "WakeflowMaintenancePublicCoordinatorError";
  readonly code = "wakeflow-maintenance-public-coordinator" as const;
  readonly reason: WakeflowMaintenancePublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly operationId: WakeflowMaintenanceOperationId | null;

  constructor(
    reason: WakeflowMaintenancePublicCoordinatorErrorReason,
    causeCode: string | null = null,
    operationId: WakeflowMaintenanceOperationId | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.operationId = operationId;
  }
}

function errorCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "code");
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: WakeflowMaintenancePublicCoordinatorErrorReason,
  cause?: unknown,
): never {
  throw new WakeflowMaintenancePublicCoordinatorError(
    reason,
    errorCode(cause),
    cause instanceof WakeflowMaintenanceExecutionTransactionError
      ? cause.operationId
      : null,
  );
}

function assertHostFacade(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
): void {
  try {
    const current = parseWakeflowWorkspaceHostResourceProfile(
      facade.currentHostProfile,
    );
    if (
      current.hostId !== facade.hostId
      || facade.hostProfiles.length !== 2
      || !facade.hostProfiles.some((entry) => entry.hostId === facade.hostId)
      || typeof facade.preview !== "function"
      || typeof facade.apply !== "function"
      || typeof facade.recover !== "function"
    ) {
      fail("host");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenancePublicCoordinatorError) throw error;
    fail("host", error);
  }
}

function executionRequest(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
  action: WakeflowStaticMaterializationAction,
  desiredConfig: WakeflowConfigV3Model | null,
): WakeflowStaticMaterializationPreviewRequest {
  return Object.freeze({
    action,
    desiredConfig,
    currentHostProfile: facade.currentHostProfile,
    hostProfiles: facade.hostProfiles,
  });
}

function freshCompilationView(
  compilation: Readonly<WakeflowFreshConfigCompilation> | null,
) {
  return compilation === null
    ? null
    : Object.freeze({
        selectionDigest: compilation.selectionDigest,
        configDigest: compilation.configDigest,
        allocations: compilation.allocations,
      });
}

function containsPrivatePath(
  value: JsonValue,
  privatePaths: readonly string[],
): boolean {
  if (typeof value === "string") {
    return privatePaths.some((entry) => value.includes(entry));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => (
    containsPrivatePath(entry, privatePaths)
  ));
}

function publicResult(
  value: unknown,
  privatePaths: readonly string[],
): Readonly<WakeflowMaintenancePublicResult> {
  let parsed: JsonValue;
  try {
    parsed = parseJsonValue(value, "$result");
    if (
      encodeCanonicalJson(parsed, "$result").byteLength
        > WAKEFLOW_MAINTENANCE_PUBLIC_MAXIMUM_RESULT_BYTES
      || containsPrivatePath(parsed, privatePaths)
    ) {
      fail("output");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenancePublicCoordinatorError) throw error;
    fail("output", error);
  }
  return parsed as unknown as Readonly<WakeflowMaintenancePublicResult>;
}

async function withRoot<Result>(
  rootPath: string,
  operation: (root: RootedDirectory) => Promise<Result>,
): Promise<Readonly<{ readonly result: Result; readonly canonicalRoot: string }>> {
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(rootPath, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
  const canonicalRoot = root.absolutePath;
  let result: Result | undefined;
  let failure: unknown;
  try {
    result = await operation(root);
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) fail("root", error);
  }
  if (failure !== undefined) throw failure;
  return Object.freeze({ result: result as Result, canonicalRoot });
}

async function preview(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
  request: Readonly<WakeflowMaintenancePublicPreviewRequest>,
): Promise<Readonly<WakeflowMaintenancePublicResult>> {
  let compilation: Readonly<WakeflowFreshConfigCompilation> | null = null;
  let desiredConfig: WakeflowConfigV3Model | null;
  try {
    if (request.action === "fresh-initialize") {
      compilation = compileWakeflowFreshConfigSelection(
        request.request.selection,
      );
      desiredConfig = compilation.config;
    } else if (request.action === "reconfigure") {
      desiredConfig = parseWakeflowConfigV3(request.request.desiredConfig);
    } else {
      desiredConfig = null;
    }
  } catch (error: unknown) {
    fail("preview", error);
  }
  const internalRequest = executionRequest(
    facade,
    request.action,
    desiredConfig,
  );
  let rooted;
  try {
    rooted = await withRoot(request.root, async (root) => {
      const plan = await facade.preview(root, internalRequest);
      const confirmation = plan.status === "ready"
        ? createWakeflowMaintenanceConfirmation(plan, internalRequest)
        : null;
      return Object.freeze({ plan, confirmation });
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenancePublicCoordinatorError) throw error;
    fail("preview", error);
  }
  const { plan, confirmation } = rooted.result;
  const launchIntentSet = confirmation?.launchIntentSet ?? null;
  return publicResult({
    kind: "WakeflowMaintenancePublicPreviewResult",
    schemaVersion: WAKEFLOW_MAINTENANCE_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    hostId: facade.hostId,
    mode: "preview",
    action: request.action,
    status: plan.status,
    blockerCodes: plan.blockerCodes,
    confirmation,
    confirmationDigest: confirmation?.confirmationDigest ?? null,
    freshConfigCompilation: freshCompilationView(compilation),
    launchIntents: launchIntentSet?.intents ?? [],
    launchSetDigest: launchIntentSet?.launchSetDigest ?? null,
  }, [request.root, rooted.canonicalRoot]);
}

function assertConfirmationHost(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
  confirmation: Readonly<WakeflowMaintenanceConfirmation>,
): void {
  if (
    confirmation.executionPlan.hostId !== facade.hostId
    || computeCanonicalJsonSha256Digest(
      confirmation.executionRequest.currentHostProfile,
    ) !== computeCanonicalJsonSha256Digest(facade.currentHostProfile)
    || computeCanonicalJsonSha256Digest(
      confirmation.executionRequest.hostProfiles,
    ) !== computeCanonicalJsonSha256Digest(facade.hostProfiles)
  ) {
    fail("confirmation");
  }
}

/** 使用一个由宿主 entrypoint 固定提供的 facade 执行公共 Maintenance 请求。 */
export async function executeWakeflowMaintenancePublicRequest(
  facade: Readonly<WakeflowMaintenancePublicHostFacade>,
  value: unknown,
): Promise<Readonly<WakeflowMaintenancePublicResult>> {
  assertHostFacade(facade);
  const request = parseWakeflowMaintenancePublicRequest(value);
  if (request.mode === "preview") return preview(facade, request);

  if (request.mode === "apply") {
    let confirmation: Readonly<WakeflowMaintenanceConfirmation>;
    try {
      confirmation = parseWakeflowMaintenanceConfirmation(
        request.confirmation,
      );
      if (
        confirmation.confirmationDigest !== request.confirmationDigest
        || canonicalizeJson(confirmation) !== canonicalizeJson(
          request.confirmation,
        )
      ) {
        fail("confirmation");
      }
      assertConfirmationHost(facade, confirmation);
    } catch (error: unknown) {
      if (
        error instanceof WakeflowMaintenancePublicCoordinatorError
      ) throw error;
      fail("confirmation", error);
    }
    let rooted;
    try {
      rooted = await withRoot(request.root, (root) => facade.apply(
        root,
        confirmation.executionPlan,
        confirmation.executionRequest,
      ));
    } catch (error: unknown) {
      if (error instanceof WakeflowMaintenancePublicCoordinatorError) throw error;
      fail("apply", error);
    }
    const launchIntentSet = confirmation.launchIntentSet;
    return publicResult({
      kind: "WakeflowMaintenancePublicMutationResult",
      schemaVersion: WAKEFLOW_MAINTENANCE_PUBLIC_SCHEMA_VERSION,
      tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
      hostId: facade.hostId,
      mode: "apply",
      action: confirmation.action,
      status: rooted.result.status,
      operationId: rooted.result.operationId,
      planDigest: rooted.result.planDigest,
      stepReceipts: rooted.result.stepReceipts,
      confirmationDigest: confirmation.confirmationDigest,
      launchIntents: launchIntentSet?.intents ?? [],
      launchSetDigest: launchIntentSet?.launchSetDigest ?? null,
    }, [request.root, rooted.canonicalRoot]);
  }

  let rooted;
  try {
    rooted = await withRoot(request.root, (root) => (
      facade.recover(root, request.operationId)
    ));
  } catch (error: unknown) {
    if (error instanceof WakeflowMaintenancePublicCoordinatorError) throw error;
    fail("recover", error);
  }
  return publicResult({
    kind: "WakeflowMaintenancePublicMutationResult",
    schemaVersion: WAKEFLOW_MAINTENANCE_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    hostId: facade.hostId,
    mode: "recover",
    action: null,
    status: rooted.result.status,
    operationId: rooted.result.operationId,
    planDigest: rooted.result.planDigest,
    stepReceipts: rooted.result.stepReceipts,
    confirmationDigest: null,
    launchIntents: [],
    launchSetDigest: null,
  }, [request.root, rooted.canonicalRoot]);
}
