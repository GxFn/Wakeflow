import {
  DurableAtomicFileStageRecoveryError,
  type DurableAtomicFileStageRecoveryReceipt,
  recoverDurableAtomicFileStagesForTargets,
  recoverDurableAtomicFileStagesMatchingTargets,
} from "../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { materializeDirectoryPath } from "../foundation/filesystem/durable-directory-materialization.js";
import {
  ensureKernelFileLockFile,
  isKernelFileLockHeldExclusively,
  KernelFileLockError,
  withKernelFileLock,
} from "../foundation/filesystem/kernel-file-lock.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import { OperationAbortedError, signalOptions } from "../foundation/node/abort-signal.js";
import { WAKEFLOW_LOCAL_RUNTIME_ROOT_REF } from "./layout.js";

/**
 * Wakeflow Kernel / Workspace Locks：工作区里全部的锁（ADR-0033）。
 *
 * 名字是封闭的一张表，每个名字是私有目录 `.wakeflow-local/runtime/locks/` 里的一个常驻文件，互斥由内核
 * 咨询锁提供。工作区根、账本目录与活动目录里没有锁文件；锁文件不进 git，不带任何需要落盘的状态。
 * 按需求包、按 pod、按 Demand、按记录各有一把的做法没有了：同一类的两次操作先后进行。
 *
 * 嵌套次序（外层在前）：维护的门 → 操作作用域（门、作用域）→ 其余各把。除操作作用域之外，这里的锁都只以
 * 独占方式获取。
 */

export const WORKSPACE_LOCKS_ROOT_REF = parsePortableResourcePath(
  `${WAKEFLOW_LOCAL_RUNTIME_ROOT_REF}/locks`,
  "$layout",
);

export const WORKSPACE_LOCK_NAMES = Object.freeze([
  /** 此刻有一次维护在跑。"维护没做完"的记号是事务目录里的意图，不是它。 */
  "maintenance-gate",
  /** 操作作用域的"门"：普通命令短暂地共享持有，维护独占持有到结束（写者优先）。 */
  "operation-gate",
  /** 操作作用域：普通命令共享持有到结束，维护独占。 */
  "operation-scope",
  "active-projection",
  "requirement-board",
  "pod-mutation",
  "demand-publication",
  /** 证据的记录与它的 recover：recover 不会接手一次还在跑的记录。 */
  "evidence-publication",
  "ledger-record",
  "window-binding",
  "config-authority",
  "gitignore",
  "program-instruction",
] as const);

export type WorkspaceLockName = (typeof WORKSPACE_LOCK_NAMES)[number];

/** 这把锁的文件在工作区里的位置。 */
export function workspaceLockRef(name: WorkspaceLockName): PortableResourcePath {
  return parsePortableResourcePath(`${WORKSPACE_LOCKS_ROOT_REF}/${name}.lock`, "$layout");
}

/** `name` 是不是锁目录里一个锁文件的名字；只读的清点用它认出本协议的文件，不授予任何东西。 */
export function isWorkspaceLockFileName(name: string): boolean {
  return (
    name.endsWith(".lock") &&
    (WORKSPACE_LOCK_NAMES as readonly string[]).includes(name.slice(0, -".lock".length))
  );
}

export interface WorkspaceLockOptions {
  readonly signal?: AbortSignal;
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
}

/**
 * 建出锁目录（私有、0700）和表里的每一个锁文件；已在的什么都不改。维护的自举调用它，所以一个初始化过的
 * 工作区里锁目录的内容从此不变——核心布局的观察不会因为某把锁第一次被用到而对不上。
 */
export async function materializeWorkspaceLocksRoot(
  root: RootedDirectory,
  signal?: AbortSignal,
): Promise<void> {
  await materializeDirectoryPath(root, WORKSPACE_LOCKS_ROOT_REF, {
    mode: 0o700,
    ...signalOptions(signal),
  });
  for (const name of WORKSPACE_LOCK_NAMES) {
    await ensureKernelFileLockFile(root, workspaceLockRef(name));
  }
}

/**
 * 独占地持有 `name` 这把锁执行 `operation`。锁目录还不在时建出它再拿一次——除操作作用域之外的锁都在一个
 * 已经准入的操作里获取，目录不在只发生在没有经过维护初始化的根上。失败以 `KernelFileLockError` 上抛，
 * 由各自的调用方说成自己的拒绝。
 */
