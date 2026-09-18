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

/** 读一个指针文件的正文（去掉末尾换行）；读不出返回 null。 */
async function pointerText(
  root: RootedDirectory,
  ref: PortableResourcePath,
  maximumBytes: ReturnType<typeof parseByteCount>,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  try {
    const read = await readStrictTextFile(root, ref, { maximumBytes, ...signalOptions(signal) });
    return read.text.replace(/\n$/u, "");
  } catch (error: unknown) {
    rethrowAbort(error);
    if (error instanceof StableFileReadError || error instanceof StrictTextFileError) return null;
    throw error;
  }
}

async function directoryEntries(
  root: RootedDirectory,
  ref: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<readonly Readonly<{ readonly name: string; readonly resourcePath: PortableResourcePath; readonly kind: string }>[] | null> {
  try {
    const listing = await readStableResourceDirectory(root, ref, {
      maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
      ...signalOptions(signal),
    });
    return listing.entries.map((entry) =>
      Object.freeze({ name: entry.name, resourcePath: entry.resourcePath, kind: entry.node.kind }),
    );
  } catch (error: unknown) {
    rethrowAbort(error);
    if (error instanceof StableDirectoryReadError) return null;
    throw error;
  }
}

async function collectLooseBranches(
  root: RootedDirectory,
  directory: PortableResourcePath,
  prefix: string,
  depth: number,
  into: Map<string, string>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (depth > REFS_MAXIMUM_DEPTH) return;
  const entries = await directoryEntries(root, directory, signal);
  if (entries === null) return;
  for (const entry of entries) {
    const name = `${prefix}${entry.name}`;
    if (entry.kind === "directory") {
      await collectLooseBranches(root, entry.resourcePath, `${name}/`, depth + 1, into, signal);
      continue;
    }
    if (entry.kind !== "file") continue;
    const text = await pointerText(root, entry.resourcePath, POINTER_MAXIMUM_BYTES, signal);
    if (text !== null && OBJECT_ID_PATTERN.test(text)) into.set(name, text);
  }
}

async function collectPackedBranches(
  root: RootedDirectory,
  into: Map<string, string>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const text = await pointerText(root, PACKED_REFS_REF, PACKED_REFS_MAXIMUM_BYTES, signal);
  if (text === null) return;
  for (const line of text.split("\n")) {
    const match = PACKED_REF_PATTERN.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined && !into.has(match[2])) {
      into.set(match[2], match[1]);
    }
  }
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
  const entries = await directoryEntries(root, WORKTREES_REF, signal);
  if (entries === null) return Object.freeze([]);
  const worktrees: Readonly<RepositoryWorktreeFact>[] = [];
  for (const entry of entries) {
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
  await collectLooseBranches(root, HEADS_REF, "", 0, branchTips, signal);
  await collectPackedBranches(root, branchTips, signal);
  const head = resolveHead(headText, branchTips);
  const branches = Object.freeze(
    [...branchTips.entries()]
      .map(([name, tip]) => Object.freeze({ name, tip }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
  return Object.freeze({
    repositoryId,
    status: "observed" as const,
    issue: null,
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
