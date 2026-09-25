import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import {
  observeRepositoryPointers,
  repositoryBranchesComplete,
} from "../../../src/governance/observation/repository-pointer-observation.js";
import { WakeflowError } from "../../../src/kernel/error.js";

/**
 * 仓库指针事实（gate-log §13.94 D2）：只读 `.git/HEAD`、`refs/heads/**`、`packed-refs` 与
 * `.git/worktrees/<name>/{gitdir, HEAD}`；报告 HEAD、当前分支、分支尖端、登记的 worktree 与
 * prunable；`.git` 或 HEAD 读不出才整仓 unavailable；从不 spawn git。夹具用真实 git 造出。
 * 分支清单另有第三种结果：读得出但看不全——引用来源读不出时 `issue` 为 `branches-incomplete`，
 * 因为"branches 里没有它"与"仓库里没有它"必须能分辨。
 */

const REPOSITORY_ID = "repository_22222222-2222-4222-8222-222222222222";

function git(cwd: string, ...args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

interface Fixture {
  readonly base: string;
  readonly repository: string;
}

function fixture(t: TestContext): Fixture {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-pointers-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repository = path.join(base, "ProductA");
  mkdirSync(repository);
  git(repository, "init", "--quiet", "--initial-branch=main");
  return { base, repository };
}

async function observe(absolutePath: string, signal?: AbortSignal) {
  return observeRepositoryPointers({
    repositoryId: REPOSITORY_ID,
    absolutePath,
    ...(signal === undefined ? {} : { signal }),
  });
}

test("真实仓库：分支上的 HEAD、松散与打包的分支尖端、登记的 worktree 与 prunable、分离 HEAD", { timeout: 60_000 }, async (t) => {
  const { base, repository } = fixture(t);
  git(repository, "commit", "--quiet", "--allow-empty", "-m", "c1");
  const c1 = git(repository, "rev-parse", "HEAD");
  git(repository, "branch", "feature/x");
  git(repository, "branch", "feature/z");
  git(repository, "commit", "--quiet", "--allow-empty", "-m", "c2");
  const c2 = git(repository, "rev-parse", "HEAD");
  git(repository, "worktree", "add", "--quiet", path.join(base, "wt-x"), "feature/x");
  git(repository, "worktree", "add", "--quiet", "--detach", path.join(base, "wt-d"));
  rmSync(path.join(base, "wt-d"), { recursive: true, force: true });

  const loose = await observe(repository);
  equal(loose.status, "observed");
  equal(loose.issue, null);
  equal(loose.head, c2);
  equal(loose.branch, "main");
  equal(loose.detached, false);
  deepEqual(loose.branches, [
    { name: "feature/x", tip: c1 },
    { name: "feature/z", tip: c1 },
    { name: "main", tip: c2 },
  ]);
  deepEqual(loose.worktrees, [
    { name: "wt-d", head: c2, branch: null, prunable: true },
    { name: "wt-x", head: c1, branch: "feature/x", prunable: false },
  ]);

  // 打包后松散引用消失，事实不变；之后新的松散引用优先于打包记录。
  git(repository, "pack-refs", "--all");
  equal(existsSync(path.join(repository, ".git", "refs", "heads", "main")), false);
  equal(existsSync(path.join(repository, ".git", "packed-refs")), true);
  const packed = await observe(repository);
  deepEqual(packed.branches, loose.branches);
  equal(packed.head, c2);
  equal(packed.branch, "main");
  git(repository, "branch", "-f", "feature/z", "main");
  equal(existsSync(path.join(repository, ".git", "refs", "heads", "feature", "z")), true);
  equal(readFileSync(path.join(repository, ".git", "packed-refs"), "utf8").includes(`${c1} refs/heads/feature/z`), true);
  const overridden = await observe(repository);
  deepEqual(overridden.branches, [
    { name: "feature/x", tip: c1 },
    { name: "feature/z", tip: c2 },
    { name: "main", tip: c2 },
  ]);

  git(repository, "checkout", "--quiet", "--detach");
  const detached = await observe(repository);
  equal(detached.status, "observed");
  equal(detached.head, c2);
  equal(detached.branch, null);
  equal(detached.detached, true);
});

test("gitdir 写相对路径且检出在场：相对该 worktree 管理目录解析，prunable 为 false", { timeout: 60_000 }, async (t) => {
  const { base, repository } = fixture(t);
  git(repository, "commit", "--quiet", "--allow-empty", "-m", "c1");
  const c1 = git(repository, "rev-parse", "HEAD");
  git(repository, "worktree", "add", "--quiet", "--detach", path.join(base, "wt-rel"));
  const gitdirFile = path.join(repository, ".git", "worktrees", "wt-rel", "gitdir");
  writeFileSync(gitdirFile, "../../../../wt-rel/.git\n");
  equal(existsSync(path.join(base, "wt-rel", ".git")), true);

  const observed = await observe(repository);
  equal(observed.status, "observed");
  deepEqual(observed.worktrees, [{ name: "wt-rel", head: c1, branch: null, prunable: false }]);
});

test("不可用：没有 .git、根是 worktree 检出、HEAD 读不出、根打不开各自带原因；单个指针读不出只让对应项为 null", { timeout: 60_000 }, async (t) => {
  const { base, repository } = fixture(t);
  git(repository, "commit", "--quiet", "--allow-empty", "-m", "c1");
  git(repository, "worktree", "add", "--quiet", "--detach", path.join(base, "wt-a"));

  const plain = path.join(base, "Plain");
  mkdirSync(plain);
  equal((await observe(plain)).issue, "git-directory-missing");
  equal((await observe(plain)).status, "unavailable");
  equal((await observe(path.join(base, "wt-a"))).issue, "root-is-worktree");
  equal((await observe(path.join(base, "missing"))).issue, "root-open");

  rmSync(path.join(repository, ".git", "worktrees", "wt-a", "HEAD"));
  const partial = await observe(repository);
  equal(partial.status, "observed");
  deepEqual(partial.worktrees, [{ name: "wt-a", head: null, branch: null, prunable: false }]);

  rmSync(path.join(repository, ".git", "HEAD"));
  const headless = await observe(repository);
  equal(headless.status, "unavailable");
  equal(headless.issue, "head-unreadable");
  deepEqual(headless.branches, []);
});

test("分支清单：引用来源读不出仍是 observed 但带 branches-incomplete，来源本来就不存在不报", { timeout: 60_000 }, async (t) => {
  const { repository } = fixture(t);
  git(repository, "commit", "--quiet", "--allow-empty", "-m", "c1");
  const c1 = git(repository, "rev-parse", "HEAD");
  git(repository, "branch", "feature/x");
  git(repository, "pack-refs", "--all");
  const heads = path.join(repository, ".git", "refs", "heads");
  const packed = path.join(repository, ".git", "packed-refs");

  const baseline = await observe(repository);
  equal(baseline.issue, null);
  equal(repositoryBranchesComplete(baseline), true);
  deepEqual(baseline.branches, [
    { name: "feature/x", tip: c1 },
    { name: "main", tip: c1 },
  ]);

  // refs/heads 列不出（这里是"不是目录"，与符号链接、超出条目上限、io 失败同一类）：
  // 读得到的事实照常报告，但缺席的分支只是没看见，必须说出来。
  rmSync(heads, { recursive: true, force: true });
  writeFileSync(heads, "not a directory\n", { mode: 0o600 });
  const looseUnreadable = await observe(repository);
  equal(looseUnreadable.status, "observed");
  equal(looseUnreadable.issue, "branches-incomplete");
  equal(repositoryBranchesComplete(looseUnreadable), false);
  equal(looseUnreadable.head, c1);
  equal(looseUnreadable.branch, "main");
  deepEqual(looseUnreadable.branches, baseline.branches);

  // 目录本来就不存在：这是读全了的"没有松散引用"，不是读不出。
  rmSync(heads, { force: true });
  const looseAbsent = await observe(repository);
  equal(looseAbsent.status, "observed");
  equal(looseAbsent.issue, null);
  deepEqual(looseAbsent.branches, baseline.branches);

  // packed-refs 是唯一的打包来源：读不出时一个分支都报不出，HEAD 尖端也解析不出来。
  rmSync(packed, { force: true });
  mkdirSync(packed);
  const packedUnreadable = await observe(repository);
  equal(packedUnreadable.status, "observed");
  equal(packedUnreadable.issue, "branches-incomplete");
  equal(repositoryBranchesComplete(packedUnreadable), false);
  deepEqual(packedUnreadable.branches, []);
  equal(packedUnreadable.head, null);
  equal(packedUnreadable.branch, "main");

  // packed-refs 不存在是常态（分支全是松散引用），不能报成读不出。
  rmSync(packed, { recursive: true, force: true });
  mkdirSync(heads, { recursive: true });
  writeFileSync(path.join(heads, "main"), `${c1}\n`, { mode: 0o600 });
  const packedAbsent = await observe(repository);
  equal(packedAbsent.status, "observed");
  equal(packedAbsent.issue, null);
  deepEqual(packedAbsent.branches, [{ name: "main", tip: c1 }]);
});

test("观察从不 spawn git：模块不引用子进程，中止信号照常上抛", async (t) => {
  const { repository } = fixture(t);
  const source = readFileSync(
    fileURLToPath(
      import.meta.resolve("../../../src/governance/observation/repository-pointer-observation.js"),
    ),
    "utf8",
  );
  equal(source.includes("child_process"), false);
  equal(/\bspawn(?:Sync)?\(/u.test(source), false);
  equal(/\bexecFile(?:Sync)?\(/u.test(source), false);
  await rejects(
    observe(repository, AbortSignal.abort()),
    (error: unknown) =>
      error instanceof WakeflowError && error.code === "io-failure" && error.reason === "aborted",
  );
});
