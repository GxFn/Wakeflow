import { types } from "node:util";

import {
  parseWakeflowConfig,
  WakeflowConfigError,
  type WakeflowConfigModel,
} from "../../configuration/wakeflow-config.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { isWakeflowError } from "../../kernel/error.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  type WakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
} from "../workspace-host-resource-profile.js";
import type { WakeflowWindowHostBinding } from "./wakeflow-window-host-binding.js";
import {
  inspectWakeflowWindowHostBindingInventory,
  WakeflowWindowHostBindingStoreError,
} from "./wakeflow-window-host-binding-store.js";
import {
  compileWakeflowWindowHostBindingStoreAuthority,
  WakeflowWindowHostBindingStoreAuthorityError,
} from "./wakeflow-window-host-binding-store-authority.js";
import {
  parseWakeflowWindowHostIdentityProfile,
  type WakeflowWindowHostIdentityProfile,
  WakeflowWindowHostIdentityProfileError,
} from "./wakeflow-window-host-identity-profile.js";
import {
  inspectWakeflowWindowRuntimeProjectionDocument,
  type WakeflowWindowRuntimeProjectionDocumentTarget,
} from "./wakeflow-window-runtime-projection-document.js";
import { compileWakeflowWindowRuntimeRegisteredProjectionEntry } from "./wakeflow-window-runtime-registered-projection.js";
import {
  compileWakeflowWindowRuntimeUnregisteredProjectionSet,
  WakeflowWindowRuntimeUnregisteredProjectionError,
} from "./wakeflow-window-runtime-unregistered-projection.js";

/**
 * Wakeflow Workspace / Window Runtime：窗口运行投影的零写入观察缝。
 *
 * 每个配置窗口的期望文档由当前 Config 与该宿主的 Binding inventory 重算：有 Binding 的窗口是
 * registered 投影，否则是 unregistered 投影；磁盘文档与期望比对得 current / stale / missing /
 * unsafe。对账（G5，`wakeflow-window-runtime-projection-maintenance.ts`）与观察（G6，
 * `wakeflow_status` / `wakeflow_verify`）共用这一份判定，所以它是 Governance 可取得的 Workspace
 * 合同缝之一，本身不写任何东西。宿主运行时根未发布或 Binding inventory 读不出时整组不可观察。
 */

export type WakeflowWindowRuntimeProjectionErrorReason =
  | "input"
  | "profile"
  | "topology"
  | "plan"
  | "aborted"
  | "effect";

const ERROR_MESSAGES = {
  input: "Wakeflow window runtime projection input is invalid.",
  profile: "Wakeflow window runtime projection host profile is invalid.",
  topology: "Wakeflow window runtime projection topology is invalid.",
  plan: "Wakeflow window runtime projection operation no longer matches the current authority.",
  aborted: "Wakeflow window runtime projection work was aborted.",
  effect: "Wakeflow window runtime projection could not be published safely.",
} as const satisfies Readonly<Record<WakeflowWindowRuntimeProjectionErrorReason, string>>;

/** 窗口运行投影观察与维护失败的稳定、脱敏错误。 */
export class WakeflowWindowRuntimeProjectionError extends Error {
  override readonly name = "WakeflowWindowRuntimeProjectionError";
  readonly code = "wakeflow-window-runtime-projection" as const;
  readonly reason: WakeflowWindowRuntimeProjectionErrorReason;
  readonly path: string;

  constructor(reason: WakeflowWindowRuntimeProjectionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export function failWindowRuntimeProjection(
  reason: WakeflowWindowRuntimeProjectionErrorReason,
  path: string,
): never {
  throw new WakeflowWindowRuntimeProjectionError(reason, path);
}

export interface WakeflowWindowRuntimeProjectionInputs {
  readonly config: WakeflowConfigModel;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly identityProfile: Readonly<WakeflowWindowHostIdentityProfile>;
}

export interface WakeflowWindowRuntimeProjectionExpectedEntry {
  readonly windowId: string;
  readonly registered: boolean;
  readonly target: Readonly<WakeflowWindowRuntimeProjectionDocumentTarget>;
}

export type WakeflowWindowRuntimeProjectionExpectedEntries =
  | Readonly<{
      readonly kind: "entries";
      readonly entries: readonly Readonly<WakeflowWindowRuntimeProjectionExpectedEntry>[];
    }>
  | Readonly<{ readonly kind: "runtime-missing" }>
  | Readonly<{ readonly kind: "inventory-unavailable" }>;

export type WakeflowWindowRuntimeProjectionStatus = "current" | "stale" | "missing" | "unsafe";

export interface WakeflowWindowRuntimeProjectionInspectedEntry {
  readonly entry: Readonly<WakeflowWindowRuntimeProjectionExpectedEntry>;
  readonly status: WakeflowWindowRuntimeProjectionStatus;
  readonly currentDigest: Sha256Digest | null;
}

export interface InspectWakeflowWindowRuntimeProjectionSetRequest {
  readonly config: unknown;
  readonly resourceProfile: unknown;
  readonly identityProfile: unknown;
  readonly signal?: AbortSignal;
}

export interface WakeflowWindowRuntimeProjectionWindowInspection {
  readonly windowId: string;
  readonly registered: boolean;
  readonly resourceRef: PortableResourcePath;
  readonly status: WakeflowWindowRuntimeProjectionStatus;
}

/** 一个宿主的全部窗口运行投影：宿主运行时根未发布或 Binding inventory 读不出时整组不可观察。 */
export type WakeflowWindowRuntimeProjectionSetInspection =
  | Readonly<{
      readonly status: "observed";
      readonly windows: readonly Readonly<WakeflowWindowRuntimeProjectionWindowInspection>[];
    }>
  | Readonly<{ readonly status: "runtime-missing" }>
  | Readonly<{ readonly status: "inventory-unavailable" }>;

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    failWindowRuntimeProjection("input", "$root");
  }
}

/** 准入根与三份输入：Config 与两份宿主 profile 都重新解析，且两份 profile 必须是同一宿主。 */
export function admitWakeflowWindowRuntimeProjectionInputs(
  rootValue: unknown,
  configValue: unknown,
  resourceProfileValue: unknown,
  identityProfileValue: unknown,
): WakeflowWindowRuntimeProjectionInputs {
  assertRoot(rootValue);
  let config: WakeflowConfigModel;
  try {
    config = parseWakeflowConfig(configValue);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigError) failWindowRuntimeProjection("input", error.path);
    throw error;
  }
  try {
    const resourceProfile = parseWakeflowWorkspaceHostResourceProfile(resourceProfileValue);
    const identityProfile = parseWakeflowWindowHostIdentityProfile(identityProfileValue);
    if (resourceProfile.hostId !== identityProfile.hostId) {
      failWindowRuntimeProjection("profile", "$profiles");
    }
    return Object.freeze({ config, resourceProfile, identityProfile });
  } catch (error: unknown) {
    if (
      error instanceof WakeflowWorkspaceHostResourceProfileError
      || error instanceof WakeflowWindowHostIdentityProfileError
    ) {
      failWindowRuntimeProjection("profile", error.path);
    }
    throw error;
  }
}

async function resourcePresent(
  root: RootedDirectory,
  resourceRef: PortableResourcePath,
  path: string,
): Promise<boolean> {
  try {
    await root.inspectExistingResource(resourceRef, path);
    return true;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      if (error.reason === "resource-not-found") return false;
      failWindowRuntimeProjection("input", "$root");
    }
    throw error;
  }
}

export interface ResolveWakeflowWindowRuntimeProjectionExpectedEntriesOptions {
  /**
   * 投影根未发布时默认整组 `runtime-missing`；对账在同一事务里先补目录骨架再逐窗口重建时
   * 传 false，把根缺失当成每份文档缺失（§13.114 D2）。
   */
  readonly projectionRootRequired?: boolean;
}

