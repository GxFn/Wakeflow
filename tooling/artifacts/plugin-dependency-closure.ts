import { lstatSync, readdirSync, readFileSync } from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";

/**
 * Wakeflow Tooling / Artifacts：制品的运行时依赖闭包（gate-log §13.101 D5）。
 *
 * 两个宿主装插件时都不会替它跑 `npm install`，所以制品必须自带它在运行时会 `import` 的每一个
 * npm 包。闭包从编译闭包记下的直接外部包出发，沿根 `package-lock.json`（v3）的 `packages`
 * 表逐级取 `dependencies`、`peerDependencies` 与已装的 `optionalDependencies`，每一级都核对
 * 锁文件版本与 `node_modules/` 里实际装着的版本相等；锁里标为 `dev`、`link` 或嵌套安装的包一律
 * 失败——制品只接受扁平、精确、可复现的一层 `node_modules/`。文件按扩展名剪掉类型声明、
 * source map 与 Markdown（它们没有运行时消费者），其余原样复制；顺序与字节只由锁文件和已装
 * 包决定，所以两次构建逐字节一致。不用 bundler：需求文档 §5 把"通过 bundling 隐藏领域依赖或
 * 宿主边界"列为非目标。
 */

const LOCKFILE_NAME = "package-lock.json";
const NODE_MODULES = "node_modules";
const MAXIMUM_LOCKFILE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_PACKAGES = 64;
const MAXIMUM_FILES_PER_PACKAGE = 2048;
const MAXIMUM_FILE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_TOTAL_BYTES = 64 * 1024 * 1024;
/** 没有运行时消费者的扩展名；`.d.ts` 与 `.d.mts` 分别以 `.ts`、`.mts` 结尾，一并剪掉。 */
const EXCLUDED_EXTENSIONS: readonly string[] = Object.freeze([
  ".ts",
  ".mts",
  ".cts",
  ".map",
  ".md",
  ".markdown",
]);

export interface RuntimeDependencyPackage {
  readonly name: string;
  readonly version: string;
  /** 锁文件记录的 SRI 完整性值；清单原样带上，供离线核对来源。 */
  readonly integrity: string;
  /** 该包在锁文件里声明、且进了闭包的依赖名（已排序）。 */
  readonly dependencies: readonly string[];
}

export interface VendoredFile {
  /** 制品内路径：`node_modules/<name>/<相对路径>`。 */
  readonly path: string;
  readonly bytes: Buffer;
}

/** 依赖闭包不满足约束时返回的稳定工具错误；调用方与测试按 `name` 与 `code` 断言。 */
class PluginDependencyClosureError extends Error {
  override readonly name = "PluginDependencyClosureError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new PluginDependencyClosureError(code, message);
}

type JsonRecord = Readonly<Record<string, unknown>>;

