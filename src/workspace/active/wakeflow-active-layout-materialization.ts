import { types } from "node:util";

import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  createDirectoryAtomically,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
  WAKEFLOW_ACTIVE_ROOT_REF,
} from "./wakeflow-active-paths.js";

/**
 * Wakeflow Workspace / Active：Fresh Workspace 的两级 Active Layout 物化。
 *
 * 普通执行要求 `.wakeflow-active` 严格不存在；恢复执行只接受当前用户拥有且权限为
 * `0700` 的 exact root/current 目录，并补齐尚未发生的创建效果。TODO、Demand 等领域
 * owner 从此不再隐式取得共享 `current` 容器的 ownership。
 */

export interface WakeflowActiveLayoutMaterializationOptions {
  readonly recoveringFreshLayout: boolean;
  readonly signal?: AbortSignal;
}

export interface WakeflowActiveLayoutMaterializationEntry {
  readonly resourcePath: PortableResourcePath;
  readonly disposition: "created" | "current";
  readonly node: Readonly<FileNodeSnapshot>;
}

export interface WakeflowActiveLayoutMaterializationResult {
  readonly disposition: "created" | "current";
  readonly entries:
    readonly Readonly<WakeflowActiveLayoutMaterializationEntry>[];
}

export type WakeflowActiveLayoutMaterializationErrorReason =
  | "input"
  | "strict-absent"
  | "node-policy"
  | "root-scope"
  | "aborted"
  | "materialization";

const ERROR_MESSAGES = {
  input: "Wakeflow Active layout materialization input is invalid.",
  "strict-absent": "Wakeflow fresh Active layout already exists.",
  "node-policy": "Wakeflow Active layout violates its private node policy.",
  "root-scope": "Wakeflow Active layout lost workspace root scope.",
  aborted: "Wakeflow Active layout materialization was aborted.",
  materialization: "Wakeflow Active layout could not be materialized.",
} as const satisfies Readonly<Record<
  WakeflowActiveLayoutMaterializationErrorReason,
  string
>>;

/** Active Layout 物化失败的稳定、脱敏错误。 */
export class WakeflowActiveLayoutMaterializationError extends Error {
  override readonly name = "WakeflowActiveLayoutMaterializationError";
  readonly code = "wakeflow-active-layout-materialization" as const;
  readonly reason: WakeflowActiveLayoutMaterializationErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowActiveLayoutMaterializationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly recoveringFreshLayout: boolean;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: WakeflowActiveLayoutMaterializationErrorReason,
  path: string,
): never {
  throw new WakeflowActiveLayoutMaterializationError(reason, path);
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    !Object.hasOwn(record, "recoveringFreshLayout")
    || Object.keys(record).some((key) => (
      key !== "recoveringFreshLayout" && key !== "signal"
    ))
    || typeof record.recoveringFreshLayout !== "boolean"
    || (
      record.signal !== undefined
      && (
        typeof record.signal !== "object"
        || record.signal === null
        || types.isProxy(record.signal)
        || !(record.signal instanceof AbortSignal)
      )
    )
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    recoveringFreshLayout: record.recoveringFreshLayout,
    signal: record.signal as AbortSignal | undefined,
  });
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

function assertPrivateDirectory(
  node: Readonly<FileNodeSnapshot>,
  path: string,
): void {
  if (
    node.kind !== "directory"
    || node.permissionBits !== 0o700
    || (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    fail("node-policy", path);
  }
}

async function ensureDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  recovering: boolean,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowActiveLayoutMaterializationEntry>> {
  try {
    const existing = await root.inspectExistingResource(
      resourcePath,
      `$layout/${resourcePath}`,
    );
    assertPrivateDirectory(existing.node, `$layout/${resourcePath}`);
    if (!recovering) fail("strict-absent", `$layout/${resourcePath}`);
    return Object.freeze({
      resourcePath,
      disposition: "current" as const,
      node: existing.node,
    });
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      try {
        const created = await createDirectoryAtomically(root, resourcePath, {
          mode: 0o700,
          ...(signal === undefined ? {} : { signal }),
        });
        assertPrivateDirectory(created.node, `$layout/${resourcePath}`);
        return Object.freeze({
          resourcePath,
          disposition: "created" as const,
          node: created.node,
        });
      } catch (createError: unknown) {
        if (createError instanceof DurableDirectoryMaterializationError) {
          if (createError.reason === "aborted") fail("aborted", "$signal");
          fail("materialization", `$layout/${resourcePath}`);
        }
        throw createError;
      }
    }
    if (error instanceof WakeflowActiveLayoutMaterializationError) throw error;
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

/** 独占创建 Fresh Active Layout，或在 affected-step 恢复中幂等补齐。 */
export async function materializeWakeflowActiveLayout(
  rootValue: RootedDirectory,
  optionsValue: WakeflowActiveLayoutMaterializationOptions,
): Promise<Readonly<WakeflowActiveLayoutMaterializationResult>> {
  if (
    typeof rootValue !== "object"
    || rootValue === null
    || types.isProxy(rootValue)
    || !(rootValue instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const options = parseOptions(optionsValue);
  if (options.signal?.aborted === true) fail("aborted", "$signal");
  const active = await ensureDirectory(
    rootValue,
    WAKEFLOW_ACTIVE_ROOT_REF,
    options.recoveringFreshLayout,
    options.signal,
  );
  const current = await ensureDirectory(
    rootValue,
    WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
    options.recoveringFreshLayout,
    options.signal,
  );
  const entries = Object.freeze([active, current]);
  return Object.freeze({
    disposition: entries.some((entry) => entry.disposition === "created")
      ? "created"
      : "current",
    entries,
  });
}