export async function withWorkspaceLock<Result>(
  root: RootedDirectory,
  name: WorkspaceLockName,
  operation: () => Promise<Result>,
  options: WorkspaceLockOptions = {},
): Promise<Result> {
  const lockOptions = {
    ...signalOptions(options.signal),
    ...(options.acquireTimeoutMilliseconds === undefined
      ? {}
      : { acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds }),
    ...(options.retryDelayMilliseconds === undefined
      ? {}
      : { retryDelayMilliseconds: options.retryDelayMilliseconds }),
  };
  const run = () =>
    withKernelFileLock(root, workspaceLockRef(name), "exclusive", operation, lockOptions);
  try {
    return await run();
  } catch (error: unknown) {
    // 只有获取时才会报 `parent`：这时 `operation` 还没有开始，再拿一次不会让它跑两遍。
    if (!(error instanceof KernelFileLockError) || error.reason !== "parent") throw error;
  }
  await materializeWorkspaceLocksRoot(root, options.signal);
  return run();
}

/**
 * `withWorkspaceLock`，并把"拿不到锁"与"操作自己抛出"分开：`operation` 开始之前的 `KernelFileLockError`
 * 交给 `refuse` 说成调用方自己的拒绝；进到操作之后抛出的一切（包括临界区里别的锁的同类错误）原样穿过。
 */
export async function withWorkspaceLockOrRefuse<Result>(
  root: RootedDirectory,
  name: WorkspaceLockName,
  operation: () => Promise<Result>,
  refuse: (error: KernelFileLockError) => never,
  options: WorkspaceLockOptions = {},
): Promise<Result> {
  let entered = false;
  try {
    return await withWorkspaceLock(
      root,
      name,
      () => {
        entered = true;
        return operation();
      },
      options,
    );
  } catch (error: unknown) {
    if (!entered && error instanceof KernelFileLockError) refuse(error);
    throw error;
  }
}

/**
 * 拿到锁之后、读受保护的文件之前做的事（ADR-0033 决定 6）：上一个持有者死在写到一半时，它的原子写暂存还
 * 留在这些文件旁边——可能还链接着目标。先结算掉确定由死掉的写者留下的；否则替换自己会在写之前退役那份
 * 暂存，目标的链接数随之变化，它刚读到的期望就对不上。
 *
 * 尽力而为：结算不了（属主说不清、目录读不出、被中止）就什么都不做，由随后的读或写按它自己的方式报告。
 * `targets` 必须在同一个目录里。
 */
export async function settleStagesOfDeadWriters(
  root: RootedDirectory,
  targets: readonly PortableResourcePath[],
  signal?: AbortSignal,
): Promise<void> {
  try {
    await recoverDurableAtomicFileStagesMatchingTargets(root, targets, signalOptions(signal));
  } catch (error: unknown) {
    if (
      !(error instanceof DurableAtomicFileStageRecoveryError) &&
      !(error instanceof OperationAbortedError)
    )
      throw error;
  }
}

/**
 * `settleStagesOfDeadWriters` 的严格版，给结算不了就不能往下走的读者：属主还活着或说不清的暂存留在
 * 原处并调用 `refuse()`，恢复自己失败时调用 `refuse(cause)`；中止与别的错误照常上抛。`scope` 是
 * foundation 的两种目标范围：`closed` 在同一目录里见到集合之外的暂存时什么都不退休并报错，`matching`
 * 只看集合里的目标。
 */
export async function settleStagesOfDeadWritersStrictly(
  root: RootedDirectory,
  targets: readonly PortableResourcePath[],
  scope: "closed" | "matching",
  signal: AbortSignal | undefined,
  refuse: (cause?: DurableAtomicFileStageRecoveryError) => never,
): Promise<void> {
  const recover =
    scope === "closed"
      ? recoverDurableAtomicFileStagesForTargets
      : recoverDurableAtomicFileStagesMatchingTargets;
  let receipt: Readonly<DurableAtomicFileStageRecoveryReceipt>;
  try {
    receipt = await recover(root, targets, signalOptions(signal));
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileStageRecoveryError) refuse(error);
    throw error;
  }
  if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0) refuse();
}

/** 只读：`name` 这把锁此刻是否被独占持有。不创建任何东西。 */
export function isWorkspaceLockHeld(
  root: RootedDirectory,
  name: Exclude<WorkspaceLockName, "operation-gate" | "operation-scope">,
): Promise<boolean> {
  return isKernelFileLockHeldExclusively(root, workspaceLockRef(name));
}
