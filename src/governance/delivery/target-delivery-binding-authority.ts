import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { WakeflowConfigV3Model } from "../../configuration/wakeflow-config-v3.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";
import type { WakeflowWindowHostBinding } from "../../workspace/window-runtime/wakeflow-window-host-binding.js";
import {
  inspectWakeflowWindowHostBindingInventory,
  WakeflowWindowHostBindingStoreError,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import {
  compileWakeflowWindowHostBindingStoreAuthority,
  WakeflowWindowHostBindingStoreAuthorityError,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import type { WakeflowWindowHostIdentityProfile } from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import type { TargetDeliveryIntent } from "./target-delivery-intent.js";

/** Target Delivery Intent 路由与当前私有 Binding inventory 的窄组合准入。 */

export type TargetDeliveryBindingAuthorityErrorReason = "binding" | "aborted";

const ERROR_MESSAGES = {
  binding: "Target Delivery current Binding authority is invalid.",
  aborted: "Target Delivery current Binding loading was aborted.",
} as const satisfies Readonly<
  Record<TargetDeliveryBindingAuthorityErrorReason, string>
>;

export class TargetDeliveryBindingAuthorityError extends Error {
  override readonly name = "TargetDeliveryBindingAuthorityError";
  readonly code = "wakeflow-target-delivery-binding-authority" as const;
  readonly reason: TargetDeliveryBindingAuthorityErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: TargetDeliveryBindingAuthorityErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: TargetDeliveryBindingAuthorityErrorReason,
  cause?: unknown,
): never {
  throw new TargetDeliveryBindingAuthorityError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

/** 零写入加载一个已配置窗口的当前唯一私有Binding。 */
export async function loadCurrentDeliveryWindowBinding(
  workspaceRoot: RootedDirectory,
  config: Readonly<WakeflowConfigV3Model>,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
  windowId: WakeflowDurableId<"window">,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowWindowHostBinding>> {
  try {
    const authority = compileWakeflowWindowHostBindingStoreAuthority(
      config,
      resourceProfile,
      identityProfile,
    );
    const inventory = await inspectWakeflowWindowHostBindingInventory(
      workspaceRoot,
      authority,
      signal === undefined ? {} : { signal },
    );
    const matches = inventory.bindings.filter(
      (entry) => entry.windowId === windowId,
    );
    if (matches.length !== 1 || matches[0] === undefined) fail("binding");
    return matches[0];
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryBindingAuthorityError) throw error;
    if (
      error instanceof WakeflowWindowHostBindingStoreAuthorityError ||
      error instanceof WakeflowWindowHostBindingStoreError
    ) {
      if (
        error instanceof WakeflowWindowHostBindingStoreError &&
        error.reason === "aborted"
      ) {
        fail("aborted", error);
      }
      fail("binding", error);
    }
    throw error;
  }
}

/** 零写入复验Intent路由仍绑定该窗口当前私有Binding。 */
export async function loadCurrentTargetDeliveryBinding(
  workspaceRoot: RootedDirectory,
  config: Readonly<WakeflowConfigV3Model>,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
  intent: Readonly<TargetDeliveryIntent>,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowWindowHostBinding>> {
  const binding = await loadCurrentDeliveryWindowBinding(
    workspaceRoot,
    config,
    resourceProfile,
    identityProfile,
    intent.route.windowId,
    signal,
  );
  if (
    binding.bindingId !== intent.route.bindingId ||
    binding.hostId !== intent.route.hostId
  ) {
    fail("binding");
  }
  return binding;
}