/** 每个配置窗口的期望文档：有 Binding 即 registered，否则 unregistered；尚无 Binding 目录的宿主只有未登记投影。 */
export async function resolveWakeflowWindowRuntimeProjectionExpectedEntries(
  root: RootedDirectory,
  inputs: WakeflowWindowRuntimeProjectionInputs,
  signal: AbortSignal | undefined,
  options: ResolveWakeflowWindowRuntimeProjectionExpectedEntriesOptions = {},
): Promise<WakeflowWindowRuntimeProjectionExpectedEntries> {
  const { config, resourceProfile, identityProfile } = inputs;
  let unregistered;
  let authority;
  try {
    unregistered = compileWakeflowWindowRuntimeUnregisteredProjectionSet(config, resourceProfile);
    authority = compileWakeflowWindowHostBindingStoreAuthority(
      config,
      resourceProfile,
      identityProfile,
    );
  } catch (error: unknown) {
    if (
      error instanceof WakeflowWindowRuntimeUnregisteredProjectionError
      || error instanceof WakeflowWindowHostBindingStoreAuthorityError
    ) {
      failWindowRuntimeProjection("topology", error.path);
    }
    throw error;
  }
  if (
    options.projectionRootRequired !== false
    && !(await resourcePresent(root, unregistered.projectionRootRef, "$projectionRoot"))
  ) {
    return Object.freeze({ kind: "runtime-missing" as const });
  }
  let inventory: Readonly<{ readonly bindings: readonly Readonly<WakeflowWindowHostBinding>[] }>;
  try {
    inventory = (await resourcePresent(root, authority.bindingRootRef, "$bindingRoot"))
      ? await inspectWakeflowWindowHostBindingInventory(
          root,
          authority,
          signal === undefined ? {} : { signal },
        )
      : Object.freeze({ bindings: Object.freeze([]) });
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingStoreError) {
      if (error.reason === "aborted") failWindowRuntimeProjection("aborted", "$signal");
      return Object.freeze({ kind: "inventory-unavailable" as const });
    }
    throw error;
  }
  const entries = unregistered.entries.map((entry) => {
    const binding = inventory.bindings.find((candidate) => candidate.windowId === entry.windowId);
    const compiled = binding === undefined
      ? entry
      : compileWakeflowWindowRuntimeRegisteredProjectionEntry(
          resourceProfile,
          identityProfile,
          entry.projection,
          binding,
        );
    return Object.freeze({
      windowId: entry.windowId,
      registered: binding !== undefined,
      target: Object.freeze({
        resourceRef: compiled.resourceRef,
        document: compiled.document,
        documentDigest: compiled.documentDigest,
        projectionDigest: compiled.projection.projectionDigest,
      }),
    });
  });
  return Object.freeze({ kind: "entries" as const, entries: Object.freeze(entries) });
}

/** 逐窗口比对磁盘文档与期望：current / stale / missing / unsafe，并带回当前文档摘要。 */
export async function inspectWakeflowWindowRuntimeProjectionEntries(
  root: RootedDirectory,
  entries: readonly Readonly<WakeflowWindowRuntimeProjectionExpectedEntry>[],
  signal: AbortSignal | undefined,
): Promise<readonly Readonly<WakeflowWindowRuntimeProjectionInspectedEntry>[]> {
  const inspected: Readonly<WakeflowWindowRuntimeProjectionInspectedEntry>[] = [];
  for (const entry of entries) {
    let inspection;
    try {
      inspection = await inspectWakeflowWindowRuntimeProjectionDocument(root, entry.target, signal);
    } catch (error: unknown) {
      if (isWakeflowError(error) && error.reason === "aborted") {
        failWindowRuntimeProjection("aborted", "$signal");
      }
      throw error;
    }
    inspected.push(
      Object.freeze({ entry, status: inspection.status, currentDigest: inspection.currentDigest }),
    );
  }
  return Object.freeze(inspected);
}

/** 零写入观察：每个配置窗口的投影与当前 Config 加 Binding 的重算比对（G6，§13.111）。 */
export async function inspectWakeflowWindowRuntimeProjectionSet(
  rootValue: RootedDirectory,
  request: InspectWakeflowWindowRuntimeProjectionSetRequest,
): Promise<WakeflowWindowRuntimeProjectionSetInspection> {
  if (request.signal?.aborted === true) failWindowRuntimeProjection("aborted", "$signal");
  const inputs = admitWakeflowWindowRuntimeProjectionInputs(
    rootValue,
    request.config,
    request.resourceProfile,
    request.identityProfile,
  );
  const expected = await resolveWakeflowWindowRuntimeProjectionExpectedEntries(
    rootValue,
    inputs,
    request.signal,
  );
  if (expected.kind !== "entries") return Object.freeze({ status: expected.kind });
  const inspected = await inspectWakeflowWindowRuntimeProjectionEntries(
    rootValue,
    expected.entries,
    request.signal,
  );
  return Object.freeze({
    status: "observed" as const,
    windows: Object.freeze(
      inspected.map((item) =>
        Object.freeze({
          windowId: item.entry.windowId,
          registered: item.entry.registered,
          resourceRef: item.entry.target.resourceRef,
          status: item.status,
        }),
      ),
    ),
  });
}
