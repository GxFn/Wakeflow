/**
 * 级别 1（组件）：`foundation/git` 的提交观察与封闭的只读 runner，在真实的临时仓库上用真实的 git 进程
 * 核对（ADR-0028）。每个仓库几十毫秒即建好；不走网络，不碰本机的全局 git 配置。
 */
import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  GitCommitObservationError,
  type GitCommitObservationErrorReason,
  observeGitAncestry,
  observeGitCommit,
} from "../../../src/foundation/git/git-commit-observation.js";
import {
  GIT_PATCH_RETAINED_BYTES_MAXIMUM,
  GitReadOnlyProcessError,
  runGitReadOnly,
} from "../../../src/foundation/git/git-read-only-process.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";

interface Repository {
  readonly absolutePath: string;
  readonly root: RootedDirectory;
  git(...args: readonly string[]): string;
  commit(message: string, files: Readonly<Record<string, string>>): string;
}

const MISSING_OID = "0000000000000000000000000000000000000001";

async function repository(t: TestContext, initialize = true): Promise<Repository> {
  const absolutePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-git-commit-observation-"));
  const git = (...args: readonly string[]): string => {
    const result = spawnSync(
      "git",
      ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args],
      {
        cwd: absolutePath,
        encoding: "utf8",
        shell: false,
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      },
    );
    if (result.status !== 0) throw new Error(`fixture git ${args[0]} failed`);
    return result.stdout.trim();
  };
  if (initialize) git("init", "--quiet", "--initial-branch=main");
  const commit = (message: string, files: Readonly<Record<string, string>>): string => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(absolutePath, name)), { recursive: true });
      writeFileSync(path.join(absolutePath, name), text);
    }
    git("add", "--all");
    git("commit", "--quiet", "--message", message);
    return git("rev-parse", "HEAD");
  };
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return { absolutePath, root, git, commit };
}

async function failureReason(
  operation: Promise<unknown>,
): Promise<GitCommitObservationErrorReason | "no-error"> {
  try {
    await operation;
  } catch (error: unknown) {
    if (error instanceof GitCommitObservationError) return error.reason;
    throw error;
  }
  return "no-error";
}

test("观察一个提交：树、父提交、相对第一父提交的改动路径，补丁的摘要、字节数与正文", async (t) => {
  const repo = await repository(t);
  const first = repo.commit("first", { "a.txt": "a\n", "gone.txt": "x\n" });
  rmSync(path.join(repo.absolutePath, "gone.txt"));
  const second = repo.commit("second", { "a.txt": "a\nb\n", "dir/sp ace.txt": "new\n" });

  const observed = await observeGitCommit(repo.root, second);
  ok(observed.status === "observed");
  equal(observed.commitOid, second);
  equal(observed.treeOid, repo.git("rev-parse", `${second}^{tree}`));
  deepEqual(observed.parents, [first]);
  deepEqual(observed.changedPaths, [
    { status: "modified", path: "a.txt" },
    { status: "added", path: "dir/sp ace.txt" },
    { status: "deleted", path: "gone.txt" },
  ]);
  equal(observed.changedPathCount, 3);
  equal(observed.changedPathsTruncated, false);
  ok(observed.patch.content !== null);
  const patch = Buffer.from(observed.patch.content).toString("utf8");
  ok(patch.includes("+b\n") && patch.includes("diff --git a/dir/sp ace.txt b/dir/sp ace.txt"));
  equal(observed.patch.bytes, observed.patch.content.byteLength);
  equal(observed.patch.digest, computeSha256Digest(observed.patch.content));
  // 同一个提交再观察一次，摘要不变。
  const again = await observeGitCommit(repo.root, second);
  equal(again.status === "observed" ? again.patch.digest : "", observed.patch.digest);
});