function isPlainRecord(value: unknown): value is JsonRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lstatOrNull(target: string): Stats | null {
  try {
    return lstatSync(target);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function readBoundedJson(file: string, maximumBytes: number, code: string): JsonRecord {
  const stat = lstatOrNull(file);
  if (stat === null || stat.isSymbolicLink() || !stat.isFile() || stat.size > maximumBytes) {
    fail(code, `${path.basename(file)} must be one bounded regular file`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail(code, `${path.basename(file)} is not valid JSON`);
  }
  if (!isPlainRecord(parsed)) fail(code, `${path.basename(file)} must be one JSON object`);
  return parsed;
}

function readLockPackages(repositoryRoot: string): JsonRecord {
  const lock = readBoundedJson(
    path.join(repositoryRoot, LOCKFILE_NAME),
    MAXIMUM_LOCKFILE_BYTES,
    "wakeflow-artifact-lockfile",
  );
  if (lock.lockfileVersion !== 3 || !isPlainRecord(lock.packages)) {
    fail("wakeflow-artifact-lockfile", "package-lock.json must be lockfile version 3");
  }
  return lock.packages;
}

/** 锁文件里一个包的依赖名：`dependencies` 与 `peerDependencies` 必须在锁里，`optionalDependencies` 在锁里才算。 */
function lockedDependencyNames(
  packages: JsonRecord,
  name: string,
  entry: JsonRecord,
): readonly string[] {
  const names = new Set<string>();
  for (const field of ["dependencies", "peerDependencies"] as const) {
    const declared = entry[field];
    if (declared === undefined) continue;
    if (!isPlainRecord(declared)) {
      fail("wakeflow-artifact-lockfile", `${name} declares a malformed ${field} table`);
    }
    for (const dependency of Object.keys(declared)) {
      if (!isPlainRecord(packages[`${NODE_MODULES}/${dependency}`])) {
        fail(
          "wakeflow-artifact-dependency-missing",
          `${name} depends on ${dependency}, which the lockfile does not install at the top level`,
        );
      }
      names.add(dependency);
    }
  }
  const optional = entry.optionalDependencies;
  if (optional !== undefined) {
    if (!isPlainRecord(optional)) {
      fail("wakeflow-artifact-lockfile", `${name} declares a malformed optionalDependencies table`);
    }
    for (const dependency of Object.keys(optional)) {
      if (isPlainRecord(packages[`${NODE_MODULES}/${dependency}`])) names.add(dependency);
    }
  }
  return Object.freeze([...names].sort(compareCodeUnits));
}

function assertInstalledVersion(repositoryRoot: string, name: string, lockedVersion: string): void {
  const installed = readBoundedJson(
    path.join(repositoryRoot, NODE_MODULES, name, "package.json"),
    MAXIMUM_LOCKFILE_BYTES,
    "wakeflow-artifact-dependency-installed",
  );
  if (installed.version !== lockedVersion) {
    fail(
      "wakeflow-artifact-dependency-drift",
      `${name} is installed at ${String(installed.version)} but locked at ${lockedVersion}`,
    );
  }
}

function lockedPackage(
  repositoryRoot: string,
  packages: JsonRecord,
  name: string,
): Readonly<RuntimeDependencyPackage> {
  const entry = packages[`${NODE_MODULES}/${name}`];
  if (!isPlainRecord(entry)) {
    fail("wakeflow-artifact-dependency-missing", `${name} is not installed at the top level`);
  }
  if (entry.dev === true) {
    fail("wakeflow-artifact-dependency-dev", `${name} is a development dependency`);
  }
  if (entry.link === true) {
    fail("wakeflow-artifact-dependency-link", `${name} is a workspace link, not a package`);
  }
  if (typeof entry.version !== "string" || entry.version.length === 0) {
    fail("wakeflow-artifact-lockfile", `${name} has no locked version`);
  }
  if (typeof entry.integrity !== "string" || !entry.integrity.startsWith("sha512-")) {
    fail("wakeflow-artifact-lockfile", `${name} has no sha512 integrity in the lockfile`);
  }
  assertInstalledVersion(repositoryRoot, name, entry.version);
  return Object.freeze({
    name,
    version: entry.version,
    integrity: entry.integrity,
    dependencies: lockedDependencyNames(packages, name, entry),
  });
}

/**
 * 从直接外部包出发的传递闭包，按包名排序返回。同一个包只解析一次；闭包超过上限即失败，
 * 因为一个控制器插件不该带着几百个包。
 */
export function resolveRuntimeDependencyClosure(
  repositoryRoot: string,
  directPackages: readonly string[],
): readonly Readonly<RuntimeDependencyPackage>[] {
  const packages = readLockPackages(repositoryRoot);
  const resolved = new Map<string, Readonly<RuntimeDependencyPackage>>();
  const pending = [...directPackages].sort(compareCodeUnits);
  while (pending.length > 0) {
    const name = pending.shift();
    if (name === undefined || resolved.has(name)) continue;
    if (resolved.size >= MAXIMUM_PACKAGES) {
      fail("wakeflow-artifact-dependency-count", `closure exceeds ${MAXIMUM_PACKAGES} packages`);
    }
    const locked = lockedPackage(repositoryRoot, packages, name);
    resolved.set(name, locked);
    for (const dependency of locked.dependencies) {
      if (!resolved.has(dependency)) pending.push(dependency);
    }
  }
  return Object.freeze(
    [...resolved.values()].sort((left, right) => compareCodeUnits(left.name, right.name)),
  );
}

function isExcludedFile(name: string): boolean {
  return name.startsWith(".") || EXCLUDED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

interface FileBudget {
  totalBytes: number;
}

/** 一份运行时文件：单文件与整体预算都在这里扣，超限即失败。 */
function vendoredFile(
  packageRoot: string,
  name: string,
  relative: string,
  budget: FileBudget,
): Readonly<VendoredFile> {
  const absolute = path.join(packageRoot, relative);
  const stat = lstatSync(absolute);
  if (stat.size > MAXIMUM_FILE_BYTES) {
    fail("wakeflow-artifact-dependency-file", `${name}/${relative} exceeds the file budget`);
  }
  budget.totalBytes += stat.size;
  if (budget.totalBytes > MAXIMUM_TOTAL_BYTES) {
    fail("wakeflow-artifact-dependency-budget", "dependency closure exceeds the total budget");
  }
  return Object.freeze({
    path: `${NODE_MODULES}/${name}/${relative}`,
    bytes: readFileSync(absolute),
  });
}

function collectPackageFiles(
  packageRoot: string,
  name: string,
  budget: FileBudget,
): readonly Readonly<VendoredFile>[] {
  const files: VendoredFile[] = [];
  const pending: string[] = [""];
  while (pending.length > 0) {
    const directory = pending.pop() ?? "";
    const entries = readdirSync(path.join(packageRoot, directory), { withFileTypes: true });
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const relative = directory === "" ? entry.name : `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        fail("wakeflow-artifact-dependency-file", `${name}/${relative} is a symbolic link`);
      }
      if (entry.isDirectory()) {
        if (entry.name === NODE_MODULES) {
          fail("wakeflow-artifact-dependency-nested", `${name} installs a nested ${NODE_MODULES}`);
        }
        pending.push(relative);
        continue;
      }
      if (!entry.isFile() || isExcludedFile(entry.name)) continue;
      files.push(vendoredFile(packageRoot, name, relative, budget));
      if (files.length > MAXIMUM_FILES_PER_PACKAGE) {
        fail("wakeflow-artifact-dependency-file", `${name} exceeds the per-package file budget`);
      }
    }
  }
  if (!files.some((file) => file.path === `${NODE_MODULES}/${name}/package.json`)) {
    fail("wakeflow-artifact-dependency-file", `${name} has no package.json to vendor`);
  }
  files.sort((left, right) => compareCodeUnits(left.path, right.path));
  return Object.freeze(files);
}

/** 闭包里每个包的运行时文件，按制品内路径排序；模式一律 0644，可执行位不进制品。 */
export function collectVendoredFiles(
  repositoryRoot: string,
  packages: readonly Readonly<RuntimeDependencyPackage>[],
): readonly Readonly<VendoredFile>[] {
  const budget: FileBudget = { totalBytes: 0 };
  const files: VendoredFile[] = [];
  for (const dependency of packages) {
    const packageRoot = path.join(repositoryRoot, NODE_MODULES, dependency.name);
    const stat = lstatOrNull(packageRoot);
    if (stat === null || stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("wakeflow-artifact-dependency-installed", `${dependency.name} is not a real directory`);
    }
    files.push(...collectPackageFiles(packageRoot, dependency.name, budget));
  }
  files.sort((left, right) => compareCodeUnits(left.path, right.path));
  return Object.freeze(files);
}
