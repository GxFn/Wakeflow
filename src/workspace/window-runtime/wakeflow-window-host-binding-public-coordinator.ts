import {
  WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA,
  type WakeflowWindowHostBindingRegistrationResultV1 as RegistrationResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-window-host-binding-registration-result.generated.js";
import {
  WAKEFLOW_SHA256_DIGEST_SCHEMA,
} from "../../contracts/generated/foundation/sha256-digest.generated.js";
import {
  WAKEFLOW_UTC_INSTANT_SCHEMA,
} from "../../contracts/generated/foundation/utc-instant.generated.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parseJsonValue,
  JsonValueError,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import type { WakeflowDurableId } from "../../foundation/identity/wakeflow-durable-id.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  registerWakeflowWindowHostBinding,
  WakeflowWindowHostBindingRegistrationError,
  type RegisterWakeflowWindowHostBindingOptions,
} from "./wakeflow-window-host-binding-registration.js";
import type { WakeflowWindowHostBindingId } from "./wakeflow-window-host-binding-id.js";
import {
  parseWakeflowWindowHostIdentityProfile,
  WakeflowWindowHostIdentityProfileError,
  type WakeflowWindowHostIdentityProfile,
} from "./wakeflow-window-host-identity-profile.js";
import {
  parseWakeflowWindowHostBindingPublicRequest,
  WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
} from "./wakeflow-window-host-binding-public-contract.js";

/**
 * Wakeflow Workspace / Window Runtime：公共 Binding registration 的唯一编排边界。
 *
 * composition root 固定当前 Host 的 Resource Profile 与 Identity Profile。协调器打开
 * workspace、读取当前 Config authority，并把已准入 Agent observation 交给 Binding
 * owner；它不调用宿主工具，也不读取或返回 raw handle。
 */

export interface WakeflowWindowHostBindingPublicHostFacade {
  readonly hostId: WakeflowWorkspaceHostId;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}

export interface WakeflowWindowHostBindingPublicResult {
  readonly kind: "WakeflowWindowHostBindingRegistrationResult";
  readonly schemaVersion:
    typeof WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_SCHEMA_VERSION;
  readonly tool: typeof WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly windowId: WakeflowDurableId<"window">;
  readonly disposition: "registered" | "replayed";
  readonly binding: Readonly<{
    readonly bindingId: WakeflowWindowHostBindingId;
    readonly bindingRef: PortableResourcePath;
    readonly bindingDigest: Sha256Digest;
    readonly registeredAt: UtcInstant;
    readonly source: Readonly<{
      readonly kind: "agent-host-create-result";
      readonly launchIntentDigest: Sha256Digest;
      readonly observedAt: UtcInstant;
    }>;
  }>;
  readonly projection: Readonly<{
    readonly resourceRef: PortableResourcePath;
    readonly projectionDigest: Sha256Digest;
    readonly documentDigest: Sha256Digest;
  }>;
}

export type WakeflowWindowHostBindingPublicCoordinatorErrorReason =
  | "host"
  | "root"
  | "config"
  | "registration"
  | "output";

const ERROR_MESSAGES = {
  host: "Window Host Binding public host composition is invalid.",
  root: "Window Host Binding public workspace root is invalid.",
  config: "Window Host Binding public Config authority could not be loaded.",
  registration: "Window Host Binding public registration failed.",
  output: "Window Host Binding public result violated its redacted boundary.",
} as const satisfies Readonly<Record<
  WakeflowWindowHostBindingPublicCoordinatorErrorReason,
  string
>>;

/** 公共 Binding 编排失败的稳定、脱敏错误。 */
export class WakeflowWindowHostBindingPublicCoordinatorError extends Error {
  override readonly name = "WakeflowWindowHostBindingPublicCoordinatorError";
  readonly code = "wakeflow-window-host-binding-public-coordinator" as const;
  readonly reason: WakeflowWindowHostBindingPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly bindingAuthority: "unchanged" | "current" | "unknown";