test("根提交相对空树；合并提交相对第一父提交", async (t) => {
  const repo = await repository(t);
  const rootCommit = repo.commit("root", { "a.txt": "a\n" });
  const mainline = repo.commit("mainline", { "b.txt": "b\n" });
  repo.git("checkout", "--quiet", "-b", "side", rootCommit);
  const side = repo.commit("side", { "x.txt": "x\n" });
  repo.git("checkout", "--quiet", "main");
  repo.git("merge", "--quiet", "--no-ff", "--message", "merge", "side");
  const merge = repo.git("rev-parse", "HEAD");

  const observedRoot = await observeGitCommit(repo.root, rootCommit);
  ok(observedRoot.status === "observed");
  deepEqual(observedRoot.parents, []);
  deepEqual(observedRoot.changedPaths, [{ status: "added", path: "a.txt" }]);

  const observedMerge = await observeGitCommit(repo.root, merge);
  ok(observedMerge.status === "observed");
  deepEqual(observedMerge.parents, [mainline, side]);
  deepEqual(observedMerge.changedPaths, [{ status: "added", path: "x.txt" }]);
});

test("不存在的对象是 missing，不是提交的对象是 not-a-commit；两者都是观察结果而不是错误", async (t) => {
  const repo = await repository(t);
  const commit = repo.commit("only", { "a.txt": "a\n" });
  deepEqual(await observeGitCommit(repo.root, MISSING_OID), {
    status: "missing",
    commitOid: MISSING_OID,
  });
  const tree = repo.git("rev-parse", `${commit}^{tree}`);
  deepEqual(await observeGitCommit(repo.root, tree), {
    status: "not-a-commit",
    commitOid: tree,
    objectType: "tree",
  });
});

test("仓库配置里可执行的东西都不被执行：文件系统监视器、钩子、外部 diff、textconv、分页器", async (t) => {
  const repo = await repository(t);
  const first = repo.commit("first", { "a.txt": "a\n" });
  const marker = path.join(repo.absolutePath, "..", `${path.basename(repo.absolutePath)}.marker`);
  t.after(() => rmSync(marker, { force: true }));
  const tool = path.join(repo.absolutePath, ".git", "hostile.sh");
  writeFileSync(tool, `#!/bin/sh\necho ran >> "${marker}"\ncat "$1" 2>/dev/null\nexit 0\n`);
  chmodSync(tool, 0o755);
  const hooks = path.join(repo.absolutePath, ".git", "hostile-hooks");
  mkdirSync(hooks);
  for (const hook of [
    "post-checkout",
    "pre-commit",
    "reference-transaction",
    "post-index-change",
  ]) {
    writeFileSync(path.join(hooks, hook), `#!/bin/sh\necho hook >> "${marker}"\nexit 0\n`);
    chmodSync(path.join(hooks, hook), 0o755);
  }
  const second = repo.commit("second", {
    "a.txt": "a\nb\n",
    ".gitattributes": "*.txt diff=hostile\n",
  });
  for (const [key, value] of [
    ["core.fsmonitor", tool],
    ["core.hooksPath", hooks],
    ["core.pager", tool],
    ["diff.external", tool],
    ["diff.hostile.textconv", tool],
    ["diff.hostile.command", tool],
  ] as const) {
    repo.git("config", key, value);
  }
  rmSync(marker, { force: true });

  const observed = await observeGitCommit(repo.root, second);
  ok(observed.status === "observed");
  deepEqual(
    observed.changedPaths.map((entry) => entry.path),
    [".gitattributes", "a.txt"],
  );
  equal(await observeGitAncestry(repo.root, first, second), "ancestor");
  equal(existsSync(marker), false, "a program named by the repository configuration was executed");

  // 对照：不带防护的同一条 diff 会执行这些程序，说明样本确实是带电的。
  spawnSync("git", ["--no-pager", "diff-tree", "-p", first, second], {
    cwd: repo.absolutePath,
    encoding: "utf8",
  });
  equal(existsSync(marker), true);
});

