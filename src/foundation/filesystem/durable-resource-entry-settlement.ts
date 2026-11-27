import { throwIfAborted } from "../node/abort-signal.js";
import { type FileNodeSnapshot, sameFileNodeIdentity } from "./file-node-snapshot.js";
import { type PortableResourcePath, parsePortableResourcePath } from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
} from "./rooted-resource-parent-handle.js";

/**
 * Wakeflow Foundation / Filesystem：把一个"已经在盘面上"的目录项结果落盘。
 *
 * 规则（1.4.1 段 1b，"沿用之前先落盘"）：变更路径决定沿用一个不是它这一次亲手做成的目录项结果——
 * 目标"已经在"或"已经不在"——并且接下来要做不可逆的事（删一条恢复记录、删一棵树）时，先调用这里。
 * 它打开目标的父目录，核对目标仍是调用方看到的样子，同步父目录，再核对一次。上一个写入者可能死在
 * "改了目录项"与"同步父目录"之间，没有留下任何可见的痕迹；沿用者不补这一次同步，掉电之后那个结果会
 * 消失，而它后面的不可逆操作不会。
 *
 * 保证只到这一个目录里的这一个名字：返回之后，这个名字的出现或消失已经落盘。不在保证之内的：文件的
 * 内容（归写入者，权威档的写入在名字出现之前已经同步过内容）；上级目录自己的名字；跨两个目录的改名
 * （对两个目录各调用一次，先确认旧名字不在，再确认新名字在）。
 *
 * "不在"的目标连父目录都不在时（那一段路径从没建过，或被整段删掉了），落盘的是最近一个还在的上级目录里
 * 通往它的那一段不在：同步那个上级目录一次。这不是错误——没建过的目录里的东西当然不在；被删掉而没同步
 * 的那一段，掉电后会连同目标一起回来，所以同样要补这一次同步。"在"的目标没有这条路：父目录不在就是
 * 打不开。
 *
 * 持久化级别跟随根：根以 `none` 打开时只跳过同步这一个系统调用，两次核对照做。
 */

export type DurableResourceEntryObservation = "present" | "absent";

export type DurableResourceEntrySettlementErrorReason =
  | "input"
  | "parent-open-failure"
  | "inspection-failure"
  | "observation-changed"
  | "durability-failure"
  | "close-failure";

const ERROR_MESSAGES = {
  input: "Durable resource entry settlement input is invalid.",
  "parent-open-failure": "Durable resource entry settlement could not open the parent directory.",
  "inspection-failure": "Durable resource entry settlement could not inspect its target.",
  "observation-changed": "The resource entry is no longer what the caller observed.",
  "durability-failure": "Durable resource entry settlement could not sync the parent directory.",
  "close-failure": "Durable resource entry settlement could not close the parent directory.",
} as const satisfies Record<DurableResourceEntrySettlementErrorReason, string>;

export class DurableResourceEntrySettlementError extends Error {
  override readonly name = "DurableResourceEntrySettlementError";
  readonly reason: DurableResourceEntrySettlementErrorReason;
  readonly path: string;

  constructor(reason: DurableResourceEntrySettlementErrorReason, path: string, cause?: unknown) {
    super(ERROR_MESSAGES[reason], cause === undefined ? undefined : { cause });
    this.reason = reason;
    this.path = path;
  }
}

export interface DurableResourceEntrySettlementOptions {
  /**
   * 只用于 `present`：目标必须仍是这个节点。只比较设备号与节点号——目录的时间会随成员变动，文件的
   * 替换会换节点，两种情形下身份都够用。
   */
  readonly expectedNode?: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
  readonly errorPath?: string;
}

interface ParsedSettlementOptions {
  readonly expectedNode: Readonly<FileNodeSnapshot> | undefined;
  readonly signal: AbortSignal | undefined;
  readonly errorPath: string;
}

function fail(
  reason: DurableResourceEntrySettlementErrorReason,
  path: string,
  cause?: unknown,
): never {
  throw new DurableResourceEntrySettlementError(reason, path, cause);
}

/**
 * 选项缺省值；`expectedNode` 只对 `present` 有意义——两个参数之间的这层关系留在运行时核对
 * （签名被别的层调用，第一步不收紧它）。
 */
