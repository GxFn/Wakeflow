import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  publishActiveProjection,
  renderActiveProjectionFiles,
  type ActiveProjectionPublicationReceipt,
} from "../../kernel/active-projection.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { buildActiveProjectionFacts } from "./active-projection-facts.js";
import { observeWorkspace } from "./workspace-observation.js";

/**
 * Wakeflow Governance / Observation：变更之后重算并重写活动投影（gate-log §13.94 D5）。
 *
 * 触发方是各切片的变更执行器（Demand 事件提交、pod 创建与关闭、维护 apply）；它们在自己的
 * 事务提交之后调用一次。投影是自愈的派生物：刷新失败不能否定已经提交的事件，所以静默版本
 * 只吞 `io-failure`（锁争用、读写失败），其余错误照常上抛。宿主 profile 不参与：投影不含
 * 宿主域，status 单独报告 pod 的绑定状态。
 */

export interface RefreshActiveProjectionOptions {
  readonly signal?: AbortSignal;
}

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

async function openLedgerRoot(
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
): Promise<RootedDirectory> {
  const placement = snapshot.placements.roots.find((entry) => entry.key === "ledger.root");
  if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
    fail("precondition-failed", "ledger-root-missing", "$request.root");
  }
  try {
    return await RootedDirectory.open(placement.absolutePath, "$ledgerRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("io-failure", "ledger-root", "$request.root", { cause: error });
    }
    throw error;
  }
}

/** 观察、渲染、发布；返回发布回执（`unsafe` 表示手写文件让整轮零写）。 */
export async function refreshActiveProjection(
  root: RootedDirectory,
  options: RefreshActiveProjectionOptions = {},
): Promise<Readonly<ActiveProjectionPublicationReceipt>> {
  let snapshot: Readonly<WakeflowConfigAuthoritySnapshot>;
  try {
    snapshot = await readWakeflowConfigAuthoritySnapshot(root, signalOptions(options.signal));
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("io-failure", `config-${error.reason}`, "$request.root", { cause: error });
    }
    throw error;
  }
  const ledgerRoot = await openLedgerRoot(snapshot);
  try {
    const observation = await observeWorkspace(root, snapshot, ledgerRoot, {
      hosts: [],
      currentHostId: null,
      scope: "projection",
      ...signalOptions(options.signal),
    });
    const files = renderActiveProjectionFiles(buildActiveProjectionFacts(observation));
    return await publishActiveProjection(root, files, signalOptions(options.signal));
  } finally {
    await ledgerRoot.close();
  }
}

/** 静默刷新：只吞 `io-failure`（争用、读写失败），其余上抛；中止也上抛。 */
export async function refreshActiveProjectionQuietly(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await refreshActiveProjection(root, signalOptions(signal));
  } catch (error: unknown) {
    if (error instanceof WakeflowError && error.code === "io-failure" && error.reason !== "aborted") {
      return;
    }
    throw error;
  }
}

/** 变更执行器的包装：先执行变更（提交或应用），成功后静默刷新一次投影，再返回变更结果。 */
export async function afterMutationRefresh<Result>(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  mutate: () => Promise<Result>,
): Promise<Result> {
  const result = await mutate();
  await refreshActiveProjectionQuietly(root, signal);
  return result;
}
