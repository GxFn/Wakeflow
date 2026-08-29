import { lstatSync, opendirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { spawnSync } from "node:child_process";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Wakeflow Tooling / Testing：由当前 `.test.ts` 源清单启动编译后测试。
 *
 * TypeScript 增量构建不会自动删除源文件移除后遗留的 `.build/tests/*.js`，因此测试门
 * 不能使用 glob 枚举编译目录。本入口只枚举当前测试源文件、映射对应的编译输出、
 * 复验普通文件并把清单交给 Node.js 测试运行器。无参数模式运行全部当前源；显式
 * `--focused` 模式只接受调用方列出的当前 `.test.ts` 源文件。旧输出不会被误执行，
 * 不存在、越界、重复或非测试路径也不能制造虚假的测试覆盖。
 */

const MAXIMUM_TEST_FILES = 512;

function fail(message: string): never {
  throw new Error(`Wakeflow TypeScript test runner failed: ${message}`);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertRealDirectoryChain(
  root: string,
  directory: string,
  message: string,
): void {
  const relative = nodePath.relative(root, directory);
  if (
    relative === ".."
    || relative.startsWith(`..${nodePath.sep}`)
    || nodePath.isAbsolute(relative)
  ) {
    fail(message);
  }
  let current = root;
  for (const segment of ["", ...relative.split(nodePath.sep).filter(Boolean)]) {
    if (segment.length > 0) current = nodePath.join(current, segment);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat === undefined || stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(message);
    }
  }
}

function collectTestSources(root: string): readonly string[] {
  assertRealDirectoryChain(root, root, "tests root must be one real directory");
  const result: string[] = [];
  function visit(directory: string): void {
    const handle = opendirSync(directory);
    const entries: Dirent[] = [];
    try {
      while (true) {
        const entry = handle.readSync();
        if (entry === null) break;
        entries.push(entry);
      }
    } finally {
      handle.closeSync();
    }
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const absolute = nodePath.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("tests source cannot contain symlinks");
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        result.push(absolute);
        if (result.length > MAXIMUM_TEST_FILES) {
          fail(`test file count exceeds ${MAXIMUM_TEST_FILES}`);
        }
      }
    }
  }
  visit(root);
  if (result.length === 0) fail("no .test.ts source files were found");
  return Object.freeze(result);
}

function assertCurrentTestSource(
  sourceRoot: string,
  value: string,
): string {
  const source = nodePath.resolve(value);
  const relative = nodePath.relative(sourceRoot, source);
  if (
    relative.length === 0
    || relative === ".."
    || relative.startsWith(`..${nodePath.sep}`)
    || nodePath.isAbsolute(relative)
    || !relative.endsWith(".test.ts")
  ) {
    fail("focused test source must be one .test.ts file below tests/");
  }
  assertRealDirectoryChain(
    sourceRoot,
    nodePath.dirname(source),
    "focused test source parent chain must contain only real directories",
  );
  const stat = lstatSync(source, { throwIfNoEntry: false });
  if (stat === undefined || stat.isSymbolicLink() || !stat.isFile()) {
    fail("focused test source must be one current regular file");
  }
  return source;
}

function selectedTestSources(
  repositoryRoot: string,
  focusedValues?: readonly string[],
): readonly string[] {
  const sourceRoot = nodePath.join(repositoryRoot, "tests");
  if (focusedValues === undefined) return collectTestSources(sourceRoot);
  if (focusedValues.length === 0) {
    fail("focused mode requires at least one test source");
  }
  const seen = new Set<string>();
  const sources = focusedValues.map((value) => {
    const source = assertCurrentTestSource(
      sourceRoot,
      nodePath.resolve(repositoryRoot, value),
    );
    if (seen.has(source)) fail("focused test sources cannot contain duplicates");
    seen.add(source);
    return source;
  });
  return Object.freeze(sources.sort(compareCodeUnits));
}

/** 把当前源清单映射为已经存在的编译输出，不枚举 `.build/tests`。 */
export function compiledTypeScriptTests(
  repositoryRootInput: string,
  focusedValues?: readonly string[],
): readonly string[] {
  const repositoryRoot = nodePath.resolve(repositoryRootInput);
  const sourceRoot = nodePath.join(repositoryRoot, "tests");
  const outputRoot = nodePath.join(repositoryRoot, ".build", "tests");
  return selectedTestSources(repositoryRoot, focusedValues).map((source) => {
    const relative = nodePath.relative(sourceRoot, source);
    if (
      relative.length === 0
      || relative === ".."
      || relative.startsWith(`..${nodePath.sep}`)
      || nodePath.isAbsolute(relative)
    ) {
      fail("test source escaped the tests root");
    }
    const output = nodePath.join(
      outputRoot,
      relative.replace(/\.ts$/u, ".js"),
    );
    assertRealDirectoryChain(
      outputRoot,
      nodePath.dirname(output),
      "compiled test parent chain must contain only real directories",
    );
    const stat = lstatSync(output, { throwIfNoEntry: false });
    if (
      stat === undefined
      || stat.isSymbolicLink()
      || !stat.isFile()
      || stat.nlink !== 1
    ) {
      fail("a current test source has no regular compiled output");
    }
    return output;
  });
}

function parseInvocation(values: readonly string[]): readonly string[] | undefined {
  if (values.length === 0) return undefined;
  if (values[0] !== "--focused") {
    fail("the only supported runner option is --focused");
  }
  return values.slice(1);
}

function run(): void {
  const repositoryRoot = process.cwd();
  const files = compiledTypeScriptTests(
    repositoryRoot,
    parseInvocation(process.argv.slice(2)),
  );
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.error !== undefined) fail("Node test runner could not start");
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined
    && nodePath.resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isMainModule()) run();
