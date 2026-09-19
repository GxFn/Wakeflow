import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  RootedDirectoryDurability,
  RootedDirectoryOpenOptions,
} from "../../src/foundation/filesystem/rooted-directory.js";

/**
 * 共享预备工作区基线（plan §11：“共享一个 v3 基线 fixture 按需复制”）。
 *
 * 同一测试进程里，同一个 key 的初始化链只跑一次，结果留在一个只作复制源的基线目录里；
 * 之后每个测试用 `fs.cp` 递归复制得到自己的隔离目录。副本仍是公共工具接受的真实文件系统
 * 工作区：没有内核替身，没有共享句柄，每个测试仍在 `t.after` 里删掉自己的目录。
 *
 * `fs.cp` 保留文件权限位，但按当前 umask 新建目录，会把 0700 的目录变成 0755。
 * 因此每次复制都先按基线对齐目录权限，再逐项复验条目集合与权限位：0700 目录与 0600 文件
 * 必须在副本里原样成立，否则直接失败而不是让工作区带着放宽的权限进入测试。
 */

const MODE_MASK = 0o7777;

/**
 * 一次性工作区的持久化级别。
 *
 * 基线与副本都是 `mkdtemp` 出来的临时目录，测试结束就在 `t.after` 里删掉，进程退出时
 * 基线也一并删掉：崩溃后幸存对它们没有任何意义，为它们付 `fsync` 只是在买一份没人会
 * 兑现的保险。`none` 跳过的只有 `fsync` 系统调用本身——暂存、原子重命名、权限位、
 * 链接检查、CAS 预期与错误分类一律不变，所以副本仍是公共工具接受的真实工作区。
 *
 * 只有夹具与一次性工作区用它；Foundation 的崩溃语义测试必须显式保持 `fsync`。
 */
export const DISPOSABLE_WORKSPACE_DURABILITY: RootedDirectoryDurability = "none";

/** 打开一次性工作区根的选项；夹具统一用它，而不是逐处硬写级别。 */
export const DISPOSABLE_ROOT_OPTIONS: Readonly<RootedDirectoryOpenOptions> = Object.freeze({
  durability: DISPOSABLE_WORKSPACE_DURABILITY,
});

const preparedRoots: string[] = [];
let removalRegistered = false;

/** 基线目录活到进程退出：它是复制源，不是某个测试的工作区。 */
function removePreparedRootOnExit(preparedRoot: string): void {
  preparedRoots.push(preparedRoot);
  if (removalRegistered) return;
  removalRegistered = true;
  process.on("exit", () => {
    for (const root of preparedRoots) rmSync(root, { recursive: true, force: true });
    preparedRoots.length = 0;
  });
}

/** `fs.cp` 按 umask 新建目录，逐级把目录权限对回基线。 */
function alignDirectoryModes(source: string, destination: string): void {
  chmodSync(destination, lstatSync(source).mode & MODE_MASK);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    alignDirectoryModes(path.join(source, entry.name), path.join(destination, entry.name));
  }
}

function sortedEntryNames(directory: string): readonly string[] {
  return readdirSync(directory).sort();
}

/**
 * 基线必须可搬家：整个设计就建立在"副本落在另一个绝对路径下仍然成立"上，所以基线字节里
 * 不能留下它自己的绝对根。建立基线时查一次（不是每次复制都查）：命中就直接失败并点名文件，
 * 而不是让一份带着旧路径的工作区进入测试，在别处报出无从追查的错。realpath 一并查，
 * macOS 的 `/var` 与 `/private/var` 是同一棵树的两个写法。
 */
function assertRelocatable(preparedRoot: string): void {
  const needles = [...new Set([preparedRoot, realpathSync(preparedRoot)])];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      const text = readFileSync(absolute).toString("utf8");
      for (const needle of needles) {
        if (!text.includes(needle)) continue;
        throw new Error(
          `Prepared workspace baseline is not relocatable: ${relative} records its own root path.`,
        );
      }
    }
  };
  walk(preparedRoot, "");
}

