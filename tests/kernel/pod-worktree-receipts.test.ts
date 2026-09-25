import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../src/foundation/time/utc-instant.js";
import { WakeflowError } from "../../src/kernel/error.js";
import {
  admitPodWorktreeObservation,
  candidateWorktreePaths,
  createPodWorktreeReceipt,
  findPodWorktreeReceiptByPath,
  listPodReceiptDirectories,
  listPodWorktreeReceipts,
  listPodWorktreeReceiptsAnyHost,
  parseGitWorktreePorcelain,
  readPodWorktreeReceipt,
  retirePodReceipts,
  retirePodWorktreeReceipt,
  worktreeCheckoutPresent,
  writePodWorktreeReceipt,
} from "../../src/kernel/pod-worktree-receipts.js";

/**
 * worktree 回执（§13.91 D4）：porcelain 解析、用 `.git` 指针文件与 admin 目录核对的准入、
 * 0700/0600 回执存储。宿主由测试代替：真实 `git worktree add` 造出检出。
 */

const POD_ID = "pod_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WINDOW_ID = "window_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPOSITORY_ID = "repository_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BINDING_ID = "window_binding_dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OBSERVED_AT = parseUtcInstant("2026-09-10T10:00:00.000Z");

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
  return result.stdout;
}

function gitFixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-worktree-receipt-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const main = path.join(base, "main");
  mkdirSync(main);
  git(main, "init", "--quiet");
  git(main, "commit", "--quiet", "--allow-empty", "-m", "init");
  const linked = path.join(base, "linked");
  git(main, "worktree", "add", "--quiet", linked, "-b", "feature");
  const detached = path.join(base, "detached");
  git(main, "worktree", "add", "--quiet", "--detach", detached);
  return {
    base,
    main,
    linked,
    detached,
    head: git(main, "rev-parse", "HEAD").trim(),
    porcelain: () => git(linked, "worktree", "list", "--porcelain"),
    commonDir: () => git(linked, "rev-parse", "--git-common-dir").trim(),
  };
}

function failsWith(reason: string, check?: string) {
  return (error: unknown) =>
    error instanceof WakeflowError &&
    error.reason === reason &&
    (check === undefined || error.details?.check === check);
}

test("porcelain 解析：主检出、分支检出、detached、bare 与 locked；未知行与相对路径被拒", () => {
  const entries = parseGitWorktreePorcelain(
    [
      "worktree /repo/main",
      "HEAD 67156fa5b20589e53c555919e15ce373ece0c22d",
      "branch refs/heads/main",
      "",
      "worktree /repo/linked",
      "HEAD 67156fa5b20589e53c555919e15ce373ece0c22d",
      "branch refs/heads/feature",
      "locked reason with spaces",
      "",
      "worktree /repo/detached",
      "HEAD 67156fa5b20589e53c555919e15ce373ece0c22d",
      "detached",
      "prunable gitdir file points to non-existent location",
      "",
      "worktree /repo/bare.git",
      "bare",
      "",
    ].join("\n"),
  );
  deepEqual(
    entries.map((entry) => [
      entry.path,
      entry.branch,
      entry.detached,
      entry.locked,
      entry.prunable,
      entry.bare,
    ]),
    [
      ["/repo/main", "main", false, false, false, false],
      ["/repo/linked", "feature", false, true, false, false],
      ["/repo/detached", null, true, false, true, false],
      ["/repo/bare.git", null, false, false, false, true],
    ],
  );
  for (const [text, check] of [
    ["worktree relative/path\nHEAD 67156fa5b20589e53c555919e15ce373ece0c22d\n", "path"],
    ["HEAD 67156fa5b20589e53c555919e15ce373ece0c22d\n", "orphan-line"],
    ["worktree /repo/x\nHEAD zz\n", "head"],
    ["worktree /repo/x\nHEAD 67156fa5b20589e53c555919e15ce373ece0c22d\nfoo bar\n", "unknown-line"],
    ["worktree /repo/x\nbranch refs/heads/x\n", "head-missing"],
  ] as const) {
    let caught: unknown;
    try {
      parseGitWorktreePorcelain(text);
    } catch (error: unknown) {
      caught = error;
    }
    equal(failsWith("worktree-porcelain", check)(caught), true, check);
  }
});

