import { equal } from "node:assert/strict";
import { chmodSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../../src/foundation/filesystem/rooted-directory.js";
import { DemandEventSourcingRepository } from "../../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { useDisposableDurability } from "../../../support/disposable-durability.js";
import { disposableRoot } from "../../../support/temp-root.js";

useDisposableDurability();

/**
 * Demand 事件流的 golden 回放（第 1 级，组件；open-items C3）。
 *
 * 每个事件存着 `resultingStateDigest`，所以历史被当前的 reducer 绑死：reducer、upcaster 或事件 Schema
 * 的任何改动只要让旧事件算出不同的状态，已归档的 Demand 就再也审计不过。场景链只证明"当前代码写的
 * 历史当前代码读得回"；这里放的是**以前的版本写下的真实历史**——`golden-replay/` 下每个目录是一次性
 * 测试工作区里一个已归档 Demand 的全部提交文件（原字节，扩展名改为 `.commit` 以免被当成源码检查），
 * 用当前代码从提交 1 完整审计，并钉住提交数、流修订与最终状态摘要。
 *
 * 这些期望值不随代码改动而更新：审计失败或摘要变了，说明改动破坏了对旧历史的读取，要改的是代码（或
 * 加一个 upcaster），不是这张表。新增语料见同目录的 README。
 */

const CORPUS_ROOT = path.join(
  process.cwd(),
  "tests",
  "governance",
  "demand",
  "event-sourcing",
  "golden-replay",
);

interface GoldenDemand {
  readonly name: string;
  /** 这段历史覆盖的流程，只作说明。 */
  readonly covers: string;
  readonly commits: number;
  readonly streamRevision: number;
  readonly lifecycle: string;
  readonly stateDigest: string;
}

const GOLDEN_DEMANDS: readonly GoldenDemand[] = [
  {
    name: "2026-09-24-escalated-cancelled",
    covers: "blocked 报告、升级、用户决定、取消（一个提交含两个事件）",
    commits: 9,
    streamRevision: 10,
    lifecycle: "cancelled",
    stateDigest: "sha256:ef7026f59e802c20df85979709c42fed2d8218363f2030905a055e0015d174b5",
  },
  {
    name: "2026-09-24-rework-accepted",
    covers: "一次返工后接受并归档",
    commits: 14,
    streamRevision: 14,
    lifecycle: "completed",
    stateDigest: "sha256:1fbfea1af628433f3ccc2a5a400b3ff320f14f94f483a949c4d0db577db9d1a6",
  },
  {
    name: "2026-09-25-implementation-and-test",
    covers: "实现目标加真实环境测试目标，十二条受管证据",
    commits: 24,
    streamRevision: 24,
    lifecycle: "completed",
    stateDigest: "sha256:ccb4527410506676ecf11869508c86048c889805e0b9463eb09bc2cebf442aee",
  },
  {
    name: "2026-10-19-callback-reissued",
    covers: "回调静默后重发",
    commits: 11,
    streamRevision: 11,
    lifecycle: "completed",
    stateDigest: "sha256:e08279c0b3857c8cbdd3d5d3f9e9f196cb366f86c81942c8c41a65d24d0a561c",
  },
  {
    name: "2026-11-02-tmux-1.2.0",
    covers: "带写者戳的提交（1.2.0，tmux 传输的现场 L21）",
    commits: 11,
    streamRevision: 11,
    lifecycle: "completed",
    stateDigest: "sha256:c5b8fa54fb2f7503c1c5f7b9ba297180ed52065398b0d50b7a202dd848c054be",
  },
];

test("语料目录与期望表一一对应：目录多了或少了都要在这里登记", () => {
  const directories = readdirSync(CORPUS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  equal(directories.join("\n"), GOLDEN_DEMANDS.map((demand) => demand.name).join("\n"));
});

for (const demand of GOLDEN_DEMANDS) {
  test(`以前的版本写下的历史仍能从提交 1 完整审计：${demand.name}（${demand.covers}）`, async (t) => {
    // 事件存储只认私有模式的树：语料以普通权限提交，在一次性根里按 0700 / 0600 物化。
    const root = disposableRoot(t, "wakeflow-golden-replay-");
    const commits = path.join(root, "event-sourcing", "commits");
    mkdirSync(commits, { recursive: true, mode: 0o700 });
    chmodSync(path.join(root, "event-sourcing"), 0o700);
    chmodSync(commits, 0o700);
    const files = readdirSync(path.join(CORPUS_ROOT, demand.name)).sort();
    equal(files.length, demand.commits);
    for (const file of files) {
      const target = path.join(commits, file.replace(/\.commit$/u, ".json"));
      copyFileSync(path.join(CORPUS_ROOT, demand.name, file), target);
      chmodSync(target, 0o600);
    }
    const repository = new DemandEventSourcingRepository(await RootedDirectory.open(root));
    const audited = await repository.audit();
    equal(audited.replayedCommitCount, demand.commits);
    equal(audited.aggregate.streamRevision, demand.streamRevision);
    equal(audited.aggregate.state.lifecycle, demand.lifecycle);
    equal(audited.aggregate.stateDigest, demand.stateDigest);
  });
}
