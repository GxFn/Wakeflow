import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { UuidV4Factory } from "../../foundation/identity/uuid-v4.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import type {
  WakeflowWindowHostBinding,
} from "./wakeflow-window-host-binding.js";
import {
  compileWakeflowWindowHostBindingRegistrationAuthority,
  WakeflowWindowHostBindingRegistrationAuthorityError,
  type RegisterWakeflowWindowHostBindingRequest,
  type WakeflowWindowHostBindingRegistrationAuthority,
} from "./wakeflow-window-host-binding-registration-authority.js";
import {
  createWakeflowWindowHostBindingInStore,
  withWakeflowWindowHostBindingStore,
  WakeflowWindowHostBindingStoreError,
  type WakeflowWindowHostBindingInventory,
  type WakeflowWindowHostBindingStoreOptions,
} from "./wakeflow-window-host-binding-store.js";
import type { WakeflowWindowHostBindingId } from "./wakeflow-window-host-binding-id.js";
import {
  publishWakeflowWindowRuntimeRegisteredProjection,
  WakeflowWindowRuntimeRegisteredProjectionPublicationError,
} from "./wakeflow-window-runtime-registered-projection-publication.js";
import type {
  WakeflowWindowRuntimeRegisteredProjectionEntry,
} from "./wakeflow-window-runtime-registered-projection.js";

/**
 * Wakeflow Workspace / Window Runtime：首次 Window Host Binding 注册编排。
 *
 * 本层只决定相同注册身份重放、window/handle冲突、Binding commit后的projection
 * 前向发布与公共 receipt。纯 authority、私有 store 和派生 projection 各由相邻模块
 * 独立拥有；这里不实现 replace、decommission、Lease、Delivery 或任何宿主效果。
 */

export interface RegisterWakeflowWindowHostBindingOptions
  extends WakeflowWindowHostBindingStoreOptions {
  readonly uuidFactory?: UuidV4Factory;
  readonly wallClock?: UtcWallClock;
  readonly signal?: AbortSignal;
  readonly acquireTimeoutMilliseconds?: number;
}

interface WakeflowWindowHostBindingRegistrationReceipt {
  readonly hostId: WakeflowWindowHostBinding["hostId"];
  readonly windowId: WakeflowDurableId<"window">;
  readonly disposition: "registered" | "replayed";
  readonly binding: Readonly<{
    readonly bindingId: WakeflowWindowHostBindingId;
    readonly bindingRef: PortableResourcePath;
    readonly registeredAt: UtcInstant;
    readonly source: WakeflowWindowHostBinding["source"];
  }>;
  readonly projection: Readonly<{
    readonly resourceRef: PortableResourcePath;
    readonly projectionDigest: Sha256Digest;
    readonly documentDigest: Sha256Digest;
  }>;
}

type WakeflowWindowHostBindingRegistrationErrorReason =
  | "input"
  | "profile"
  | "handle"
  | "launch-intent"
  | "resource"
  | "layout"
  | "inventory"
  | "binding-conflict"
  | "handle-conflict"
  | "lock"
  | "recovery-required"
  | "aborted"
  | "time"
  | "binding-id"
  | "binding-write"
  | "projection-conflict"
  | "projection-recovery-required";

const ERROR_MESSAGES = {
  input: "Window Host Binding registration input is invalid.",
  profile: "Window Host Binding registration profiles are inconsistent.",
  handle: "Agent host result contains an invalid current-host handle.",
  "launch-intent": "Agent host result does not match a current launch intent.",
  resource: "Window Host Binding registration resource catalog is inconsistent.",
  layout: "Window Host Binding private layout is unavailable or unsafe.",
  inventory: "Window Host Binding inventory is invalid or changed.",
  "binding-conflict": "Window already has a different current host binding.",
  "handle-conflict": "Host handle is already bound to another logical window.",
  lock: "Window Host Binding registration lock could not be acquired safely.",
  "recovery-required": "Window Host Binding registration requires explicit recovery.",
  aborted: "Window Host Binding registration was aborted.",
  time: "Window Host Binding registration clock is inconsistent with its observation.",
  "binding-id": "Window Host Binding generation ID could not be allocated safely.",
  "binding-write": "Window Host Binding authority could not be published safely.",
  "projection-conflict": "Window Runtime projection is not an admitted source.",
  "projection-recovery-required": "Binding authority is current but its projection requires recovery.",
} as const satisfies Readonly<Record<
  WakeflowWindowHostBindingRegistrationErrorReason,
  string
>>;

/** Registration 失败的稳定错误，并显式标记 Binding authority 是否已经存在。 */
export class WakeflowWindowHostBindingRegistrationError extends Error {
  override readonly name = "WakeflowWindowHostBindingRegistrationError";
  readonly code = "wakeflow-window-host-binding-registration" as const;
  readonly reason: WakeflowWindowHostBindingRegistrationErrorReason;
  readonly path: string;
  readonly bindingAuthority: "unchanged" | "current" | "unknown";

  constructor(
    reason: WakeflowWindowHostBindingRegistrationErrorReason,
    path: string,
    bindingAuthority: "unchanged" | "current" | "unknown" = "unchanged",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
    this.bindingAuthority = bindingAuthority;
  }
}

function fail(
  reason: WakeflowWindowHostBindingRegistrationErrorReason,
  path: string,
  bindingAuthority: "unchanged" | "current" | "unknown" = "unchanged",
): never {
  throw new WakeflowWindowHostBindingRegistrationError(
    reason,
    path,
    bindingAuthority,
  );
}

