import { types } from "node:util";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "../../configuration/wakeflow-config-root-placement.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  materializeAbsoluteDirectoryPlacement,
  AbsoluteDirectoryMaterializationError,
} from "../../foundation/filesystem/absolute-directory-materialization.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../foundation/identity/wakeflow-durable-id.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import {
  createWakeflowManagedSupportResourceCatalog,
} from "./wakeflow-managed-support-resource-catalog.js";

/**
 * Wakeflow Workspace / Support：单个受管 Support 根目录的机械物化 owner。
 *
 * 本模块把 Config 根位置报告、动态 Support Resource Catalog 与 Foundation 绝对目录
 * 物化组合起来。它只确保调用方明确选择的 wakeflow-managed surface 根以 `0755` 存在，
 * 已有目录不改权限；不创建 memory、draft/harness/fixture，不删除旧路径，也不判断
 * fresh/reconfigure 的高层 footprint 政策。
 *
 * 调用方仍须通过未来 maintenance confirmed plan 决定是否允许创建或接受已存在根；
 * 本 owner 的职责只是绑定摘要并执行一个可重试的机械目录效果。
 */

export const WAKEFLOW_MANAGED_SUPPORT_ROOT_MODE = 0o755;

export interface WakeflowManagedSupportRootMaterializationRequest {
  readonly config: unknown;
  readonly expectedConfigDigest: Sha256Digest;
  readonly profile: unknown;
  readonly expectedCatalogDigest: Sha256Digest;
  readonly surfaceId: unknown;
  readonly signal?: AbortSignal;
}

export interface WakeflowManagedSupportRootMaterializationReceipt {
  readonly kind: "WakeflowManagedSupportRootMaterializationReceipt";
  readonly disposition: "created" | "existing";
  readonly configDigest: Sha256Digest;
  readonly catalogDigest: Sha256Digest;
  readonly surfaceId: WakeflowDurableId<"surface">;
  readonly node: Readonly<FileNodeSnapshot>;
}

export type WakeflowManagedSupportRootMaterializationErrorReason =
  | "input"
  | "config"
  | "profile"
  | "catalog"
  | "surface"
  | "placement"
  | "root-policy"
  | "aborted"
  | "effect";

const ERROR_MESSAGES = {
  input: "Wakeflow managed support root materialization input is invalid.",
  config: "Wakeflow managed support root config is invalid.",
  profile: "Wakeflow managed support root host profile is invalid.",
  catalog: "Wakeflow managed support root catalog expectation is invalid.",
  surface: "Wakeflow managed support root surface is unavailable.",
  placement: "Wakeflow managed support root placement is unsafe.",
  "root-policy": "Wakeflow managed support root violates its node policy.",
  aborted: "Wakeflow managed support root materialization was aborted.",
  effect: "Wakeflow managed support root could not be materialized safely.",
} as const satisfies Readonly<Record<
  WakeflowManagedSupportRootMaterializationErrorReason,
  string
>>;

/** 受管 Support 根物化失败的稳定、脱敏错误。 */
export class WakeflowManagedSupportRootMaterializationError extends Error {
  override readonly name = "WakeflowManagedSupportRootMaterializationError";
  readonly code = "wakeflow-managed-support-root-materialization" as const;
  readonly reason: WakeflowManagedSupportRootMaterializationErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowManagedSupportRootMaterializationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedRequest {
  readonly config: WakeflowConfigV3Model;
  readonly configDigest: Sha256Digest;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly catalogDigest: Sha256Digest;
  readonly surfaceId: WakeflowDurableId<"surface">;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: WakeflowManagedSupportRootMaterializationErrorReason,
  path: string,
): never {
  throw new WakeflowManagedSupportRootMaterializationError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", path);
    throw error;
  }
}