function settlementOptions(
  observed: DurableResourceEntryObservation,
  options: DurableResourceEntrySettlementOptions,
): Readonly<ParsedSettlementOptions> {
  const { expectedNode, signal, errorPath = "$resourcePath" } = options;
  if (expectedNode !== undefined && observed !== "present") fail("input", "$options.expectedNode");
  return { expectedNode, signal, errorPath };
}

/** 目标此刻是否仍是调用方看到的样子；不是就报 `observation-changed`。 */
async function assertObserved(
  parent: RootedResourceParentHandle,
  observed: DurableResourceEntryObservation,
  options: Readonly<ParsedSettlementOptions>,
): Promise<void> {
  let target: Readonly<FileNodeSnapshot> | null;
  try {
    target = await parent.inspectTarget();
  } catch (error: unknown) {
    const changed =
      error instanceof RootedResourceParentHandleError && error.reason === "parent-changed";
    fail(changed ? "observation-changed" : "inspection-failure", options.errorPath, error);
  }
  if (observed === "absent") {
    if (target !== null) fail("observation-changed", options.errorPath);
    return;
  }
  if (target === null) fail("observation-changed", options.errorPath);
  if (options.expectedNode !== undefined && !sameFileNodeIdentity(target, options.expectedNode)) {
    fail("observation-changed", options.errorPath);
  }
}

async function openParent(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  errorPath: string,
): Promise<RootedResourceParentHandle> {
  try {
    return await RootedResourceParentHandle.open(root, resourcePath, errorPath);
  } catch (error: unknown) {
    const input = error instanceof RootedResourceParentHandleError && error.reason === "input";
    fail(input ? "input" : "parent-open-failure", errorPath, error);
  }
}

async function syncParent(parent: RootedResourceParentHandle, errorPath: string): Promise<void> {
  try {
    await parent.sync();
  } catch (error: unknown) {
    const changed =
      error instanceof RootedResourceParentHandleError && error.reason === "parent-changed";
    fail(changed ? "observation-changed" : "durability-failure", errorPath, error);
  }
}

/** 父目录因为不存在而打不开时，返回父目录自己的路径（它就是那个"不在"的名字）；别的打不开返回 null。 */
function missingParentOf(
  resourcePath: PortableResourcePath,
  error: unknown,
): PortableResourcePath | null {
  if (!(error instanceof DurableResourceEntrySettlementError)) return null;
  const cause = error.cause;
  if (!(cause instanceof RootedResourceParentHandleError) || cause.reason !== "parent-not-found") {
    return null;
  }
  const cut = resourcePath.lastIndexOf("/");
  return cut <= 0 ? null : parsePortableResourcePath(resourcePath.slice(0, cut));
}

/**
 * 核对 `resourcePath` 在它的父目录里仍然"在"或"不在"，同步父目录，再核对一次。句柄恰好关闭一次；
 * 先发生的错误优先于关闭时的错误。"不在"的目标连父目录都不在时，对父目录的路径做同一件事（见文件头）。
 */
export async function settleObservedResourceEntry(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  observed: DurableResourceEntryObservation,
  options: DurableResourceEntrySettlementOptions = {},
): Promise<void> {
  const parsed = settlementOptions(observed, options);
  throwIfAborted(parsed.signal);
  let parent: RootedResourceParentHandle;
  try {
    parent = await openParent(root, resourcePath, parsed.errorPath);
  } catch (error: unknown) {
    const missing = observed === "absent" ? missingParentOf(resourcePath, error) : null;
    if (missing === null) throw error;
    await settleObservedResourceEntry(root, missing, "absent", {
      errorPath: parsed.errorPath,
      ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
    });
    return;
  }
  let failure: unknown;
  try {
    await assertObserved(parent, observed, parsed);
    throwIfAborted(parsed.signal);
    await syncParent(parent, parsed.errorPath);
    await assertObserved(parent, observed, parsed);
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await parent.close();
  } catch (error: unknown) {
    failure ??= new DurableResourceEntrySettlementError("close-failure", parsed.errorPath, error);
  }
  if (failure !== undefined) throw failure;
}
