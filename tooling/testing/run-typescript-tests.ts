import { lstatSync, opendirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { spawnSync } from "node:child_process";
import nodePath from "node:path";

/**
 * Wakeflow Tooling / Testing：由当前 `.test.ts` 源清单启动编译后测试。
 *
 * TypeScript 增量构建不会自动删除源文件移除后遗留的 `.build/tests/*.js`，因此测试门
 * 不能使用 glob 枚举编译目录。本入口只枚举当前测试源文件、映射对应的编译输出、
 * 复验普通文件并把清单交给 Node.js 测试运行器。旧输出不会被误执行，也不会维持
 * 虚假的测试覆盖。
 */

const MAXIMUM_TEST_FILES = 512;

function fail(message: string): never {
  throw new Error(`Wakeflow TypeScript test runner failed: ${message}`);
}

function collectTestSources(root: string): readonly string[] {
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
    entries.sort((left, right) => left.name.localeCompare(right.name));
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

function compiledTests(repositoryRoot: string): readonly string[] {
  const sourceRoot = nodePath.join(repositoryRoot, "tests");
  const outputRoot = nodePath.join(repositoryRoot, ".build", "tests");
  return collectTestSources(sourceRoot).map((source) => {
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
    const stat = lstatSync(output, { throwIfNoEntry: false });
    if (stat === undefined || stat.isSymbolicLink() || !stat.isFile()) {
      fail("a current test source has no regular compiled output");
    }
    return output;
  });
}

function run(): void {
  const repositoryRoot = process.cwd();
  const files = compiledTests(repositoryRoot);
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.error !== undefined) fail("Node test runner could not start");
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

run();