function parseRequest(value: unknown): Readonly<ParsedRequest> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$request");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$request");
    throw error;
  }
  const required = [
    "config",
    "expectedCatalogDigest",
    "expectedConfigDigest",
    "profile",
    "surfaceId",
  ];
  const expected = record.signal === undefined
    ? required
    : [...required, "signal"].sort();
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
    || (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    fail("input", "$request");
  }
  let config: WakeflowConfigV3Model;
  try {
    config = parseWakeflowConfigV3(record.config);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", error.path);
    throw error;
  }
  const configDigest = parseDigest(
    record.expectedConfigDigest,
    "$request.expectedConfigDigest",
  );
  if (computeWakeflowConfigV3Digest(config) !== configDigest) {
    fail("config", "$request.expectedConfigDigest");
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
  let surfaceId: WakeflowDurableId<"surface">;
  try {
    surfaceId = parseWakeflowDurableIdOfKind(
      record.surfaceId,
      "surface",
      "$request.surfaceId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("input", "$request.surfaceId");
    }
    throw error;
  }
  const catalog = createWakeflowManagedSupportResourceCatalog(config, profile);
  const catalogDigest = parseDigest(
    record.expectedCatalogDigest,
    "$request.expectedCatalogDigest",
  );
  if (catalog.catalogDigest !== catalogDigest) {
    fail("catalog", "$request.expectedCatalogDigest");
  }
  const rootDeclaration = catalog.declarations.find((entry) => (
    entry.declarationId === `support.${surfaceId}.root`
  ));
  if (rootDeclaration === undefined) fail("surface", "$request.surfaceId");
  try {
    admitWakeflowResourceOperation(
      rootDeclaration.processing,
      "materialize-directory",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("catalog", "$request.expectedCatalogDigest");
    }
    throw error;
  }
  return Object.freeze({
    config,
    configDigest,
    profile,
    catalogDigest,
    surfaceId,
    signal: record.signal as AbortSignal | undefined,
  });
}

function currentUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("root-policy", "$root");
  }
  return BigInt(process.geteuid());
}

/** 物化一个已由 Config/Catalog 摘要绑定的 wakeflow-managed support 根。 */
export async function materializeWakeflowManagedSupportRoot(
  workspaceRootValue: RootedDirectory,
  requestValue: WakeflowManagedSupportRootMaterializationRequest,
): Promise<Readonly<WakeflowManagedSupportRootMaterializationReceipt>> {
  if (
    typeof workspaceRootValue !== "object"
    || workspaceRootValue === null
    || types.isProxy(workspaceRootValue)
    || !(workspaceRootValue instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const request = parseRequest(requestValue);
  if (request.signal?.aborted === true) fail("aborted", "$signal");
  let before;
  try {
    before = await validateWakeflowConfigRootPlacements(
      workspaceRootValue,
      request.config,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      fail("placement", error.path);
    }
    throw error;
  }
  const key = `support.${request.surfaceId}.root`;
  const placement = before.roots.find((entry) => entry.key === key);
  if (placement === undefined) fail("surface", "$request.surfaceId");
  let materialized;
  try {
    materialized = await materializeAbsoluteDirectoryPlacement(
      placement.absolutePath,
      {
        mode: WAKEFLOW_MANAGED_SUPPORT_ROOT_MODE,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof AbsoluteDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (
        error.reason === "symlink"
        || error.reason === "not-directory"
        || error.reason === "alias"
        || error.reason === "scope"
        || error.reason === "path-changed"
      ) {
        fail("placement", "$root");
      }
      fail("effect", "$root");
    }
    throw error;
  }
  const expectedUserId = currentUserId();
  if (
    materialized.node.kind !== "directory"
    || materialized.node.permissionBits !== WAKEFLOW_MANAGED_SUPPORT_ROOT_MODE
    || materialized.node.userId !== expectedUserId
  ) {
    fail("root-policy", "$root");
  }
  let after;
  try {
    after = await validateWakeflowConfigRootPlacements(
      workspaceRootValue,
      request.config,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      fail("placement", error.path);
    }
    throw error;
  }
  const finalPlacement = after.roots.find((entry) => entry.key === key);
  if (
    finalPlacement?.state !== "present"
    || finalPlacement.realPath !== materialized.absolutePath
  ) {
    fail("placement", "$root");
  }
  return Object.freeze({
    kind: "WakeflowManagedSupportRootMaterializationReceipt",
    disposition: materialized.segments.some((entry) => (
      entry.disposition === "created"
    )) ? "created" : "existing",
    configDigest: request.configDigest,
    catalogDigest: request.catalogDigest,
    surfaceId: request.surfaceId,
    node: materialized.node,
  });
}
