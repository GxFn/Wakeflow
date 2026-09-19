import { stat } from "node:fs/promises";

import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import {
  readStrictTextFile,
  StrictTextFileError,
} from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { fail } from "../../kernel/error.js";

/**
 * Wakeflow Governance / Observation：仓库指针文件事实（gate-log §13.94 D2）。
 *
 * 不 spawn git。只读主检出 `.git/HEAD`、`refs/heads/*`、`packed-refs` 与
 * `.git/worktrees/<name>/{gitdir, HEAD}`，报告 HEAD、当前分支、分支尖端、登记的 worktree 与
 * prunable（gitdir 指向的检出已不存在）。工作树是否干净不观察：Wakeflow 没有任何判定依赖它。
 * 单个指针读不出只让对应项为 null；`.git` 或 `HEAD` 读不出才让整个仓库 `unavailable`。
 *
 * 分支清单有第三种结果：读得出但看不全。`refs/heads` 列不出、某个松散引用文件读不出、或
 * `packed-refs` 读不出时，`status` 仍是 `observed`（HEAD、当前分支与 worktree 这些读得到的
 * 事实照常报告），但 `issue` 是 `branches-incomplete`：`branches` 里没有某个分支，只在
 * `issue === null` 时才等于"仓库里没有这个分支"。下游用 `repositoryBranchesComplete` 判定，
 * 不要自己比对 issue 字符串。看不全时 HEAD 所在分支的尖端也可能解析不出（`head` 为 null）。
 */

export interface RepositoryBranchFact {
  readonly name: string;
  readonly tip: string;
}

export interface RepositoryWorktreeFact {
  readonly name: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly prunable: boolean;
}

export interface RepositoryPointerObservation {
  readonly repositoryId: string;
  readonly status: "observed" | "unavailable";
  readonly issue: string | null;
  readonly head: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly branches: readonly Readonly<RepositoryBranchFact>[];
  readonly worktrees: readonly Readonly<RepositoryWorktreeFact>[];
}

/**
 * 分支清单是否读全。只有仓库观察成功且没有 issue，`branches` 里的缺席才等于"分支不在仓库
 * 里"；否则缺席只说明这一轮没看见，不能据此判定分支已删除或已合并。
 */
export function repositoryBranchesComplete(
  observation: Readonly<RepositoryPointerObservation>,
): boolean {
  return observation.status === "observed" && observation.issue === null;
}

export interface ObserveRepositoryPointersInput {
  readonly repositoryId: string;
  /** 主检出的绝对路径（配置放置报告里的 realPath）。 */
  readonly absolutePath: string;
  readonly signal?: AbortSignal;
}

const POINTER_MAXIMUM_BYTES = parseByteCount(4 * 1024, "$pointer.maximumBytes");
const PACKED_REFS_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$packedRefs.maximumBytes");
const DIRECTORY_MAXIMUM_ENTRIES = 4096;
const REFS_MAXIMUM_DEPTH = 8;
const OBJECT_ID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const SYMBOLIC_HEAD_PATTERN = /^ref: refs\/heads\/(\S+)$/u;
const PACKED_REF_PATTERN = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) refs\/heads\/(\S+)$/u;
/** 观察成功但分支清单没读全时的稳定 issue 码。 */
const BRANCHES_INCOMPLETE_ISSUE = "branches-incomplete";
const GIT_DIRECTORY_REF = parsePortableResourcePath(".git", "$repository");
const HEAD_REF = parsePortableResourcePath(".git/HEAD", "$repository");
const PACKED_REFS_REF = parsePortableResourcePath(".git/packed-refs", "$repository");
const HEADS_REF = parsePortableResourcePath(".git/refs/heads", "$repository");
const WORKTREES_REF = parsePortableResourcePath(".git/worktrees", "$repository");

type Signal = { readonly signal?: AbortSignal };

function signalOptions(signal: AbortSignal | undefined): Signal {
  return signal === undefined ? {} : { signal };
}

function unavailable(repositoryId: string, issue: string): Readonly<RepositoryPointerObservation> {
  return Object.freeze({
    repositoryId,
    status: "unavailable" as const,
    issue,
    head: null,
    branch: null,
    detached: false,
    branches: Object.freeze([]),
    worktrees: Object.freeze([]),
  });
}

function rethrowAbort(error: unknown): void {
  if (
    (error instanceof StableFileReadError || error instanceof StableDirectoryReadError) &&
    error.reason === "aborted"
  ) {
    fail("io-failure", "aborted", "$signal");
  }
}

