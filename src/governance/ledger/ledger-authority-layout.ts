import { types } from "node:util";

import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  LEDGER_CONFIRMATIONS_ROOT_REF,
  LEDGER_REQUIREMENTS_ROOT_REF,
  LEDGER_TRANSACTIONS_ROOT_REF,
} from "./ledger-authority-paths.js";
import {
  LEDGER_DURABLE_DIRECTORY_MODE,
  LEDGER_TRANSACTION_DIRECTORY_MODE,
} from "./ledger-authority-storage-policy.js";
import {
  throwLedgerAuthorityStoreError as fail,
} from "./ledger-authority-store-contract.js";
import {
  WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG,
} from "./ledger-resource-catalog.js";

/**
 * Wakeflow Governance / Ledger：Ledger 根内固定容器的只读观察与幂等物化。
 *
 * 本模块只拥有 `requirements`、`confirmations` 与私有 `transactions` 三个容器的
 * 节点策略，不枚举或解释任何 Requirement/Confirmation 记录。Maintenance 可以读取
 * 该观察来判断配置指定的 Ledger 是否已经具备基础布局；记录发布仍由
 * `LedgerAuthorityStore` 的逐记录事务负责。
 */

const LEDGER_AUTHORITY_LAYOUT_KIND =
  "WakeflowLedgerAuthorityLayoutInspection" as const;

type LedgerAuthorityLayoutEntryStatus =
  | "absent"
  | "current"
  | "conflict";

export interface LedgerAuthorityLayoutEntryInspection {
  readonly resourcePath:
    | typeof LEDGER_REQUIREMENTS_ROOT_REF
    | typeof LEDGER_CONFIRMATIONS_ROOT_REF
    | typeof LEDGER_TRANSACTIONS_ROOT_REF;
  readonly expectedMode: number;
  readonly status: LedgerAuthorityLayoutEntryStatus;
  readonly observedKind: string | null;
  readonly observedMode: number | null;
  readonly deviceId: string | null;
  readonly inodeId: string | null;
}

export interface LedgerAuthorityLayoutInspection {
  readonly kind: typeof LEDGER_AUTHORITY_LAYOUT_KIND;
  readonly status: "current" | "incomplete" | "conflict";
  readonly authorityDigest: Sha256Digest;
  readonly observationDigest: Sha256Digest;
  readonly entries: readonly Readonly<LedgerAuthorityLayoutEntryInspection>[];
}

interface LedgerAuthorityLayoutEntryPolicy {
  readonly resourcePath: LedgerAuthorityLayoutEntryInspection["resourcePath"];
  readonly mode: number;
  readonly requireCurrentUser: boolean;
}

const LEDGER_AUTHORITY_LAYOUT_POLICIES = Object.freeze([
  Object.freeze({
    resourcePath: LEDGER_REQUIREMENTS_ROOT_REF,
    mode: LEDGER_DURABLE_DIRECTORY_MODE,
    requireCurrentUser: false,
  }),
  Object.freeze({
    resourcePath: LEDGER_CONFIRMATIONS_ROOT_REF,
    mode: LEDGER_DURABLE_DIRECTORY_MODE,
    requireCurrentUser: false,
  }),
  Object.freeze({
    resourcePath: LEDGER_TRANSACTIONS_ROOT_REF,
    mode: LEDGER_TRANSACTION_DIRECTORY_MODE,
    requireCurrentUser: true,
  }),
]) satisfies readonly Readonly<LedgerAuthorityLayoutEntryPolicy>[];

/** 固定容器策略的语义摘要；不包含绝对路径、inode 或当前目录内容。 */
export const LEDGER_AUTHORITY_LAYOUT_DIGEST =
  computeCanonicalJsonSha256Digest({
    kind: "WakeflowLedgerAuthorityLayoutAuthority",
    schemaVersion: 1,
    declarations: WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG,
  });

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

async function inspectEntry(
  root: RootedDirectory,
  policy: Readonly<LedgerAuthorityLayoutEntryPolicy>,
): Promise<Readonly<LedgerAuthorityLayoutEntryInspection>> {
  try {
    const resource = await root.inspectExistingResource(
      policy.resourcePath,
      `$layout/${policy.resourcePath}`,
    );
    const current = resource.node.kind === "directory"
      && resource.node.permissionBits === policy.mode
      && (
        !policy.requireCurrentUser
        || currentUserId() === null
        || resource.node.userId === currentUserId()
      );
    return Object.freeze({
      resourcePath: policy.resourcePath,
      expectedMode: policy.mode,
      status: current ? "current" as const : "conflict" as const,
      observedKind: resource.node.kind,
      observedMode: resource.node.permissionBits,
      deviceId: resource.node.deviceId.toString(),
      inodeId: resource.node.inodeId.toString(),
    });
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      return Object.freeze({
        resourcePath: policy.resourcePath,
        expectedMode: policy.mode,
        status: "absent" as const,
        observedKind: null,
        observedMode: null,
        deviceId: null,
        inodeId: null,
      });
    }
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

/** 只读检查 Ledger 根内三个固定容器，不扫描不可变记录目录。 */
export async function inspectLedgerAuthorityLayout(
  rootValue: RootedDirectory,
  signal?: AbortSignal,
): Promise<Readonly<LedgerAuthorityLayoutInspection>> {
  assertRoot(rootValue);
  assertNotAborted(signal);
  try {
    await rootValue.assertCurrent("$root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
  const entries = Object.freeze(await Promise.all(
    LEDGER_AUTHORITY_LAYOUT_POLICIES.map((policy) => (
      inspectEntry(rootValue, policy)
    )),
  ));
  assertNotAborted(signal);
  try {
    await rootValue.assertCurrent("$root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
  const status = entries.some((entry) => entry.status === "conflict")
    ? "conflict" as const
    : entries.some((entry) => entry.status === "absent")
      ? "incomplete" as const
      : "current" as const;
  const observationBasis = {
    kind: LEDGER_AUTHORITY_LAYOUT_KIND,
    status,
    authorityDigest: LEDGER_AUTHORITY_LAYOUT_DIGEST,
    entries,
  };
  return Object.freeze({
    ...observationBasis,
    observationDigest: computeCanonicalJsonSha256Digest(observationBasis),
  });
}

/** 幂等物化固定容器并以只读观察复验最终布局。 */
export async function materializeLedgerAuthorityLayout(
  rootValue: RootedDirectory,
  signal?: AbortSignal,
): Promise<Readonly<LedgerAuthorityLayoutInspection>> {
  assertRoot(rootValue);
  assertNotAborted(signal);
  try {
    for (const policy of LEDGER_AUTHORITY_LAYOUT_POLICIES) {
      await materializeDirectoryPath(rootValue, policy.resourcePath, {
        mode: policy.mode,
        ...(signal === undefined ? {} : { signal }),
      });
    }
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("operation-failure", "$initialize");
    }
    throw error;
  }
  const inspection = await inspectLedgerAuthorityLayout(rootValue, signal);
  if (inspection.status !== "current") fail("node-policy", "$initialize");
  return inspection;
}
