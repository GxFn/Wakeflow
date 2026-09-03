import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import {
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  loadDemandEventSourcingRootAuthority,
  DemandEventSourcingRootAuthorityError,
  type LoadedDemandEventSourcingRootAuthority,
} from "./event-sourcing/demand-event-sourcing-root-authority.js";
import { DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE } from "./event-sourcing/demand-file-event-store-contract.js";
import { demandFinalRootRef } from "./publication/demand-publication-paths.js";
import {
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
} from "../ledger/ledger-authority-store.js";

/**
 * Wakeflow Governance / Demand：一次业务操作共享的只读组合权威上下文。
 *
 * 本模块只负责安全打开当前Config、Ledger root和一个已发布Demand root。Mutation入口
 * 从Commit 1完整audit；只读入口允许Snapshot + tail，但两者都执行同一Demand/Ledger/
 * Inventory闭包。它不解释Tasking、Delivery、Result或Review规则，也不写事件、投影或
 * 宿主状态；各领域owner在该上下文之上继续执行自己的准入。
 */

export interface DemandOperationAuthorityContext {
  readonly config: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly demandRoot: RootedDirectory;
  readonly ledgerRoot: RootedDirectory;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
}

export type DemandOperationAuthorityContextErrorReason =
  "root" | "config" | "demand-authority" | "stale-config" | "aborted";

const ERROR_MESSAGES = {
  root: "Demand operation root could not be held safely.",
  config: "Demand operation Config authority is invalid.",
  "demand-authority": "Demand operation authority is invalid.",
  "stale-config": "Demand operation Config authority changed.",
  aborted: "Demand operation authority loading was aborted.",
} as const satisfies Readonly<
  Record<DemandOperationAuthorityContextErrorReason, string>
>;

/** 通用Demand操作上下文无法安全打开、保持或关闭时的稳定错误。 */
export class DemandOperationAuthorityContextError extends Error {
  override readonly name = "DemandOperationAuthorityContextError";
  readonly code = "wakeflow-demand-operation-authority-context" as const;
  readonly reason: DemandOperationAuthorityContextErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: DemandOperationAuthorityContextErrorReason,
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
  reason: DemandOperationAuthorityContextErrorReason,
  cause?: unknown,
): never {
  throw new DemandOperationAuthorityContextError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

/** 从Workspace root安全打开一个已发布Demand的私有根目录。 */
export async function openDemandOperationRoot(
  workspaceRoot: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
): Promise<RootedDirectory> {
  let observation;
  try {
    observation = await workspaceRoot.inspectExistingResource(
      demandFinalRootRef(demandId),
      "$demandRoot",
    );
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
  if (
    observation.node.kind !== "directory" ||
    observation.node.permissionBits !==
      DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE ||
    (currentUserId() !== null && observation.node.userId !== currentUserId())
  ) {
    fail("root");
  }
  let demandRoot: RootedDirectory | undefined;
  try {
    demandRoot = await RootedDirectory.open(
      observation.physicalPath,
      "$demandRoot",
    );
    const current = await demandRoot.assertCurrent("$demandRoot");
    if (!sameFileNodeIdentity(observation.node, current)) fail("root");
    return demandRoot;
  } catch (error: unknown) {
    if (demandRoot !== undefined) {
      try {
        await demandRoot.close();
      } catch {
        // 首个打开或身份准入错误优先。
      }
    }
    if (error instanceof DemandOperationAuthorityContextError) throw error;
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
}

/** 关闭一个Demand操作持有的RootedDirectory。 */
export async function closeDemandOperationRoot(
  root: RootedDirectory,
): Promise<void> {
  try {
    await root.close();
  } catch (error: unknown) {
    fail("root", error);
  }
}

async function openDemandAuthorityContext(
  workspaceRoot: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
  signal: AbortSignal | undefined,
  audit: boolean,
): Promise<Readonly<DemandOperationAuthorityContext>> {
  let config: Readonly<WakeflowConfigAuthoritySnapshot>;
  try {
    config = await readWakeflowConfigAuthoritySnapshot(
      workspaceRoot,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("config", error);
    }
    throw error;
  }
  let ledgerRoot: RootedDirectory | undefined;
  let demandRoot: RootedDirectory | undefined;
  try {
    ledgerRoot = await RootedDirectory.open(config.ledgerRoot, "$ledgerRoot");
    demandRoot = await openDemandOperationRoot(workspaceRoot, demandId);
    const loaded = await loadDemandEventSourcingRootAuthority(
      demandRoot,
      new LedgerAuthorityStore(ledgerRoot),
      {
        ...(audit ? { audit: true } : {}),
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return Object.freeze({ config, demandRoot, ledgerRoot, loaded });
  } catch (error: unknown) {
    if (demandRoot !== undefined) {
      try {
        await demandRoot.close();
      } catch {
        // 首个权威加载错误优先。
      }
    }
    if (ledgerRoot !== undefined) {
      try {
        await ledgerRoot.close();
      } catch {
        // 首个权威加载错误优先。
      }
    }
    if (error instanceof DemandOperationAuthorityContextError) throw error;
    if (error instanceof RootedDirectoryError) fail("root", error);
    if (
      error instanceof DemandEventSourcingRootAuthorityError ||
      error instanceof LedgerAuthorityStoreError
    ) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("demand-authority", error);
    }
    throw error;
  }
}

/** 打开当前Config、Ledger与从Commit 1完整审计后的Demand组合上下文。 */
export async function openDemandOperationAuthorityContext(
  workspaceRoot: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandOperationAuthorityContext>> {
  return openDemandAuthorityContext(workspaceRoot, demandId, signal, true);
}

/**
 * 打开适合只读消费的Demand组合上下文；允许Root Authority使用Snapshot + tail，
 * 仍执行完整Inventory、Identity、Authority、Ledger、revision 1与当前Aggregate闭包。
 */
export async function openDemandReadAuthorityContext(
  workspaceRoot: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandOperationAuthorityContext>> {
  return openDemandAuthorityContext(workspaceRoot, demandId, signal, false);
}

/** 关闭组合上下文持有的Demand与Ledger根，首个关闭失败优先。 */
export async function closeDemandOperationAuthorityContext(
  context: Readonly<DemandOperationAuthorityContext>,
): Promise<void> {
  let failure: unknown;
  try {
    await context.demandRoot.close();
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await context.ledgerRoot.close();
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) fail("root", failure);
}

/** Apply提交前复验同一Config字节与物理节点仍是Preview读取的权威。 */
export async function assertDemandOperationConfigCurrent(
  workspaceRoot: RootedDirectory,
  expected: Readonly<WakeflowConfigAuthoritySnapshot>,
  signal: AbortSignal | undefined,
): Promise<void> {
  let current;
  try {
    current = await readWakeflowConfigAuthoritySnapshot(
      workspaceRoot,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("config", error);
    }
    throw error;
  }
  if (
    current.configDigest !== expected.configDigest ||
    current.source.digest !== expected.source.digest ||
    !sameFileNodeSnapshot(current.source.node, expected.source.node)
  ) {
    fail("stale-config");
  }
}