/**
 * 一次指针读取的结果。`missing` 是确认不存在（缺席就是事实），`unreadable` 是打不开或读不
 * 完（缺席只说明没看见），`malformed` 是读得出字节但不是严格文本（对逐个列出的引用文件而言
 * 这只是"不是引用文件"，对 packed-refs 这种唯一来源而言等于读不出）。
 */
type PointerOutcome = "read" | "missing" | "unreadable" | "malformed";

interface PointerRead {
  readonly text: string | null;
  readonly outcome: PointerOutcome;
}

/** 读一个指针文件的正文（去掉末尾换行），并区分"不存在"与"读不出"。 */
async function readPointer(
  root: RootedDirectory,
  ref: PortableResourcePath,
  maximumBytes: ReturnType<typeof parseByteCount>,
  signal: AbortSignal | undefined,
): Promise<Readonly<PointerRead>> {
  try {
    const read = await readStrictTextFile(root, ref, { maximumBytes, ...signalOptions(signal) });
    return Object.freeze({ text: read.text.replace(/\n$/u, ""), outcome: "read" as const });
  } catch (error: unknown) {
    rethrowAbort(error);
    if (error instanceof StableFileReadError) {
      const outcome = error.reason === "not-found" ? ("missing" as const) : ("unreadable" as const);
      return Object.freeze({ text: null, outcome });
    }
    if (error instanceof StrictTextFileError) {
      return Object.freeze({ text: null, outcome: "malformed" as const });
    }
    throw error;
  }
}

/** 读一个指针文件的正文；读不出返回 null（不关心是不存在还是读不出的调用方用这个）。 */
async function pointerText(
  root: RootedDirectory,
  ref: PortableResourcePath,
  maximumBytes: ReturnType<typeof parseByteCount>,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  return (await readPointer(root, ref, maximumBytes, signal)).text;
}

interface PointerDirectoryEntry {
  readonly name: string;
  readonly resourcePath: PortableResourcePath;
  readonly kind: string;
}

interface DirectoryRead {
  /** 列得出时是目录项，列不出或目录不存在时是 null。 */
  readonly entries: readonly Readonly<PointerDirectoryEntry>[] | null;
  /** 目录确实不存在为 false；符号链接、不是目录、超出条目上限或 io 失败为 true。 */
  readonly unreadable: boolean;
}

async function directoryEntries(
  root: RootedDirectory,
  ref: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<Readonly<DirectoryRead>> {
  try {
    const listing = await readStableResourceDirectory(root, ref, {
      maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
      ...signalOptions(signal),
    });
    return Object.freeze({
      entries: listing.entries.map((entry) =>
        Object.freeze({ name: entry.name, resourcePath: entry.resourcePath, kind: entry.node.kind }),
      ),
      unreadable: false,
    });
  } catch (error: unknown) {
    rethrowAbort(error);
    if (error instanceof StableDirectoryReadError) {
      return Object.freeze({ entries: null, unreadable: error.reason !== "not-found" });
    }
    throw error;
  }
}

/**
 * 一个松散引用文件：读得出且正文是对象 id 才记为分支尖端。正文不是对象 id（符号引用、锁文件
 * 之外的杂项文件）与严格文本失败一样只是"不是引用文件"，跳过即可；真正打不开才让清单不全。
 */
async function collectLooseRef(
  root: RootedDirectory,
  entry: Readonly<PointerDirectoryEntry>,
  name: string,
  into: Map<string, string>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const read = await readPointer(root, entry.resourcePath, POINTER_MAXIMUM_BYTES, signal);
  if (read.outcome === "unreadable") return false;
  if (read.text !== null && OBJECT_ID_PATTERN.test(read.text)) into.set(name, read.text);
  return true;
}

/** 收集松散分支；返回这棵子树是否读全（目录列不出、深度截断、引用文件读不出都算没读全）。 */
async function collectLooseBranches(
  root: RootedDirectory,
  directory: PortableResourcePath,
  prefix: string,
  depth: number,
  into: Map<string, string>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (depth > REFS_MAXIMUM_DEPTH) return false;
  const listing = await directoryEntries(root, directory, signal);
  if (listing.entries === null) return !listing.unreadable;
  let complete = true;
  for (const entry of listing.entries) {
    const name = `${prefix}${entry.name}`;
    if (entry.kind === "directory") {
      const subtree = await collectLooseBranches(
        root,
        entry.resourcePath,
        `${name}/`,
        depth + 1,
        into,
        signal,
      );
      if (!subtree) complete = false;
      continue;
    }
    if (entry.kind !== "file") continue;
    if (!(await collectLooseRef(root, entry, name, into, signal))) complete = false;
  }
  return complete;
}

/** 收集打包分支；返回是否读全。packed-refs 是唯一来源，不存在才算读全，读不出与不是严格文本都不算。 */
async function collectPackedBranches(
  root: RootedDirectory,
  into: Map<string, string>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const read = await readPointer(root, PACKED_REFS_REF, PACKED_REFS_MAXIMUM_BYTES, signal);
  if (read.text === null) return read.outcome === "missing";
  for (const line of read.text.split("\n")) {
    const match = PACKED_REF_PATTERN.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined && !into.has(match[2])) {
      into.set(match[2], match[1]);
    }
  }
  return true;
}