function mapAuthorityError(
  error: WakeflowWindowHostBindingRegistrationAuthorityError,
): never {
  if (error.reason === "profile") fail("profile", error.path);
  if (error.reason === "handle") fail("handle", error.path);
  if (error.reason === "time") fail("time", error.path);
  if (error.reason === "launch-intent") fail("launch-intent", error.path);
  fail("resource", error.path);
}

function mapStoreError(
  error: WakeflowWindowHostBindingStoreError,
  bindingAuthority: "unchanged" | "current" | "unknown",
): never {
  if (bindingAuthority === "current") {
    fail("recovery-required", error.path, "current");
  }
  if (bindingAuthority === "unknown" || error.bindingAuthority === "unknown") {
    fail("recovery-required", error.path, "unknown");
  }
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "layout") fail("layout", error.path);
  if (error.reason === "inventory") fail("inventory", error.path);
  if (error.reason === "lock") fail("lock", error.path);
  if (error.reason === "recovery-required") {
    fail("recovery-required", error.path);
  }
  if (error.reason === "aborted") fail("aborted", error.path);
  if (error.reason === "time") fail("time", error.path);
  if (error.reason === "binding-id") {
    fail("binding-id", error.path);
  }
  fail("binding-write", error.path);
}

function sameRegistrationIdentity(
  binding: Readonly<WakeflowWindowHostBinding>,
  authority: Readonly<WakeflowWindowHostBindingRegistrationAuthority>,
): boolean {
  return binding.handle.kind === authority.handle.kind
    && binding.handle.value === authority.handle.value
    && binding.source.launchIntentDigest === authority.launchIntentDigest;
}

function assertHandleAvailable(
  inventory: Readonly<WakeflowWindowHostBindingInventory>,
  authority: Readonly<WakeflowWindowHostBindingRegistrationAuthority>,
): void {
  if (inventory.bindings.some((binding) => (
    binding.windowId !== authority.windowId
    && binding.handle.kind === authority.handle.kind
    && binding.handle.value === authority.handle.value
  ))) {
    fail("handle-conflict", "$observation.handle");
  }
}

function receipt(
  authority: Readonly<WakeflowWindowHostBindingRegistrationAuthority>,
  disposition: "registered" | "replayed",
  binding: Readonly<WakeflowWindowHostBinding>,
  projection: Readonly<WakeflowWindowRuntimeRegisteredProjectionEntry>,
): Readonly<WakeflowWindowHostBindingRegistrationReceipt> {
  return Object.freeze({
    hostId: binding.hostId,
    windowId: binding.windowId,
    disposition,
    binding: Object.freeze({
      bindingId: binding.bindingId,
      bindingRef: authority.bindingRef,
      registeredAt: binding.registeredAt,
      source: binding.source,
    }),
    projection: Object.freeze({
      resourceRef: projection.resourceRef,
      projectionDigest: projection.projection.projectionDigest,
      documentDigest: projection.documentDigest,
    }),
  });
}

function mapProjectionError(
  error: WakeflowWindowRuntimeRegisteredProjectionPublicationError,
): never {
  if (error.reason === "conflict") {
    fail("projection-conflict", error.path, "current");
  }
  if (error.reason === "aborted") {
    fail("aborted", error.path, "current");
  }
  fail("projection-recovery-required", error.path, "current");
}

/** 注册一个 Agent-observed 当前宿主身份，并同步重建其脱敏 runtime projection。 */
export async function registerWakeflowWindowHostBinding(
  root: RootedDirectory,
  request: Readonly<RegisterWakeflowWindowHostBindingRequest>,
  options: RegisterWakeflowWindowHostBindingOptions = {},
): Promise<Readonly<WakeflowWindowHostBindingRegistrationReceipt>> {
  if (
    typeof root !== "object"
    || root === null
    || types.isProxy(root)
    || !(root instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  let authority: Readonly<WakeflowWindowHostBindingRegistrationAuthority>;
  try {
    authority = compileWakeflowWindowHostBindingRegistrationAuthority(request);
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingRegistrationAuthorityError) {
      mapAuthorityError(error);
    }
    throw error;
  }

  let bindingAuthority: "unchanged" | "current" | "unknown" = "unchanged";
  try {
    return await withWakeflowWindowHostBindingStore(
      root,
      authority,
      options,
      async (context) => {
        const current = context.inventory.bindings.find((binding) => (
          binding.windowId === authority.windowId
        ));
        let binding: Readonly<WakeflowWindowHostBinding>;
        let disposition: "registered" | "replayed";
        if (current !== undefined) {
          if (!sameRegistrationIdentity(current, authority)) {
            fail("binding-conflict", "$observation", "current");
          }
          binding = current;
          disposition = "replayed";
        } else {
          assertHandleAvailable(context.inventory, authority);
          binding = await createWakeflowWindowHostBindingInStore(
            root,
            authority,
            context,
          );
          disposition = "registered";
        }
        bindingAuthority = "current";
        let projection: Readonly<WakeflowWindowRuntimeRegisteredProjectionEntry>;
        try {
          projection = await publishWakeflowWindowRuntimeRegisteredProjection(
            root,
            authority,
            binding,
            context.signal,
          );
        } catch (error: unknown) {
          if (
            error instanceof
              WakeflowWindowRuntimeRegisteredProjectionPublicationError
          ) {
            mapProjectionError(error);
          }
          fail("projection-recovery-required", "$projection", "current");
        }
        return receipt(authority, disposition, binding, projection);
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingRegistrationError) throw error;
    if (error instanceof WakeflowWindowHostBindingStoreError) {
      mapStoreError(error, bindingAuthority);
    }
    fail("binding-write", "$registration", bindingAuthority);
  }
}