/** 复制后的复验：条目集合、类型与权限位都必须与基线一致。 */
function assertCopiedTree(source: string, destination: string): void {
  const expected = sortedEntryNames(source).join("\u0000");
  const actual = sortedEntryNames(destination).join("\u0000");
  if (expected !== actual) {
    throw new Error(`Prepared workspace copy lost entries under ${destination}.`);
  }
  for (const name of sortedEntryNames(source)) {
    const from = lstatSync(path.join(source, name));
    const into = lstatSync(path.join(destination, name));
    if (from.isSymbolicLink() || into.isSymbolicLink()) {
      throw new Error(`Prepared workspace baselines cannot contain symbolic links: ${name}.`);
    }
    if (from.isDirectory() !== into.isDirectory()) {
      throw new Error(`Prepared workspace copy changed the kind of ${name}.`);
    }
    if ((from.mode & MODE_MASK) !== (into.mode & MODE_MASK)) {
      throw new Error(`Prepared workspace copy changed the mode of ${name}.`);
    }
    if (from.isDirectory()) {
      assertCopiedTree(path.join(source, name), path.join(destination, name));
    }
  }
}

export interface PreparedWorkspaceMaterialization<Facts> {
  readonly fixtureRoot: string;
  readonly facts: Facts;
}

export interface PreparedWorkspaceStoreDefinition<Options, Facts> {
  /** 临时目录前缀；沿用被替换夹具原来的前缀，便于识别遗留目录。 */
  readonly prefix: string;
  /**
   * 同 key 的选项共享同一份基线。返回 `null` 表示不共享：
   * 需要不同拓扑的测试用它退出共享基线，照旧跑一遍初始化链。
   */
  readonly keyOf: (options: Options) => string | null;
  /** 在一个已创建的空目录里跑完初始化链，返回与路径无关的基线事实。 */
  readonly build: (fixtureRoot: string, options: Options) => Promise<Facts>;
}

export interface PreparedWorkspaceStore<Options, Facts> {
  /** 复制一份基线到新的隔离临时目录。 */
  materialize(options: Options): Promise<Readonly<PreparedWorkspaceMaterialization<Facts>>>;
  /** 复制一份基线到已存在的目录：供上层基线在下层基线之上继续初始化。 */
  materializeInto(fixtureRoot: string, options: Options): Promise<Facts>;
}

export function createPreparedWorkspaceStore<Options, Facts>(
  definition: Readonly<PreparedWorkspaceStoreDefinition<Options, Facts>>,
): Readonly<PreparedWorkspaceStore<Options, Facts>> {
  const baselines = new Map<string, Promise<Readonly<{ root: string; facts: Facts }>>>();

  function newRoot(): string {
    return mkdtempSync(path.join(os.tmpdir(), definition.prefix));
  }

  async function buildAt(fixtureRoot: string, options: Options): Promise<Facts> {
    return definition.build(fixtureRoot, options);
  }

  function baselineFor(key: string, options: Options) {
    const existing = baselines.get(key);
    if (existing !== undefined) return existing;
    const root = newRoot();
    removePreparedRootOnExit(root);
    const building = buildAt(root, options).then((facts) => {
      assertRelocatable(root);
      return Object.freeze({ root, facts });
    });
    baselines.set(key, building);
    return building;
  }

  function copyPrepared(preparedRoot: string, fixtureRoot: string): void {
    cpSync(preparedRoot, fixtureRoot, { recursive: true, preserveTimestamps: true });
    alignDirectoryModes(preparedRoot, fixtureRoot);
    assertCopiedTree(preparedRoot, fixtureRoot);
  }

  return Object.freeze({
    async materialize(options: Options) {
      const key = definition.keyOf(options);
      const fixtureRoot = newRoot();
      if (key === null) {
        return Object.freeze({ fixtureRoot, facts: await buildAt(fixtureRoot, options) });
      }
      const prepared = await baselineFor(key, options);
      copyPrepared(prepared.root, fixtureRoot);
      return Object.freeze({ fixtureRoot, facts: prepared.facts });
    },
    async materializeInto(fixtureRoot: string, options: Options) {
      const key = definition.keyOf(options);
      if (key === null) return buildAt(fixtureRoot, options);
      const prepared = await baselineFor(key, options);
      copyPrepared(prepared.root, fixtureRoot);
      return prepared.facts;
    },
  });
}