function resolveHead(
  text: string,
  branches: ReadonlyMap<string, string>,
): Readonly<{ readonly head: string | null; readonly branch: string | null; readonly detached: boolean }> {
  const symbolic = SYMBOLIC_HEAD_PATTERN.exec(text);
  if (symbolic?.[1] !== undefined) {
    return Object.freeze({
      head: branches.get(symbolic[1]) ?? null,
      branch: symbolic[1],
      detached: false,
    });
  }
  return Object.freeze({
    head: OBJECT_ID_PATTERN.test(text) ? text : null,
    branch: null,
    detached: true,
  });
}

async function checkoutPresent(gitdirText: string | null): Promise<boolean> {
  if (gitdirText === null) return false;
  try {
    return (await stat(gitdirText)).isFile();
  } catch {
    return false;
  }
}

async function collectWorktrees(
  root: RootedDirectory,
  branches: ReadonlyMap<string, string>,
  signal: AbortSignal | undefined,
): Promise<readonly Readonly<RepositoryWorktreeFact>[]> {
  const listing = await directoryEntries(root, WORKTREES_REF, signal);
  if (listing.entries === null) return Object.freeze([]);
  const worktrees: Readonly<RepositoryWorktreeFact>[] = [];
  for (const entry of listing.entries) {
    if (entry.kind !== "directory") continue;
    const gitdir = await pointerText(
      root,
      parsePortableResourcePath(`${entry.resourcePath}/gitdir`, "$repository"),
      POINTER_MAXIMUM_BYTES,
      signal,
    );
    const head = await pointerText(
      root,
      parsePortableResourcePath(`${entry.resourcePath}/HEAD`, "$repository"),
      POINTER_MAXIMUM_BYTES,
      signal,
    );
    const resolved = head === null ? null : resolveHead(head, branches);
    worktrees.push(
      Object.freeze({
        name: entry.name,
        head: resolved?.head ?? null,
        branch: resolved?.branch ?? null,
        prunable: !(await checkoutPresent(gitdir)),
      }),
    );
  }
  return Object.freeze(worktrees.sort((left, right) => left.name.localeCompare(right.name)));
}

async function observeOpened(
  repositoryId: string,
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<RepositoryPointerObservation>> {
  try {
    const git = await root.inspectExistingResource(GIT_DIRECTORY_REF, "$repository");
    if (git.node.kind !== "directory") return unavailable(repositoryId, "root-is-worktree");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) return unavailable(repositoryId, "git-directory-missing");
    throw error;
  }
  const headText = await pointerText(root, HEAD_REF, POINTER_MAXIMUM_BYTES, signal);
  if (headText === null) return unavailable(repositoryId, "head-unreadable");
  const branchTips = new Map<string, string>();
  const looseComplete = await collectLooseBranches(root, HEADS_REF, "", 0, branchTips, signal);
  const packedComplete = await collectPackedBranches(root, branchTips, signal);
  const head = resolveHead(headText, branchTips);
  const branches = Object.freeze(
    [...branchTips.entries()]
      .map(([name, tip]) => Object.freeze({ name, tip }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
  return Object.freeze({
    repositoryId,
    status: "observed" as const,
    // 读不全的分支清单必须说出来：否则"分支不在 branches 里"会被下游当成分支已删除。
    issue: looseComplete && packedComplete ? null : BRANCHES_INCOMPLETE_ISSUE,
    ...head,
    branches,
    worktrees: await collectWorktrees(root, branchTips, signal),
  });
}

/** 观察一个配置仓库的主检出指针文件；打开失败即 `unavailable`。 */
export async function observeRepositoryPointers(
  input: Readonly<ObserveRepositoryPointersInput>,
): Promise<Readonly<RepositoryPointerObservation>> {
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(input.absolutePath, "$repository");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) return unavailable(input.repositoryId, "root-open");
    throw error;
  }
  try {
    return await observeOpened(input.repositoryId, root, input.signal);
  } finally {
    await root.close();
  }
}