  constructor(
    reason: WakeflowWindowHostBindingPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    bindingAuthority: "unchanged" | "current" | "unknown" = "unchanged",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.bindingAuthority = bindingAuthority;
  }
}

const validateResultWire = createRuntimeJsonSchemaValidator<RegistrationResultWire>(
  WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA,
  [WAKEFLOW_SHA256_DIGEST_SCHEMA, WAKEFLOW_UTC_INSTANT_SCHEMA],
);

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: WakeflowWindowHostBindingPublicCoordinatorErrorReason,
  cause?: unknown,
): never {
  throw new WakeflowWindowHostBindingPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    cause instanceof WakeflowWindowHostBindingRegistrationError
      ? cause.bindingAuthority
      : "unchanged",
  );
}

function assertFacade(
  facade: Readonly<WakeflowWindowHostBindingPublicHostFacade>,
): Readonly<{
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}> {
  try {
    const resourceProfile = parseWakeflowWorkspaceHostResourceProfile(
      facade.resourceProfile,
    );
    const identityProfile = parseWakeflowWindowHostIdentityProfile(
      facade.identityProfile,
    );
    if (
      facade.hostId !== resourceProfile.hostId
      || facade.hostId !== identityProfile.hostId
      || !resourceProfile.surfaces.windowIdentity
    ) {
      fail("host");
    }
    return Object.freeze({ resourceProfile, identityProfile });
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingPublicCoordinatorError) {
      throw error;
    }
    if (
      error instanceof WakeflowWorkspaceHostResourceProfileError
      || error instanceof WakeflowWindowHostIdentityProfileError
    ) {
      fail("host", error);
    }
    throw error;
  }
}

function containsExactPrivateText(
  value: JsonValue,
  privateValues: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") return privateValues.has(value);
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => (
    containsExactPrivateText(entry, privateValues)
  ));
}

function publicResult(
  value: unknown,
  privateValues: ReadonlySet<string>,
): Readonly<WakeflowWindowHostBindingPublicResult> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("output", error);
    throw error;
  }
  const validated = validateResultWire(json);
  if (!validated.ok || containsExactPrivateText(json, privateValues)) {
    fail("output");
  }
  return json as unknown as Readonly<WakeflowWindowHostBindingPublicResult>;
}

/** 执行一次固定当前宿主、结果脱敏的 Window Host Binding registration。 */
export async function executeWakeflowWindowHostBindingPublicRequest(
  facade: Readonly<WakeflowWindowHostBindingPublicHostFacade>,
  value: unknown,
  options: RegisterWakeflowWindowHostBindingOptions = {},
): Promise<Readonly<WakeflowWindowHostBindingPublicResult>> {
  const profiles = assertFacade(facade);
  const request = parseWakeflowWindowHostBindingPublicRequest(value);
  if (request.observation.hostId !== facade.hostId) fail("host");

  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
  const canonicalRoot = root.absolutePath;
  let result: Readonly<WakeflowWindowHostBindingPublicResult> | undefined;
  let failure: unknown;
  try {
    let config;
    try {
      config = await readWakeflowConfigAuthoritySnapshot(root);
    } catch (error: unknown) {
      if (error instanceof WakeflowConfigAuthoritySnapshotError) {
        fail("config", error);
      }
      throw error;
    }
    let registered;
    try {
      registered = await registerWakeflowWindowHostBinding(
        root,
        {
          config: config.model,
          resourceProfile: profiles.resourceProfile,
          identityProfile: profiles.identityProfile,
          observation: request.observation,
        },
        options,
      );
    } catch (error: unknown) {
      if (error instanceof WakeflowWindowHostBindingRegistrationError) {
        fail("registration", error);
      }
      throw error;
    }
    result = publicResult({
      kind: "WakeflowWindowHostBindingRegistrationResult",
      schemaVersion: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_SCHEMA_VERSION,
      tool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      hostId: registered.hostId,
      windowId: registered.windowId,
      disposition: registered.disposition,
      binding: registered.binding,
      projection: registered.projection,
    }, new Set([request.root, canonicalRoot]));
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) fail("root", error);
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output");
  return result;
}