test("补丁超过保留上限时不带正文，摘要与字节数仍在；改动路径超过保留条数时标记截断并给出总数", async (t) => {
  const repo = await repository(t);
  repo.commit("first", { "a.txt": "a\n" });
  const line = `${"x".repeat(127)}\n`;
  const large = repo.commit("large", {
    "large.txt": line.repeat(Math.ceil((GIT_PATCH_RETAINED_BYTES_MAXIMUM + 4096) / line.length)),
  });
  const observedLarge = await observeGitCommit(repo.root, large);
  ok(observedLarge.status === "observed");
  equal(observedLarge.patch.content, null);
  ok(observedLarge.patch.bytes > GIT_PATCH_RETAINED_BYTES_MAXIMUM);
  ok(/^sha256:[0-9a-f]{64}$/u.test(observedLarge.patch.digest));

  const many: Record<string, string> = {};
  for (let index = 0; index < 2003; index += 1) many[`many/f${index}.txt`] = "";
  const wide = repo.commit("wide", many);
  const observedWide = await observeGitCommit(repo.root, wide);
  ok(observedWide.status === "observed");
  equal(observedWide.changedPathCount, 2003);
  equal(observedWide.changedPaths.length, 2000);
  equal(observedWide.changedPathsTruncated, true);
});

test("祖先判断：祖先、自身、不是祖先；提交不存在是查询失败", async (t) => {
  const repo = await repository(t);
  const rootCommit = repo.commit("root", { "a.txt": "a\n" });
  const mainline = repo.commit("mainline", { "b.txt": "b\n" });
  repo.git("checkout", "--quiet", "-b", "side", rootCommit);
  const side = repo.commit("side", { "x.txt": "x\n" });
  equal(await observeGitAncestry(repo.root, rootCommit, mainline), "ancestor");
  equal(await observeGitAncestry(repo.root, mainline, mainline), "ancestor");
  equal(await observeGitAncestry(repo.root, mainline, side), "not-ancestor");
  equal(await failureReason(observeGitAncestry(repo.root, MISSING_OID, side)), "query-failure");
});

test("拿不到结论时给稳定的分类：输入不合法、不是仓库、已取消", async (t) => {
  const repo = await repository(t);
  const commit = repo.commit("only", { "a.txt": "a\n" });
  for (const invalid of ["HEAD", "main", "--help", commit.slice(0, 12), commit.toUpperCase(), ""]) {
    equal(await failureReason(observeGitCommit(repo.root, invalid)), "input", invalid);
  }
  equal(await failureReason(observeGitAncestry(repo.root, "HEAD", commit)), "input");

  const plain = await repository(t, false);
  equal(await failureReason(observeGitCommit(plain.root, commit)), "query-failure");

  // 仓库里面的一个普通子目录不是仓库：不拿包着它的那个仓库来回答。
  mkdirSync(path.join(repo.absolutePath, "nested"));
  const nested = await RootedDirectory.open(path.join(repo.absolutePath, "nested"));
  t.after(() => nested.close());
  equal(await failureReason(observeGitCommit(nested, commit)), "query-failure");

  const controller = new AbortController();
  controller.abort();
  await rejects(
    observeGitCommit(repo.root, commit, { signal: controller.signal }),
    OperationAbortedError,
  );
});

test("runner 只认写死的查询：对象号不是完整的十六进制就不启动进程", async (t) => {
  const repo = await repository(t);
  const commit = repo.commit("only", { "a.txt": "a\n" });
  for (const hostile of ["--output=/tmp/x", "HEAD", `${commit} --help`]) {
    await rejects(
      runGitReadOnly({
        kind: "patch",
        repositoryRoot: repo.absolutePath,
        baseOid: null,
        commitOid: hostile,
      }),
      (error: unknown) =>
        error instanceof GitReadOnlyProcessError && error.reason === "query-failure",
      hostile,
    );
  }
  const result = await runGitReadOnly({
    kind: "is-ancestor",
    repositoryRoot: repo.absolutePath,
    ancestorOid: commit,
    descendantOid: commit,
  });
  equal(result.exitCode, 0);
  equal(result.outputBytes, 0);
});