test("准入：会话 cwd 等于一个非主检出且指针互相印证才通过；主检出、错 common dir、篡改指针都被拒", async (t) => {
  const fixture = gitFixture(t);
  const observation = { porcelain: fixture.porcelain(), commonDir: fixture.commonDir() };
  const admitted = await admitPodWorktreeObservation({
    observation,
    sessionCwd: fixture.linked,
    repositoryRoot: fixture.main,
  });
  deepEqual(admitted, {
    path: fixture.linked,
    head: fixture.head,
    branch: "feature",
    locked: false,
  });
  const detached = await admitPodWorktreeObservation({
    observation,
    sessionCwd: fixture.detached,
    repositoryRoot: fixture.main,
  });
  equal(detached.branch, null);
  equal(detached.head, fixture.head);
  const candidates = await candidateWorktreePaths(observation.porcelain, fixture.main);
  deepEqual([...candidates].sort(), [fixture.detached, fixture.linked].sort());

  await rejects(
    admitPodWorktreeObservation({
      observation,
      sessionCwd: fixture.main,
      repositoryRoot: fixture.main,
    }),
    failsWith("worktree-receipt", "main-checkout"),
  );
  await rejects(
    admitPodWorktreeObservation({
      observation: { ...observation, commonDir: path.join(fixture.base, "elsewhere") },
      sessionCwd: fixture.linked,
      repositoryRoot: fixture.main,
    }),
    failsWith("worktree-receipt", "common-dir"),
  );
  await rejects(
    admitPodWorktreeObservation({
      observation,
      sessionCwd: fixture.base,
      repositoryRoot: fixture.main,
    }),
    failsWith("worktree-receipt", "session-worktree"),
  );
  await rejects(
    admitPodWorktreeObservation({
      observation: {
        ...observation,
        porcelain: observation.porcelain.replace(
          "branch refs/heads/feature",
          "branch refs/heads/other",
        ),
      },
      sessionCwd: fixture.linked,
      repositoryRoot: fixture.main,
    }),
    failsWith("worktree-receipt", "head-mismatch"),
  );
  writeFileSync(path.join(fixture.linked, ".git"), "gitdir: /nowhere/worktrees/linked\n");
  await rejects(
    admitPodWorktreeObservation({
      observation,
      sessionCwd: fixture.linked,
      repositoryRoot: fixture.main,
    }),
    failsWith("worktree-receipt", "gitdir-pointer"),
  );
});

test("回执存储：0700 目录 0600 文件，读回一致，换代替换，退休与整目录清除", async (t) => {
  const fixture = gitFixture(t);
  const workspacePath = path.join(fixture.base, "Workspace");
  mkdirSync(path.join(workspacePath, ".wakeflow-local", "runtime", "hosts", "codex"), {
    recursive: true,
  });
  const root = await RootedDirectory.open(workspacePath);
  t.after(() => root.close());
  const receipt = createPodWorktreeReceipt({
    hostId: "codex",
    podId: POD_ID,
    windowId: WINDOW_ID,
    repositoryId: REPOSITORY_ID,
    bindingId: BINDING_ID,
    worktree: { path: fixture.linked, head: fixture.head, branch: "feature", locked: false },
    observedAt: OBSERVED_AT,
  });
  equal(receipt.receiptDigest.startsWith("sha256:"), true);
  await writePodWorktreeReceipt(root, receipt);
  const file = path.join(
    workspacePath,
    ".wakeflow-local/runtime/hosts/codex/pods",
    POD_ID,
    "worktrees",
    `${REPOSITORY_ID}.json`,
  );
  equal(statSync(file).mode & 0o777, 0o600);
  equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
  deepEqual(await readPodWorktreeReceipt(root, "codex", POD_ID, REPOSITORY_ID), receipt);
  deepEqual(await listPodWorktreeReceipts(root, "codex", POD_ID), [receipt]);
  deepEqual(await listPodWorktreeReceiptsAnyHost(root, POD_ID), [receipt]);
  deepEqual(await listPodReceiptDirectories(root, "codex"), [POD_ID]);
  equal(await worktreeCheckoutPresent(receipt), true);
  // 占用查找（§13.128）：同一检出被另一个 pod 的回执指着即命中；排除自己的 pod；别的路径不命中。
  const otherPod = "pod_ffffffff-ffff-4fff-8fff-ffffffffffff";
  equal(
    (await findPodWorktreeReceiptByPath(root, "codex", fixture.linked, otherPod))?.podId,
    POD_ID,
  );
  equal(await findPodWorktreeReceiptByPath(root, "codex", fixture.linked, POD_ID), null);
  equal(await findPodWorktreeReceiptByPath(root, "codex", fixture.detached, otherPod), null);

  const replaced = createPodWorktreeReceipt({
    hostId: "codex",
    podId: POD_ID,
    windowId: WINDOW_ID,
    repositoryId: REPOSITORY_ID,
    bindingId: "window_binding_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    worktree: { path: fixture.detached, head: fixture.head, branch: null, locked: true },
    observedAt: OBSERVED_AT,
  });
  await writePodWorktreeReceipt(root, replaced);
  equal((await readPodWorktreeReceipt(root, "codex", POD_ID, REPOSITORY_ID))?.branch, null);
  equal(await retirePodWorktreeReceipt(root, "codex", POD_ID, REPOSITORY_ID), true);
  equal(await retirePodWorktreeReceipt(root, "codex", POD_ID, REPOSITORY_ID), false);
  equal(await readPodWorktreeReceipt(root, "codex", POD_ID, REPOSITORY_ID), null);
  await writePodWorktreeReceipt(root, receipt);
  equal(await retirePodReceipts(root, "codex", POD_ID), true);
  equal(existsSync(path.dirname(path.dirname(file))), false);
  equal(await retirePodReceipts(root, "codex", POD_ID), false);
  git(fixture.main, "worktree", "remove", "--force", fixture.linked);
  equal(await worktreeCheckoutPresent(receipt), false);
});
