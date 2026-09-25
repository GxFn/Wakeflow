import {
  readWakeflowConfigAuthoritySnapshot,
  type WakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  type ActiveProjectionPublicationReceipt,
  type ActiveProjectionRendering,
  publishActiveProjection,
  renderActiveProjectionFiles,
} from "../../kernel/active-projection.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { buildActiveProjectionFacts } from "./active-projection-facts.js";
import { observeWorkspace } from "./workspace-observation.js";

/**
 * Wakeflow Governance / Observation：变更之后重算并重写活动投影（gate-log §13.94 D5）。
 *
 * 触发方是各切片的变更执行器（Demand 事件提交、pod 创建与关闭、维护 apply）；它们在自己的
 * 事务提交之后调用一次。投影是自愈的派生物：刷新失败不能否定已经提交的事件，所以静默版本
 * 吞掉一切带原因的 Wakeflow 失败，只有中止（调用方自己要求停下）与非 Wakeflow 的编程错误
 * 上抛。只吞 `io-failure` 是不够的：刷新还会因 `precondition-failed`（ledger 放置一时探不
 * 到）或 `capacity-exceeded`（渲染超过单文件上限）失败，那些失败一旦上抛就会让一个已经落
 * 盘的事件报错返回，调用方于是重做一次已经记下的变更。投影下一次刷新或 `wakeflow_status`
 * 自会重算。宿主 profile 不参与：投影不含宿主域，status 单独报告 pod 的绑定状态。
 */

export interface RefreshActiveProjectionOptions {
  readonly signal?: AbortSignal;
  /** 取投影锁的预算，透传给内核；缺省是内核的 10 秒。测试用它把争用变成快速可观察的失败。 */
  readonly acquireTimeoutMilliseconds?: number;
}

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

async function openLedgerRoot(
  root: RootedDirectory,
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
): Promise<RootedDirectory> {
  const placement = snapshot.placements.roots.find((entry) => entry.key === "ledger.root");
  if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
    fail("precondition-failed", "ledger-root-missing", "$request.root");
  }
  try {
    return await RootedDirectory.open(placement.absolutePath, "$ledgerRoot", {
      durability: root.durability,
    });
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("io-failure", "ledger-root", "$request.root", { cause: error });
    }
    throw error;
  }
}

async function readSnapshot(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(root, signalOptions(signal));
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("io-failure", `config-${error.reason}`, "$request.root", { cause: error });
    }
    throw error;
  }
}

/** 锁内的一轮：观察、压成事实、渲染；退休证据与文件同出这一轮观察。 */
async function renderRound(
  root: RootedDirectory,
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  ledgerRoot: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<ActiveProjectionRendering>> {
  const observation = await observeWorkspace(root, snapshot, ledgerRoot, {
    hosts: [],
    currentHostId: null,
    scope: "projection",
    ...signalOptions(signal),
  });
  const facts = buildActiveProjectionFacts(observation);
  // 这一轮没看全活动 Demand 就一个页面目录都不删。
  return { files: renderActiveProjectionFiles(facts), activeDemands: facts.activeDemands };
}

/**
 * 观察、渲染、发布；返回发布回执（`unsafe` 表示手写文件让整轮零写）。
 *
 * 观察、事实与渲染都在投影锁内：发布只按锁内那一刻的字节做 CAS，本身不带先后，所以在锁外
 * 观察的两轮并发刷新可以按与各自观察相反的顺序落盘，把旧状态写在新状态上，一直留到下一次
 * 变更才自愈。取锁在观察之前，这一轮读到的工作区就是它写回去的那一个。配置快照与账本根仍在
 * 锁外取得：它们决定这次刷新有没有可读的工作区，读不出就该以自己的原因失败，而不是先去占锁。
 */
export async function refreshActiveProjection(
  root: RootedDirectory,
  options: RefreshActiveProjectionOptions = {},
): Promise<Readonly<ActiveProjectionPublicationReceipt>> {
  const snapshot = await readSnapshot(root, options.signal);
  const ledgerRoot = await openLedgerRoot(root, snapshot);
  try {
    return await publishActiveProjection(root, () => renderRound(root, snapshot, ledgerRoot, options.signal), {
      ...signalOptions(options.signal),
      ...(options.acquireTimeoutMilliseconds === undefined
        ? {}
        : { acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds }),
    });
  } finally {
    await ledgerRoot.close();
  }
}

/**
 * 静默刷新：吞掉已归类的 Wakeflow 失败（派生物不能否定已提交的事件）；中止、`unexpected`
 * 与非 Wakeflow 错误上抛。`unexpected` 是"没人认领的错误"，也就是编程错误的出口，静默它
 * 会让投影器自己的缺陷永远不被发现；已归类的失败（io-failure、precondition-failed、
 * capacity-exceeded 等）都是环境事实，下一次刷新或 `wakeflow_status` 会自愈。
 */
export async function refreshActiveProjectionQuietly(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await refreshActiveProjection(root, signalOptions(signal));
  } catch (error: unknown) {
    if (!(error instanceof WakeflowError) || error.reason === "aborted" || error.code === "unexpected") {
      throw error;
    }
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
